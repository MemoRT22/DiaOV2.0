import { Award, Camera, CheckCircle2, Keyboard, Loader2, MapPin, RotateCcw, Sparkles } from 'lucide-react';
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
import { progressNextMessage } from './progressText';

type Phase = 'scanning' | 'validating' | 'success' | 'error' | 'manual';

/**
 * Escanear: the camera opens by itself and the manual code is right under it — no instructions before the action.
 * A new check-in celebrates (stamp, totals, rank, what is next); a repeated one says so and never claims new stamps.
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
    return (
      <div className="space-y-5">
        <div className="card animate-fade-up overflow-hidden text-center">
          <div className={`px-6 pb-5 pt-6 ${repeated ? '' : 'bg-gradient-to-b from-primary-500/15 to-transparent'}`}>
            <CheckCircle2 className={`mx-auto h-14 w-14 ${repeated ? 'text-fg-info' : 'anim-pop text-fg-success'}`} aria-hidden />
            <h1 className="mt-3 text-2xl font-extrabold">{repeated ? 'Asistencia ya registrada' : 'Misión completada'}</h1>
            <p className="mt-2 text-lg font-semibold leading-snug">{result.title}</p>
            <p className="text-sm text-ink-muted">
              {formatTime(result.starts_at)} — {formatTime(result.ends_at)}
            </p>

            {repeated ? (
              <p className="mx-auto mt-4 max-w-xs text-sm text-ink-muted">
                Esta asistencia ya estaba registrada. Tus {term('stamp', true).toLowerCase()} no cambiaron.
              </p>
            ) : (
              <div className="anim-stamp mx-auto mt-4 flex h-32 w-32 flex-col items-center justify-center rounded-full border-4 border-dashed border-primary-500 bg-primary-500/10 text-fg-brand">
                <Sparkles className="h-5 w-5" aria-hidden />
                <span className="font-display text-3xl font-extrabold leading-none">+{result.credits_granted}</span>
                <span className="max-w-[6.5rem] text-center text-[10px] font-bold uppercase leading-tight tracking-wide">{term('stamp', result.credits_granted !== 1).toLowerCase()}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 px-5 pb-4 text-sm">
            <div className="rounded-theme border border-line p-3">
              <p className="font-display text-2xl font-extrabold">{result.stamps}</p>
              <p className="text-xs text-ink-muted">{term('stamp', true)} totales</p>
            </div>
            <div className="rounded-theme border border-line p-3">
              <p className="font-display text-2xl font-extrabold">{result.attended_workshops}</p>
              <p className="text-xs text-ink-muted">Talleres asistidos</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            <Link to="/ruta" className={buttonClasses('primary', 'w-full px-3 whitespace-nowrap')}>
              Ver mi ruta
            </Link>
            <Button variant="secondary" onClick={reset} className="w-full px-3 whitespace-nowrap">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Escanear otro
            </Button>
          </div>

          <div className="mx-5 mb-5 rounded-theme border border-primary-400/40 bg-primary-500/10 p-3 text-left">
            <div className="flex items-center gap-3">
              <Award className="h-6 w-6 shrink-0 text-fg-brand" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-widest text-ink-muted">{term('rank')} actual</p>
                <p className="font-extrabold text-fg-brand">
                  {result.level} · {rankName(result.level)}
                </p>
              </div>
            </div>
            {fraction != null && (
              <>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Avance hacia el siguiente nivel">
                  <div className="anim-bar h-full rounded-full bg-primary-500" style={{ width: `${fraction * 100}%` }} />
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
              <p className="text-xs font-extrabold uppercase tracking-widest text-fg-brand">{focusLabel(next)}</p>
              <p className="mt-0.5 font-semibold leading-snug">{next.session.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-ink-muted">
                {formatTime(next.session.starts_at)}
                {next.session.location && (
                  <>
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{next.session.location}</span>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Escanear asistencia</h1>

      {phase === 'error' && <Alert tone="error">{errorMsg || 'No se pudo validar la asistencia.'}</Alert>}
      {cameraError && <Alert tone="warning">No pudimos abrir la cámara. Escribe el código de 6 letras del facilitador.</Alert>}

      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Cámara para escanear el QR del taller" />
        {/* framing corners: purely visual guidance */}
        <div className="pointer-events-none absolute inset-[18%]" aria-hidden>
          <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-white" />
          <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-white" />
          <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-white" />
          <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-white" />
        </div>
        {phase === 'validating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
            <Loader2 className="h-9 w-9 animate-spin" aria-hidden />
            <p className="text-sm">Validando asistencia…</p>
          </div>
        )}
        {(phase === 'manual' || phase === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center text-white">
            <Camera className="h-10 w-10 opacity-80" aria-hidden />
            <Button variant="secondary" onClick={() => void startCamera()}>
              Abrir cámara
            </Button>
          </div>
        )}
        {phase === 'scanning' && <p className="absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-white/90">Apunta al QR del taller</p>}
      </div>

      <section className="card p-4" aria-label="Código manual">
        <div className="mb-2 flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-ink-muted" aria-hidden />
          <h2 className="text-sm font-semibold">Código manual</h2>
        </div>
        <p className="mb-3 text-xs text-ink-muted">Si la cámara no funciona, pide el código de 6 letras al facilitador e introdúcelo aquí.</p>
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
            className="min-w-0 flex-1 rounded-theme border border-line bg-surface px-4 py-3 text-center font-display text-lg font-bold uppercase tracking-widest focus:border-primary-400 focus:outline-none"
            disabled={phase === 'validating'}
          />
          <Button type="submit" loading={phase === 'validating'}>
            Validar
          </Button>
        </form>
      </section>
    </div>
  );
}

function focusLabel(stop: Stop) {
  return stop.reservation.derived_status === 'in_progress' ? 'Ahora' : 'Sigue';
}
