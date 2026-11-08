import { createHash, randomBytes } from 'node:crypto';
import { guard } from './guard';
import type { SafeHttpClient } from './safe-http';
import { ConnectorError, type OAuthProviderId } from './sdk';

/**
 * Phase 11: OAuth 2.0 (Authorization Code mit PKCE) für Google, Microsoft und Dropbox.
 * Da Jotion selbst gehostet wird, registriert der Admin eine eigene App beim Anbieter und trägt
 * Client-ID und -Secret in der Umgebung ein. Die Rückleitung ist
 * `${JOTION_PUBLIC_URL}/api/integrations/oauth/callback`.
 */

export interface OAuthProvider {
  id: OAuthProviderId;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Zusätzliche Parameter der Autorisierung (Offline-Zugriff, Zustimmung erzwingen) */
  authorizeParams: Record<string, string>;
  /** Scopes, die jede Verbindung zusätzlich braucht (z. B. Refresh-Token bei Microsoft) */
  baseScopes: string[];
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProvider> = {
  google: {
    id: 'google',
    displayName: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // offline: Refresh-Token; consent: auch bei erneuter Verbindung ein Refresh-Token
    authorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    baseScopes: ['openid', 'email'],
  },
  microsoft: {
    id: 'microsoft',
    displayName: 'Microsoft',
    // Mandant über die Umgebung (Standard "common": private und Organisationskonten)
    authorizeUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    authorizeParams: { response_mode: 'query', prompt: 'select_account' },
    baseScopes: ['offline_access', 'User.Read'],
  },
  dropbox: {
    id: 'dropbox',
    displayName: 'Dropbox',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    authorizeParams: { token_access_type: 'offline' },
    baseScopes: [],
  },
};

export interface OAuthClient {
  clientId: string;
  /** Bei Dropbox mit PKCE optional */
  clientSecret: string | null;
  /** Microsoft: Mandant (Standard "common") */
  tenant?: string;
  /** Tests: Autorisierungs- und Token-URL überschreiben */
  authorizeUrl?: string;
  tokenUrl?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Ablauf in ms seit Epoche */
  expiresAt: number;
  scope: string | null;
}

const b64url = (b: Buffer) => b.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

const withTenant = (url: string, client: OAuthClient) =>
  url.replace('{tenant}', encodeURIComponent(client.tenant || 'common'));

export function authorizeUrl(
  provider: OAuthProvider,
  client: OAuthClient,
  opts: { redirectUri: string; state: string; codeChallenge: string; scopes: string[] },
): string {
  const u = new URL(withTenant(client.authorizeUrl ?? provider.authorizeUrl, client));
  const scopes = [...new Set([...provider.baseScopes, ...opts.scopes])];
  const params: Record<string, string> = {
    client_id: client.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    ...provider.authorizeParams,
  };
  if (scopes.length) params.scope = scopes.join(' ');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function tokenRequest(
  http: SafeHttpClient,
  provider: OAuthProvider,
  client: OAuthClient,
  body: Record<string, string>,
  now: number,
): Promise<OAuthTokens> {
  const form = new URLSearchParams({ client_id: client.clientId, ...body });
  if (client.clientSecret) form.set('client_secret', client.clientSecret);
  const res = await guard(() =>
    http.fetch(withTenant(client.tokenUrl ?? provider.tokenUrl, client), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    }),
  );
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body.toString('utf8')) as Record<string, unknown>;
  } catch {
    /* unten behandelt */
  }
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: Refresh-Token widerrufen oder abgelaufen, neu verbinden
    throw new ConnectorError(
      'auth',
      `Anmeldung bei ${provider.displayName} abgelaufen oder widerrufen (${String(json.error ?? res.status)})`,
    );
  }
  if (res.status !== 200 || typeof json.access_token !== 'string')
    throw new ConnectorError(
      'protocol',
      `${provider.displayName}: Token-Abruf fehlgeschlagen (Status ${res.status})`,
    );
  const expiresIn =
    typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in) || 3600;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: now + expiresIn * 1000,
    scope: typeof json.scope === 'string' ? json.scope : null,
  };
}

export function exchangeCode(
  http: SafeHttpClient,
  provider: OAuthProvider,
  client: OAuthClient,
  opts: { code: string; redirectUri: string; codeVerifier: string; now: number },
): Promise<OAuthTokens> {
  return tokenRequest(
    http,
    provider,
    client,
    {
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    },
    opts.now,
  );
}

export async function refreshTokens(
  http: SafeHttpClient,
  provider: OAuthProvider,
  client: OAuthClient,
  refreshToken: string,
  now: number,
): Promise<OAuthTokens> {
  const t = await tokenRequest(
    http,
    provider,
    client,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    now,
  );
  // Manche Anbieter liefern beim Erneuern kein neues Refresh-Token: das alte bleibt gültig
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

/** Geheimnisse einer OAuth-Verbindung (verschlüsselt gespeichert) */
export const tokensToSecrets = (t: OAuthTokens): Record<string, string> => ({
  accessToken: t.accessToken,
  ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}),
  expiresAt: String(t.expiresAt),
});

/** Erneuert das Token, wenn es in weniger als einer Minute abläuft. */
export function needsRefresh(secrets: Record<string, string>, now: number): boolean {
  const exp = Number(secrets.expiresAt ?? 0);
  return !secrets.accessToken || !Number.isFinite(exp) || exp - now < 60_000;
}

/** Umgebungsvariablen der OAuth-Apps (Ausschnitt der Server-Konfiguration) */
export interface OAuthEnv {
  NODE_ENV: string;
  JOTION_GOOGLE_CLIENT_ID: string;
  JOTION_GOOGLE_CLIENT_SECRET: string;
  JOTION_MICROSOFT_CLIENT_ID: string;
  JOTION_MICROSOFT_CLIENT_SECRET: string;
  JOTION_MICROSOFT_TENANT: string;
  JOTION_DROPBOX_CLIENT_ID: string;
  JOTION_DROPBOX_CLIENT_SECRET: string;
  JOTION_INTEGRATION_ENDPOINTS: Record<string, string>;
}

/** Testumgebung: Basis-URLs der Dienste überschreiben (in production ignoriert) */
export function endpointsFromEnv(env: OAuthEnv): Record<string, string> | undefined {
  if (env.NODE_ENV === 'production') return undefined;
  return Object.keys(env.JOTION_INTEGRATION_ENDPOINTS).length
    ? env.JOTION_INTEGRATION_ENDPOINTS
    : undefined;
}

export function oauthClientFromEnv(env: OAuthEnv, provider: OAuthProviderId): OAuthClient | null {
  const ids: Record<OAuthProviderId, [string, string]> = {
    google: [env.JOTION_GOOGLE_CLIENT_ID, env.JOTION_GOOGLE_CLIENT_SECRET],
    microsoft: [env.JOTION_MICROSOFT_CLIENT_ID, env.JOTION_MICROSOFT_CLIENT_SECRET],
    dropbox: [env.JOTION_DROPBOX_CLIENT_ID, env.JOTION_DROPBOX_CLIENT_SECRET],
  };
  const [clientId, secret] = ids[provider];
  if (!clientId.trim()) return null;
  const e = endpointsFromEnv(env) ?? {};
  return {
    clientId: clientId.trim(),
    clientSecret: secret.trim() || null,
    tenant: provider === 'microsoft' ? env.JOTION_MICROSOFT_TENANT : undefined,
    authorizeUrl: e[`oauth:${provider}:authorize`],
    tokenUrl: e[`oauth:${provider}:token`],
  };
}
