import { ArrowLeft, Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Modal, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import {
  CATEGORY_LABELS, GROUP_LABELS, TYPE_LABELS, groupForStatus, workshopAdminApi,
  type WorkshopCareer, type WorkshopDetail as Detail,
} from '../../lib/workshopAdminApi';

const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const fallback = (value: string | null | undefined) => value?.trim() || 'No especificado';
const groupCareers = (careers: WorkshopCareer[]) => {
  const groups = new Map<string, string[]>();
  for (const career of careers) groups.set(career.division_name, [...(groups.get(career.division_name) ?? []), career.career_name]);
  return [...groups];
};
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card space-y-4 p-5"><h2 className="text-lg font-bold">{title}</h2>{children}</section>;
}
function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{children}</dd></div>;
}
function Operational({ detail }: { detail: Detail }) {
  return <Section title="Operación del taller">
    <p className="text-sm text-ink-muted">Horarios y cupos de la actividad vinculada a este taller.</p>
    {detail.sessions?.length ? <div className="space-y-3">{detail.sessions.map((session) => <div key={session.id} className="rounded-theme border border-line p-4">
      <p className="font-semibold">{formatDate(session.starts_at)} – {new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date(session.ends_at))}</p>
      <p className="mt-1 text-sm text-ink-muted">Cupo {session.capacity} · Reservados {session.reserved} · {fallback(session.location)} · {session.status}</p>
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
    <header className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3"><h1 className="text-2xl font-extrabold">{data.title}</h1><Badge tone={group === 'published' ? 'success' : group === 'archived' ? 'neutral' : 'warning'}>{GROUP_LABELS[group]}</Badge></div>
      <p className="text-sm text-ink-muted">Recibido el {formatDate(data.submitted_at)}</p>
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
    {pending && <div className="card flex flex-wrap gap-3 p-5" aria-label="Acciones del taller">
      <Link to={`/coordinacion/talleres/${id}/editar`} className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold hover:border-secondary-400">Editar</Link>
      <Button loading={busy === 'approve'} disabled={!!busy} onClick={() => void run('approve')}>Aprobar</Button>
      <Button variant="danger" disabled={!!busy} onClick={() => setConfirmDiscard(true)}>Descartar</Button>
    </div>}
    {confirmDiscard && <Modal title="Descartar taller" onClose={() => { if (!busyRef.current) setConfirmDiscard(false); }}>
      <p className="mb-5 text-sm text-ink-muted">El taller se conservará en Descartados y no estará disponible para alumnos.</p>
      <div className="flex justify-end gap-3"><Button variant="secondary" disabled={!!busy} onClick={() => setConfirmDiscard(false)}>Cancelar</Button>
        <Button variant="danger" loading={busy === 'discard'} disabled={!!busy} onClick={() => void run('discard')}>Confirmar descarte</Button></div>
    </Modal>}
  </div>;
}
