#!/usr/bin/env node
// Startet die Prisma-CLI, aufgelöst relativ zu @jotion/db. Wird in den Docker-Images
// für `generate` und `migrate deploy` genutzt, unabhängig vom pnpm-Layout.
// Eigener Prozess, weil die CLI nur als Hauptmodul startet.
const { spawnSync } = require('node:child_process');

const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
