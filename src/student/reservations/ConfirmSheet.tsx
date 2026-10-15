import { Clock, MapPin, Rocket } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, buttonClasses } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { useVisualViewportAnchor } from '../../lib/useVisualViewportAnchor';
import { StampPlan, type StampPlanView } from '../ui/StampPlan';
import { sheetEntryActive, useDismissOnBack } from '../useDismissOnBack';

export type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** Non-blocking notice shown inside the same sheet (e.g. a tight transfer). It is advice, never an error. */
  warning?: string;
  /** What is being booked: rendered as a clear summary (what / when / where) instead of one line of text. */
  summary?: { title: string; when: string; where?: string };
  /** After a successful action, show this feedback instead of closing silently. */
  success?: {
    title: string;
    body?: string;
    link?: { to: string; label: string };
    /**
     * How full the route is NOW, read after the server accepted the action and the board was refreshed. Only shown
     * after a real success; it is never computed from the tap itself. `stamps` is the POTENTIAL stamp projection of the route
     * (earned vs. possible): possible stamps are never shown as won.
     */
    progress?: () => { active: number; max: number; stamps?: StampPlanView };
  };
  action: () => Promise<unknown>;
};

/** Bottom sheet on phones (thumb reach), centred card on larger screens. Rendered on <body>; locks page scroll. */
export function BottomSheet({ title, onClose, locked = false, children }: { title: string; onClose: () => void; /** Hay una acción en curso: Atrás no la cierra. */ locked?: boolean; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useVisualViewportAnchor<HTMLDivElement>('bottom'); // with pinch-zoom, the sheet fills what is visible instead of the (larger) layout viewport
  // El botón Atrás del navegador cierra la hoja (no saca de la pantalla), salvo que haya una acción en curso.
  useDismissOnBack(() => { if (locked) return false; onClose(); });

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="anim-sheet-up relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-[0_-20px_60px_-20px_rgb(var(--c-primary-500)/0.35)] pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl sm:pb-5"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default function ConfirmSheet({ request, onClose }: { request: ConfirmRequest; onClose: (done: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await request.action();
      if (request.success) {
        setDone(true);
        setBusy(false);
      } else {
        onClose(true);
      }
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  const close = () => !busy && onClose(done);

  if (done && request.success) {
    const route = request.success.progress?.();
    return (
      <BottomSheet title={request.success.title} onClose={close} locked={busy}>
        <div className="space-y-4 text-center">
          {/* one short launch: the mission is now on the route */}
          <span className="relative mx-auto flex h-20 w-20 items-center justify-center" aria-hidden>
            <span className="anim-burst absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0_10%,rgb(var(--c-primary-400)/0.55)_10%_14%,transparent_14%_35%,rgb(var(--c-secondary-400)/0.5)_35%_39%,transparent_39%_60%,rgb(var(--c-primary-400)/0.55)_60%_64%,transparent_64%_85%,rgb(var(--c-accent-500)/0.5)_85%_89%,transparent_89%)]" />
            <span className="anim-launch relative flex h-16 w-16 items-center justify-center rounded-full bg-primary-500 text-on-primary shadow-[0_12px_30px_-8px_rgb(var(--c-primary-500)/0.9)]">
              <Rocket className="h-8 w-8" />
            </span>
            <span className="anim-trail absolute left-1/2 top-[88%] h-6 w-1.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-primary-300 to-transparent" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold">{request.success.title}</h2>
            {request.success.body && <p className="mt-1 text-sm text-ink-muted">{request.success.body}</p>}
          </div>
          {route && route.active > 0 && (
            <div className="mx-auto w-full max-w-[16rem]" role="img" aria-label={`Tu ruta: ${route.active} de ${route.max} misiones reservadas`}>
              {/* the number of reservations is the limit of the route: it stays, as text, the way it always was */}
              {!(route.stamps && route.stamps.total > 0) && (
                <div className="flex items-center" aria-hidden>
                  {Array.from({ length: route.max }, (_, i) => (
                    <span key={i} className="flex flex-1 items-center last:flex-none">
                      <span
                        className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                          i < route.active ? 'border-primary-500 bg-primary-500 shadow-[0_0_10px_rgb(var(--c-primary-500)/0.8)]' : 'border-line'
                        } ${i === route.active - 1 ? 'anim-pop' : ''}`}
                      />
                      {i < route.max - 1 && <span className={`h-0.5 flex-1 ${i < route.active - 1 ? 'bg-primary-500' : 'bg-line'}`} />}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs font-semibold text-ink-muted">
                Tu ruta: <span className="text-ink">{route.active} de {route.max}</span> misiones reservadas
              </p>
            </div>
          )}
          {route?.stamps && route.stamps.total > 0 && route.active > 0 && (
            <div className="mx-auto w-full max-w-[17rem] rounded-theme border border-line bg-surface-sunken/50 px-3 py-3">
              <StampPlan plan={route.stamps} />
            </div>
          )}
          <div className="grid gap-2">
            {request.success.link && (
              <Link
                to={request.success.link.to}
                onClick={(event) => {
                  // Irse desde la hoja REEMPLAZA su entrada de historial: Atrás desde el destino vuelve a la pantalla, sin una pulsación de más.
                  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigate(request.success!.link!.to, { replace: sheetEntryActive() });
                  onClose(true);
                }}
                className={buttonClasses('primary')}
              >
                {request.success.link.label}
              </Link>
            )}
            <Button variant="secondary" data-autofocus onClick={() => onClose(true)}>
              Seguir explorando
            </Button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title={request.title} onClose={close} locked={busy}>
      <div className="space-y-4">
        <h2 className="text-lg font-extrabold">{request.title}</h2>
        {request.summary ? (
          <div className="ticket overflow-hidden">
            <div className="px-4 pb-3 pt-3">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-fg-brand">Pase de misión</p>
              <p className="mt-1 text-base font-extrabold leading-snug">{request.summary.title}</p>
            </div>
            <div className="ticket-tear mx-3" aria-hidden />
            <div className="grid gap-1.5 px-4 pb-4 pt-3">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Clock className="h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
                {request.summary.when}
              </p>
              {request.summary.where && (
                <p className="flex items-start gap-2 text-sm text-ink-muted">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
                  <span className="min-w-0 break-words">{request.summary.where}</span>
                </p>
              )}
            </div>
          </div>
        ) : null}
        {request.body && <p className="text-sm text-ink-muted">{request.body}</p>}
        {request.warning && !error && <Alert tone="warning">{request.warning}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-2">
          {!error && (
            <Button variant={request.danger ? 'danger' : 'primary'} loading={busy} data-autofocus onClick={confirm}>
              {request.confirmLabel}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => onClose(false)} data-autofocus={error ? true : undefined}>
            {error ? 'Cerrar' : 'Volver'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
