import { Compass, QrCode, Target, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, buttonClasses, LoadError, PageSkeleton } from '../components/ui';
import { fetchDivisions, fetchProgress } from '../lib/catalog';
import { useAuth } from '../lib/auth';
import { fetchMyRaffleStatus } from '../lib/raffleApi';
import { buildJourney, firstName, heroAction, latestPending } from '../lib/studentJourney';
import { useLoad } from '../lib/useLoad';
import { useNow } from '../lib/useNow';
import { useParticipantSync } from '../lib/useParticipantSync';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import NextStopCard from './NextStopCard';
import RankProgress from './RankProgress';
import StampCollection from './StampCollection';

const DISMISS_KEY = 'diaov.interestsPromptDismissed';

/** Inicio: «¿qué hago ahora?» first, then «¿cómo voy?». Everything else lives one tap away. */
export default function Home() {
  const { term, text } = usePublicTheme();
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
  if (!data) return <LoadError error={error} onRetry={reload} />;

  const [progress, divisions, raffle] = data;
  const visited = new Set(progress.division_ids);
  const journey = board ? buildJourney(board) : null;
  const interestsDone = progress.post_event_interests_completed;
  const showPrompt = progress.post_event_interests_prompt && progress.post_event_interests_open && !interestsDone && !dismissed;
  const finished = progress.level === 5 || interestsDone;
  const hero = journey ? heroAction(journey, now) : null;
  // The reminder is a secondary notice: it is hidden when the main card already IS the pending attendance.
  const pending = journey && hero?.kind !== 'pending' ? latestPending(journey) : undefined;
  const name = firstName(profile?.display_name);
  const raffleUnlocked = !!raffle && (raffle.has_won || !!raffle.raffle_category_name);

  const dismissPrompt = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{name ? `Hola, ${name}` : text('passportIntro')}</h1>
        <p className="hidden text-sm text-ink-muted sm:block">{text('passportIntro')}</p>
      </header>

      {board && journey ? (
        <NextStopCard board={board} journey={journey} now={now} />
      ) : boardError ? (
        <Alert tone="warning">
          No pudimos cargar tu ruta.{' '}
          <button className="font-semibold underline underline-offset-4" onClick={() => void reloadBoard()}>
            Reintentar
          </button>
        </Alert>
      ) : (
        <div className="card h-48 animate-pulse" role="status" aria-label="Cargando tu siguiente actividad" />
      )}

      {pending && (
        <Link
          to="/escanear"
          className="flex min-h-14 items-center gap-3 rounded-theme border border-warning-500/50 bg-warning-500/10 p-3 text-sm"
        >
          <QrCode className="h-5 w-5 shrink-0 text-fg-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong className="block truncate">¿Ya fuiste a {pending.session.title}?</strong>
            Registra tu asistencia para ganar tu sello.
          </span>
        </Link>
      )}

      <RankProgress progress={progress} />

      <section aria-label="Tu avance" className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="font-display text-3xl font-extrabold text-fg-brand">{progress.stamps}</p>
          <p className="text-xs font-semibold text-ink-muted">{term('stamp', progress.stamps !== 1)}</p>
        </div>
        <div className="card p-4">
          <p className="font-display text-3xl font-extrabold">{progress.attended_workshops}</p>
          <p className="text-xs font-semibold text-ink-muted">{progress.attended_workshops === 1 ? 'Taller completado' : 'Talleres completados'}</p>
        </div>
      </section>

      <section aria-label={`Tus ${term('stamp', true).toLowerCase()}`}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold">Tu colección</h2>
          <Link to="/pasaporte" className="inline-flex min-h-11 items-center text-sm font-semibold text-fg-brand">
            {visited.size} de {divisions.length} · Ver todo
          </Link>
        </div>
        <StampCollection divisions={divisions} visited={visited} compact />
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
          <Compass className="h-6 w-6 text-fg-brand" aria-hidden />
          <p className="mt-2 pr-6 text-xs font-semibold uppercase tracking-wide text-ink-muted">Después de vivir el Día OV…</p>
          <h2 className="text-lg font-extrabold">{text('interestsPromptTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{text('interestsPromptBody')}</p>
          <Link to="/destinos" className={buttonClasses('primary', 'mt-4')}>
            Elegir carreras
          </Link>
        </section>
      )}

      {progress.post_event_interests_prompt && !showPrompt && interestsDone && progress.attended_workshops < 4 && (
        <section className="card animate-fade-up p-4">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-fg-info" aria-hidden />
            <h2 className="text-sm font-semibold">Encuentra tu siguiente taller</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Tienes carreras de interés. Te ayudamos a encontrar talleres relacionados.</p>
          <Link to="/misiones" className={buttonClasses('secondary', 'mt-3')}>
            Ver recomendados
          </Link>
        </section>
      )}

      {raffleUnlocked && (
        <Link to="/pasaporte" className="card flex items-center gap-3 border-accent-500/40 bg-accent-500/10 p-4">
          <Trophy className="h-6 w-6 shrink-0 text-fg-accent" aria-hidden />
          <span className="min-w-0 text-sm">
            <strong className="block">{raffle.has_won ? '¡Ganaste un premio!' : 'Ya participas en el sorteo'}</strong>
            {raffle.has_won ? 'Gracias por participar en el sorteo final.' : raffle.raffle_category_name}
          </span>
        </Link>
      )}

      {finished && (
        <section className="card animate-fade-up p-6 text-center">
          <h2 className="text-lg font-extrabold">{text('closingTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{text('closingBody')}</p>
        </section>
      )}
    </div>
  );
}
