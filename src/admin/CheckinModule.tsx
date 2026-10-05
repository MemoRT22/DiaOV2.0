import { ArrowLeft, Keyboard, Maximize2, Minimize2, Printer, QrCode, RefreshCw, Users } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, LoadError, PageSkeleton, Spinner } from '../components/ui';
import { formatTime } from '../lib/catalog';
import {
  fetchCheckinOverview,
  fetchCredentialDisplay,
  regenerateCredential,
  type CheckinSession,
  type CredentialDisplay,
} from '../lib/checkin';
import { friendlyError } from '../lib/errors';
import { hasRole, useAuth } from '../lib/auth';
import { useLoad } from '../lib/useLoad';

export default function CheckinModule() {
  const { staff } = useAuth();
  const isCoord = hasRole(staff, 'coordinacion');
  const { data, error, loading, reload } = useLoad(() => fetchCheckinOverview(), []);
  const [selected, setSelected] = useState<CheckinSession | null>(null);
  const [cred, setCred] = useState<CredentialDisplay | null>(null);
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
    if (!sessionId) return;
    const session = data.find((s) => s.session_id === sessionId);
    if (!session) return;
    autoOpenRef.current = true;
    void openCredential(session);
  }, [data, searchParams]);

  const openCredential = async (session: CheckinSession) => {
    setSelected(session);
    setShowCred(true);
    setStatus(null);
    setBusy(true);
    try {
      const display = await fetchCredentialDisplay(session.session_id);
      setCred(display);
      const url = await QRCode.toDataURL(display.qr_token, { width: 400, margin: 1 });
      setQrUrl(url);
      await reload();
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
      const display = await regenerateCredential(selected.session_id, reason);
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
        session={selected}
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
        <h1 className="text-2xl font-extrabold">Check-in</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sesiones de la edición activa. Abre el QR al final del taller para que los aspirantes registren su asistencia.
        </p>
      </header>

      <div className="space-y-2">
        {data.length === 0 && <p className="text-sm text-ink-muted">No hay sesiones en la edición activa.</p>}
        {data.map((s) => (
          <button
            key={s.session_id}
            onClick={() => openCredential(s)}
            className="card flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-surface-raised"
          >
            <div className="flex-1">
              <p className="font-semibold">{s.title}</p>
              <p className="text-xs text-ink-muted">
                {formatTime(s.starts_at)} — {formatTime(s.ends_at)} · {s.location}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <p className="font-display font-extrabold">{s.reserved}</p>
                <p className="text-xs text-ink-muted">Reservados</p>
              </div>
              <div className="text-center">
                <p className="font-display font-extrabold text-success">{s.attended}</p>
                <p className="text-xs text-ink-muted">Asistencias</p>
              </div>
              <Badge tone={s.status === 'activa' ? 'success' : s.status === 'cancelada' ? 'error' : 'warning'}>
                {s.status === 'activa' ? 'Publicada' : s.status === 'cancelada' ? 'Cancelada' : 'Oculta'}
              </Badge>
              <QrCode className="h-5 w-5 text-primary-400" aria-hidden />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

type CredentialViewProps = {
  session: CheckinSession;
  cred: CredentialDisplay | null;
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
  const { session, cred, qrUrl, busy, status, isCoord, onRegenerate, onBack, onPrint, fullscreen, onToggleFullscreen } = props;
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
          <h1 className="text-xl font-extrabold">{session.title}</h1>
        </div>
      )}

      {status && !fullscreen && <Alert tone={status.tone}>{status.msg}</Alert>}

      <div className={`card print-area text-center ${fullscreen ? 'max-w-md' : ''}`}>
        <p className="text-sm font-semibold">{session.title}</p>
        <p className="text-xs text-ink-muted">
          {formatTime(cred.starts_at)} — {formatTime(cred.ends_at)} · {cred.location}
        </p>
        <p className="mt-1 text-xs text-ink-muted">Válido solo al final de la sesión</p>

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
            {session.reserved} reservados
          </span>
          <span className="flex items-center gap-1 text-success">
            <span className="font-display font-extrabold">{session.attended}</span>
            asistencias
          </span>
        </div>
      </div>

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
