import { ArrowLeft, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Modal, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import {
  CATEGORY_LABELS, STATUS_LABELS, TYPE_LABELS, workshopAdminApi,
  type PublishResult, type ReviewAction, type WorkshopCareer, type WorkshopDetail as Detail,
} from '../../lib/workshopAdminApi';

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Aún no';
const text = (value: string | null | undefined) => value?.trim() || 'No especificado';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card space-y-4 p-5"><h2 className="text-lg font-bold">{title}</h2>{children}</section>;
}
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{children}</dd></div>;
}
function groupCareers(careers: WorkshopCareer[]) {
  const groups = new Map<string, WorkshopCareer[]>();
  for (const career of careers) groups.set(career.division_name, [...(groups.get(career.division_name) ?? []), career]);
  return [...groups];
}
function timeMinutes(time: string) {
  const [hours, mins, seconds = 0] = time.split(':').map(Number);
  return hours * 60 + mins + seconds / 60;
}
function expectedSessions(detail: Detail) {
  return Math.ceil((timeMinutes(detail.operating_end_time) - timeMinutes(detail.operating_start_time)) / detail.session_duration_minutes);
}
function PublicationSummary({ detail, result }: { detail: Detail; result?: PublishResult }) {
  const life = detail.activity_type === 'vida_universitaria';
  const grouped = groupCareers(detail.careers);
  const lastEnd = timeMinutes(detail.operating_start_time) + expectedSessions(detail) * detail.session_duration_minutes;
  const lastEndLabel = `${String(Math.floor(lastEnd / 60) % 24).padStart(2, '0')}:${String(Math.floor(lastEnd % 60)).padStart(2, '0')}${lastEnd >= 1440 ? ' del día siguiente' : ''}`;
  return <dl className="grid gap-4 sm:grid-cols-2">
    <Item label="Tipo de actividad">{TYPE_LABELS[detail.activity_type]}</Item>
    <Item label="Título">{detail.title}</Item>
    <Item label="Duración por sesión">{detail.session_duration_minutes} minutos</Item>
    <Item label={result ? 'Sesiones generadas' : detail.status === 'published' ? 'Sesiones según horario' : 'Sesiones previstas'}>
      {result?.session_count ?? expectedSessions(detail)}
    </Item>
    <Item label="Capacidad por sesión">{detail.capacity_per_session}</Item>
    <Item label="Horario operativo">{detail.operating_start_time.slice(0, 5)}–{detail.operating_end_time.slice(0, 5)}</Item>
    {lastEnd > timeMinutes(detail.operating_end_time) &&
      <div className="sm:col-span-2"><Item label="Fin de la última sesión">{lastEndLabel}. Las sesiones se generan con la duración completa.</Item></div>}
    <Item label="Ubicación">{detail.building} · {detail.room_space}</Item>
    {life ? <Item label="Clasificación">{CATEGORY_LABELS[detail.experience_category ?? ''] ?? text(detail.experience_category)}</Item> :
      <div className="sm:col-span-2"><Item label="Carreras y divisiones">{grouped.map(([division, careers]) =>
        <div key={division}><strong>{division}</strong>: {careers.map((career) => career.career_name).join(', ')}</div>)}</Item></div>}
    {(result?.activity_id ?? detail.published_activity_id) &&
      <div className="sm:col-span-2"><Item label="ID de actividad">{result?.activity_id ?? detail.published_activity_id}</Item></div>}
    {result && <Item label="Credencial de actividad">{result.credential_created ? 'Generada' : 'No generada'}</Item>}
  </dl>;
}

export default function WorkshopDetail() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useLoad(() => workshopAdminApi.get(id), [id]);
  const [adminNotes, setAdminNotes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<ReviewAction | 'publish' | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishedResult, setPublishedResult] = useState<PublishResult | null>(null);
  const [approvedId, setApprovedId] = useState<string | null>(null);

  useEffect(() => { if (data) { setAdminNotes(data.admin_notes ?? ''); setFeedback(data.review_feedback ?? ''); } }, [data]);

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copiado.`); setActionError(''); }
    catch { setActionError('No se pudo copiar. Selecciona el texto y cópialo manualmente.'); }
  };
  const run = async (action: ReviewAction, fields: { admin_notes?: string; review_feedback?: string } = {}) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action); setNotice(''); setActionError('');
    try {
      const updated = await workshopAdminApi.transition(action, id, fields);
      if (action === 'approve' && updated.status === 'approved') setApprovedId(id);
      setConfirmArchive(false);
      setNotice({ start_review: 'Revisión iniciada.', save_notes: 'Notas internas guardadas.',
        request_changes: 'Cambios solicitados. El feedback quedó preparado para enviarlo manualmente.',
        resume_review: 'Revisión reanudada.', approve: 'Propuesta aprobada.',
        archive: 'Propuesta archivada.' }[action]);
      await reload();
    } catch (cause) { setActionError(friendlyError(cause)); }
    finally { busyRef.current = false; setBusy(null); }
  };
  const publish = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('publish'); setNotice(''); setActionError('');
    try {
      const result = await workshopAdminApi.publish(id);
      setPublishedResult(result);
      setConfirmPublish(false);
      setNotice('Propuesta publicada en Día OV.');
      await reload();
    } catch (cause) { setActionError(friendlyError(cause)); }
    finally { busyRef.current = false; setBusy(null); }
  };

  if (loading && !data) return <Spinner label="Cargando propuesta" />;
  if (!data) return <div className="space-y-4"><Link to="/coordinacion/talleres" className="text-sm underline">Volver a propuestas</Link>
    <Alert tone="error">{friendlyError(error ?? 'NOT_FOUND')} <button onClick={reload} className="font-semibold underline">Reintentar</button></Alert></div>;

  const publication = publishedResult?.submission_id === id ? publishedResult : null;
  const status = publication ? 'published' : approvedId === id && data.status === 'in_review' ? 'approved' : data.status;
  const editable = ['submitted', 'in_review', 'changes_requested', 'approved'].includes(status);
  const life = data.activity_type === 'vida_universitaria';
  return (
    <div className="space-y-6">
      <Link to="/coordinacion/talleres" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Volver a propuestas</Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-extrabold">{data.title}</h1><Badge>{STATUS_LABELS[status]}</Badge></div>
        <p className="text-sm text-ink-muted">Enviada el {formatDate(data.submitted_at)} · Actualizada el {formatDate(data.updated_at)}</p>
      </header>
      {notice && <Alert tone="success">{notice}</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {!!error && <Alert tone="error">{friendlyError(error)}</Alert>}
      {status === 'published' && <Section title="Actividad publicada">
        <p className="text-sm text-ink-muted">La propuesta quedó cerrada. Este detalle está disponible solo para consulta.</p>
        <PublicationSummary detail={data} result={publication ?? undefined} />
      </Section>}

      <Section title="Responsable">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label="Nombre">{data.facilitator_name}</Item>
          <Item label="Correo"><span className="break-all">{data.facilitator_email}</span></Item>
        </dl>
        <Button variant="secondary" onClick={() => copy(data.facilitator_email, 'Correo')}><Copy className="h-4 w-4" />Copiar correo</Button>
      </Section>

      <Section title="Propuesta">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label="Tipo">{TYPE_LABELS[data.activity_type]}</Item>
          {life && <Item label="Clasificación">{CATEGORY_LABELS[data.experience_category ?? ''] ?? text(data.experience_category)}</Item>}
          <Item label="Título">{data.title}</Item>
          <Item label="Palabras clave">{data.keywords.join(', ')}</Item>
          <div className="sm:col-span-2"><Item label="Presentación breve">{data.student_pitch}</Item></div>
        </dl>
      </Section>

      <Section title={life ? 'Experiencia de Vida Universitaria' : 'Experiencia académica'}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label="Objetivo">{text(data.objective)}</Item>
          <Item label="Qué se llevará el alumno">{data.takeaway}</Item>
        </dl>
      </Section>

      <Section title="Logística">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label="Duración">{data.session_duration_minutes === 60 ? '1 hora' : '30 minutos'}</Item>
          <Item label="Capacidad por sesión">{data.capacity_per_session}</Item>
          <Item label="Horario operativo">{data.operating_start_time.slice(0, 5)}–{data.operating_end_time.slice(0, 5)}</Item>
          <Item label="Edificio">{data.building}</Item>
          <Item label="Salón o espacio">{data.room_space}</Item>
          <Item label="Requerimientos">{text(data.requirements)}</Item>
          <div className="sm:col-span-2"><Item label="Notas del tallerista">{text(data.notes)}</Item></div>
        </dl>
      </Section>

      {!life && <Section title="Carreras relacionadas">
        {data.careers.length === 0 ? <p className="text-sm text-ink-muted">Sin carreras relacionadas.</p> :
          groupCareers(data.careers).map(([division, careers]) =>
            <div key={division}><h3 className="font-semibold">{division}</h3>
              <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">{careers.map((career) => <li key={career.career_id}>{career.career_name}</li>)}</ul>
            </div>)}
      </Section>}

      <Section title="Revisión administrativa">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Item label="Estado">{STATUS_LABELS[status]}</Item>
          <Item label="Revisó">{data.reviewer_name ?? 'Sin asignar'}</Item>
          <Item label="Última revisión">{formatDate(data.reviewed_at)}</Item>
        </dl>
        <label className="block text-sm font-semibold">Notas internas de Coordinación
          <textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} readOnly={!editable}
            maxLength={5000} rows={4} className="mt-2 w-full rounded-theme border border-line bg-surface-raised p-3 text-ink read-only:opacity-75" />
        </label>
        {editable && <Button variant="secondary" loading={busy === 'save_notes'} disabled={!!busy}
          onClick={() => run('save_notes', { admin_notes: adminNotes })}>Guardar notas internas</Button>}
        <div>
          <label className="block text-sm font-semibold">Feedback para el tallerista
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} readOnly={status !== 'in_review'}
              maxLength={5000} rows={4} className="mt-2 w-full rounded-theme border border-line bg-surface-raised p-3 text-ink read-only:opacity-75" />
          </label>
          <p className="mt-1 text-xs text-ink-muted">Este mensaje no se envía automáticamente.</p>
          {data.review_feedback && <Button variant="secondary" className="mt-2" onClick={() => copy(data.review_feedback ?? '', 'Feedback')}><Copy className="h-4 w-4" />Copiar feedback</Button>}
        </div>
        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          {status === 'submitted' && <Button loading={busy === 'start_review'} disabled={!!busy} onClick={() => run('start_review')}>Comenzar revisión</Button>}
          {status === 'in_review' && <><Button loading={busy === 'request_changes'} disabled={!!busy || !feedback.trim()}
            onClick={() => run('request_changes', { review_feedback: feedback })}>Solicitar cambios</Button>
            <Button variant="secondary" loading={busy === 'approve'} disabled={!!busy} onClick={() => run('approve')}>Aprobar propuesta</Button></>}
          {status === 'changes_requested' && <Button loading={busy === 'resume_review'} disabled={!!busy}
            onClick={() => run('resume_review')}>Reanudar revisión</Button>}
          {status === 'approved' && <Button loading={busy === 'publish'} disabled={!!busy} onClick={() => setConfirmPublish(true)}>Publicar en Día OV</Button>}
          {editable && <Button variant="danger" disabled={!!busy} onClick={() => setConfirmArchive(true)}>Archivar propuesta</Button>}
        </div>
      </Section>
      {confirmArchive && <Modal title="Archivar propuesta" onClose={() => { if (!busyRef.current) setConfirmArchive(false); }}>
        <p className="mb-5 text-sm text-ink-muted">La propuesta saldrá de la bandeja activa. Se conservará con su historial de revisión.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={!!busy} onClick={() => setConfirmArchive(false)}>Cancelar</Button>
          <Button variant="danger" loading={busy === 'archive'} disabled={!!busy} onClick={() => run('archive', { admin_notes: adminNotes })}>Confirmar archivo</Button>
        </div>
      </Modal>}
      {confirmPublish && status === 'approved' && <Modal title="Confirmar publicación" onClose={() => { if (!busyRef.current) setConfirmPublish(false); }}>
        <p className="mb-5 text-sm text-ink-muted">Se crearán la actividad, sus sesiones y la credencial a partir de esta propuesta.</p>
        <PublicationSummary detail={data} />
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={!!busy} onClick={() => setConfirmPublish(false)}>Cancelar</Button>
          <Button loading={busy === 'publish'} disabled={!!busy} onClick={publish}>Confirmar publicación</Button>
        </div>
      </Modal>}
    </div>
  );
}
