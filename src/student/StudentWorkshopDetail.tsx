import { ArrowDown, ArrowLeft, ArrowLeftRight, Backpack, CalendarClock, Clock3, Compass, MapPin, Sparkles, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { durationMinutes, hasTightTransfer, isSelectable, sessionState, type BoardSession } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { useReservationBoard } from '../lib/useReservationBoard';
import { fetchWorkshopDetail } from '../lib/workshopDetailApi';
import { workshopDivisionIds, workshopDuration, workshopLocation, workshopPersonalStatus } from '../lib/workshopDiscovery';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { MISSION } from './copy';
import { missionHeadline } from './MissionCard';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import SessionRow from './reservations/SessionRow';
import { DivisionOrb, divisionColor, tintVars } from './ui/divisionVisuals';
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
  const { board, error, loading, reload, reserve, change } = useReservationBoard(edition?.id);
  const detail = useLoad(() => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(activityId) ? fetchWorkshopDetail(activityId) : Promise.resolve(null), [activityId]);
  // Only for the division colour; the page never waits for it.
  const divisions = useLoad(fetchDivisions, []);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const navigate = useNavigate();

  const { theme } = usePublicTheme();
  const back = <Link to={backPath} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-fg-brand"><ArrowLeft className="h-4 w-4" aria-hidden />Volver a {MISSION.many}</Link>;
  if (loading && !board) return <div className="space-y-4">{back}<PageSkeleton blocks={3} /></div>;
  if (error || !board) return <div className="space-y-4">{back}<ErrorState error={error} onRetry={reload} /></div>;

  const sessions = board.sessions.filter((s) => s.activity_id === activityId && s.status === 'activa');
  if (!sessions.length) return <div className="space-y-4">{back}<Alert>Esta misión no está disponible.</Alert></div>;
  if (detail.loading && !detail.data && !detail.error) return <div className="space-y-4">{back}<PageSkeleton blocks={3} /></div>;

  const first = sessions[0];
  const metadata = detail.data;
  const location = workshopLocation(sessions);
  const status = workshopPersonalStatus(sessions);
  const changeId = params.get('cambiar');
  const replacing = board.reservations.find((r) => r.id === changeId && r.status === 'vigente') ?? null;
  const replacingSession = replacing && board.sessions.find((s) => s.id === replacing.session_id);
  const changing = !!changeId;
  const canChange = !!(replacing && replacingSession);

  const ask = (s: BoardSession) => {
    const when = `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`;
    const whenWithDuration = `${when} · ${durationMinutes(s)} min`;
    const warning = hasTightTransfer(s, replacing)
      ? `Traslado ajustado: tienes menos de ${board.travel_buffer_minutes} min entre esta misión y otra de tu ruta. Puedes continuar.`
      : undefined;
    const summary = { title: s.title, when: s.in_progress ? `${whenWithDuration} · En curso, puedes entrar` : whenWithDuration, where: s.location || undefined };
    if (changing && replacing && replacingSession) {
      setConfirm({
        title: 'Cambiar horario',
        body: `Cambiarás ${replacingSession.title} (${formatTime(replacingSession.starts_at)}) por ${s.title} (${whenWithDuration}). Si el nuevo lugar ya no está disponible, conservas tu reservación actual.`,
        confirmLabel: 'Confirmar cambio', summary, warning,
        action: async () => { await change(replacing.id, s.id); navigate('/ruta'); },
      });
    } else if (!changing) {
      setConfirm({
        title: 'Reservar lugar', body: s.in_progress ? 'Ya está en curso: puedes entrar ahora.' : '',
        confirmLabel: 'Reservar', summary, warning,
        success: { title: '¡Listo! Misión agregada a tu ruta', body: `${s.title} · ${whenWithDuration}`, link: { to: '/ruta', label: 'Ver mi ruta' } },
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
  const color = divisionColor(theme, onlyDivision);
  const headline = missionHeadline(board, sessions, replacing, status);
  const openCount = sessions.filter((s) => isSelectable(sessionState(board, s, replacing))).length;
  const pitch = metadata?.student_pitch || first.description;
  const seatsLeft = sessions.filter((s) => !s.ended && s.status === 'activa').reduce((n, s) => n + Math.max(s.remaining, 0), 0);
  return (
    <div className="space-y-5">
      {back}
      <article className="space-y-5">
        {/* 1–2 · name and what you will experience */}
        <header className="space-card relative animate-fade-up overflow-hidden p-5" style={tintVars(color)}>
          <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgb(var(--tint)/0.35),transparent_70%)]" aria-hidden />
          <div className="relative flex items-start gap-3">
            <DivisionOrb name={onlyDivision?.name ?? (divisionNames.length === 1 ? divisionNames[0] : type === 'Vida Universitaria' ? 'Vida Universitaria' : undefined)} color={color} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-fg-brand">{[MISSION.one, type, categoryLabel].filter(Boolean).join(' · ')}</p>
              <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight">{metadata?.title || first.title}</h1>
            </div>
          </div>
          {headline && <div className="relative mt-3"><StatusPill kind={headline.kind}>{headline.label}</StatusPill></div>}
          {pitch && <p className="relative mt-3 whitespace-pre-line text-[0.95rem] leading-relaxed text-ink">{pitch}</p>}

          {/* 4–7 · logistics at a glance, never buried in text */}
          <dl className="relative mt-4 grid grid-cols-3 gap-2 text-center">
            <Fact icon={Clock3} label="Duración" value={workshopDuration(sessions)} />
            <Fact icon={CalendarClock} label="Horarios" value={status === 'En tu ruta' ? 'En tu ruta' : status === 'Explorado' ? 'Completada' : openCount ? `${openCount} disponible${openCount === 1 ? '' : 's'}` : 'Ninguno libre'} />
            <Fact icon={Users} label="Lugares" value={seatsLeft > 0 ? `${seatsLeft} libres` : 'Llena'} />
          </dl>
          {location && (
            <p className="relative mt-3 flex items-start gap-2 rounded-theme border border-line bg-surface/70 px-3 py-2.5 text-sm font-semibold">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
              <span className="min-w-0 break-words">{location}</span>
            </p>
          )}
          {openCount > 0 && (
            <a href="#horarios" className="relative mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary-500 px-6 text-sm font-extrabold text-on-primary shadow-[0_8px_24px_-8px_rgb(var(--c-primary-500)/0.8)]">
              {changing ? 'Elegir nuevo horario' : 'Elegir horario'}
              <ArrowDown className="h-4 w-4" aria-hidden />
            </a>
          )}
        </header>

        {(metadata?.objective || metadata?.takeaway) && (
          <section className="space-card space-y-2 p-5">
            <h2 className="flex items-center gap-2 font-extrabold"><Sparkles className="h-4 w-4 text-fg-brand" aria-hidden />Qué vas a vivir</h2>
            {metadata.objective && <p className="text-sm text-ink-muted">{metadata.objective}</p>}
            {metadata.takeaway && <p className="text-sm text-ink-muted"><strong className="text-ink">Te llevarás:</strong> {metadata.takeaway}</p>}
          </section>
        )}

        {/* 3 · why it could interest me */}
        {metadata && (metadata.careers?.length > 0 || metadata.divisions?.length > 0) && (
          <section className="space-card p-5">
            <h2 className="flex items-center gap-2 font-extrabold"><Compass className="h-4 w-4 text-fg-brand" aria-hidden />Ideal si te interesa</h2>
            {metadata.careers?.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Carreras">
                {metadata.careers.map((c) => <li key={c.id} className="rounded-full border border-line bg-surface-raised px-3 py-1 text-xs font-semibold">{c.name}</li>)}
              </ul>
            )}
            {metadata.divisions?.length > 0 && <p className="mt-3 text-sm text-ink-muted"><strong className="text-ink">Divisiones:</strong> {metadata.divisions.map((d) => d.name).join(' · ')}</p>}
          </section>
        )}

        {/* 8 · requirements */}
        {metadata?.requirements && (
          <section className="rounded-theme border border-warning-500/40 bg-warning-500/10 p-4">
            <h2 className="flex items-center gap-2 text-sm font-extrabold"><Backpack className="h-4 w-4 text-fg-warning" aria-hidden />Antes de ir</h2>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{metadata.requirements}</p>
          </section>
        )}
      </article>

      {!!detail.error && <Alert tone="warning">No pudimos cargar toda la información de la misión. Puedes consultar los horarios y <button className="font-semibold underline" onClick={detail.reload}>reintentar</button>.</Alert>}
      {changing && !canChange && <Alert tone="warning">No encontramos la reservación que deseas cambiar. <Link to="/ruta" className="font-semibold underline">Revisa tu ruta</Link>.</Alert>}
      {changing && replacingSession && <Alert><ArrowLeftRight className="mr-2 inline h-4 w-4" aria-hidden />Elige el nuevo horario para {replacingSession.title}.</Alert>}

      {/* 6–7 + 9 · schedules, availability and the action */}
      <section id="horarios" className="scroll-mt-20 space-y-3" aria-label="Horarios">
        <div>
          <h2 className="text-lg font-extrabold">Elige tu horario</h2>
          <p className="text-sm text-ink-muted">Toca «{changing ? 'Cambiar aquí' : 'Reservar'}» en el horario que te quede mejor.</p>
        </div>
        <ul className="space-y-2.5">
          {sessions.map((s) => <SessionRow key={s.id} session={s} state={sessionState(board, s, replacing)} actionLabel={changing ? 'Cambiar aquí' : 'Reservar'} onAction={() => ask(s)} showLocation={sessions.length > 1 || !location} tightMinutes={hasTightTransfer(s, replacing) ? board.travel_buffer_minutes : null} hideAction={changing && !canChange} />)}
        </ul>
      </section>
      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="rounded-theme border border-line bg-surface/70 px-2 py-2.5">
      <dt className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</dt>
      <dd className="mt-0.5 text-sm font-extrabold leading-tight">{value}</dd>
    </div>
  );
}
