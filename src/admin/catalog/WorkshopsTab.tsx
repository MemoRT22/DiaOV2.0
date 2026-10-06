import { Briefcase, Clock, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Spinner } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { fetchActivities, fetchCareers, fetchDivisions, formatTime, SESSION_STATUS_LABELS, type Activity, type Career, type Session } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { fetchActivityCareers } from '../../lib/recommendationsApi';
import { fetchSessionCounts } from '../../lib/reservations';
import { useLoad } from '../../lib/useLoad';
import { useEdition } from '../../edition/EditionProvider';
import { ActivityModal, CareersModal, LocationModal, SessionModal } from './WorkshopModals';

export default function WorkshopsTab() {
  const { edition } = useEdition();
  const editionId = edition?.id ?? '';
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchDivisions(), fetchActivities(editionId), fetchSessionCounts(), fetchCareers()]),
    [editionId],
  );
  const [activity, setActivity] = useState<Partial<Activity> | null>(null);
  const [session, setSession] = useState<Partial<Session> | null>(null);
  const [moving, setMoving] = useState<Session | null>(null);
  const [careersModal, setCareersModal] = useState<{ activity: Activity; careerIds: string[] } | null>(null);
  const [careersBusy, setCareersBusy] = useState(false);
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

  const [divisions, activities, counts, careers] = data;
  const reservedOf = (id?: string) => (id && counts.get(id)) || 0;

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

  const openCareers = async (a: Activity) => {
    setCareersBusy(true);
    try {
      const ids = await fetchActivityCareers(a.id);
      setCareersModal({ activity: a, careerIds: ids });
    } catch (cause) {
      setActionError(friendlyError(cause));
    } finally {
      setCareersBusy(false);
    }
  };

  const done = () => {
    setActivity(null);
    setSession(null);
    setMoving(null);
    setCareersModal(null);
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
                      {a.title} {a.is_demo && <Badge tone="warning">Prueba</Badge>} {a.activity_type === 'liderazgo' && <Badge tone="success">Liderazgo</Badge>}
                    </p>
                    <p className="text-sm text-ink-muted">{a.location || 'Sin ubicación'}</p>
                  </div>
                  <button
                    onClick={() => openCareers(a)}
                    disabled={careersBusy}
                    className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink"
                    aria-label={`Carreras relacionadas de ${a.title}`}
                    title="Carreras relacionadas"
                  >
                    <Briefcase className="h-4 w-4" />
                  </button>
                  <button onClick={() => setActivity(a)} className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink" aria-label={`Editar ${a.title}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove('activity', a.id, `el taller "${a.title}" y sus horarios`)}
                    className="rounded-full p-2 text-ink-muted hover:bg-error-500/10 hover:text-fg-error"
                    aria-label={`Eliminar ${a.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.activity_sessions.map((s) => {
                    const reserved = reservedOf(s.id);
                    return (
                    <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-raised py-1 pl-3 pr-1 text-xs">
                      <Clock className="h-3.5 w-3.5 text-ink-muted" aria-hidden />
                      {formatTime(s.starts_at)}–{formatTime(s.ends_at)} ·{' '}
                      <span className={reserved >= s.capacity ? 'font-semibold text-fg-error' : ''}>
                        {reserved}/{s.capacity} reservados · quedan {Math.max(s.capacity - reserved, 0)}
                      </span>
                      {s.credits > 1 && <span className="text-ink-muted">· {s.credits} sellos</span>}
                      {s.location && s.location !== a.location && <span className="text-ink-muted">· {s.location}</span>}
                      {s.status !== 'activa' && <Badge tone={s.status === 'cancelada' ? 'error' : 'neutral'}>{SESSION_STATUS_LABELS[s.status]}</Badge>}
                      <button onClick={() => setSession(s)} className="rounded-full p-1 text-ink-muted hover:text-ink" aria-label="Editar horario">
                        <Pencil className="h-3 w-3" />
                      </button>
                      {reserved > 0 && (
                        <button onClick={() => setMoving(s)} className="rounded-full p-1 text-ink-muted hover:text-ink" aria-label="Cambiar ubicación" title="Cambiar ubicación">
                          <MapPin className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => remove('session', s.id, `el horario de las ${formatTime(s.starts_at)}`)}
                        className="rounded-full p-1 text-ink-muted hover:text-fg-error"
                        aria-label="Eliminar horario"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                    );
                  })}
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
          reserved={reservedOf(session.id)}
          activityLocation={activities.find((a) => a.id === session.activity_id)?.location ?? ''}
          eventDate={edition.event_date} onClose={() => setSession(null)}
          onSaved={done}
        />
      )}
      {moving && <LocationModal session={moving} reserved={reservedOf(moving.id)} onClose={() => setMoving(null)} onSaved={done} />}
      {careersModal && (
        <CareersModal
          activity={careersModal.activity}
          careers={careers as Career[]}
          initialCareerIds={careersModal.careerIds}
          onClose={() => setCareersModal(null)}
          onSaved={done}
        />
      )}
    </section>
  );
}
