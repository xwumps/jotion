import { defineConfig } from 'vitest/config';

// Vergleichstests laufen gegen eine echte PostgreSQL (DATABASE_URL, *_test).
export default defineConfig({
  test: { testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
