import { Check, Compass, Lock, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ProgressRing, ThemedTitle } from '../components/themed';
import { buttonClasses, LoadError, PageSkeleton } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fetchDivisions, fetchMyInterests, fetchProgress } from '../lib/catalog';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';

const DISMISS_KEY = 'diaov.interestsPromptDismissed';

export default function Passport() {
  const { theme, term, text, rankName } = useTheme();
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchProgress(), fetchDivisions(), fetchMyInterests()]),
    [],
  );
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const [progress, divisions, interests] = data;
  const visited = new Set(progress.division_ids);
  const rank = theme.ranks[progress.level - 1];
  const showPrompt = progress.interests_prompt && progress.interests_open && interests.length === 0 && !dismissed;
  const finished = progress.level === 5 || interests.length > 0;

  const remainingActivities = progress.next ? Math.max(progress.next.required_attendances - progress.attendances, 0) : 0;
  const remainingDivisions = progress.next ? Math.max(progress.next.required_divisions - visited.size, 0) : 0;

  const dismissPrompt = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="space-y-6">
      <section className="animate-fade-up text-center">
        <p className="text-sm text-ink-muted">{term('passport')}</p>
        <h1 className="mt-1 text-2xl font-extrabold">{profile?.display_name}</h1>
        <div className="mt-6 flex justify-center">
          <ProgressRing value={progress.level / 5} size={220}>
            <span className="text-xs font-semibold uppercase tracking-widest text-ink-muted">{term('rank')}</span>
            <ThemedTitle className="mt-1 font-display text-5xl font-extrabold">{progress.level}</ThemedTitle>
            <span className="text-xs text-ink-muted">de 5</span>
          </ProgressRing>
        </div>
        <h2 className="mt-4 text-xl font-extrabold text-primary-400">{rank.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">{rank.description}</p>
        <p className="mx-auto mt-4 max-w-sm rounded-theme border border-line bg-surface/70 px-4 py-3 text-sm">
          {progress.next
            ? text('progressNext', {
                activities: remainingActivities,
                activityTerm: term('activity', remainingActivities !== 1).toLowerCase(),
                divisions: progress.next.required_divisions,
                divisionTerm: term('division', progress.next.required_divisions !== 1).toLowerCase(),
                rank: rankName(progress.next.level),
              })
            : text('progressMax')}
          {progress.next && remainingDivisions > 0 && remainingActivities === 0 && (
            <span className="mt-1 block text-xs text-ink-muted">
              Te falta visitar {remainingDivisions} {term('division', remainingDivisions !== 1).toLowerCase()} distinto
              {remainingDivisions !== 1 ? 's' : ''}.
            </span>
          )}
        </p>
      </section>

      {showPrompt && (
        <section className="card relative animate-fade-up overflow-hidden border-primary-500/50 bg-gradient-to-br from-primary-500/15 via-surface to-secondary-500/10 p-5">
          <button
            onClick={dismissPrompt}
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink"
            aria-label="Ocultar recordatorio"
          >
            <X className="h-4 w-4" />
          </button>
          <Compass className="h-6 w-6 text-primary-400" aria-hidden />
          <h2 className="mt-2 pr-6 text-lg font-extrabold">{text('interestsPromptTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{text('interestsPromptBody')}</p>
          <Link to="/destinos" className={buttonClasses('primary', 'mt-4')}>
            Elegir carreras
          </Link>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold">{term('stamp', true)}</h2>
          <span className="text-sm text-ink-muted">
            {visited.size} de {divisions.length} {term('division', true).toLowerCase()}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {divisions.map((d, i) => {
            const on = visited.has(d.id);
            const color = theme.divisions[d.code]?.color ?? theme.colors.secondary;
            return (
              <div
                key={d.id}
                className={`card flex animate-fade-up flex-col items-center gap-2 p-4 text-center transition-all ${on ? '' : 'opacity-60'}`}
                style={{
                  animationDelay: `${i * 50}ms`,
                  borderColor: on ? color : undefined,
                  boxShadow: on ? `0 0 24px -8px ${color}` : undefined,
                }}
              >
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-full border-2"
                  style={{ borderColor: on ? color : 'rgb(var(--line))', background: on ? `${color}22` : undefined }}
                >
                  {on ? <Sparkles className="h-6 w-6" style={{ color }} aria-hidden /> : <Lock className="h-5 w-5 text-ink-muted" aria-hidden />}
                </div>
                <span className="text-xs font-semibold leading-tight">{d.name}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-extrabold">{term('rank', true)}</h2>
        <ol className="card divide-y divide-line">
          {theme.ranks.map((r, i) => {
            const level = i + 1;
            const reached = level <= progress.level;
            return (
              <li key={level} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                    reached ? 'bg-primary-500 text-on-primary' : 'border border-line text-ink-muted'
                  }`}
                >
                  {reached ? <Check className="h-4 w-4" aria-hidden /> : level}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${reached ? 'text-ink' : 'text-ink-muted'}`}>{r.name}</p>
                  <p className="text-xs text-ink-muted">{r.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {finished && (
        <section className="card animate-fade-up p-6 text-center">
          {theme.assets.mascot && <img src={theme.assets.mascot} alt="" loading="lazy" decoding="async" className="mx-auto h-28 w-auto" />}
          <h2 className="mt-3 text-lg font-extrabold">{text('closingTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{text('closingBody')}</p>
        </section>
      )}
    </div>
  );
}
