import { GitMerge } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Spinner } from '../../components/ui';
import { FIELD_LABELS, rpc } from '../../lib/adminApi';
import { formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';

export type ImportConflict = {
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

type Props = {
  /** Only the conflicts of this participant (used inside the expediente). */
  participantId?: string;
  heading?: string;
  description?: string;
  /** Render nothing when there is nothing to review. */
  hideWhenEmpty?: boolean;
  onChange?: () => void;
};

/**
 * Resolution of data that an import brought but a person had already corrected by hand. It lives inside the import
 * flow and the participant's expediente: an import never overwrites a manual correction silently, and each decision
 * is audited server-side (`participants.conflict_resolved`).
 */
export default function ConflictReview({
  participantId,
  heading = 'Registros que requieren revisión',
  description = 'Estos datos llegaron en una importación, pero alguien ya los había corregido a mano. Elige cuál se queda.',
  hideWhenEmpty = false,
  onChange,
}: Props) {
  const { data, error, loading, reload } = useLoad(async () => {
    const rows = await rpc<ImportConflict[]>('list_import_conflicts');
    if (!Array.isArray(rows)) throw new Error('SERVER_ERROR');
    return participantId ? rows.filter((c) => c.participant_id === participantId) : rows;
  }, [participantId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const resolve = async (id: string, accept: boolean) => {
    setBusy(id);
    setActionError('');
    try {
      await rpc('resolve_import_conflict', { p_id: id, p_accept: accept });
      await reload();
      onChange?.();
    } catch (cause) {
      setActionError(friendlyError(cause));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Button variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    );
  }
  if (data.length === 0) {
    if (hideWhenEmpty) return null;
    return <div className="card p-6 text-center text-sm text-ink-muted">No hay registros pendientes de revisión.</div>;
  }

  return (
    <section aria-label={heading} className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="rounded-theme bg-warning-500/10 p-2 text-fg-warning"><GitMerge className="h-5 w-5" aria-hidden /></span>
        <div>
          <h2 className="text-lg font-bold">
            {data.length} {data.length === 1 ? 'dato requiere revisión' : 'datos requieren revisión'}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        </div>
      </div>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      <ul className="space-y-3">
        {data.map((c) => (
          <li key={c.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                {participantId ? (
                  <p className="font-semibold">{FIELD_LABELS[c.field] ?? c.field}</p>
                ) : (
                  <>
                    <Link to={`/coordinacion/participantes/${c.participant_id}`} className="font-semibold hover:text-fg-info">{c.full_name}</Link>
                    <p className="text-xs text-ink-muted">{c.email}</p>
                  </>
                )}
              </div>
              {!participantId && (
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{FIELD_LABELS[c.field] ?? c.field}</span>
              )}
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
    </section>
  );
}
