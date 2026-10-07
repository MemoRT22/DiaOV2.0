import { Compass, LogOut, Ticket, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses, LoadError, PageSkeleton } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fetchDivisions, fetchProgress } from '../lib/catalog';
import { fetchMyRaffleStatus } from '../lib/raffleApi';
import { useLoad } from '../lib/useLoad';
import { useParticipantSync } from '../lib/useParticipantSync';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { missingAcademicMissionsMessage } from './progressText';
import RankProgress from './RankProgress';
import StampCollection from './StampCollection';

const initials = (name: string | undefined) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·';

/** Pasaporte: the keepsake — who I am, my rank, my collection of stamps, the raffle and my interests. Sign-out lives here. */
export default function PassportPage() {
  const { term, text } = usePublicTheme();
  const { profile, signOut } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchProgress(), fetchDivisions(), fetchMyRaffleStatus().catch(() => null)]),
    [],
  );
  useParticipantSync(reload);

  if (loading && !data) return <PageSkeleton />;
  if (!data) return <LoadError error={error} onRetry={reload} />;

  const [progress, divisions, raffle] = data;
  const visited = new Set(progress.division_ids);
  const showInterestsLink = progress.post_event_interests_prompt && progress.post_event_interests_open;

  return (
    <div className="space-y-6">
      <header className="flex animate-fade-up items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-500 font-display text-xl font-extrabold text-on-primary">
          {initials(profile?.display_name)}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">{term('passport')}</p>
          <h1 className="truncate text-2xl font-extrabold">{profile?.display_name}</h1>
        </div>
      </header>

      <RankProgress progress={progress} full />

      <section aria-label={`Mis ${term('stamp', true).toLowerCase()}`}>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold">Mi colección</h2>
          <span className="text-sm text-ink-muted">
            {visited.size} de {divisions.length} {term('division', true).toLowerCase()}
          </span>
        </div>
        <StampCollection divisions={divisions} visited={visited} />
        <p className="mt-4 text-xs text-ink-muted">
          {progress.stamps} {term('stamp', progress.stamps !== 1).toLowerCase()} · {progress.attended_workshops}{' '}
          {progress.attended_workshops === 1 ? 'taller completado' : 'talleres completados'}
        </p>
      </section>

      <section className="card p-5" aria-label="Sorteo">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-fg-accent" aria-hidden />
          <h2 className="text-base font-extrabold">Sorteo</h2>
        </div>
        {raffle?.has_won ? (
          <div className="mt-4 rounded-theme border border-success-500/40 bg-success-500/10 p-4 text-center">
            <Trophy className="mx-auto h-8 w-8 text-fg-success" aria-hidden />
            <p className="mt-2 font-semibold">¡Ganaste un premio!</p>
            <p className="mt-1 text-sm text-ink-muted">Ya participaste en el sorteo final.</p>
          </div>
        ) : raffle?.raffle_category_name ? (
          <div className="mt-4 rounded-theme border border-accent-500/40 bg-accent-500/10 p-4 text-center">
            <p className="text-sm font-semibold text-ink-muted">Grupo de sorteo desbloqueado</p>
            <p className="mt-1 text-lg font-extrabold text-fg-accent">{raffle.raffle_category_name}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {raffle.academic_tickets} académicos + {raffle.leadership_tickets} liderazgo
            </p>
          </div>
        ) : raffle ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-theme border border-line bg-surface-raised p-3">
                <p className="font-display text-2xl font-extrabold text-fg-brand">{raffle.academic_tickets}</p>
                <p className="text-xs text-ink-muted">Académicos</p>
              </div>
              <div className="rounded-theme border border-line bg-surface-raised p-3">
                <p className="font-display text-2xl font-extrabold text-fg-info">{raffle.leadership_tickets}</p>
                <p className="text-xs text-ink-muted">Liderazgo</p>
              </div>
            </div>
            <p className="text-center text-sm text-ink-muted">
              {raffle.academic_tickets < 3
                ? missingAcademicMissionsMessage(3 - raffle.academic_tickets)
                : raffle.leadership_tickets === 0
                  ? 'Te falta 1 actividad de liderazgo.'
                  : 'Aún no perteneces a ningún grupo de sorteo.'}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Acepta el Aviso de Privacidad para ver tu progreso en el sorteo.</p>
        )}
      </section>

      {(showInterestsLink || progress.post_event_interests_completed) && (
        <section className="card p-5" aria-label="Carreras de interés">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-fg-brand" aria-hidden />
            <h2 className="text-base font-extrabold">{term('interests', true)}</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {progress.post_event_interests_completed ? 'Ya guardaste tus carreras. Puedes revisarlas.' : text('interestsPromptBody')}
          </p>
          <Link to="/destinos" className={buttonClasses(progress.post_event_interests_completed ? 'secondary' : 'primary', 'mt-4')}>
            {progress.post_event_interests_completed ? 'Revisar mis intereses' : 'Elegir carreras'}
          </Link>
        </section>
      )}

      <div className="pt-2 text-center">
        <button
          onClick={() => void signOut()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
