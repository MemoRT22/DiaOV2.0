import { Check, Compass, Lock, Sparkles, Target, Ticket, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ProgressRing, ThemedTitle } from '../components/themed';
import { buttonClasses, LoadError, PageSkeleton } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fetchDivisions, fetchMyInterests, fetchProgress } from '../lib/catalog';
import { fetchMyRaffleStatus } from '../lib/raffleApi';
import { useLoad } from '../lib/useLoad';
import ScanButton from './ScanButton';
import { useTheme } from '../theme/ThemeProvider';

const DISMISS_KEY = 'diaov.interestsPromptDismissed';

export default function Passport() {
  const { theme, term, text, rankName } = useTheme();
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchProgress(), fetchDivisions(), fetchMyInterests(), fetchMyRaffleStatus().catch(() => null)]),
    [],
  );
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const [progress, divisions, interests, raffle] = data;
  const visited = new Set(progress.division_ids);
  const rank = theme.ranks[progress.level - 1];
  const showPrompt = progress.interests_prompt && progress.interests_open && interests.length === 0 && !dismissed;
  const finished = progress.level === 5 || interests.length > 0;
  const showBrujulaPrompt = progress.interests_prompt && progress.interests_open;

  const remainingStamps = progress.next ? Math.max(progress.next.required_attendances - progress.stamps, 0) : 0;
  const remainingDivisions = progress.next ? Math.max(progress.next.required_divisions - visited.size, 0) : 0;

  const dismissPrompt = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="space-y-6">
      <ScanButton />

      <section className="card animate-fade-up grid grid-cols-3 gap-2 p-4 text-center">
        <div>
          <p className="font-display text-2xl font-extrabold text-primary-400">{progress.reserved_workshops}</p>
          <p className="text-xs text-ink-muted">Reservados</p>
        </div>
        <div>
          <p className="font-display text-2xl font-extrabold text-secondary-300">{progress.attended_workshops}</p>
          <p className="text-xs text-ink-muted">Asistidos</p>
        </div>
        <div>
          <p className="font-display text-2xl font-extrabold text-accent-400">{progress.stamps}</p>
          <p className="text-xs text-ink-muted">{term('stamp', true)}</p>
        </div>
      </section>

      <section className="card animate-fade-up p-5">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-accent-400" aria-hidden />
          <h2 className="text-base font-extrabold">Tickets para el sorteo</h2>
        </div>
        {raffle?.has_won ? (
          <div className="mt-4 rounded-theme border border-success-500/40 bg-success-500/10 p-4 text-center">
            <Trophy className="mx-auto h-8 w-8 text-success-400" aria-hidden />
            <p className="mt-2 font-semibold text-success-300">¡Ganaste un premio!</p>
            <p className="mt-1 text-sm text-ink-muted">Ya participaste en el sorteo final.</p>
          </div>
        ) : raffle?.raffle_category_name ? (
          <div className="mt-4 rounded-theme border border-accent-500/40 bg-accent-500/10 p-4 text-center">
            <p className="text-sm font-semibold text-ink-muted">Grupo de sorteo desbloqueado</p>
            <p className="mt-1 text-lg font-extrabold text-accent-400">{raffle.raffle_category_name}</p>
            <p className="mt-1 text-sm text-ink-muted">{raffle.academic_tickets} académicos + {raffle.leadership_tickets} liderazgo</p>
          </div>
        ) : raffle ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-theme border border-line bg-surface-raised p-3">
                <p className="font-display text-2xl font-extrabold text-primary-400">{raffle.academic_tickets}</p>
                <p className="text-xs text-ink-muted">Académicos</p>
              </div>
              <div className="rounded-theme border border-line bg-surface-raised p-3">
                <p className="font-display text-2xl font-extrabold text-secondary-300">{raffle.leadership_tickets}</p>
                <p className="text-xs text-ink-muted">Liderazgo</p>
              </div>
            </div>
            <p className="text-center text-sm text-ink-muted">
              {raffle.academic_tickets < 3
                ? `Te falta completar ${3 - raffle.academic_tickets} misión${3 - raffle.academic_tickets !== 1 ? 'es' : ''} académica${3 - raffle.academic_tickets !== 1 ? 's' : ''}.`
                : raffle.leadership_tickets === 0
                  ? 'Te falta 1 actividad de liderazgo.'
                  : 'Aún no perteneces a ningún grupo de sorteo.'}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Acepta el Aviso de Privacidad para ver tu progreso en el sorteo.</p>
        )}
      </section>

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
                activities: remainingStamps,
                activityTerm: term('stamp', remainingStamps !== 1).toLowerCase(),
                divisions: progress.next.required_divisions,
                divisionTerm: term('division', progress.next.required_divisions !== 1).toLowerCase(),
                rank: rankName(progress.next.level),
              })
            : text('progressMax')}
          {progress.next && remainingDivisions > 0 && remainingStamps === 0 && (
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
          <h2 className="mt-2 pr-6 text-lg font-extrabold">Descubre tu Brújula Vocacional</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Explora las conexiones entre los talleres que cursaste y las carreras que podrías considerar.
          </p>
          <Link to="/destinos" className={buttonClasses('primary', 'mt-4')}>
            Abrir mi Brújula
          </Link>
        </section>
      )}

      {progress.interests_prompt && !showPrompt && interests.length > 0 && progress.attended_workshops < 4 && (
        <section className="card animate-fade-up p-4">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-secondary-300" aria-hidden />
            <h2 className="text-sm font-semibold">Encuentra tu siguiente taller</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Tienes carreras de interés. Te ayudamos a encontrar talleres relacionados.
          </p>
          <Link to="/misiones" className={buttonClasses('secondary', 'mt-3')}>
            Ver recomendados
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
          {showBrujulaPrompt && (
            <Link to="/destinos" className={buttonClasses('secondary', 'mt-4')}>
              <Compass className="mr-1.5 h-4 w-4" />
              Ver mi Brújula Vocacional
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
