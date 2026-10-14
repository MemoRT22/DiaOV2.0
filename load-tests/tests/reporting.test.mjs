import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('el renderizador crea el directorio de salida y conserva métricas/umbrales', () => {
  const root = mkdtempSync(join(tmpdir(), 'diaov-report-'));
  try {
    const input = join(root, 'summary.json');
    const output = join(root, 'nested', 'results', 'report.md');
    writeFileSync(input, JSON.stringify({ metrics: { http_req_duration: { values: { 'p(95)': 100, 'p(99)': 200 }, thresholds: { 'p(99)<500': { ok: true } } } } }));
    const run = spawnSync(process.execPath, [resolve('tools/render-report.mjs'), input, output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(output), true);
    assert.match(readFileSync(output, 'utf8'), /http_req_duration/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
