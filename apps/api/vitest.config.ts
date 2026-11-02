import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC statt esbuild, damit emitDecoratorMetadata für NestJS-DI funktioniert
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], testTimeout: 15_000 },
});
