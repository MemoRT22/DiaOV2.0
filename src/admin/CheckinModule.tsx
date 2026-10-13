import { ArrowLeft, Clock, Download, Maximize2, Minimize2, Printer, QrCode, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, Field, LoadError, Modal, PageSkeleton, Spinner } from '../components/ui';
import { formatTime } from '../lib/catalog';
import {
  fetchCheckinOverview,
  fetchActivityCredentialDisplay,
  regenerateActivityCredential,
  resolveSessionToActivity,
  type CheckinActivity,
  type CheckinSession,
  type ActivityCredentialDisplay,
} from '../lib/checkin';
// regenerateActivityCredential returns a partial result; we re-fetch full display after it.
import { friendlyError } from '../lib/errors';
import { hasRole, useAuth } from '../lib/auth';
import { useLoad } from '../lib/useLoad';
import { DataPanel, EmptyState, PageHeader, SearchField, SectionHeading } from './design/Primitives';

export default function CheckinModule() {
  const { staff } = useAuth();
  const isCoord = hasRole(staff, 'coordinacion');
  const { data, error, loading, reload } = useLoad(() => fetchCheckinOverview(), []);
  const [selected, setSelected] = useState<CheckinActivity | null>(null);
  const [cred, setCred] = useState<ActivityCredentialDisplay | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [showCred, setShowCred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchParams] = useSearchParams();
  const autoOpenRef = useRef(false);

  useEffect(() => {
    if (autoOpenRef.current || !data || data.length === 0) return;
    const sessionId = searchParams.get('session');
    const activityId = searchParams.get('activity');
    if (!sessionId && !activityId) return;
    autoOpenRef.current = true;
    if (activityId) {
      const activity = data.find((a) => a.activity_id === activityId);
      if (activity) void openCredential(activity);
    } else if (sessionId) {
      void resolveAndOpen(sessionId);
    }
  }, [data, searchParams]);

  const resolveAndOpen = async (sessionId: string) => {
    try {
      const activityId = await resolveSessionToActivity(sessionId);
      if (!activityId) return;
      const activity = data?.find((a) => a.activity_id === activityId);
      if (activity) void openCredential(activity);
    } catch {
      // Session not found or error — silently ignore
    }
  };

  const openCredential = async (activity: CheckinActivity) => {
    setSelected(activity);
    setShowCred(true);
    setStatus(null);
    setBusy(true);
    try {
      const display = await fetchActivityCredentialDisplay(activity.activity_id);
      setCred(display);
      const url = await QRCode.toDataURL(display.qr_token, { width: 400, margin: 1 });
      setQrUrl(url);
      void reload();
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const doRegenerate = async (reason: string) => {
    if (!selected) return;
    setBusy(true);
    setStatus(null);
    try {
      await regenerateActivityCredential(selected.activity_id, reason);
      const display = await fetchActivityCredentialDisplay(selected.activity_id);
      setCred(display);
      const url = await QRCode.toDataURL(display.qr_token, { width: 400, margin: 1 });
      setQrUrl(url);
      setStatus({ tone: 'success', msg: 'Credencial regenerada. La anterior ya no funciona.' });
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  if (showCred && selected) {
    return (
      <CredentialView
        activity={selected}
        cred={cred}
        qrUrl={qrUrl}
        busy={busy}
        status={status}
        isCoord={isCoord}
        onRegenerate={doRegenerate}
        onBack={() => { setShowCred(false); setCred(null); setQrUrl(''); void reload(); }}
        onPrint={() => window.print()}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((f) => !f)}
      />
    );
  }

  const filtered = data.filter((activity) => `${activity.title} ${activity.location}`.toLocaleLowerCase('es-MX').includes(query.trim().toLocaleLowerCase('es-MX')));
  const activeActivity = selected ?? filtered[0] ?? null;

  return (
    <div className="ad-page">
      <PageHeader eyebrow="Operación / Acceso" title="Check-in por taller"
        description="Consulta reservas y asistencias por horario. Abre la credencial cuando necesites proyectar o imprimir el acceso."
        action={isCoord ? <Link to="/coordinacion/checkin/qr-talleres" className="btn btn-secondary inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold"><Download aria-hidden size={16} />Descargar QR de talleres</Link> : undefined} />
      <div className="ad-toolbar">
        <SearchField label="Buscar taller" value={query} onChange={(value) => { setQuery(value); setSelected(null); }} placeholder="Buscar taller o ubicación" />
        <span className="ad-context-help">{filtered.length} {filtered.length === 1 ? 'taller' : 'talleres'}</span>
      </div>
      {data.length === 0 ? <DataPanel><EmptyState title="No hay talleres en la edición activa." description="Los talleres aparecerán aquí cuando se publiquen." /></DataPanel> :
        filtered.length === 0 ? <DataPanel><EmptyState title="No se encontraron talleres." description="Prueba con otro nombre o ubicación." /></DataPanel> :
        <div className="ad-checkin-grid">
          <div className="ad-checkin-list" aria-label="Talleres">
            {filtered.map((activity) => <button type="button" key={activity.activity_id}
              className="ad-checkin-item" aria-pressed={activeActivity?.activity_id === activity.activity_id}
              onClick={() => setSelected(activity)}>
              <span className="ad-row-title">{activity.title}</span>
              <span className="ad-row-meta">{activity.sessions.length} {activity.sessions.length === 1 ? 'horario' : 'horarios'} · {activity.location}</span>
              <span className="ad-checkin-counts">{activity.total_reserved} reservados <span aria-hidden>·</span> {activity.total_attended} asistencias</span>
            </button>)}
          </div>
          {activeActivity && <section className="ad-checkin-detail">
            <SectionHeading title={activeActivity.title} detail={activeActivity.location}
              action={<Button onClick={() => void openCredential(activeActivity)}><QrCode aria-hidden />Mostrar credencial</Button>} />
            <div className="ad-checkin-summary">
              <div><strong>{activeActivity.sessions.length}</strong><span>Horarios</span></div>
              <div><strong>{activeActivity.total_reserved}</strong><span>Reservados</span></div>
              <div><strong>{activeActivity.total_attended}</strong><span>Asistencias</span></div>
            </div>
            <div className="ad-detail-subtitle">Horarios y asistencia</div>
            <DataPanel>
              {activeActivity.sessions.map((session) => <SessionRow key={session.session_id} session={session} />)}
              {activeActivity.sessions.length === 0 && <EmptyState title="Sin horarios publicados." />}
            </DataPanel>
            <p className="ad-context-help">La credencial del taller sirve para todos sus horarios. Puedes proyectarla, imprimirla o regenerarla desde la vista de presentación.</p>
          </section>}
        </div>}
    </div>
  );
}

type CredentialViewProps = {
  activity: CheckinActivity;
  cred: ActivityCredentialDisplay | null;
  qrUrl: string;
  busy: boolean;
  status: { tone: 'success' | 'error'; msg: string } | null;
  isCoord: boolean;
  onRegenerate: (reason: string) => void;
  onBack: () => void;
  onPrint: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

function CredentialView(props: CredentialViewProps) {
  const { activity, cred, qrUrl, busy, status, isCoord, onRegenerate, onBack, onPrint, fullscreen, onToggleFullscreen } = props;
  const [showRegen, setShowRegen] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!fullscreen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggleFullscreen(); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [fullscreen, onToggleFullscreen]);

  if (busy && !cred) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!cred) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert tone="error">No se pudo cargar la credencial.</Alert>
        <Button variant="secondary" onClick={onBack}>Volver</Button>
      </div>
    );
  }

  return <div className={fullscreen ? 'ad-presentation-fullscreen' : 'ad-page ad-presentation-page'}
    role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? 'Credencial en pantalla completa' : undefined}>
    {fullscreen ? <button type="button" className="ad-fullscreen-close" onClick={onToggleFullscreen} aria-label="Salir de pantalla completa"><Minimize2 aria-hidden />Salir de pantalla completa</button> : <>
      <button type="button" className="ad-back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden />Volver a talleres</button>
      <PageHeader eyebrow="Check-in / Presentación" title="Credencial de acceso" description={activity.title}
        action={<Button onClick={onPrint}><Printer aria-hidden />Imprimir</Button>} />
      <div className="ad-presentation-tools">
        <Button variant="secondary" onClick={onToggleFullscreen}><Maximize2 aria-hidden />Pantalla completa</Button>
        {isCoord && <Button variant="secondary" onClick={() => setShowRegen(true)}><RefreshCw aria-hidden />Regenerar credencial</Button>}
      </div>
      {status && <Alert tone={status.tone}>{status.msg}</Alert>}
    </>}

    <div className="ad-credential print-area">
      <div className="ad-credential-brand">DÍA OV <span>·</span> CHECK-IN</div>
      <h2>{activity.title}</h2>
      <p>Escanea este código para registrar tu asistencia.</p>
      {qrUrl && <img src={qrUrl} alt="QR de check-in" />}
      <div className="ad-manual-code"><span>Código manual</span><strong>{cred.manual_code}</strong></div>
      <p className="ad-credential-footnote">Un acceso para todos los horarios de este taller</p>
    </div>

    {showRegen && isCoord && !fullscreen && <Modal title="Regenerar credencial" onClose={() => setShowRegen(false)}>
      <div className="ad-page">
        <Alert tone="warning">La credencial actual dejará de funcionar inmediatamente. Las asistencias ya registradas no cambian.</Alert>
        <Field label="Motivo de la regeneración" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej. se filtró el QR" required minLength={5} />
        <div className="ad-modal-actions"><Button variant="ghost" onClick={() => setShowRegen(false)}>Cancelar</Button>
          <Button loading={busy} disabled={reason.trim().length < 5} onClick={() => { onRegenerate(reason.trim()); setShowRegen(false); setReason(''); }}>Confirmar regeneración</Button></div>
      </div>
    </Modal>}
  </div>;
}

function SessionRow({ session }: { session: CheckinSession }) {
  return (
    <div className="ad-session-row">
      <div className="ad-row-main"><p className="ad-row-title"><Clock size={15} aria-hidden />{formatTime(session.starts_at)} – {formatTime(session.ends_at)}</p>
        <p className="ad-row-meta">{session.reserved} de {session.capacity} reservados · {session.attended} asistencias</p></div>
      <Badge tone={session.status === 'activa' ? 'success' : session.status === 'cancelada' ? 'error' : 'neutral'}>
        {session.status === 'activa' ? 'Publicada' : session.status === 'cancelada' ? 'Cancelada' : 'Oculta'}
      </Badge>
    </div>
  );
}
