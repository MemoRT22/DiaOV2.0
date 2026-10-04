import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from '../../components/ui';
import { fetchCareers, type Career } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import type { ReviewPanelContext } from './CsvImport';

export const NO_CAREER = 'none';

export default function CareerMappingPanel({ result, options, busy, apply, isDemo }: ReviewPanelContext) {
  const unmatched = result.unmatched_careers ?? [];
  const [careers, setCareers] = useState<Career[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...((options.careerMap as Record<string, string>) ?? {}) }));

  useEffect(() => {
    fetchCareers()
      .then(setCareers)
      .catch((cause) => setLoadError(friendlyError(cause)));
  }, []);

  if (!unmatched.length) return null;
  const choices = (careers ?? []).filter((c) => c.is_active && (isDemo || !c.is_demo));
  const pending = unmatched.filter((u) => !u.target).length;
  const dirty = unmatched.some((u) => (draft[u.key] ?? '') !== (u.target ?? ''));

  return (
    <section className="card space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">Carreras no reconocidas</h3>
        {pending > 0 ? <Badge tone="warning">{pending} por relacionar</Badge> : <Badge tone="success">Todas relacionadas</Badge>}
      </div>
      <p className="text-sm text-ink-muted">
        Estos valores del archivo no coinciden con el catálogo oficial. Relaciona cada uno con una carrera oficial, o márcalo como "Sin carrera". La
        decisión se aplica a todas las filas con ese valor y el texto original se conserva.
      </p>
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <ul className="divide-y divide-line rounded-theme border border-line">
        {unmatched.map((u) => (
          <li key={u.key} className="grid gap-3 p-4 sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-center">
            <div>
              <p className="font-semibold">"{u.value}"</p>
              <p className="text-xs text-ink-muted">
                {u.count} {u.count === 1 ? 'fila' : 'filas'}
              </p>
            </div>
            <select
              aria-label={`Carrera oficial para ${u.value}`}
              value={draft[u.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [u.key]: e.target.value }))}
              disabled={!careers || busy}
              className={`w-full rounded-theme border bg-surface px-3 py-2 text-sm text-ink focus:border-secondary-400 focus:outline-none ${
                draft[u.key] ? 'border-line' : 'border-warning-400'
              }`}
            >
              <option value="">Elige una carrera oficial…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NO_CAREER}>Sin carrera (dejar vacía)</option>
            </select>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        loading={busy}
        disabled={!dirty}
        onClick={() => apply({ ...options, careerMap: Object.fromEntries(Object.entries(draft).filter(([, v]) => v)) })}
      >
        Aplicar y actualizar vista previa
      </Button>
    </section>
  );
}
