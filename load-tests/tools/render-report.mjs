#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const input = process.argv[2];
const output = process.argv[3] || `results/report-${Date.now()}.md`;
if (!input) {
  console.error('Uso: npm run report -- results/<summary>.json [results/reporte.md]');
  process.exit(2);
}
const data = JSON.parse(readFileSync(resolve(input), 'utf8'));
const metrics = data.metrics || {};
const metric = (name) => metrics[name]?.values || {};
const n = (value, suffix = '') => value === undefined ? '—' : `${Number(value).toFixed(2)}${suffix}`;
const failed = Object.entries(metrics).flatMap(([name, item]) => Object.entries(item.thresholds || {}).filter(([, t]) => !t.ok).map(([rule]) => `${name}: ${rule}`));
const rows = Object.entries(metrics)
  .filter(([name]) => /^(http_req_duration|infra_errors|auth_|static_|reserve_|checkin_|survey_|realtime_|integrity_)/.test(name))
  .map(([name, item]) => `| ${name} | ${n(item.values?.['p(95)'], ' ms')} | ${n(item.values?.['p(99)'], ' ms')} | ${n(item.values?.rate === undefined ? item.values?.count : item.values.rate * 100, item.values?.rate === undefined ? '' : ' %')} |`)
  .join('\n');
const markdown = `# Reporte de rendimiento Día OV 2026\n\n- Fuente: \`${basename(input)}\`\n- Generado: ${new Date().toISOString()}\n- Resultado de umbrales: ${failed.length ? 'FALLA' : 'OK'}\n\n## Resumen ejecutivo\n\n[Completar impacto observado, capacidad sostenible y decisión go/no-go.]\n\n## Métricas\n\n| Métrica | p95 | p99 | Tasa / total |\n|---|---:|---:|---:|\n${rows}\n\n## Umbrales incumplidos\n\n${failed.length ? failed.map((x) => `- ${x}`).join('\n') : '- Ninguno.'}\n\n## Cuellos de botella y correlación\n\n[Relacionar intervalos de k6 con Supabase Auth, Postgres, Edge Functions, Realtime y Netlify.]\n\n## Integridad\n\n[Adjuntar salida de tools/verify-integrity.sql. Todas las violaciones deben ser 0.]\n\n## Recomendaciones\n\n1. [Acción, responsable y fecha.]\n2. [Capacidad o configuración a ajustar.]\n3. [Prueba de confirmación.]\n`;
const outputPath = resolve(output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, markdown);
console.log(outputPath);
