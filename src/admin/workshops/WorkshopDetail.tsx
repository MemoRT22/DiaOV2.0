import { ArrowLeft, Copy, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Modal, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { formatEventDateTime, formatEventTime } from '../../lib/eventTime';
import { useLoad } from '../../lib/useLoad';
import PhraseConfirmModal from '../PhraseConfirmModal';
import WorkshopDeleteSummary from './WorkshopDeleteSummary';
import WorkshopAudience from './WorkshopAudience';
import {
  CATEGORY_LABELS, GROUP_LABELS, TYPE_LABELS, groupForStatus, workshopAdminApi,
  type WorkshopCareer, type WorkshopDetail as Detail,
} from '../../lib/workshopAdminApi';

const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const SESSION_STATUS_LABELS: Record<string, string> = { activa: 'Disponible', oculta: 'Oculto', cancelada: 'Cancelado' };
const sessionStatusLabel = (status: string) => SESSION_STATUS_LABELS[status] ?? 'Sin estado';
const fallback = (value: string | null | undefined) => value?.trim() || 'No especificado';
const groupCareers = (careers: WorkshopCareer[]) => {
  const groups = new Map<string, string[]>();
  for (const career of careers) groups.set(career.division_name, [...(groups.get(career.division_name) ?? []), career.career_name]);
  return [...groups];
};
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card admin-detail-section space-y-4 p-5"><h2 className="text-lg font-bold">{title}</h2>{children}</section>;
}
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{children}</dd></div>;
}
function Operational({ detail }: { detail: Detail }) {
  return <Section title="Operación del taller">
    <p className="text-sm text-ink-muted">Horarios y cupos del taller.</p>
    {detail.sessions?.length ? <div className="space-y-3">{detail.sessions.map((session) => <div key={session.id} className="rounded-theme border border-line p-4">
      <p className="font-semibold">{formatEventDateTime(session.starts_at)} – {formatEventTime(session.ends_at)}</p>
      <p className="mt-1 text-sm text-ink-muted">Cupo {session.capacity} · Reservados {session.reserved} · {fallback(session.location)} · {sessionStatusLabel(session.status)}</p>
    </div>)}</div> : <p className="text-sm text-ink-muted">Sin sesiones registradas.</p>}
  </Section>;
}

export default function WorkshopDetail() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useLoad(() => workshopAdminApi.get(id), [id]);
  const [busy, setBusy] = useState<'approve' | 'discard' | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  const run = async (action: 'approve' | 'discard') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action); setNotice(''); setActionError('');
    try {
      if (action === 'approve') await workshopAdminApi.approve(id);
      else await workshopAdminApi.discard(id);
      setConfirmDiscard(false);
      setNotice(action === 'approve' ? 'Taller aprobado y publicado.' : 'Taller descartado.');
      await reload();
    } catch (cause) { setActionError(friendlyError(cause)); }
    finally { busyRef.current = false; setBusy(null); }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice('Correo copiado.'); }
    catch { setActionError('No se pudo copiar. Selecciona el correo y cópialo manualmente.'); }
  };
  if (loading && !data) return <Spinner label="Cargando taller" />;
  if (!data) return <div className="space-y-4"><Link to="/coordinacion/talleres" className="text-sm underline">Volver a Talleres</Link>
    <Alert tone="error">{friendlyError(error ?? 'NOT_FOUND')} <button onClick={reload} className="font-semibold underline">Reintentar</button></Alert></div>;

  const group = groupForStatus(data.status);
  const pending = group === 'pending';
  const life = data.activity_type === 'vida_universitaria';
  return <div className="space-y-6">
    <Link to="/coordinacion/talleres" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Volver a Talleres</Link>
    <header className="admin-feature-card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">{TYPE_LABELS[data.activity_type]}</p><h1 className="text-2xl font-extrabold">{data.title}</h1><p className="mt-2 text-sm text-ink-muted">Recibido el {formatDate(data.submitted_at)}</p></div><Badge tone={group === 'published' ? 'success' : group === 'archived' ? 'neutral' : 'warning'}>{GROUP_LABELS[group]}</Badge></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {group !== 'archived' ? <Link to={`/coordinacion/talleres/${id}/editar`} className="admin-action-link" data-primary="true"><Pencil className="h-4 w-4" aria-hidden />Editar taller</Link> : <span />}
        <button type="button" className="admin-action-link text-fg-error" onClick={() => { setActionError(''); setConfirmDelete(true); }}><Trash2 className="h-4 w-4" aria-hidden />Eliminar taller</button>
      </div>
    </header>
    {notice && <Alert tone="success">{notice} <Link to="/coordinacion/talleres" className="font-semibold underline">Volver a Talleres</Link></Alert>}
    {actionError && <Alert tone="error">{actionError}</Alert>}
    {!!error && <Alert tone="error">{friendlyError(error)}</Alert>}

    <Section title="Responsable"><dl className="grid gap-4 sm:grid-cols-2">
      <Item label="Nombre">{data.facilitator_name}</Item><Item label="Correo">{data.facilitator_email}</Item>
    </dl><Button variant="secondary" onClick={() => copy(data.facilitator_email)}><Copy className="h-4 w-4" />Copiar correo</Button></Section>

    <Section title="Sobre el taller"><dl className="grid gap-4 sm:grid-cols-2">
      <Item label="Tipo">{TYPE_LABELS[data.activity_type]}</Item>
      {life && <Item label="Categoría">{CATEGORY_LABELS[data.experience_category ?? ''] ?? fallback(data.experience_category)}</Item>}
      <Item label="Título">{data.title}</Item><Item label="Palabras clave">{data.keywords.join(', ')}</Item>
      <div className="sm:col-span-2"><Item label="Presentación breve">{data.student_pitch}</Item></div>
    </dl></Section>

    <Section title="Experiencia"><dl className="grid gap-4 sm:grid-cols-2">
      <Item label="Objetivo">{fallback(data.objective)}</Item><Item label="Qué se llevará el alumno">{data.takeaway}</Item>
    </dl></Section>

    <Section title="Logística"><dl className="grid gap-4 sm:grid-cols-2">
      <Item label="Duración">{data.session_duration_minutes} minutos</Item><Item label="Cupo por sesión">{data.capacity_per_session}</Item>
      <Item label="Horario">{data.operating_start_time.slice(0, 5)}–{data.operating_end_time.slice(0, 5)}</Item>
      <Item label="Ubicación">{data.building} · {data.room_space}</Item>
      <Item label="Requerimientos">{fallback(data.requirements)}</Item><Item label="Notas">{fallback(data.notes)}</Item>
    </dl></Section>

    {!life && <Section title="Carreras relacionadas">{data.careers.length === 0 ? <p className="text-sm text-ink-muted">Sin carreras relacionadas.</p> :
      groupCareers(data.careers).map(([division, careers]) => <div key={division}><h3 className="font-semibold">{division}</h3>
        <p className="mt-1 text-sm text-ink-muted">{careers.join(', ')}</p></div>)}</Section>}

    {group === 'published' && <Operational detail={data} />}
    {group === 'published' && data.published_activity_id && <WorkshopAudience key={data.published_activity_id} activityId={data.published_activity_id} />}
    {pending && <section className="card space-y-3 p-5" aria-label="Decisión sobre el taller">
      <div><h2 className="text-lg font-bold">Decisión sobre la propuesta</h2><p className="mt-1 text-sm text-ink-muted">Verifica los datos anteriores antes de publicar o descartar.</p></div>
      <div className="flex flex-wrap gap-3">
        <Button loading={busy === 'approve'} disabled={!!busy} onClick={() => void run('approve')}>Aprobar</Button>
        <Button variant="danger" disabled={!!busy} onClick={() => setConfirmDiscard(true)}>Descartar</Button>
      </div>
    </section>}
    {confirmDelete && <PhraseConfirmModal title="Eliminar taller" phrase="ELIMINAR" confirmLabel="Eliminar definitivamente" danger
      onClose={() => setConfirmDelete(false)}
      onConfirm={async () => {
        await workshopAdminApi.remove(id);
        navigate('/coordinacion/talleres', { replace: true, state: { notice: `Taller «${data.title}» eliminado.` } });
      }}>
      <WorkshopDeleteSummary title={data.title} published={group === 'published'}
        dependents={data.dependents ?? { sessions: data.sessions?.length ?? 0, reservations: 0, attendances: 0, participants: 0 }} />
    </PhraseConfirmModal>}
    {confirmDiscard && <Modal title="Descartar taller" onClose={() => { if (!busyRef.current) setConfirmDiscard(false); }}>
      <p className="mb-5 text-sm text-ink-muted">El taller se conservará en Descartados y no estará disponible para alumnos.</p>
      <div className="flex justify-end gap-3"><Button variant="secondary" disabled={!!busy} onClick={() => setConfirmDiscard(false)}>Cancelar</Button>
        <Button variant="danger" loading={busy === 'discard'} disabled={!!busy} onClick={() => void run('discard')}>Confirmar descarte</Button></div>
    </Modal>}
  </div>;
}
