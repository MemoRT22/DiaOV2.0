import { ArrowLeft, Award, CheckCircle2, Keyboard, Loader2, QrCode, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import QRScanner from 'qr-scanner';
import { Link } from 'react-router-dom';
import { Alert, Button } from '../components/ui';
import { checkIn, type CheckInResult } from '../lib/checkin';
import { friendlyError } from '../lib/errors';
import { formatTime } from '../lib/catalog';
import { usePublicTheme } from '../theme/PublicThemeProvider';

type Phase = 'idle' | 'scanning' | 'validating' | 'success' | 'error' | 'manual';

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QRScanner | null>(null);
  const decodedRef = useRef(false);
  const { term, rankName } = usePublicTheme();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState(false);

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
        { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true },
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
      setResult(res);
      setPhase('success');
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
    setErrorMsg('');
    setManualCode('');
    setPhase('idle');
  };

  useEffect(() => {
    return () => {
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'scanning') {
      scannerRef.current?.stop();
    }
  }, [phase]);

  if (phase === 'success' && result) {
    return (
      <div className="space-y-6">
        <div className="card animate-fade-up p-6 text-center">
          <CheckCircle2 className="mx-auto h-16 w-16 text-success" aria-hidden />
          <h1 className="mt-4 text-xl font-extrabold">Misión completada</h1>
          <p className="mt-1 text-lg font-semibold">{result.title}</p>
          <p className="text-sm text-ink-muted">
            {formatTime(result.starts_at)} — {formatTime(result.ends_at)}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-theme bg-accent-500/15 px-4 py-2">
            <Sparkles className="h-5 w-5 text-accent-400" aria-hidden />
            <span className="text-lg font-extrabold text-accent-400">+{result.credits_granted}</span>
            <span className="text-sm text-ink-muted">{term('stamp', true).toLowerCase()}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-theme border border-line p-3">
              <p className="font-display text-xl font-extrabold">{result.stamps}</p>
              <p className="text-xs text-ink-muted">{term('stamp', true)} totales</p>
            </div>
            <div className="rounded-theme border border-line p-3">
              <p className="font-display text-xl font-extrabold">{result.attended_workshops}</p>
              <p className="text-xs text-ink-muted">Talleres asistidos</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-3 rounded-theme border border-primary-400/40 bg-primary-500/10 p-3">
            <Award className="h-6 w-6 text-primary-400" aria-hidden />
            <div className="text-left">
              <p className="text-xs uppercase tracking-widest text-ink-muted">{term('rank')} actual</p>
              <p className="font-extrabold text-primary-400">
                {result.level} · {rankName(result.level)}
              </p>
            </div>
          </div>
          {result.already_registered && (
            <p className="mt-3 text-sm text-ink-muted">Esta asistencia ya estaba registrada.</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={reset} className="flex-1">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Escanear otro
          </Button>
          <Link to="/bitacora" className="flex-1">
            <Button variant="primary" className="w-full">
              Ver Pasaporte
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/bitacora" className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-extrabold">Escanear asistencia</h1>
      </div>

      {phase === 'error' && (
        <Alert tone="error">{errorMsg || 'No se pudo validar la asistencia.'}</Alert>
      )}

      {phase === 'validating' && (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary-400" aria-hidden />
          <p className="text-sm text-ink-muted">Validando asistencia…</p>
        </div>
      )}

      {(phase === 'idle' || phase === 'scanning') && (
        <>
          <div className="relative overflow-hidden rounded-theme border border-line bg-black">
            <video ref={videoRef} className="mx-auto aspect-square w-full max-w-sm object-cover" playsInline muted />
            {phase === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <QrCode className="h-16 w-16 text-ink-muted" aria-hidden />
                <p className="text-sm text-ink-muted">
                  Toca el botón para abrir la cámara y escanea el QR que muestra el facilitador al final del taller.
                </p>
                <Button variant="primary" onClick={startCamera}>
                  <QrCode className="h-5 w-5" aria-hidden />
                  Abrir cámara
                </Button>
              </div>
            )}
            {phase === 'scanning' && (
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <p className="text-xs text-white/80">Apunta al QR del taller…</p>
              </div>
            )}
          </div>

          {cameraError && (
            <Alert tone="warning">
              No pudimos acceder a la cámara. Puedes usar el código manual que muestra el facilitador.
            </Alert>
          )}
        </>
      )}

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Keyboard className="h-5 w-5 text-ink-muted" aria-hidden />
          <h2 className="text-sm font-semibold">Código manual</h2>
        </div>
        <p className="mb-3 text-xs text-ink-muted">
          Si la cámara no funciona, pide el código de 6 letras al facilitador e introdúcelo aquí.
        </p>
        <form onSubmit={submitManual} className="flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            maxLength={6}
            className="flex-1 rounded-theme border border-line bg-surface px-4 py-3 text-center font-display text-lg font-bold uppercase tracking-widest focus:border-primary-400 focus:outline-none"
            disabled={phase === 'validating'}
          />
          <Button type="submit" loading={phase === 'validating'}>
            Validar
          </Button>
        </form>
      </div>
    </div>
  );
}
