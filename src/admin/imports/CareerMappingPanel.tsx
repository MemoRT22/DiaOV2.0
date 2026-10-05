import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from '../../components/ui';
import { fetchCareers, type Career } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import type { ReviewPanelContext } from './CsvImport';

export const NO_CAREER = 'none';

function MappingSection({
  unmatched,
  draft,
  setDraft,
  choices,
  busy,
  title,
}: {
  unmatched: { key: string; value: string; count: number; target: string | null }[];
  draft: Record<string, string>;
  setDraft: (d: Record<string, string>) => void;
  choices: Career[];
  busy: boolean;
  title: string;
}) {
  if (!unmatched.length) return null;
  const pending = unmatched.filter((u) => !u.target).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        {pending > 0 ? <Badge tone="warning">{pending} por relacionar</Badge> : <Badge tone="success">Todas relacionadas</Badge>}
      </div>
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
              onChange={(e) => setDraft({ ...draft, [u.key]: e.target.value })}
              disabled={!choices.length || busy}
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
    </div>
  );
}

export default function CareerMappingPanel({ result, options, busy, apply, isDemo }: ReviewPanelContext) {
  const unmatched1 = result.unmatched_careers ?? [];
  const unmatched2 = result.unmatched_careers_2 ?? [];
  const [careers, setCareers] = useState<Career[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft1, setDraft1] = useState<Record<string, string>>(() => ({ ...((options.careerMap as Record<string, string>) ?? {}) }));
  const [draft2, setDraft2] = useState<Record<string, string>>(() => ({ ...((options.careerMap2 as Record<string, string>) ?? {}) }));

  useEffect(() => {
    fetchCareers()
      .then(setCareers)
      .catch((cause) => setLoadError(friendlyError(cause)));
  }, []);

  if (!unmatched1.length && !unmatched2.length) return null;
  const choices = (careers ?? []).filter((c) => c.is_active && (isDemo || !c.is_demo));
  const dirty1 = unmatched1.some((u) => (draft1[u.key] ?? '') !== (u.target ?? ''));
  const dirty2 = unmatched2.some((u) => (draft2[u.key] ?? '') !== (u.target ?? ''));
  const dirty = dirty1 || dirty2;

  return (
    <section className="card space-y-4 p-6">
      <h3 className="text-base font-semibold">Carreras no reconocidas</h3>
      <p className="text-sm text-ink-muted">
        Estos valores del archivo no coinciden con el catálogo oficial. Relaciona cada uno con una carrera oficial, o márcalo como "Sin carrera". La
        decisión se aplica a todas las filas con ese valor y el texto original se conserva.
      </p>
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <MappingSection
        unmatched={unmatched1}
        draft={draft1}
        setDraft={setDraft1}
        choices={choices}
        busy={busy}
        title="Carrera de interés 1"
      />
      <MappingSection
        unmatched={unmatched2}
        draft={draft2}
        setDraft={setDraft2}
        choices={choices}
        busy={busy}
        title="Carrera de interés 2"
      />
      <Button
        variant="secondary"
        loading={busy}
        disabled={!dirty}
        onClick={() =>
          apply({
            ...options,
            careerMap: Object.fromEntries(Object.entries(draft1).filter(([, v]) => v)),
            careerMap2: Object.fromEntries(Object.entries(draft2).filter(([, v]) => v)),
          })
        }
      >
        Aplicar y actualizar vista previa
      </Button>
    </section>
  );
}
