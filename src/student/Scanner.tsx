import { Camera, CircleAlert, Info, Keyboard, Loader2, MapPin, RotateCcw, ScanQrCode, Ticket, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import QRScanner from 'qr-scanner';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses } from '../components/ui';
import { fetchProgress, formatTime, type Progress } from '../lib/catalog';
import { checkIn, type CheckInResult } from '../lib/checkin';
import { isTemporaryAccessError, retryAfterOf } from '../lib/accessErrors';
import { friendlyError } from '../lib/errors';
import { announceParticipantChange } from '../lib/participantSync';
import { fetchMyRaffleStatus } from '../lib/raffleApi';
import { nextTierHint, type MyRaffleStatus } from '../lib/raffleRules';
import { fetchBoard } from '../lib/reservations';
import { buildJourney, focusStop, type Stop } from '../lib/studentJourney';
import { useRafflePrizes } from './RafflePrizeProvider';
import { useExitSurvey } from './ExitSurveyProvider';
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
  const { refresh: refreshPrizes } = useRafflePrizes();
  const { refresh: refreshSurvey } = useExitSurvey();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [next, setNext] = useState<Stop | null>(null);
  const [raffle, setRaffle] = useState<MyRaffleStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // A scan without a reservation points to Misiones: the student can still enrol if the tolerance allows it.
  const [needsReservation, setNeedsReservation] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState(false);
  // Bumped to request a fresh camera session. The <video> only exists on the scanning screen, so the camera must be
  // (re)started by an effect AFTER React has rendered it — never synchronously from an event handler.
  const [cameraRun, setCameraRun] = useState(0);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const recovery = useRef<string | null>(null); // memory only; discarded on success, a new scan, or leaving
  const [recoverable, setRecoverable] = useState(false);
  const retryAt = useRef(0);
  const [retrySeconds, setRetrySeconds] = useState(0);

  const startCamera = async () => {
    if (!alive.current || inFlight.current || Date.now() < retryAt.current) return;
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
      if (!alive.current) return;
      setCameraError(true);
      setPhase('manual');
    }
  };

  const validate = async (credential: string) => {
    if (inFlight.current || Date.now() < retryAt.current || !alive.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    request.current = controller;
    const wasUncertain = recovery.current !== null;
    setRecoverable(false);
    setNeedsReservation(false);
    setPhase('validating');
    try {
      const res = await checkIn(credential, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      recovery.current = null;
      setResult(res);
      setPhase('success');
      // A repeated check-in changes nothing, so only a new attendance is announced to the other tabs.
      // A recovered lost response may have committed in the first attempt: synchronize those tabs too.
      if (!res.already_registered || wasUncertain) {
        announceParticipantChange('attendance');
        // The providers survive navigation; their delayed refresh is coalesced with any read already in flight.
        void refreshPrizes({ afterAttendance: true });
        void refreshSurvey({ afterAttendance: true });
        try {
          navigator.vibrate?.(40);
        } catch {
          /* vibration is optional */
        }
      }
    } catch (cause) {
      if (!alive.current || controller.signal.aborted) return;
      const temporary = isTemporaryAccessError(cause);
      recovery.current = temporary ? credential : null;
      setRecoverable(temporary);
      retryAt.current = temporary ? Date.now() + (retryAfterOf(cause) ?? (3 + Math.random() * 3)) * 1000 : 0;
      setRetrySeconds(Math.ceil(Math.max(0, retryAt.current - Date.now()) / 1000));
      // Supabase reports RPC errors as plain objects with `message`, not as Error instances.
      setNeedsReservation((cause as { message?: unknown } | null)?.message === 'NO_RESERVATION');
      setErrorMsg(friendlyError(cause));
      setPhase('error');
    } finally {
      inFlight.current = false;
    }
  };

  // Secondary hints never gate success. Each gets a bounded jitter, no retry, and cannot update an obsolete scan/screen.
  useEffect(() => {
    if (phase !== 'success' || !result) return;
    const controller = new AbortController();
    let freshProgress: Progress | null = null;
    const later = <T,>(load: () => Promise<T>, apply: (value: T) => void, min: number, spread: number) => window.setTimeout(() => {
      if (controller.signal.aborted) return;
      void Promise.resolve().then(load).then((value) => { if (!controller.signal.aborted) apply(value); }).catch(() => undefined);
    }, min + Math.random() * spread);
    const timers = [
      later(fetchProgress, (p) => { freshProgress = p ?? null; setProgress(freshProgress); }, 300, 900),
      later(fetchMyRaffleStatus, (s) => setRaffle(s ?? null), 500, 1000),
      // Direct reads of reservations/attendances are intentionally revoked. Keep the authorized RPC, once and deferred.
      // my_progress uses active_reservation_count: zero already proves there is no next/current mission. Reuse that answer.
      later(() => freshProgress?.reserved_workshops === 0 ? Promise.resolve(null) : fetchBoard(),
        (board) => setNext(board ? (focusStop(buildJourney(board))?.stop ?? null) : null), 1000, 2000),
    ];
    return () => { controller.abort(); timers.forEach(window.clearTimeout); };
  }, [phase, result]);

  useEffect(() => {
    if (!recoverable) return;
    const timer = window.setInterval(() => setRetrySeconds(Math.ceil(Math.max(0, retryAt.current - Date.now()) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recoverable]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); recovery.current = null; };
  }, []);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    void validate(code);
  };

  const reset = () => {
    recovery.current = null;
    retryAt.current = 0;
    setRecoverable(false);
    setRetrySeconds(0);
    setResult(null);
    setProgress(null);
    setNext(null);
    setRaffle(null);
    setErrorMsg('');
    setNeedsReservation(false);
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
    const raffleHint = raffle && !raffle.has_won ? nextTierHint(raffle) : null;
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

          {/* Raffle standing after this attendance (server data; best effort — the check-in already succeeded). */}
          {raffle && !raffle.has_won && (raffle.raffle_category_name || raffleHint) && (
            <div className="mx-5 mb-4 flex items-start gap-3 rounded-theme border border-accent-500/40 bg-accent-500/10 p-3 text-left text-sm">
              <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-fg-accent" aria-hidden />
              <p className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">Sorteo</span>
                {raffle.raffle_category_name ? (
                  <strong className="block text-fg-accent">Categoría {raffle.raffle_category_name}</strong>
                ) : (
                  <strong className="block">Aún sin categoría</strong>
                )}
                <span className="block text-xs text-ink-muted">
                  {raffle.academic_stamps} {raffle.academic_stamps === 1 ? 'académico' : 'académicos'} · {raffle.university_life_stamps} de Vida Universitaria
                  {raffleHint ? ` · ${raffleHint.text}` : ''}
                </span>
              </p>
            </div>
          )}

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
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-fg-brand">{next.reservation.derived_status === 'in_progress' ? 'Ahora' : 'Tu siguiente misión'}</p>
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
            disabled={phase === 'validating' || retrySeconds > 0}
          />
          <Button type="submit" loading={phase === 'validating'} disabled={retrySeconds > 0}>
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
            <p className="font-extrabold">{recoverable ? 'No pudimos confirmar tu asistencia' : 'No pudimos registrar tu asistencia'}</p>
            <p className="mt-0.5 text-ink-muted">{errorMsg || 'No se pudo validar la asistencia.'}</p>
            {recoverable && <>
              <p className="mt-2 text-ink-muted">Tu asistencia podría haberse registrado. Conservamos este intento mientras estás aquí: puedes volver a confirmarlo con el mismo QR o código sin recibir sellos adicionales.</p>
              <Button variant="secondary" className="mt-3" disabled={retrySeconds > 0} onClick={() => { if (recovery.current) void validate(recovery.current); }}>
                {retrySeconds > 0 ? `Reintentar en ${retrySeconds} s` : 'Volver a confirmar'}
              </Button>
            </>}
            {needsReservation && (
              <Link to="/misiones" className="mt-2 inline-block font-extrabold text-fg-brand underline underline-offset-2">
                Ver misiones y reservar
              </Link>
            )}
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
            <Button variant="secondary" disabled={retrySeconds > 0} onClick={() => void startCamera()}>
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
