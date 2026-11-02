# syntax=docker/dockerfile:1.7
# Ein Dockerfile für alle Jotion-Dienste. Targets: web, api, worker.

# Alpine enthält bereits libssl3 (für Prisma); keine Paketinstallation nötig
ARG NODE_IMAGE=node:22-alpine

# ---------- Basis mit pnpm ----------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN corepack enable
WORKDIR /repo

# ---------- Abhängigkeiten + Build ----------
# Optional: zusätzliches CA-Zertifikat für Builds hinter einem TLS-Proxy (Firma, Schule).
# Übergabe als Build-Secret "extra_ca" (siehe JOTION_BUILD_CA in .env.example).
FROM base AS build
COPY docker/with-extra-ca.sh /usr/local/bin/with-extra-ca
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    with-extra-ca pnpm install --frozen-lockfile
COPY . .
RUN --mount=type=secret,id=extra_ca,required=false \
    with-extra-ca sh -c 'pnpm --filter @jotion/db generate && pnpm build'
# Produktions-Abhängigkeiten pro Dienst isolieren
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    with-extra-ca sh -c '\
      pnpm --filter @jotion/api deploy --legacy --prod /out/api && \
      pnpm --filter @jotion/worker deploy --legacy --prod /out/worker && \
      for d in api worker; do \
        (cd "$(realpath /out/$d/node_modules/@jotion/db)" && node bin/prisma.cjs generate) || exit 1; \
      done'

# ---------- Laufzeit-Basis ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Signal-Weitergabe und Zombie-Reaping übernimmt `init: true` in compose.yml

# ---------- api (auch für Migrationen) ----------
FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
# Volume-Ziel vorab anlegen, damit es dem Laufzeitnutzer gehört
RUN mkdir -p /data/files && chown -R node:node /data
ENV JOTION_FILES_DIR=/data/files
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---------- worker ----------
FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
RUN mkdir -p /data/files /data/backups && chown -R node:node /data
ENV JOTION_FILES_DIR=/data/files
USER node
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]

# ---------- web (Next.js standalone) ----------
FROM runtime AS web
ENV PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
