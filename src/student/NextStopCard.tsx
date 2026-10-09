import { ArrowRight, Clock, MapPin, MapPinned, ScanQrCode, Sparkles, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../components/ui';
import { formatTime } from '../lib/catalog';
import type { Board } from '../lib/reservations';
import { heroAction, timingLabel, type Journey } from '../lib/studentJourney';
import { mapForSession, MapLink } from './campus/mapLinks';
import { placeDetailLine, resolveCampusLocation } from './campus/resolveCampusLocation';
import { MISSION, SCAN_CTA } from './copy';
import { GuideAvatar } from './ui/Guide';
import { OrbitArcs, PlanetHorizon } from './ui/SpaceDecor';

/**
 * «Tu siguiente misión» — the answer to «¿qué hago ahora?» with exactly ONE main action (priority in `heroAction`):
 * in progress → unmistakable, brand-coloured, scan when you finish; next/imminent → how long is left, when and where;
 * attendance still to register → scan (never claims a stamp was earned); nothing booked → build your route.
 */
export default function NextStopCard({ board, journey, now }: { board: Board; journey: Journey; now: number }) {
  const hero = heroAction(journey, now);
  const bookedAll = board.active_reservation_count >= board.max_reservations;

  if (hero.kind === 'none') {
    const closed = board.window === 'closed';
    const notOpen = board.window === 'not_open';
    const returning = journey.done.length > 0;
    return (
      <section className="hero-next relative overflow-hidden rounded-theme border border-line p-5 pb-8 animate-fade-up" aria-label="Tu siguiente misión">
        <PlanetHorizon />
        <div className="relative flex items-start gap-4">
          <GuideAvatar size={64} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-brand">{returning ? 'Sigue explorando' : 'Primer paso'}</p>
            <h2 className="mt-0.5 text-xl font-extrabold leading-tight">{returning ? 'Elige tu siguiente misión' : 'Arma tu ruta del día'}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {notOpen
                ? 'Las reservaciones aún no abren. Mientras, explora las misiones.'
                : closed
                  ? 'Las reservaciones ya cerraron.'
                  : `Las misiones son los talleres de Día OV. Elige hasta ${board.max_reservations} y aquí verás a dónde ir.`}
            </p>
          </div>
        </div>
        <div className="relative mt-5 grid gap-2">
          <Link to="/misiones" className={buttonClasses('primary', 'w-full')}>
            Explorar {MISSION.many.toLowerCase()}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          {!closed && (
            <Link to="/misiones?f=foryou" className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold text-fg-accent">
              <Sparkles className="h-4 w-4" aria-hidden />
              Ver las que son para ti
            </Link>
          )}
        </div>
      </section>
    );
  }

  const { session } = hero.stop;
  const live = hero.kind === 'now';
  const pending = hero.kind === 'pending';
  const imminent = hero.kind === 'imminent';
  const eyebrow = live ? 'En curso ahora' : pending ? 'Falta escanear' : imminent ? 'Tu siguiente misión · ya casi' : 'Tu siguiente misión';
  const region = live ? 'Misión en curso' : pending ? 'Asistencia pendiente' : 'Tu siguiente misión';
  const surface = live
    ? 'hero-live border-primary-400 text-on-primary'
    : pending
      ? 'border-warning-500/60 bg-warning-500/10'
      : imminent
        ? 'hero-next border-primary-500/70 shadow-[0_0_0_1px_rgb(var(--c-primary-500)/0.25),0_18px_40px_-20px_rgb(var(--c-primary-500)/0.7)]'
        : 'hero-next border-line';
  const muted = live ? 'text-on-primary/85' : 'text-ink-muted';
  const timing = timingLabel(session, now);
  const place = resolveCampusLocation(session.location);
  const placeLine = place.resolved ? placeDetailLine(place) : null;

  return (
    <section aria-label={region} className={`relative overflow-hidden rounded-theme border p-5 animate-fade-up ${surface}`}>
      {!pending && <OrbitArcs className={`-right-6 -top-6 h-40 w-40 ${live ? 'opacity-60' : ''}`} />}
      <div className="relative">
        <p
          className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] ${
            live ? 'bg-on-primary/15 text-on-primary' : pending ? 'bg-warning-500/15 text-fg-warning' : 'bg-primary-500/15 text-fg-brand'
          }`}
        >
          {live && <span className="anim-ring-pulse h-2 w-2 rounded-full bg-current" aria-hidden />}
          {pending && <ScanQrCode className="h-3.5 w-3.5" aria-hidden />}
          {eyebrow}
        </p>
        <h2 className="mt-3 pr-10 text-2xl font-extrabold leading-tight">{session.title}</h2>

        {/* The countdown is the loudest line: «Empieza en 12 min» / «En curso · termina en 30 min». */}
        <p className={`mt-2 flex items-center gap-2 font-display text-lg font-extrabold ${live ? '' : pending ? 'text-fg-warning' : 'text-fg-brand'}`}>
          <Timer className="h-5 w-5 shrink-0" aria-hidden />
          {pending ? 'Falta registrar tu asistencia' : timing}
        </p>
        {pending && <p className={`mt-0.5 text-sm ${muted}`}>{timing}</p>}

        <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-sm">
          <dt className={`flex items-center gap-1.5 ${muted}`}>
            <Clock className="h-4 w-4" aria-hidden />
            Hora
          </dt>
          <dd className="font-bold">
            {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
          </dd>
          {session.location && (
            <>
              <dt className={`flex items-center gap-1.5 ${muted}`}>
                <MapPin className="h-4 w-4" aria-hidden />
                Dónde
              </dt>
              <dd className="min-w-0 break-words">
                <span className="font-bold">{place.resolved ? place.building : session.location}</span>
                {placeLine && <span className={`block ${muted}`}>{placeLine}</span>}
              </dd>
            </>
          )}
        </dl>
        {/* Secondary on purpose: it never competes with the main action below. */}
        {session.location && (
          <MapLink
            to={mapForSession(session.id)}
            className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-sm font-semibold underline-offset-4 hover:underline ${
              live ? 'text-on-primary' : 'text-fg-brand'
            }`}
          >
            <MapPinned className="h-4 w-4" aria-hidden />
            Ver ubicación
          </MapLink>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {live ? (
            <>
              <Link to="/escanear" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-on-primary px-6 text-sm font-extrabold text-primary-500 shadow-lg">
                <ScanQrCode className="h-5 w-5" aria-hidden />
                {SCAN_CTA}
              </Link>
              <Link to="/ruta" className="inline-flex min-h-12 items-center justify-center rounded-full border border-on-primary/50 px-6 text-sm font-semibold">
                Ver mi ruta
              </Link>
              <p className="text-center text-xs text-on-primary/85 sm:col-span-2">Al terminar, escanea el QR que te muestra el facilitador.</p>
            </>
          ) : pending ? (
            <>
              <Link to="/escanear" className={buttonClasses('primary')}>
                <ScanQrCode className="h-5 w-5" aria-hidden />
                {SCAN_CTA}
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
                  Agregar misión
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
