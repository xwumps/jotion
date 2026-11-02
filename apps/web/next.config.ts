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
};

export default withNextIntl(nextConfig);
