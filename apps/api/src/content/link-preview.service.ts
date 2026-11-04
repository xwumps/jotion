import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LinkPreviewDto } from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { RateLimitService } from '../common/rate-limit.service';
import { SafeHttpClient, SsrfError } from '../common/safe-http';
import { SERVER_ENV } from '../config/config.module';
import { RedisService } from '../infra/redis.service';
import { PermissionService } from '../permissions/permission.service';
import { decodeBody, parseOpenGraph } from './og-parser';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const FAILURE_TTL_SECONDS = 10 * 60;

/** Link-Vorschau für Bookmarks: OpenGraph-Daten über den SSRF-geschützten HTTP-Client. */
@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger('LinkPreview');
  private readonly http: SafeHttpClient;

  constructor(
    private readonly perms: PermissionService,
    private readonly redis: RedisService,
    private readonly limits: RateLimitService,
    @Inject(SERVER_ENV) env: ServerEnv,
  ) {
    this.http = new SafeHttpClient({
      allowlist: env.JOTION_SSRF_ALLOWLIST,
      timeoutMs: 5000,
      maxBytes: 512 * 1024,
      maxRedirects: 3,
    });
  }

  async preview(user: AuthUser, workspaceId: string, rawUrl: string): Promise<LinkPreviewDto> {
    await this.perms.requireMember(user.id, workspaceId);
    let url: string;
    try {
      const u = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
      u.hash = '';
      url = u.toString();
    } catch {
      throw new AppError('bad_request', 'Ungültige URL');
    }
    const key = `jotion:linkpreview:${createHash('sha256').update(url).digest('hex')}`;
    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as LinkPreviewDto;

    await this.limits.hit(`linkpreview:${user.id}`, 60, 60);
    const fallback = (): LinkPreviewDto => ({
      url,
      title: null,
      description: null,
      image: null,
      siteName: new URL(url).hostname.replace(/^www\./, ''),
      favicon: null,
    });
    let result: LinkPreviewDto;
    try {
      const res = await this.http.get(url);
      const isHtml = /text\/html|application\/xhtml/i.test(res.contentType);
      result =
        res.status >= 200 && res.status < 300 && isHtml
          ? { ...parseOpenGraph(decodeBody(res.body, res.contentType), res.url), url }
          : fallback();
    } catch (err) {
      if (err instanceof SsrfError && /nicht erlaubt|Nur |Ungültige|Zugangsdaten/.test(err.message))
        throw new AppError('bad_request', err.message);
      this.logger.debug(`Vorschau für ${new URL(url).hostname} fehlgeschlagen: ${String(err)}`);
      result = fallback();
      await this.redis.client
        .set(key, JSON.stringify(result), 'EX', FAILURE_TTL_SECONDS)
        .catch(() => undefined);
      return result;
    }
    await this.redis.client
      .set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return result;
  }
}
