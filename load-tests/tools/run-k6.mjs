#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Uso: npm run k6 -- scenarios/00-preflight.js [opciones de k6]');
  process.exit(2);
}
mkdirSync(resolve(root, 'results'), { recursive: true });
const result = spawnSync('k6', ['run', ...args], { cwd: root, stdio: 'inherit', env: process.env });
if (result.error) {
  console.error(result.error.code === 'ENOENT' ? 'No se encontró k6 en PATH.' : result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
