import { ArrowRight, ChevronRight, Compass, PartyPopper, ScanQrCode, Sparkles, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses, PageSkeleton } from '../components/ui';
import { ProgressRing } from '../components/themed';
import { fetchDivisions, fetchProgress, formatTime, type Division, type Progress } from '../lib/catalog';
import { useAuth } from '../lib/auth';
import { fetchMyRaffleStatus } from '../lib/raffleApi';
import { buildJourney, firstName, heroAction, latestPending, type Journey } from '../lib/studentJourney';
import { useLoad } from '../lib/useLoad';
import { useNow } from '../lib/useNow';
import { useParticipantSync } from '../lib/useParticipantSync';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { formatPlace } from './campus/resolveCampusLocation';
import { missions } from './copy';
import NextStopCard from './NextStopCard';
import { progressNextMessage } from './progressText';
import StampCollection from './StampCollection';
import { GuideTip } from './ui/Guide';
import { HowItWorks } from './ui/HowItWorks';
import { ErrorState } from './ui/States';

const DISMISS_KEY = 'diaov.interestsPromptDismissed';

/**
 * Inicio = centro de mando. In this order: «¿qué hago ahora?» (one hero with one action), what comes after it today,
 * «¿cómo voy?» (rank and stamps) and, only when they apply, the interests question, the raffle and the closing.
 */
export default function Home() {
  const { text } = usePublicTheme();
  const { profile } = useAuth();
  const { edition } = useEdition();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchProgress(), fetchDivisions(), fetchMyRaffleStatus().catch(() => null)]),
    [],
  );
  const { board, error: boardError, reload: reloadBoard } = useReservationBoard(edition?.id);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
  // Other tabs of this browser (reserve, cancel, change, check-in) or a long time hidden → quietly re-query, keeping what is on screen.
  useParticipantSync(reload);

  if (loading && !data) return <PageSkeleton />;
  if (!data) return <ErrorState error={error} onRetry={reload} />;

  const [progress, divisions, raffle] = data;
  const journey = board ? buildJourney(board) : null;
  const interestsDone = progress.post_event_interests_completed;
  const showPrompt = progress.post_event_interests_prompt && progress.post_event_interests_open && !interestsDone && !dismissed;
  const finished = progress.level === 5 || interestsDone;
  const hero = journey ? heroAction(journey, now) : null;
  // The reminder is a secondary notice: it is hidden when the main card already IS the pending attendance.
  const pending = journey && hero?.kind !== 'pending' ? latestPending(journey) : undefined;
  const name = firstName(profile?.display_name);
  const raffleUnlocked = !!raffle && (raffle.has_won || !!raffle.raffle_category_name);
  const firstTime =
    !!journey && progress.attended_workshops === 0 && journey.now.length + journey.upcoming.length + journey.pending.length + journey.done.length === 0;
  const heroId = hero && hero.kind !== 'none' ? hero.stop.reservation.id : null;
  const guideInHero = hero?.kind === 'none';
  const later = journey ? journey.upcoming.filter((s) => s.reservation.id !== heroId).slice(0, 3) : [];

  const dismissPrompt = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-brand">Centro de mando</p>
        <h1 className="mt-0.5 text-[1.75rem] font-extrabold leading-tight">{name ? `Hola, ${name}` : text('passportIntro')}</h1>
      </header>

      {board && journey ? (
        <NextStopCard board={board} journey={journey} now={now} />
      ) : boardError ? (
        <ErrorState error={boardError} onRetry={() => void reloadBoard()} title="No pudimos cargar tu ruta" />
      ) : (
        <div className="space-card h-52 animate-pulse" role="status" aria-label="Cargando tu siguiente misión" />
      )}

      {pending && (
        <Link
          to="/escanear"
          className="flex min-h-16 animate-fade-up items-center gap-3 rounded-theme border border-warning-500/50 bg-warning-500/10 p-3 text-sm"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-500/20 text-fg-warning" aria-hidden>
            <ScanQrCode className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate">¿Ya fuiste a {pending.session.title}?</strong>
            Escanea tu asistencia para ganar tu sello.
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
        </Link>
      )}

      {firstTime && <HowItWorks />}

      {later.length > 0 && <LaterToday stops={later} />}

      <JourneyProgress progress={progress} divisions={divisions} />

      {showPrompt && (
        <section className="space-card relative animate-fade-up overflow-hidden border-primary-500/50 p-4" aria-label="Carreras de interés">
          <button
            onClick={dismissPrompt}
            className="absolute right-1 top-1 z-10 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink"
            aria-label="Ocultar recordatorio"
          >
            <X className="h-4 w-4" />
          </button>
          {/* The guide speaks here only when the hero is not already showing it: one appearance per screen. */}
          {guideInHero ? (
            <div className="pr-8">
              <Compass className="h-6 w-6 text-fg-brand" aria-hidden />
              <h2 className="mt-2 text-lg font-extrabold">{text('interestsPromptTitle')}</h2>
              <p className="mt-1 text-sm text-ink-muted">{text('interestsPromptBody')}</p>
              <Link to="/destinos" className={buttonClasses('primary', 'mt-4 w-full')}>
                Elegir carreras
              </Link>
            </div>
          ) : (
            <GuideTip
              title={text('interestsPromptTitle')}
              action={
                <Link to="/destinos" className={buttonClasses('primary', 'w-full')}>
                  <Compass className="h-4 w-4" aria-hidden />
                  Elegir carreras
                </Link>
              }
              className="pr-8"
            >
              {text('interestsPromptBody')}
            </GuideTip>
          )}
        </section>
      )}

      {progress.post_event_interests_prompt && !showPrompt && interestsDone && progress.attended_workshops < 4 && (
        <section className="space-card animate-fade-up p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-fg-accent" aria-hidden />
            <h2 className="text-sm font-bold">Encuentra tu siguiente misión</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Ya elegiste carreras de interés. Mira las misiones relacionadas con ellas.</p>
          <Link to="/misiones?f=foryou" className={buttonClasses('secondary', 'mt-3')}>
            Ver misiones para ti
          </Link>
        </section>
      )}

      {raffleUnlocked && (
        <Link to="/pasaporte" className="space-card flex items-center gap-3 border-accent-500/40 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-fg-accent" aria-hidden>
            <Trophy className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <strong className="block">{raffle.has_won ? '¡Ganaste un premio!' : 'Ya participas en el sorteo'}</strong>
            {raffle.has_won ? 'Gracias por participar en el sorteo final.' : raffle.raffle_category_name}
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
        </Link>
      )}

      {finished && (
        <section className="space-card animate-fade-up p-5 text-center">
          <span className="icon-orb mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-fg-brand" aria-hidden>
            <PartyPopper className="h-6 w-6" />
          </span>
          <h2 className="mt-3 text-lg font-extrabold">{text('closingTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{text('closingBody')}</p>
        </section>
      )}
    </div>
  );
}

/** What comes after the hero today, as a mini trajectory. Tapping it opens Mi ruta. */
function LaterToday({ stops }: { stops: Journey['upcoming'] }) {
  return (
    <section aria-label="Después en tu ruta" className="animate-fade-up">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">Después en tu ruta</h2>
        <Link to="/ruta" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-fg-brand">
          Ver mi ruta
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <ol className="space-card divide-y divide-line overflow-hidden">
        {stops.map(({ reservation, session }) => (
          <li key={reservation.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-12 shrink-0 font-display text-base font-extrabold">{formatTime(session.starts_at)}</span>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-primary-500" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{session.title}</span>
              {session.location && <span className="block truncate text-xs text-ink-muted">{formatPlace(session.location)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** «¿Cómo voy?»: stamps on an orbit ring, the current rank, ONE sentence about the next one and the stamps strip. */
function JourneyProgress({ progress, divisions }: { progress: Progress; divisions: Division[] }) {
  const { theme, term, text, rankName } = usePublicTheme();
  const remaining = progress.next ? Math.max(progress.next.required_attendances - progress.stamps, 0) : 0;
  const fraction = progress.next ? Math.min(progress.stamps / Math.max(progress.next.required_attendances, 1), 1) : 1;
  const visited = new Set(progress.division_ids);
  return (
    <section aria-label="Tu avance" className="space-card animate-fade-up overflow-hidden p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">Tu avance</h2>
        <Link to="/pasaporte" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-fg-brand">
          Ver mi bitácora
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="mt-1 flex items-center gap-4">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label={`Avance hacia el siguiente ${term('rank').toLowerCase()}`}>
          <ProgressRing value={fraction} size={92} stroke={8}>
            <span className="font-display text-2xl font-extrabold leading-none">{progress.stamps}</span>
            <span className="mt-0.5 max-w-[4.5rem] text-[9px] font-bold uppercase leading-tight tracking-wide text-ink-muted">
              {term('stamp', progress.stamps !== 1)}
            </span>
          </ProgressRing>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-muted">
            {term('rank')} {progress.level} de 5
          </p>
          <p className="font-display text-lg font-extrabold leading-tight text-fg-brand">{rankName(progress.level)}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {progress.next ? progressNextMessage(theme, progress.next, remaining, term, rankName) : text('progressMax')}
          </p>
          <p className="mt-1 text-xs font-semibold">
            {missions(progress.attended_workshops)} {progress.attended_workshops === 1 ? 'completada' : 'completadas'}
          </p>
        </div>
      </div>
      {divisions.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs text-ink-muted">
            {term('stamp', true)} · {visited.size} de {divisions.length} {term('division', true).toLowerCase()}
          </p>
          <StampCollection divisions={divisions} visited={visited} compact />
        </div>
      )}
    </section>
  );
}
