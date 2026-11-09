import { NetworkError, SsrfError } from './safe-http';
import { ConnectorError } from './sdk';

/** Netzwerk- und SSRF-Fehler einheitlich als ConnectorError. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConnectorError) throw err;
    if (err instanceof NetworkError)
      throw new ConnectorError('network', `Server nicht erreichbar: ${err.message}`);
    if (err instanceof SsrfError)
      throw new ConnectorError('config', `Adresse nicht erlaubt: ${err.message}`);
    throw new ConnectorError('network', `Server nicht erreichbar: ${(err as Error).message}`);
  }
}
