import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@jotion/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Keine Telemetrie, keine externen Dienste
  images: { unoptimized: true },
  // In Produktion leitet Caddy /api direkt an die API. Für `pnpm dev` (ohne Caddy) übernimmt Next das.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
