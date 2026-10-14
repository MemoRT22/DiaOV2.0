#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md', '.env.example', 'REPORT_TEMPLATE.md', 'docs/architecture.md', 'docs/monitoring.md',
  'scenarios/00-preflight.js', 'scenarios/01-static.js', 'scenarios/02-auth.js', 'scenarios/03-navigation.js',
  'scenarios/04-reservations.js', 'scenarios/05-checkin.js', 'scenarios/06-survey.js', 'scenarios/07-realtime.js',
  'scenarios/99-full-day.js', 'tools/generate-data.mjs', 'tools/verify-integrity.sql',
];
const failures = [];
for (const relative of required) {
  try { readFileSync(join(root, relative)); } catch (_) { failures.push(`falta ${relative}`); }
}

const jsFiles = [];
for (const directory of ['config', 'lib', 'scenarios', 'tools']) {
  for (const name of readdirSync(join(root, directory))) if (/\.(?:js|mjs)$/.test(name)) jsFiles.push(join(root, directory, name));
}
for (const file of jsFiles) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) failures.push(`${file}: ${checked.stderr.trim()}`);
}

const env = readFileSync(join(root, 'lib/env.js'), 'utf8');
for (const guard of ['LOADTEST_ALLOW_WRITES', 'TARGET_ENV', 'PRODUCTION_SUPABASE_REFS', 'service_role']) {
  if (!env.includes(guard)) failures.push(`falta guarda de seguridad ${guard}`);
}
const fullDay = readFileSync(join(root, 'scenarios/99-full-day.js'), 'utf8');
for (const cohort of ['navigation', 'reservations', 'checkin', 'survey', 'realtime']) {
  if (!fullDay.includes(`cohort('${cohort}')`)) failures.push(`99-full-day no asigna la cohorte ${cohort}`);
}

if (failures.length) {
  console.error(`Suite inválida:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Suite válida: ${jsFiles.length} archivos JavaScript con sintaxis correcta y guardas obligatorias presentes.`);
