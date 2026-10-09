import { Compass, LogOut, Rocket, Ticket, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses, PageSkeleton } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fetchDivisions, fetchProgress } from '../lib/catalog';
import { fetchMyRaffleStatus } from '../lib/raffleApi';
import { useLoad } from '../lib/useLoad';
import { useParticipantSync } from '../lib/useParticipantSync';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { LOGBOOK, MISSION } from './copy';
import { missingAcademicMissionsMessage } from './progressText';
import RankProgress from './RankProgress';
import StampCollection from './StampCollection';
import { GuideTip } from './ui/Guide';
import { ErrorState } from './ui/States';

const initials = (name: string | undefined) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·';

/**
 * Bitácora de Explorador (route `/pasaporte`): the keepsake — a cover with who I am and my rank, the constellation of
 * ranks, my stamps, the raffle and my interests. Sign-out lives here.
 */
export default function PassportPage() {
  const { theme, term, text, rankName } = usePublicTheme();
  const { profile, signOut } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchProgress(), fetchDivisions(), fetchMyRaffleStatus().catch(() => null)]),
    [],
  );
  useParticipantSync(reload);

  if (loading && !data) return <PageSkeleton />;
  if (!data) return <ErrorState error={error} onRetry={reload} />;

  const [progress, divisions, raffle] = data;
  const visited = new Set(progress.division_ids);
  const showInterestsLink = progress.post_event_interests_prompt && progress.post_event_interests_open;

  return (
    <div className="space-y-6">
      {/* cover of the logbook */}
      <header className="passport-cover relative animate-fade-up overflow-hidden rounded-theme border border-line p-5">
        <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border border-primary-400/30" aria-hidden />
        <span className="pointer-events-none absolute -right-2 -top-2 h-24 w-24 rounded-full border border-dashed border-secondary-400/30" aria-hidden />
        <div className="relative flex items-center justify-between gap-3">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-fg-brand">{LOGBOOK.full}</p>
          {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-7 w-7 object-contain opacity-90" />}
        </div>
        <div className="relative mt-4 flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-500 font-display text-xl font-extrabold text-on-primary shadow-[0_0_0_3px_rgb(var(--surface-raised)),0_0_0_5px_rgb(var(--c-primary-400)/0.8)]">
            {initials(profile?.display_name)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold">{profile?.display_name}</h1>
            <p className="truncate text-sm font-semibold text-fg-brand">{rankName(progress.level)}</p>
            <p className="text-xs text-ink-muted">{[theme.meta.eventName, theme.meta.editionLabel].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <dl className="relative mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-theme border border-line bg-surface/60 flex flex-col-reverse px-2 py-2.5">
            <dt className="mt-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-ink-muted">{term('stamp', progress.stamps !== 1)}</dt>
            <dd className="font-display text-2xl font-extrabold leading-none text-fg-brand">{progress.stamps}</dd>
          </div>
          <div className="rounded-theme border border-line bg-surface/60 flex flex-col-reverse px-2 py-2.5">
            <dt className="mt-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-ink-muted">{progress.attended_workshops === 1 ? 'Misión' : MISSION.many}</dt>
            <dd className="font-display text-2xl font-extrabold leading-none">{progress.attended_workshops}</dd>
          </div>
          <div className="rounded-theme border border-line bg-surface/60 flex flex-col-reverse px-2 py-2.5">
            <dt className="mt-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-ink-muted">{term('division', true)}</dt>
            <dd className="font-display text-2xl font-extrabold leading-none">{visited.size}<span className="text-sm text-ink-muted">/{divisions.length}</span></dd>
          </div>
        </dl>
      </header>

      {progress.stamps === 0 && (
        <GuideTip
          title="Tu bitácora está lista"
          action={
            <Link to="/ruta" className={buttonClasses('secondary', 'w-full')}>
              <Rocket className="h-4 w-4" aria-hidden />
              Ir a mi ruta
            </Link>
          }
        >
          Completa tu primera misión y escanea el QR para ganar tu primer sello.
        </GuideTip>
      )}

      <RankProgress progress={progress} full />

      <section aria-label={`Mis ${term('stamp', true).toLowerCase()}`} className="space-card p-5">
        <div className="mb-4">
          <h2 className="text-lg font-extrabold">Mis {term('stamp', true).toLowerCase()}</h2>
          <p className="text-sm text-ink-muted">
            {visited.size} de {divisions.length} {term('division', true).toLowerCase()} · un sello por área
          </p>
        </div>
        <StampCollection divisions={divisions} visited={visited} />
        <p className="mt-5 border-t border-line pt-3 text-xs text-ink-muted">
          {progress.stamps} {term('stamp', progress.stamps !== 1).toLowerCase()} · {progress.attended_workshops}{' '}
          {progress.attended_workshops === 1 ? 'misión completada' : 'misiones completadas'}
        </p>
      </section>

      <section className="space-card p-5" aria-label="Sorteo">
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
        <section className="space-card p-5" aria-label="Carreras de interés">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-fg-brand" aria-hidden />
            <h2 className="text-base font-extrabold">{term('interests', true)}</h2>
          </div>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Carreras que te interesan</p>
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
