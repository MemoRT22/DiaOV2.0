import { CheckCircle2, Clock, MapPin, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, Button, Spinner } from '../components/ui';
import { fetchActivities, fetchDivisions, fetchMyAttendedSessionIds, formatTime } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';

export default function Missions() {
  const { theme, edition, term, text } = useTheme();
  const { data, error, loading, reload } = useLoad(async () => {
    if (!edition) throw new Error('NO_ACTIVE_EDITION');
    return Promise.all([fetchActivities(edition.id), fetchDivisions(), fetchMyAttendedSessionIds()]);
  }, [edition?.id]);
  const [filter, setFilter] = useState<string | null>(null);

  const [activities, divisions, attended] = data ?? [[], [], new Set<string>()];
  const divisionById = useMemo(() => new Map(divisions.map((d) => [d.id, d])), [divisions]);
  const visible = filter ? activities.filter((a) => a.division_id === filter) : activities;

  if (loading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Button variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
      active ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-line bg-surface text-ink-muted hover:text-ink'
    }`;

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{term('activity', true)}</h1>
        <p className="mt-1 text-sm text-ink-muted">{text('activitiesIntro')}</p>
      </header>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={term('division', true)}>
        <button className={chip(filter === null)} onClick={() => setFilter(null)}>
          Todos
        </button>
        {divisions.map((d) => (
          <button key={d.id} className={chip(filter === d.id)} onClick={() => setFilter(d.id)}>
            {d.name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Alert>{text('activitiesEmpty')}</Alert>
      ) : (
        <ul className="space-y-3">
          {visible.map((a, i) => {
            const division = divisionById.get(a.division_id);
            const color = (division && theme.divisions[division.code]?.color) || theme.colors.secondary;
            const done = a.activity_sessions.some((s) => attended.has(s.id));
            return (
              <li
                key={a.id}
                className="card animate-fade-up overflow-hidden"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <div className="h-1" style={{ background: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
                        {term('division')} · {division?.name}
                      </p>
                      <h2 className="mt-1 text-base font-extrabold">{a.title}</h2>
                    </div>
                    {done && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-500/15 px-2 py-1 text-xs font-semibold text-success-300">
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Completada
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">{a.description}</p>
                  {a.location && (
                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-ink-muted">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {a.location}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.activity_sessions.map((s) => (
                      <span
                        key={s.id}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                          attended.has(s.id) ? 'border-success-500/60 text-success-200' : 'border-line text-ink'
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {formatTime(s.starts_at)}
                        <span className="inline-flex items-center gap-1 text-ink-muted">
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          {s.capacity}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
