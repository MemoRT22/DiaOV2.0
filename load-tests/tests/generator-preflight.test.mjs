import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { identifiesConfiguredPassword } from '../lib/contracts.js';
import { assertDisjointCohorts } from '../lib/planning.js';

test('el generador marca las contraseñas configuradas y produce cohortes válidas', () => {
  const out = mkdtempSync(join(tmpdir(), 'diaov-k6-'));
  try {
    const run = spawnSync(process.execPath, [resolve('tools/generate-data.mjs'), '--users', '20', '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const sql = readFileSync(join(out, 'seed.sql'), 'utf8');
    const meta = JSON.parse(readFileSync(join(out, 'dataset.meta.json'), 'utf8'));
    const users = JSON.parse(readFileSync(join(out, 'users.json'), 'utf8'));
    assert.match(sql, /auth_user_id, password_configured_at/);
    assert.match(sql, /, now\(\)\s+FROM jsonb_to_recordset/);
    assert.equal(new Set(users.map((user) => user.email)).size, 20);
    assert.equal(assertDisjointCohorts(meta.cohorts, 20), true);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('el contrato del preflight solo acepta password_login', () => {
  assert.equal(identifiesConfiguredPassword({ ok: true, body: { state: 'password_login' } }), true);
  assert.equal(identifiesConfiguredPassword({ ok: true, body: { state: 'password_setup' } }), false);
  assert.equal(identifiesConfiguredPassword({ ok: false, body: { state: 'password_login' } }), false);
});
