import { CalendarPlus, Clock, MapPin, QrCode } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../components/ui';
import { formatTime } from '../lib/catalog';
import type { Board } from '../lib/reservations';
import { heroAction, timingLabel, type Journey } from '../lib/studentJourney';
import { usePublicTheme } from '../theme/PublicThemeProvider';

/**
 * The answer to «¿qué hago ahora?» — exactly ONE main action (see `heroAction` for the priority):
 * in progress → unmistakable and brand-coloured; next/imminent → time, place and how long is left;
 * attendance still to register → «Registrar asistencia» (never claims it is in progress nor that a stamp was earned);
 * nothing booked → a clear path to pick workshops.
 */
export default function NextStopCard({ board, journey, now }: { board: Board; journey: Journey; now: number }) {
  const { term } = usePublicTheme();
  const hero = heroAction(journey, now);
  const bookedAll = board.active_reservation_count >= board.max_reservations;

  if (hero.kind === 'none') {
    const closed = board.window === 'closed';
    const notOpen = board.window === 'not_open';
    return (
      <section className="card animate-fade-up p-6 text-center" aria-label="Siguiente actividad">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/15 text-fg-brand">
          <CalendarPlus className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-extrabold">{journey.done.length > 0 ? 'Elige tu siguiente taller' : 'Arma tu ruta del día'}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {notOpen
            ? 'Las reservaciones aún no abren. Mientras, explora los talleres.'
            : closed
              ? 'Las reservaciones ya cerraron.'
              : `Elige hasta ${board.max_reservations} ${term('activity', true).toLowerCase()} y te mostramos a dónde ir.`}
        </p>
        <Link to="/misiones" className={buttonClasses('primary', 'mt-5 w-full')}>
          Ver {term('activity', true).toLowerCase()}
        </Link>
      </section>
    );
  }

  const { session } = hero.stop;
  const live = hero.kind === 'now';
  const pending = hero.kind === 'pending';
  const imminent = hero.kind === 'imminent';
  const eyebrow = live ? 'Ahora' : pending ? 'Pendiente' : 'Sigue';
  const region = live ? 'Actividad en curso' : pending ? 'Asistencia pendiente' : 'Siguiente actividad';
  const tone = live
    ? 'border-primary-500 bg-primary-500 text-on-primary'
    : pending
      ? 'border-warning-500/60 bg-warning-500/10'
      : imminent
        ? 'border-primary-500/60 bg-surface'
        : 'border-line bg-surface';
  const muted = live ? 'text-on-primary/90' : 'text-ink-muted';

  return (
    <section aria-label={region} className={`animate-fade-up overflow-hidden rounded-theme border ${tone}`}>
      <div className="p-5">
        <p className={`flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest ${live ? 'text-on-primary/80' : pending ? 'text-fg-warning' : 'text-fg-brand'}`}>
          {live && <span className="anim-ring-pulse h-2.5 w-2.5 rounded-full bg-current" aria-hidden />}
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-extrabold leading-tight">{session.title}</h2>
        {pending ? (
          <>
            <p className="mt-1 text-base font-bold text-fg-warning">Falta registrar asistencia</p>
            <p className="mt-0.5 text-sm text-ink-muted">{timingLabel(session, now)}</p>
          </>
        ) : (
          <p className={`mt-1 text-base font-bold ${live ? '' : 'text-fg-brand'}`}>{timingLabel(session, now)}</p>
        )}

        <dl className={`mt-4 grid gap-2 text-sm ${muted}`}>
          <div className="flex items-start gap-2">
            <dt className="sr-only">Horario</dt>
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <dd>
              {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
            </dd>
          </div>
          {session.location && (
            <div className="flex items-start gap-2">
              <dt className="sr-only">Dónde</dt>
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <dd className="min-w-0 break-words font-semibold">{session.location}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {live ? (
            <>
              <Link to="/escanear" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-on-primary px-6 text-sm font-bold text-primary-700">
                <QrCode className="h-4 w-4" aria-hidden />
                Registrar asistencia
              </Link>
              <Link to="/ruta" className="inline-flex min-h-12 items-center justify-center rounded-full border border-on-primary/50 px-6 text-sm font-semibold">
                Ver mi ruta
              </Link>
            </>
          ) : pending ? (
            <>
              <Link to="/escanear" className={buttonClasses('primary')}>
                <QrCode className="h-4 w-4" aria-hidden />
                Registrar asistencia
              </Link>
              <Link to="/ruta" className={buttonClasses('secondary')}>
                Ver mi ruta
              </Link>
            </>
          ) : (
            <>
              <Link to="/ruta" className={buttonClasses('primary')}>
                Ver mi ruta
              </Link>
              {!bookedAll && board.window === 'open' && (
                <Link to="/misiones" className={buttonClasses('secondary')}>
                  Agregar taller
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
