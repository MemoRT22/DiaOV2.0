import { ArrowLeft, ArrowLeftRight, Backpack, CalendarClock, Clock3, Compass, MapPin, Sparkles, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import StaleBoardNotice from './ui/StaleBoardNotice';
import { Alert, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { durationMinutes, hasTightTransfer, isSelectable, sessionState, type Board, type BoardSession } from '../lib/reservations';
import { projectStamps } from '../lib/stampProjection';
import { useLoad } from '../lib/useLoad';
import { useReservationBoard } from '../lib/useReservationBoard';
import { fetchWorkshopDetail } from '../lib/workshopDetailApi';
import { bookableSeats, enrollmentClosedWithSeats, workshopDivisionIds, workshopDuration, workshopFinished, workshopLocation, workshopPersonalStatus } from '../lib/workshopDiscovery';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { MISSION } from './copy';
import { missionHeadline } from './MissionCard';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import { sheetEntryActive } from './useDismissOnBack';
import { mapForSession, MapActionLink } from './campus/mapLinks';
import PlaceLine from './campus/PlaceLine';
import { formatPlace } from './campus/resolveCampusLocation';
import SessionRow from './reservations/SessionRow';
import { ClampedText } from './ui/ClampedText';
import { DivisionOrb, divisionColor, divisionIcon, tintVars } from './ui/divisionVisuals';
import { ErrorState } from './ui/States';
import { StatusPill } from './ui/StatusPill';

// The historical liderazgo activity type is displayed as itself for legacy manual activities.
const TYPE_LABELS: Record<string, string> = { academica: 'Académico', liderazgo: 'Liderazgo', vida_universitaria: 'Vida Universitaria' };
const CATEGORY_LABELS: Record<string, string> = {
  liderazgo: 'Liderazgo', deportiva: 'Deportiva', artistica_cultural: 'Artística / cultural', vida_universitaria: 'Vida universitaria', otra: 'Otra',
};

/** Student editorial detail; the board remains the only source for sessions and booking state. */
export default function StudentWorkshopDetail() {
  const { activityId = '' } = useParams();
  const [params] = useSearchParams();
  const backPath = `/misiones${params.toString() ? `?${params.toString()}` : ''}`;
  const { edition } = useEdition();
  const { board, error, stale, loading, reload, reserve, change } = useReservationBoard(edition?.id);
  // The success sheet reads the route AFTER the board was refreshed with the server's answer.
  const latestBoard = useRef<Board | null>(null);
  latestBoard.current = board;
  const detail = useLoad(() => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(activityId) ? fetchWorkshopDetail(activityId) : Promise.resolve(null), [activityId]);
  // Only for the division colour; the page never waits for it.
  const divisions = useLoad(fetchDivisions, []);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const navigate = useNavigate();
  const routeLocation = useLocation();

  const { theme, term } = usePublicTheme();
  const fromCatalogue = (routeLocation.state as { fromCatalogue?: boolean } | null)?.fromCatalogue === true;
  const back = (
    <button
      type="button"
      onClick={() => { if (fromCatalogue) navigate(-1); else navigate(backPath); }}
      className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-fg-brand"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />Volver a {MISSION.many}
    </button>
  );
  if (loading && !board) return <div className="space-y-4">{back}<PageSkeleton blocks={3} /></div>;
  if (error || !board) return <div className="space-y-4">{back}<ErrorState error={error} onRetry={reload} /></div>;

  const sessions = board.sessions.filter((s) => s.activity_id === activityId && s.status === 'activa');
  if (!sessions.length) return <div className="space-y-4">{back}<Alert>Esta misión no está disponible.</Alert></div>;
  if (detail.loading && !detail.data && !detail.error) return <div className="space-y-4">{back}<PageSkeleton blocks={3} /></div>;

  const first = sessions[0];
  const metadata = detail.data;
  const location = workshopLocation(sessions);
  // One place for every session → one map link; different places → each schedule opens ITS own place.
  const uniqueLocations = [...new Set(sessions.map((s) => s.location))];
  const sharedLocation = uniqueLocations.length === 1 && uniqueLocations[0] ? uniqueLocations[0] : null;
  const mapSession = sessions.find((s) => s.my_reservation_id) ?? sessions[0];
  const status = workshopPersonalStatus(sessions);
  const changeId = params.get('cambiar');
  const replacing = board.reservations.find((r) => r.id === changeId && r.status === 'vigente') ?? null;
  const replacingSession = replacing && board.sessions.find((s) => s.id === replacing.session_id);
  const changing = !!changeId;
  const canChange = !!(replacing && replacingSession);

  /**
   * Read AFTER the server accepted the action and the board was refreshed: reservations (the limit) and the potential stamps of the route.
   * No projected rank here: the board only knows the stamps of RESERVED missions, not the official total (`my_progress`), and a rank
   * computed from a partial total could understate what the student already has. Where the official total is at hand, use
   * `projectedRankLevel` to fill `potentialRank`.
   */
  const routeProgress = (current: Board | null) => {
    const stamps = current ? projectStamps(current) : null;
    return {
      active: current?.active_reservation_count ?? 0,
      max: current?.max_reservations ?? 4,
      stamps: stamps ? { ...stamps, noun: (n: number) => term('stamp', n !== 1).toLowerCase() } : undefined,
    };
  };

  const ask = (s: BoardSession) => {
    const when = `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`;
    const whenWithDuration = `${when} · ${durationMinutes(s)} min`;
    const warning = hasTightTransfer(s, replacing)
      ? `Traslado ajustado: tienes menos de ${board.travel_buffer_minutes} min entre esta misión y otra de tu ruta. Puedes continuar.`
      : undefined;
    const summary = { title: s.title, when: s.in_progress ? `${whenWithDuration} · En curso, puedes entrar` : whenWithDuration, where: s.location ? formatPlace(s.location) : undefined };
    if (changing && replacing && replacingSession) {
      setConfirm({
        title: 'Cambiar horario',
        body: `Cambiarás ${replacingSession.title} (${formatTime(replacingSession.starts_at)}) por ${s.title} (${whenWithDuration}). Si el nuevo lugar ya no está disponible, conservas tu reservación actual.`,
        confirmLabel: 'Confirmar cambio', summary, warning,
        action: async () => { await change(replacing.id, s.id); navigate('/ruta', { replace: sheetEntryActive() }); },
      });
    } else if (!changing) {
      setConfirm({
        title: 'Reservar lugar', body: s.in_progress ? 'Ya está en curso: puedes entrar ahora.' : '',
        confirmLabel: 'Reservar', summary, warning,
        success: { title: '¡Listo! Misión agregada a tu ruta', body: `${s.title} · ${whenWithDuration}`, link: { to: '/ruta', label: 'Ver mi ruta' }, progress: () => routeProgress(latestBoard.current) },
        action: async () => { await reserve(s.id); },
      });
    }
  };

  const type = metadata?.activity_type && TYPE_LABELS[metadata.activity_type];
  const category = metadata?.experience_category && CATEGORY_LABELS[metadata.experience_category];
  const categoryLabel = category && category.toLocaleLowerCase('es') !== type?.toLocaleLowerCase('es') ? category : null;
  const divisionIds = workshopDivisionIds(first);
  const divisionNames = metadata?.divisions?.length ? metadata.divisions.map((d) => d.name) : [];
  const onlyDivision = divisionIds.length === 1 ? divisions.data?.find((d) => d.id === divisionIds[0]) : null;
  // Vida Universitaria keeps its own colour (the theme accent), as on the catalogue card.
  const color = type === 'Vida Universitaria' ? (theme.colors.accent || theme.colors.secondary) : divisionColor(theme, onlyDivision);
  const headline = missionHeadline(board, sessions, replacing, status);
  const openCount = sessions.filter((s) => isSelectable(sessionState(board, s, replacing))).length;
  const pitch = metadata?.student_pitch || first.description;
  const seatsLeft = bookableSeats(sessions);
  const AreaSymbol = divisionIcon(onlyDivision?.name ?? (divisionNames.length === 1 ? divisionNames[0] : type === 'Vida Universitaria' ? 'Vida Universitaria' : undefined));
  const placeName = onlyDivision?.name ?? (divisionNames.length === 1 ? divisionNames[0] : type === 'Vida Universitaria' ? 'Vida Universitaria' : undefined);
  const careers = metadata?.careers ?? [];
  const hasAbout = !!(metadata?.objective || metadata?.takeaway || careers.length > 0 || (metadata?.divisions?.length ?? 0) > 0);
  const seatsValue = seatsLeft > 0 ? `${seatsLeft} libres` : workshopFinished(sessions) ? 'Finalizada' : enrollmentClosedWithSeats(sessions) ? 'Inscripción cerrada' : 'Llena';
  const slotsValue = status === 'En tu ruta' ? 'En tu ruta' : status === 'Explorado' ? 'Completada' : openCount ? `${openCount} disponible${openCount === 1 ? '' : 's'}` : 'Ninguno libre';
  return (
    <div className="space-y-4">
      {back}
      <StaleBoardNotice stale={stale} onRetry={reload} />

      {/* 1 · what it is and what it takes, in one compact card: name, pitch, the three facts and where. Times come right after. */}
      <header className="space-card relative animate-fade-up overflow-hidden p-4" style={tintVars(color)}>
        <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgb(var(--tint)/0.35),transparent_70%)]" aria-hidden />
        {/* the same large, faint symbol of the area as on the catalogue card: one identity from card to detail */}
        <AreaSymbol className="pointer-events-none absolute -bottom-6 -right-6 h-36 w-36 text-[rgb(var(--tint))] opacity-[0.07]" strokeWidth={1.25} aria-hidden />
        <div className="relative flex items-start gap-3">
          <DivisionOrb name={placeName} color={color} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-fg-brand">{[MISSION.one, type, categoryLabel].filter(Boolean).join(' · ')}</p>
            <h1 className="mt-0.5 font-display text-[1.45rem] font-extrabold leading-tight">{metadata?.title || first.title}</h1>
          </div>
        </div>
        {headline && <div className="relative mt-2.5"><StatusPill kind={headline.kind}>{headline.label}</StatusPill></div>}
        {pitch && <div className="relative mt-2.5 text-[0.95rem] leading-relaxed text-ink"><ClampedText text={pitch} lines={3} /></div>}

        {/* the facts, at a glance and never buried in text */}
        <ul aria-label="Datos de la misión" className="relative mt-3 flex flex-wrap gap-2">
          <Fact icon={Clock3} label="Duración" value={workshopDuration(sessions)} />
          <Fact icon={CalendarClock} label="Horarios" value={slotsValue} />
          <Fact icon={Users} label="Lugares" value={seatsValue} />
        </ul>
        {location && (
          <div className="relative mt-2.5 text-sm">
            {sharedLocation ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <PlaceLine location={sharedLocation} />
                <MapActionLink to={mapForSession(mapSession.id)} ariaLabel={`Ver en el mapa: ${formatPlace(sharedLocation)}`} />
              </div>
            ) : (
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold">{location}</span>
                  <span className="block text-ink-muted">Cada horario indica su lugar y su mapa.</span>
                </span>
              </p>
            )}
          </div>
        )}
      </header>

      {!!detail.error && <Alert tone="warning">No pudimos cargar toda la información de la misión. Puedes consultar los horarios y <button className="font-semibold underline" onClick={detail.reload}>reintentar</button>.</Alert>}
      {changing && !canChange && <Alert tone="warning">No encontramos la reservación que deseas cambiar. <Link to="/ruta" className="font-semibold underline">Revisa tu ruta</Link>.</Alert>}
      {changing && replacingSession && <Alert><ArrowLeftRight className="mr-2 inline h-4 w-4" aria-hidden />Elige el nuevo horario para {replacingSession.title}.</Alert>}

      {/* 2 · schedules, availability and the action: the point of opening a mission, right under its summary */}
      <section id="horarios" className="scroll-mt-20 space-y-3" aria-label="Horarios">
        <div>
          <h2 className="text-lg font-extrabold">Elige tu horario</h2>
          <p className="text-sm text-ink-muted">Toca «{changing ? 'Cambiar aquí' : 'Reservar'}» en el horario que te quede mejor.</p>
        </div>
        <ul className="space-y-2.5">
          {sessions.map((s) => <SessionRow key={s.id} session={s} state={sessionState(board, s, replacing)} actionLabel={changing ? 'Cambiar aquí' : 'Reservar'} onAction={() => ask(s)} showLocation={!sharedLocation} tightMinutes={hasTightTransfer(s, replacing) ? board.travel_buffer_minutes : null} hideAction={changing && !canChange} mapHref={!sharedLocation && s.location ? mapForSession(s.id) : undefined} />)}
        </ul>
      </section>

      {/* 3 · before going: short and practical, so it stays visible */}
      {metadata?.requirements && (
        <section className="rounded-theme border border-warning-500/40 bg-warning-500/10 p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold"><Backpack className="h-4 w-4 text-fg-warning" aria-hidden />Antes de ir</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{metadata.requirements}</p>
        </section>
      )}

      {/* 4 · the academic substance, complete and one tap away: what you will live, what you take, who it is for */}
      {hasAbout && (
        <section className="space-card space-y-4 p-4" aria-label="Sobre la misión">
          {metadata?.objective && (
            <div>
              <h2 className="flex items-center gap-2 font-extrabold"><Sparkles className="h-4 w-4 text-fg-brand" aria-hidden />Qué vas a vivir</h2>
              <ClampedText text={metadata.objective} lines={4} className="mt-1 text-sm text-ink-muted" />
            </div>
          )}
          {metadata?.takeaway && (
            <p className="text-sm text-ink-muted"><strong className="text-ink">Te llevarás:</strong> {metadata.takeaway}</p>
          )}
          {(careers.length > 0 || (metadata?.divisions?.length ?? 0) > 0) && (
            <div className={metadata?.objective || metadata?.takeaway ? 'border-t border-line pt-4' : ''}>
              <h2 className="flex items-center gap-2 font-extrabold"><Compass className="h-4 w-4 text-fg-brand" aria-hidden />Ideal si te interesa</h2>
              {careers.length > 0 && <CareerChips careers={careers} />}
              {(metadata?.divisions?.length ?? 0) > 0 && <p className="mt-3 text-sm text-ink-muted"><strong className="text-ink">Divisiones:</strong> {metadata!.divisions.map((d) => d.name).join(' · ')}</p>}
            </div>
          )}
        </section>
      )}
      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

/** The first careers, and the rest one tap away (up to 8 exist): the chips never take over the screen. */
const CAREERS_SHOWN = 4;
function CareerChips({ careers }: { careers: { id: string; name: string }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? careers : careers.slice(0, CAREERS_SHOWN);
  const hidden = careers.length - CAREERS_SHOWN;
  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Carreras">
      {shown.map((c) => <li key={c.id} className="rounded-full border border-line bg-surface-raised px-3 py-1 text-xs font-semibold">{c.name}</li>)}
      {hidden > 0 && (
        <li>
          <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="inline-flex min-h-8 items-center rounded-full border border-dashed border-line px-3 text-xs font-bold text-fg-brand">
            {all ? 'Ver menos' : `+${hidden} más`}
          </button>
        </li>
      )}
    </ul>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-sm font-bold">
      <Icon className="h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
      <span className="sr-only">{label}: </span>
      {value}
    </li>
  );
}
