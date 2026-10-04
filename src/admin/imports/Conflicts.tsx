import { useState } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { FIELD_LABELS, rpc } from '../../lib/adminApi';
import { formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';

type Conflict = {
  id: string;
  participant_id: string;
  field: string;
  full_name: string;
  email: string;
  imported_value: string | null;
  current_value: string | null;
  corrected_by: string | null;
  corrected_at: string | null;
  created_at: string;
};

export default function Conflicts() {
  const { data, error, loading, reload } = useLoad(() => rpc<Conflict[]>('list_import_conflicts'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const resolve = async (id: string, accept: boolean) => {
    setBusy(id);
    setActionError('');
    try {
      await rpc('resolve_import_conflict', { p_id: id, p_accept: accept });
      await reload();
    } catch (cause) {
      setActionError(friendlyError(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Conflictos de importación</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Datos que llegaron en una importación pero que staff ya había corregido a mano. Elige qué valor se queda.
        </p>
      </header>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : error || !Array.isArray(data) ? (
        <div className="space-y-4">
          <Alert tone="error">{friendlyError(error)}</Alert>
          <Button variant="secondary" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : data.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-muted">No hay conflictos pendientes.</div>
      ) : (
        <ul className="space-y-3">
          {data.map((c) => (
            <li key={c.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.full_name}</p>
                  <p className="text-xs text-ink-muted">{c.email}</p>
                </div>
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{FIELD_LABELS[c.field] ?? c.field}</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-theme border border-line p-3">
                  <p className="text-xs text-ink-muted">
                    Corrección manual{c.corrected_by ? ` de ${c.corrected_by}` : ''}
                    {c.corrected_at ? ` · ${formatDateTime(c.corrected_at)}` : ''}
                  </p>
                  <p className="mt-1 font-semibold">{c.current_value || 'Vacío'}</p>
                </div>
                <div className="rounded-theme border border-warning-500/40 p-3">
                  <p className="text-xs text-ink-muted">Dato del archivo · {formatDateTime(c.created_at)}</p>
                  <p className="mt-1 font-semibold">{c.imported_value || 'Vacío'}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="secondary" loading={busy === c.id} disabled={!!busy} onClick={() => resolve(c.id, false)}>
                  Conservar corrección manual
                </Button>
                <Button variant="ghost" disabled={!!busy} onClick={() => resolve(c.id, true)}>
                  Usar dato del archivo
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
