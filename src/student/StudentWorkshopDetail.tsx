import { ArrowLeft, ArrowLeftRight, Check, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, LoadError, PageSkeleton } from '../components/ui';
import { formatTime } from '../lib/catalog';
import { hasTightTransfer, sessionState, type BoardSession } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { useReservationBoard } from '../lib/useReservationBoard';
import { fetchWorkshopDetail } from '../lib/workshopDetailApi';
import { workshopLocation, workshopPersonalStatus } from '../lib/workshopDiscovery';
import { useEdition } from '../edition/EditionProvider';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import SessionRow from './reservations/SessionRow';

const TYPE_LABELS: Record<string, string> = { academica: 'Académico', liderazgo: 'Liderazgo', vida_universitaria: 'Vida universitaria' };
const CATEGORY_LABELS: Record<string, string> = {
  liderazgo: 'Liderazgo', deportiva: 'Deporte', artistica_cultural: 'Arte y cultura', vida_universitaria: 'Vida universitaria', otra: 'Otra experiencia',
};

/** Student editorial detail; the board remains the only source for sessions and booking state. */
export default function StudentWorkshopDetail() {
  const { activityId = '' } = useParams();
  const [params] = useSearchParams();
  const backPath = `/misiones${params.toString() ? `?${params.toString()}` : ''}`;
  const { edition } = useEdition();
  const { board, error, loading, reload, reserve, change } = useReservationBoard(edition?.id);
  const detail = useLoad(() => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(activityId) ? fetchWorkshopDetail(activityId) : Promise.resolve(null), [activityId]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const navigate = useNavigate();

  const back = <Link to={backPath} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-fg-brand"><ArrowLeft className="h-4 w-4" aria-hidden />Volver a Talleres</Link>;
  if (loading && !board) return <div className="space-y-4">{back}<PageSkeleton blocks={3} /></div>;
  if (error || !board) return <div className="space-y-4">{back}<LoadError error={error} onRetry={reload} /></div>;

  const sessions = board.sessions.filter((s) => s.activity_id === activityId && s.status === 'activa');
  if (!sessions.length) return <div className="space-y-4">{back}<Alert>Este taller no está disponible.</Alert></div>;
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
    const warning = hasTightTransfer(s, replacing)
      ? `Traslado ajustado: tienes menos de ${board.travel_buffer_minutes} min entre este taller y otro de tu ruta. Puedes continuar.`
      : undefined;
    const summary = { title: s.title, when: s.in_progress ? `${when} · En curso, puedes entrar` : when, where: s.location || undefined };
    if (changing && replacing && replacingSession) {
      setConfirm({
        title: 'Cambiar horario',
        body: `Cambiarás ${replacingSession.title} (${formatTime(replacingSession.starts_at)}) por ${s.title} (${when}). Si el nuevo lugar ya no está disponible, conservas tu reservación actual.`,
        confirmLabel: 'Confirmar cambio', summary, warning,
        action: async () => { await change(replacing.id, s.id); navigate('/ruta'); },
      });
    } else if (!changing) {
      setConfirm({
        title: 'Reservar lugar', body: s.in_progress ? 'Ya está en curso: puedes entrar ahora.' : '',
        confirmLabel: 'Reservar', summary, warning,
        success: { title: 'Listo. Lo agregamos a tu ruta.', body: `${s.title} · ${when}`, link: { to: '/ruta', label: 'Ver mi ruta' } },
        action: async () => { await reserve(s.id); },
      });
    }
  };

  const type = metadata?.activity_type && TYPE_LABELS[metadata.activity_type];
  const category = metadata?.experience_category && CATEGORY_LABELS[metadata.experience_category];
  return (
    <div className="space-y-5">
      {back}
      <article className="card overflow-hidden">
        <div className="h-1 bg-primary-500" />
        <div className="space-y-4 p-4 sm:p-5">
          <div>
            {(type || category) && <p className="text-xs font-bold uppercase tracking-wide text-fg-brand">{[type, category !== type ? category : null].filter(Boolean).join(' · ')}</p>}
            <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
              <h1 className="min-w-0 flex-1 font-display text-2xl font-extrabold leading-tight">{metadata?.title || first.title}</h1>
              {status && <span className="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-2.5 py-1 text-xs font-bold text-fg-success"><Check className="h-3 w-3" aria-hidden />{status}</span>}
            </div>
            {(metadata?.student_pitch || first.description) && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{metadata?.student_pitch || first.description}</p>}
          </div>

          {(metadata?.objective || metadata?.takeaway) && (
            <section className="space-y-2 border-t border-line pt-4">
              <h2 className="font-bold">Qué vas a hacer</h2>
              {metadata.objective && <p className="text-sm text-ink-muted">{metadata.objective}</p>}
              {metadata.takeaway && <p className="text-sm text-ink-muted"><strong className="text-ink">Te llevarás:</strong> {metadata.takeaway}</p>}
            </section>
          )}

          {metadata && (metadata.careers?.length > 0 || metadata.divisions?.length > 0) && (
            <section className="border-t border-line pt-4">
              <h2 className="font-bold">Para quién</h2>
              {metadata.careers?.length > 0 && <p className="mt-2 text-sm text-ink-muted"><strong className="text-ink">Carreras:</strong> {metadata.careers.map((c) => c.name).join(' · ')}</p>}
              {metadata.divisions?.length > 0 && <p className="mt-1 text-sm text-ink-muted"><strong className="text-ink">Divisiones:</strong> {metadata.divisions.map((d) => d.name).join(' · ')}</p>}
            </section>
          )}

          {(metadata?.requirements || location) && (
            <section className="space-y-2 border-t border-line pt-4">
              <h2 className="font-bold">Antes de ir</h2>
              {metadata?.requirements && <p className="whitespace-pre-line text-sm text-ink-muted">{metadata.requirements}</p>}
              {location && <p className="flex items-start gap-2 text-sm text-ink-muted"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{location}</p>}
            </section>
          )}
        </div>
      </article>

      {!!detail.error && <Alert tone="warning">No pudimos cargar toda la información del taller. Puedes consultar los horarios y <button className="font-semibold underline" onClick={detail.reload}>reintentar</button>.</Alert>}
      {changing && !canChange && <Alert tone="warning">No encontramos la reservación que deseas cambiar. <Link to="/ruta" className="font-semibold underline">Revisa tu ruta</Link>.</Alert>}
      {changing && replacingSession && <Alert><ArrowLeftRight className="mr-2 inline h-4 w-4" aria-hidden />Elige el nuevo horario para {replacingSession.title}.</Alert>}
      <section className="space-y-3">
        <div><h2 className="text-lg font-extrabold">Elige horario</h2><p className="text-sm text-ink-muted">Consulta los lugares y elige la sesión que te convenga.</p></div>
        <ul className="space-y-2">
          {sessions.map((s) => <SessionRow key={s.id} session={s} state={sessionState(board, s, replacing)} actionLabel={changing ? 'Cambiar aquí' : 'Reservar'} onAction={() => ask(s)} showLocation tightMinutes={hasTightTransfer(s, replacing) ? board.travel_buffer_minutes : null} hideAction={changing && !canChange} />)}
        </ul>
      </section>
      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
