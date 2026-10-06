import { ArrowLeft, Clock, Keyboard, Maximize2, Minimize2, Printer, QrCode, RefreshCw, Users } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, LoadError, PageSkeleton, Spinner } from '../components/ui';
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

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Check-in por taller</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Cada taller tiene un único QR y código de respaldo válidos para todos sus horarios. Abre un taller para ver e imprimir su credencial.
        </p>
      </header>

      <div className="space-y-2">
        {data.length === 0 && <p className="text-sm text-ink-muted">No hay talleres en la edición activa.</p>}
        {data.map((a) => (
          <button
            key={a.activity_id}
            onClick={() => openCredential(a)}
            className="card flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-surface-raised"
          >
            <div className="flex-1">
              <p className="font-semibold">{a.title}</p>
              <p className="text-xs text-ink-muted">
                {a.sessions.length} {a.sessions.length === 1 ? 'horario' : 'horarios'} · {a.location}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <p className="font-display font-extrabold">{a.total_reserved}</p>
                <p className="text-xs text-ink-muted">Reservados</p>
              </div>
              <div className="text-center">
                <p className="font-display font-extrabold text-success">{a.total_attended}</p>
                <p className="text-xs text-ink-muted">Asistencias</p>
              </div>
              <QrCode className="h-5 w-5 text-fg-brand" aria-hidden />
            </div>
          </button>
        ))}
      </div>
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

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface-sunken p-4' : 'max-w-2xl space-y-6'}>
      {fullscreen ? (
        <button onClick={onToggleFullscreen} className="absolute right-4 top-4 rounded-full p-2 text-ink-muted hover:bg-surface-raised">
          <Minimize2 className="h-5 w-5" aria-hidden />
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <h1 className="text-xl font-extrabold">{activity.title}</h1>
        </div>
      )}

      {status && !fullscreen && <Alert tone={status.tone}>{status.msg}</Alert>}

      <div className={`card print-area text-center ${fullscreen ? 'max-w-md' : ''}`}>
        <p className="text-sm font-semibold">{activity.title}</p>
        <p className="text-xs text-ink-muted">QR único del taller · válido para todos los horarios</p>

        {qrUrl && (
          <img src={qrUrl} alt="QR de check-in" className="mx-auto mt-4 h-64 w-64 rounded-theme border border-line bg-white p-2" />
        )}

        <div className="mt-4 flex items-center justify-center gap-2 rounded-theme border-2 border-line bg-surface-sunken px-6 py-3">
          <Keyboard className="h-5 w-5 text-ink-muted" aria-hidden />
          <span className="font-display text-3xl font-extrabold tracking-widest">{cred.manual_code}</span>
        </div>

        <div className="mt-4 flex items-center justify-center gap-6 text-sm">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4 text-ink-muted" aria-hidden />
            {activity.total_reserved} reservados
          </span>
          <span className="flex items-center gap-1 text-success">
            <span className="font-display font-extrabold">{activity.total_attended}</span>
            asistencias
          </span>
        </div>
      </div>

      {!fullscreen && cred.sessions.length > 0 && (
        <div className="card space-y-2 p-4">
          <p className="text-sm font-semibold">Horarios</p>
          <div className="space-y-1">
            {cred.sessions.map((s) => (
              <SessionRow key={s.session_id} session={s} />
            ))}
          </div>
        </div>
      )}

      {!fullscreen && (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onToggleFullscreen}>
            <Maximize2 className="h-4 w-4" aria-hidden />
            Pantalla completa
          </Button>
          <Button variant="secondary" onClick={onPrint}>
            <Printer className="h-4 w-4" aria-hidden />
            Imprimir
          </Button>
          {isCoord && (
            <Button variant="secondary" onClick={() => setShowRegen((s) => !s)}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Regenerar credencial
            </Button>
          )}
        </div>
      )}

      {showRegen && isCoord && !fullscreen && (
        <div className="card space-y-3 p-4">
          <p className="text-sm font-semibold">Regenerar credencial</p>
          <p className="text-xs text-ink-muted">
            La credencial actual dejará de funcionar inmediatamente. Las asistencias ya registradas no cambian.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (ej. se filtró el QR)"
            className="w-full rounded-theme border border-line bg-surface px-4 py-2 text-sm focus:border-primary-400 focus:outline-none"
          />
          <Button
            variant="primary"
            loading={busy}
            disabled={reason.trim().length < 5}
            onClick={() => { onRegenerate(reason.trim()); setShowRegen(false); setReason(''); }}
          >
            Confirmar regeneración
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: CheckinSession }) {
  const fullness = session.capacity > 0 ? Math.round((session.reserved / session.capacity) * 100) : 0;
  return (
    <div className="flex items-center gap-3 rounded-theme px-3 py-2 text-sm hover:bg-surface-sunken">
      <Clock className="h-4 w-4 text-ink-muted" aria-hidden />
      <span className="tabular-nums">{formatTime(session.starts_at)} — {formatTime(session.ends_at)}</span>
      <span className="text-ink-muted">
        {session.reserved}/{session.capacity}
      </span>
      <span className="text-success">{session.attended} check-ins</span>
      <Badge tone={session.status === 'activa' ? 'success' : session.status === 'cancelada' ? 'error' : 'warning'}>
        {session.status === 'activa' ? 'Publicada' : session.status === 'cancelada' ? 'Cancelada' : 'Oculta'}
      </Badge>
      <div className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-primary-400" style={{ width: `${fullness}%` }} />
      </div>
    </div>
  );
}
