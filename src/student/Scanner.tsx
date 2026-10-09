import { Camera, CircleAlert, Info, Keyboard, Loader2, MapPin, RotateCcw, ScanQrCode, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import QRScanner from 'qr-scanner';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses } from '../components/ui';
import { fetchProgress, formatTime, type Progress } from '../lib/catalog';
import { checkIn, type CheckInResult } from '../lib/checkin';
import { friendlyError } from '../lib/errors';
import { announceParticipantChange } from '../lib/participantSync';
import { fetchBoard } from '../lib/reservations';
import { buildJourney, focusStop, type Stop } from '../lib/studentJourney';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { NAV } from './copy';
import { progressNextMessage } from './progressText';
import { GuideAvatar } from './ui/Guide';
import { PageHeader } from './ui/PageHeader';

type Phase = 'scanning' | 'validating' | 'success' | 'error' | 'manual';

/**
 * Escanear: ONE sentence of instruction, the camera opens by itself and the manual code is right under it.
 * A new check-in is a reward moment (stamp, guide, totals, rank, what is next); a repeated one says so plainly and
 * never claims new stamps. The check-in logic itself is unchanged.
 */
export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QRScanner | null>(null);
  const decodedRef = useRef(false);
  const { theme, term, rankName } = usePublicTheme();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [next, setNext] = useState<Stop | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState(false);
  // Bumped to request a fresh camera session. The <video> only exists on the scanning screen, so the camera must be
  // (re)started by an effect AFTER React has rendered it — never synchronously from an event handler.
  const [cameraRun, setCameraRun] = useState(0);

  const startCamera = async () => {
    setPhase('scanning');
    setErrorMsg('');
    setCameraError(false);
    if (!videoRef.current) return;
    decodedRef.current = false;
    try {
      scannerRef.current?.destroy();
      const scanner = new QRScanner(
        videoRef.current,
        (decoded) => {
          if (decodedRef.current) return;
          decodedRef.current = true;
          scanner.stop();
          void validate(decoded.data);
        },
        { preferredCamera: 'environment', highlightScanRegion: false, highlightCodeOutline: false },
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch {
      setCameraError(true);
      setPhase('manual');
    }
  };

  const validate = async (credential: string) => {
    setPhase('validating');
    try {
      const res = await checkIn(credential);
      // A repeated check-in changes nothing, so only a new attendance is announced to the other tabs.
      if (!res.already_registered) {
        announceParticipantChange('attendance');
        try {
          navigator.vibrate?.(40);
        } catch {
          /* vibration is optional */
        }
      }
      setResult(res);
      setPhase('success');
      // What comes next (best effort: the check-in itself already succeeded).
      void Promise.resolve(fetchProgress()).then((p) => setProgress(p ?? null)).catch(() => undefined);
      void Promise.resolve(fetchBoard())
        .then((board) => setNext(board ? (focusStop(buildJourney(board))?.stop ?? null) : null))
        .catch(() => undefined);
    } catch (cause) {
      setErrorMsg(friendlyError(cause));
      setPhase('error');
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    void validate(code);
  };

  const reset = () => {
    setResult(null);
    setProgress(null);
    setNext(null);
    setErrorMsg('');
    setManualCode('');
    setPhase('scanning');
    setCameraRun((n) => n + 1);
  };

  // Runs on mount and every time a new camera session is requested. The cleanup destroys the previous scanner first
  // (also on unmount), so there is never more than one QRScanner alive.
  useEffect(() => {
    void startCamera();
    return () => {
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraRun]);

  useEffect(() => {
    if (phase !== 'scanning') scannerRef.current?.stop();
  }, [phase]);

  if (phase === 'success' && result) {
    const repeated = result.already_registered;
    const fraction = progress?.next ? Math.min(result.stamps / Math.max(progress.next.required_attendances, 1), 1) : progress ? 1 : null;
    const remainingStamps = progress?.next ? Math.max(progress.next.required_attendances - result.stamps, 0) : 0;
    const stampWord = term('stamp', result.credits_granted !== 1).toLowerCase();
    return (
      <div className="space-y-4">
        <section className={`space-card relative animate-fade-up overflow-hidden text-center ${repeated ? '' : 'border-success-500/40'}`}>
          <div className={`relative px-6 pb-5 pt-7 ${repeated ? '' : 'bg-gradient-to-b from-primary-500/20 via-primary-500/5 to-transparent'}`}>
            {repeated ? (
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-secondary-500/15 text-fg-info" aria-hidden>
                <Info className="h-8 w-8" />
              </span>
            ) : (
              <div className="relative mx-auto h-36 w-36" aria-hidden>
                <span className="anim-burst absolute -inset-6 rounded-full bg-[conic-gradient(from_0deg,transparent_0_8%,rgb(var(--c-primary-400)/0.5)_8%_11%,transparent_11%_25%,rgb(var(--c-secondary-400)/0.45)_25%_28%,transparent_28%_42%,rgb(var(--c-primary-400)/0.5)_42%_45%,transparent_45%_58%,rgb(var(--c-accent-500)/0.45)_58%_61%,transparent_61%_75%,rgb(var(--c-primary-400)/0.5)_75%_78%,transparent_78%_92%,rgb(var(--c-secondary-400)/0.45)_92%_95%,transparent_95%)]" />
                <div className="anim-stamp relative flex h-36 w-36 flex-col items-center justify-center rounded-full border-4 border-dashed border-primary-400 bg-primary-500/15 text-fg-brand shadow-[0_0_40px_-6px_rgb(var(--c-primary-500)/0.8)]">
                  <span className="font-display text-4xl font-extrabold leading-none">+{result.credits_granted}</span>
                  <span className="mt-1 max-w-[7rem] text-center text-[10px] font-bold uppercase leading-tight tracking-wide">{stampWord}</span>
                </div>
              </div>
            )}
            <h1 className="mt-4 text-2xl font-extrabold">{repeated ? 'Asistencia ya registrada' : 'Misión completada'}</h1>
            <p className="mt-1 text-lg font-semibold leading-snug">{result.title}</p>
            <p className="text-sm text-ink-muted">
              {formatTime(result.starts_at)} — {formatTime(result.ends_at)}
            </p>
            {repeated ? (
              <p className="mx-auto mt-3 max-w-xs text-sm text-ink-muted">
                Esta asistencia ya estaba registrada. Tus {term('stamp', true).toLowerCase()} no cambiaron.
              </p>
            ) : (
              <div className="mx-auto mt-4 flex max-w-xs items-center gap-3 rounded-2xl border border-line bg-surface-raised/80 p-3 text-left">
                <GuideAvatar size={44} />
                <p className="text-sm">
                  <strong className="block text-ink">¡Excelente trabajo!</strong>
                  <span className="text-ink-muted">Ya sumaste {result.credits_granted} {stampWord} a tu bitácora.</span>
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 px-5 pb-4 text-sm">
            <div className="rounded-theme border border-line bg-surface/70 p-3">
              <p className="font-display text-2xl font-extrabold">{result.stamps}</p>
              <p className="text-xs text-ink-muted">{term('stamp', true)} totales</p>
            </div>
            <div className="rounded-theme border border-line bg-surface/70 p-3">
              <p className="font-display text-2xl font-extrabold">{result.attended_workshops}</p>
              <p className="text-xs text-ink-muted">{result.attended_workshops === 1 ? 'Misión completada' : 'Misiones completadas'}</p>
            </div>
          </div>

          <div className="mx-5 mb-5 rounded-theme border border-primary-400/40 bg-primary-500/10 p-3 text-left">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">{term('rank')} actual</p>
            <p className="font-extrabold text-fg-brand">
              {result.level} · {rankName(result.level)}
            </p>
            {fraction != null && (
              <>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Avance hacia el siguiente nivel">
                  <div className="anim-bar h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-300" style={{ width: `${fraction * 100}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {progress?.next
                    ? progressNextMessage(theme, progress.next, remainingStamps, term, rankName)
                    : 'Llegaste al nivel máximo.'}
                </p>
              </>
            )}
          </div>

          {next && (
            <div className="mx-5 mb-5 rounded-theme border border-line bg-surface-raised p-3 text-left text-sm">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-fg-brand">{focusLabel(next)}</p>
              <p className="mt-0.5 font-bold leading-snug">{next.session.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-ink-muted">
                <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {formatTime(next.session.starts_at)}
                {next.session.location && (
                  <>
                    <MapPin className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{next.session.location}</span>
                  </>
                )}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            <Link to="/ruta" className={buttonClasses('primary', 'w-full px-3 whitespace-nowrap')}>
              Ver mi ruta
            </Link>
            <Button variant="secondary" onClick={reset} className="w-full px-3 whitespace-nowrap">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Escanear otro
            </Button>
          </div>
        </section>
      </div>
    );
  }

  // Without a camera, the code is the way in: it moves above the (closed) camera so it is the first thing in reach.
  const manualEntry = (
    <section className="space-card p-4" aria-label="Código manual">
        <div className="mb-1 flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-fg-brand" aria-hidden />
          <h2 className="text-sm font-extrabold">¿No funciona la cámara?</h2>
        </div>
        <p className="mb-3 text-xs text-ink-muted">Pide al facilitador el código de 6 letras y escríbelo aquí.</p>
        <form onSubmit={submitManual} className="flex gap-2">
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            maxLength={6}
            aria-label="Código de 6 letras"
            className="min-w-0 flex-1 rounded-theme border border-line bg-surface px-4 py-3 text-center font-display text-xl font-extrabold uppercase tracking-[0.2em] placeholder:text-ink-muted/40 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            disabled={phase === 'validating'}
          />
          <Button type="submit" loading={phase === 'validating'}>
            Validar
          </Button>
        </form>
      </section>
  );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Registra tu asistencia" title={NAV.scan} subtitle="Al terminar tu misión, escanea el QR que te muestra el facilitador." />

      {phase === 'error' && (
        <div role="alert" className="flex items-start gap-3 rounded-theme border border-error-500/50 bg-error-500/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-fg-error" aria-hidden />
          <div className="min-w-0">
            <p className="font-extrabold">No pudimos registrar tu asistencia</p>
            <p className="mt-0.5 text-ink-muted">{errorMsg || 'No se pudo validar la asistencia.'}</p>
          </div>
        </div>
      )}
      {cameraError && <Alert tone="warning">No pudimos abrir la cámara. Escribe el código de 6 letras del facilitador.</Alert>}
      {cameraError && manualEntry}

      <div className={`relative mx-auto w-full overflow-hidden ${cameraError ? 'aspect-[4/3] max-w-xs' : 'aspect-square max-w-sm'} rounded-3xl border border-line bg-black shadow-[0_20px_50px_-25px_rgb(var(--c-primary-500)/0.7)]`}>
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Cámara para escanear el QR de la misión" />
        {/* framing corners + sweeping line: purely visual guidance */}
        <div className="pointer-events-none absolute inset-[16%]" aria-hidden>
          <span className="scan-frame-corner left-0 top-0 rounded-tl-2xl border-l-4 border-t-4" />
          <span className="scan-frame-corner right-0 top-0 rounded-tr-2xl border-r-4 border-t-4" />
          <span className="scan-frame-corner bottom-0 left-0 rounded-bl-2xl border-b-4 border-l-4" />
          <span className="scan-frame-corner bottom-0 right-0 rounded-br-2xl border-b-4 border-r-4" />
          {phase === 'scanning' && (
            <span className="anim-scan absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary-400 shadow-[0_0_14px_3px_rgb(var(--c-primary-400)/0.8)] [--sweep:15rem]" />
          )}
        </div>
        {phase === 'validating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 text-white">
            <Loader2 className="h-9 w-9 animate-spin" aria-hidden />
            <p className="text-sm font-semibold">Validando asistencia…</p>
          </div>
        )}
        {(phase === 'manual' || phase === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center text-white">
            <Camera className="h-10 w-10 opacity-80" aria-hidden />
            <Button variant="secondary" onClick={() => void startCamera()}>
              Abrir cámara
            </Button>
          </div>
        )}
        {phase === 'scanning' && (
          <p className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-white/90">
            <ScanQrCode className="h-4 w-4" aria-hidden />
            Apunta al QR de la misión
          </p>
        )}
      </div>

      {!cameraError && manualEntry}
    </div>
  );
}

function focusLabel(stop: Stop) {
  return stop.reservation.derived_status === 'in_progress' ? 'Ahora' : 'Tu siguiente misión';
}
