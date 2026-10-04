import { Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Spinner } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { fetchActivities, fetchDivisions, formatTime, SESSION_STATUS_LABELS, type Activity, type Session } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { useTheme } from '../../theme/ThemeProvider';
import { ActivityModal, SessionModal } from './WorkshopModals';

export default function WorkshopsTab() {
  const { edition } = useTheme();
  const editionId = edition?.id ?? '';
  const { data, error, loading, reload } = useLoad(() => Promise.all([fetchDivisions(), fetchActivities(editionId)]), [editionId]);
  const [activity, setActivity] = useState<Partial<Activity> | null>(null);
  const [session, setSession] = useState<Partial<Session> | null>(null);
  const [actionError, setActionError] = useState('');

  if (loading && !data) return <Spinner />;
  if (error || !data || !edition)
    return (
      <Alert tone="error">
        {friendlyError(error)}{' '}
        <button className="font-semibold underline" onClick={reload}>
          Reintentar
        </button>
      </Alert>
    );

  const [divisions, activities] = data;

  const remove = async (kind: 'activity' | 'session', id: string, label: string) => {
    if (!window.confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
    setActionError('');
    try {
      await rpc(kind === 'activity' ? 'delete_activity' : 'delete_session', { p_id: id });
      reload();
    } catch (cause) {
      setActionError(friendlyError(cause));
    }
  };

  const done = () => {
    setActivity(null);
    setSession(null);
    reload();
  };

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setActivity({ division_id: divisions[0]?.id })} disabled={!divisions.length}>
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo taller
        </Button>
      </div>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {divisions.map((d) => {
        const list = activities.filter((a) => a.division_id === d.id);
        return (
          <div key={d.id} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{d.name}</h3>
            {list.length === 0 && <p className="card px-5 py-4 text-sm text-ink-muted">Sin talleres.</p>}
            {list.map((a) => (
              <article key={a.id} className="card p-5">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">
                      {a.title} {a.is_demo && <Badge tone="warning">Prueba</Badge>}
                    </p>
                    <p className="text-sm text-ink-muted">{a.location || 'Sin ubicación'}</p>
                  </div>
                  <button onClick={() => setActivity(a)} className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink" aria-label={`Editar ${a.title}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove('activity', a.id, `el taller "${a.title}" y sus horarios`)}
                    className="rounded-full p-2 text-ink-muted hover:bg-error-500/10 hover:text-error-300"
                    aria-label={`Eliminar ${a.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.activity_sessions.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-raised py-1 pl-3 pr-1 text-xs">
                      <Clock className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                      {formatTime(s.starts_at)}–{formatTime(s.ends_at)} · {s.capacity} lugares
                      {s.location && s.location !== a.location && <span className="text-ink-muted">· {s.location}</span>}
                      {s.status !== 'activa' && <Badge tone={s.status === 'cancelada' ? 'error' : 'neutral'}>{SESSION_STATUS_LABELS[s.status]}</Badge>}
                      <button onClick={() => setSession(s)} className="rounded-full p-1 text-ink-muted hover:text-ink" aria-label="Editar horario">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => remove('session', s.id, `el horario de las ${formatTime(s.starts_at)}`)}
                        className="rounded-full p-1 text-ink-muted hover:text-error-300"
                        aria-label="Eliminar horario"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => setSession({ activity_id: a.id, capacity: 30 })}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-xs font-semibold text-ink-muted hover:border-secondary-400 hover:text-ink"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Horario
                  </button>
                </div>
              </article>
            ))}
          </div>
        );
      })}
      {activity && <ActivityModal initial={activity} divisions={divisions} onClose={() => setActivity(null)} onSaved={done} />}
      {session && (
        <SessionModal
          initial={session}
          activityLocation={activities.find((a) => a.id === session.activity_id)?.location ?? ''}
          eventDate={edition.event_date} onClose={() => setSession(null)}
          onSaved={done}
        />
      )}
    </section>
  );
}
