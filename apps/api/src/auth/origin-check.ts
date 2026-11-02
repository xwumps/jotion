import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF-Schutz zusätzlich zu SameSite-Cookies: schreibende Requests aus dem Browser müssen
 * vom eigenen Origin kommen. Requests ohne Origin (CLI, Tests, Server) sind erlaubt,
 * da sie keine Browser-Cookies eines Opfers mitsenden.
 */
export function registerOriginCheck(app: FastifyInstance, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin));
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin) {
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        return reply
          .status(403)
          .send({ error: { code: 'forbidden', message: 'Fremder Ursprung' } });
      }
      return;
    }
    if (!allowed.has(origin)) {
      return reply.status(403).send({ error: { code: 'forbidden', message: 'Fremder Ursprung' } });
    }
  });
}
