import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const editorSrc = (file: string) => resolve(__dirname, '../../packages/editor/src', file);

// SWC statt esbuild, damit emitDecoratorMetadata für NestJS-DI funktioniert.
// Testdateien teilen sich eine Datenbank und laufen daher nacheinander.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  // Editor-Package aus dem Quellcode laden: sonst landen ESM- und CJS-Kopie von yjs
  // gleichzeitig im Testprozess und Yjs-Typprüfungen schlagen fehl.
  resolve: {
    alias: [
      { find: /^@jotion\/editor\/projection$/, replacement: editorSrc('projection.ts') },
      { find: /^@jotion\/editor$/, replacement: editorSrc('index.ts') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
