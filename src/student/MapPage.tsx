import { ArrowLeft, ArrowRight, Clock, Expand, ListOrdered, MapPinned, Rocket } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { buttonClasses, PageSkeleton } from '../components/ui';
import { formatTime } from '../lib/catalog';
import type { BoardSession } from '../lib/reservations';
import { buildJourney, timingLabel, type Stop } from '../lib/studentJourney';
import { useNow } from '../lib/useNow';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import CampusMap, { type MapMarker } from './campus/CampusMap';
import { CAMPUS_ZONES, ZONE_BY_ID, type CampusZoneId } from './campus/campusZones';
import type { MapReturnState } from './campus/mapLinks';
import { placeDetailLine, resolveCampusLocation, type CampusPlace } from './campus/resolveCampusLocation';
import { MISSION } from './copy';
import { GuideAvatar } from './ui/Guide';
import { ErrorState } from './ui/States';

type RouteStop = Stop & { n: number; place: CampusPlace };

/**
 * Mapa del campus. Three faces of the same map, all read-only (it never reserves, cancels or checks in):
 *  - /mapa                 the campus: tap a building to see what is there and which of MY missions are in it;
 *  - /mapa?sesion=<id>     «Tu misión es aquí»: that session's building selected, centred and marked with a beacon;
 *  - /mapa?vista=ruta      my route: active missions numbered in time order, the next one highlighted.
 * Everything comes from the reservation board the student already loads; locations go through resolveCampusLocation.
 */
export default function MapPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as MapReturnState | null)?.from;
  const sessionId = params.get('sesion');
  const routeView = params.get('vista') === 'ruta';
  const { edition } = useEdition();
  const { board, error, loading, reload } = useReservationBoard(edition?.id);
  const now = useNow();

  const session: BoardSession | null = (sessionId && board?.sessions.find((s) => s.id === sessionId)) || null;
  const destination = session ? resolveCampusLocation(session.location) : null;
  const destinationZone = destination?.zoneId ?? null;

  const journey = useMemo(() => (board ? buildJourney(board) : null), [board]);
  // «Misiones vigentes»: what is happening now and what is still ahead, in time order.
  const routeStops: RouteStop[] = useMemo(
    () => (journey ? [...journey.now, ...journey.upcoming].map((stop, i) => ({ ...stop, n: i + 1, place: resolveCampusLocation(stop.session.location) })) : []),
    [journey],
  );
  const withMissions = useMemo(() => new Set(routeStops.map((s) => s.place.zoneId).filter((z): z is CampusZoneId => !!z)), [routeStops]);

  const [selected, setSelected] = useState<CampusZoneId | null>(null);
  const [focus, setFocus] = useState<CampusZoneId | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Opening a session selects and centres its building once the board arrives.
  useEffect(() => {
    if (destinationZone) {
      setSelected(destinationZone);
      setFocus(destinationZone);
    }
  }, [destinationZone]);

  const select = (zoneId: CampusZoneId) => {
    setSelected(zoneId);
    setFocus(zoneId);
  };

  const goBack = () => {
    if (from) navigate(from);
    else navigate('/bitacora');
  };

  const header = (
    <header className="flex animate-fade-up items-start gap-2">
      <button
        onClick={goBack}
        className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-brand hover:bg-surface-raised"
        aria-label="Volver"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </button>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-brand">Mapa de exploración</p>
        <h1 className="text-[1.6rem] font-extrabold leading-tight">{routeView ? 'Tu ruta en el mapa' : 'Mapa del campus'}</h1>
      </div>
    </header>
  );

  if (loading && !board) return <div className="space-y-4">{header}<PageSkeleton blocks={2} /></div>;
  if (error || !board) return <div className="space-y-4">{header}<ErrorState error={error} onRetry={reload} title="No pudimos cargar el mapa" /></div>;

  // Route view: one marker per building (numbers joined when two missions share it) and the order as a reference line.
  const byZone = new Map<CampusZoneId, number[]>();
  for (const stop of routeStops) if (stop.place.zoneId) byZone.set(stop.place.zoneId, [...(byZone.get(stop.place.zoneId) ?? []), stop.n]);
  const markers: MapMarker[] = routeView
    ? [...byZone.entries()].map(([zoneId, ns]) => ({ zoneId, label: ns.join('·'), next: ns.includes(1) }))
    : [];
  const trail = routeView
    ? routeStops.map((s) => s.place.zoneId).filter((z, i, all): z is CampusZoneId => !!z && z !== all[i - 1])
    : [];
  const nextZone = routeStops[0]?.place.zoneId ?? null;
  const unresolvedDestination = !!session && !!destination && !destination.resolved;
  const missingSession = !!sessionId && !session;

  return (
    <div className="space-y-4">
      {header}

      {missingSession && (
        <p role="status" className="rounded-theme border border-warning-500/45 bg-warning-500/10 px-3 py-2.5 text-sm">
          No encontramos esa misión en tu ruta. Te mostramos el campus completo.
        </p>
      )}

      {unresolvedDestination && session && (
        <section className="space-card p-4" aria-label="Ubicación sin punto en el mapa">
          <div className="flex items-start gap-3">
            <GuideAvatar size={52} />
            <div className="min-w-0">
              <p className="font-extrabold">No tenemos el punto exacto de esta ubicación</p>
              <p className="mt-1 text-sm">
                <strong>{session.title}</strong> · {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
              </p>
              <p className="mt-1 text-sm text-ink-muted">Busca: «{session.location}». Si tienes dudas, pregunta al personal del evento.</p>
            </div>
          </div>
        </section>
      )}
      {/* «¿A dónde voy?» first: building, floor and room are readable before looking at the drawing. */}
      {session && destination?.resolved && destinationZone && <DestinationCard session={session} place={destination} now={now} />}

      <div className={`relative ${session && destination?.resolved ? 'h-[44dvh]' : 'h-[56dvh]'} min-h-[320px] max-h-[640px] overflow-hidden rounded-theme border border-line bg-surface shadow-[0_18px_40px_-28px_rgb(var(--c-primary-500)/0.8)]`}>
        <CampusMap
          selected={selected}
          onSelect={select}
          focus={focus}
          destination={destination?.resolved ? destinationZone : null}
          markers={markers}
          trail={trail}
          withMissions={withMissions}
        />
        {focus && (
          <button
            onClick={() => setFocus(null)}
            className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 text-sm font-semibold shadow-md backdrop-blur"
          >
            <Expand className="h-4 w-4" aria-hidden />
            Ver todo el campus
          </button>
        )}
      </div>

      {routeView && trail.length > 1 && (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="h-0 w-6 border-t-2 border-dashed border-primary-400" aria-hidden />
          La línea solo une tus destinos en orden; no es un camino a pie.
        </p>
      )}

      <div ref={panelRef} aria-live="polite" className="space-y-4">

        {routeView && <RouteList stops={routeStops} now={now} selected={selected} onSelect={select} />}

        {selected && selected !== destinationZone && <ZoneCard zoneId={selected} stops={routeStops} highlightNext={selected === nextZone} />}
        {!selected && !routeView && !session && (
          <p className="text-sm text-ink-muted">Toca un edificio del mapa para ver qué hay ahí. Los números y letras son los mismos del mapa impreso del campus.</p>
        )}

        <details className="space-card group p-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-bold">
            Lista de lugares del campus
            <ArrowRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <ul className="mt-2 grid gap-1">
            {CAMPUS_ZONES.filter((z) => z.kind !== 'parking').map((zone) => (
              <li key={zone.id}>
                <button
                  onClick={() => {
                    select(zone.id);
                    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  }}
                  aria-pressed={selected === zone.id}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-theme px-2 text-left text-sm ${selected === zone.id ? 'bg-primary-500/15 font-bold' : 'hover:bg-surface-raised'}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold" style={{ background: zone.pin, color: zone.pinInk }} aria-hidden>
                    {zone.code}
                  </span>
                  <span className="min-w-0">{zone.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

function DestinationCard({ session, place, now }: { session: BoardSession; place: CampusPlace; now: number }) {
  const zone = place.zone!;
  const detail = placeDetailLine(place);
  const mine = !!session.my_reservation_id;
  return (
    <section className="space-card relative animate-fade-up overflow-hidden border-primary-500/60 p-4" aria-label={mine ? 'Tu misión es aquí' : 'Esta misión es aquí'}>
      <div className="flex items-start gap-3">
        <GuideAvatar size={48} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-fg-brand">{mine ? 'Tu misión es aquí' : 'Esta misión es aquí'}</p>
          <p className="mt-0.5 font-bold leading-snug">{session.title}</p>
        </div>
      </div>
      <div className="mt-4 flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-base font-extrabold" style={{ background: zone.pin, color: zone.pinInk }} aria-hidden>
          {zone.code}
        </span>
        <div className="min-w-0">
          <p className="font-display text-xl font-extrabold leading-tight">{place.building}</p>
          {detail && <p className="mt-0.5 text-base font-semibold">{detail}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
            <Clock className="h-4 w-4" aria-hidden />
            {formatTime(session.starts_at)}–{formatTime(session.ends_at)} · {timingLabel(session, now)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="text-xs text-ink-muted">El mapa marca el edificio; aquí tienes piso y salón.</p>
        <Link to={`/misiones/${session.activity_id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg-brand">
          <Rocket className="h-4 w-4" aria-hidden />
          Ver {MISSION.one.toLowerCase()}
        </Link>
      </div>
    </section>
  );
}

function RouteList({ stops, now, selected, onSelect }: { stops: RouteStop[]; now: number; selected: CampusZoneId | null; onSelect: (z: CampusZoneId) => void }) {
  if (stops.length === 0) {
    return (
      <section className="space-card p-5 text-center" aria-label="Tu ruta">
        <GuideAvatar size={64} className="mx-auto" />
        <p className="mt-3 font-extrabold">Aún no tienes misiones por delante</p>
        <p className="mt-1 text-sm text-ink-muted">Cuando reserves, aquí verás a qué edificio ir y en qué orden.</p>
        <Link to="/misiones" className={buttonClasses('primary', 'mt-4')}>
          Explorar {MISSION.many.toLowerCase()}
        </Link>
      </section>
    );
  }
  return (
    <section aria-label="Tu ruta en orden" className="space-card p-3">
      <h2 className="flex items-center gap-2 px-1 pb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">
        <ListOrdered className="h-4 w-4" aria-hidden />
        En orden
      </h2>
      <ol className="grid gap-1.5">
        {stops.map((stop) => {
          const { place, session, n } = stop;
          const isNext = n === 1;
          const active = !!place.zoneId && place.zoneId === selected;
          const detail = placeDetailLine(place);
          return (
            <li key={stop.reservation.id}>
              <button
                onClick={() => place.zoneId && onSelect(place.zoneId)}
                disabled={!place.zoneId}
                aria-pressed={active}
                className={`flex min-h-14 w-full items-start gap-3 rounded-theme px-2 py-2 text-left ${active ? 'bg-primary-500/15' : 'hover:bg-surface-raised'} disabled:cursor-default`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold ${
                    isNext ? 'bg-primary-500 text-on-primary' : 'border-2 border-ink/60 text-ink'
                  }`}
                  aria-hidden
                >
                  {n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-ink-muted">
                    {isNext ? 'Siguiente · ' : ''}
                    {formatTime(session.starts_at)} · {timingLabel(session, now)}
                  </span>
                  <span className="block font-bold leading-snug">{session.title}</span>
                  <span className="block text-sm text-ink-muted">
                    {place.resolved ? [place.building, detail].filter(Boolean).join(' · ') : session.location || 'Sin ubicación'}
                    {!place.resolved && session.location && ' · sin punto exacto en el mapa'}
                  </span>
                </span>
                {place.zoneId && <MapPinned className="mt-1 h-4 w-4 shrink-0 text-fg-brand" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ZoneCard({ zoneId, stops, highlightNext }: { zoneId: CampusZoneId; stops: RouteStop[]; highlightNext: boolean }) {
  const zone = ZONE_BY_ID.get(zoneId)!;
  const here = stops.filter((s) => s.place.zoneId === zoneId);
  const together = CAMPUS_ZONES.filter((z) => z.sharesFootprintWith === zoneId || (zone.sharesFootprintWith && z.id === zone.sharesFootprintWith));
  return (
    <section className="space-card animate-fade-up p-4" aria-label={zone.name}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold" style={{ background: zone.pin, color: zone.pinInk }} aria-hidden>
          {zone.code}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-extrabold leading-tight">{zone.name}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">{zone.description}</p>
          {together.length > 0 && <p className="mt-1 text-xs text-ink-muted">Aquí también: {together.map((z) => z.name).join(', ')}.</p>}
        </div>
      </div>
      {here.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-fg-brand">{highlightNext ? 'Tu siguiente misión está aquí' : 'Tus misiones aquí'}</p>
          <ul className="mt-1.5 grid gap-1.5">
            {here.map(({ reservation, session, place, n }) => (
              <li key={reservation.id} className="flex items-start gap-2 text-sm">
                <span className="w-6 shrink-0 font-display font-extrabold text-fg-brand">{n}</span>
                <span className="min-w-0">
                  <strong>{session.title}</strong>
                  <span className="block text-ink-muted">
                    {formatTime(session.starts_at)}
                    {placeDetailLine(place) ? ` · ${placeDetailLine(place)}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
