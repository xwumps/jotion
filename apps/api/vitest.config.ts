import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC statt esbuild, damit emitDecoratorMetadata für NestJS-DI funktioniert.
// Testdateien teilen sich eine Datenbank und laufen daher nacheinander.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
