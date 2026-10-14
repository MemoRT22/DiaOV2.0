import { ENV } from './env.js';

const pad = (text, width) => String(text).padEnd(width);
const fmt = (value, unit = 'ms') => (value === undefined || value === null ? '—' : unit === 'ms' ? `${value.toFixed(0)} ms` : String(value));

/** Resumen final: un archivo JSON completo (para el reporte) y una tabla corta en pantalla. */
export function summarize(name) {
  return function handleSummary(data) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `results/${name}-${ENV.profile}-${stamp}.json`;
    const lines = [`\n== ${name} · perfil ${ENV.profile} · escala ${ENV.scale} · escrituras ${ENV.writes ? 'HABILITADAS' : 'deshabilitadas (solo lectura)'} ==`];
    const interesting = Object.entries(data.metrics).filter(([key]) => /^(infra_errors|auth_success|auth_login_ms|auth_429|rate_limited_responses|static_|realtime_|reserve_|checkin_|survey_|integrity_|business_rejections|unexpected_rejections|http_req_duration|http_reqs|iterations|vus_max)/.test(key));
    for (const [key, metric] of interesting) {
      const v = metric.values;
      const detail = v['p(95)'] !== undefined
        ? `p95 ${fmt(v['p(95)'])} · p99 ${fmt(v['p(99)'])} · med ${fmt(v.med)} · máx ${fmt(v.max)}`
        : v.rate !== undefined ? `tasa ${(v.rate * 100).toFixed(2)} %` : v.count !== undefined ? `total ${v.count}` : JSON.stringify(v);
      lines.push(`${pad(key, 56)} ${detail}`);
    }
    const failed = Object.entries(data.metrics).flatMap(([key, metric]) => Object.entries(metric.thresholds || {}).filter(([, t]) => !t.ok).map(([rule]) => `${key}: ${rule}`));
    lines.push(failed.length ? `\nUMBRALES NO CUMPLIDOS (${failed.length}):\n  - ${failed.join('\n  - ')}` : '\nTodos los umbrales se cumplieron.');
    lines.push(`Resultados completos: ${file}\n`);
    return { [file]: JSON.stringify(data, null, 2), stdout: lines.join('\n') };
  };
}
