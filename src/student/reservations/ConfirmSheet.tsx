import { CalendarCheck, Clock, MapPin } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses } from '../../components/ui';
import { friendlyError } from '../../lib/errors';

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
  success?: { title: string; body?: string; link?: { to: string; label: string } };
  action: () => Promise<unknown>;
};

/** Bottom sheet on phones (thumb reach), centred card on larger screens. Rendered on <body>; locks page scroll. */
export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);

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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="anim-sheet-up relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5"
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
    return (
      <BottomSheet title={request.success.title} onClose={close}>
        <div className="space-y-4 text-center">
          <span className="anim-pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-500/20 text-fg-success">
            <CalendarCheck className="h-8 w-8" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-extrabold">{request.success.title}</h2>
            {request.success.body && <p className="mt-1 text-sm text-ink-muted">{request.success.body}</p>}
          </div>
          <div className="grid gap-2">
            {request.success.link && (
              <Link to={request.success.link.to} onClick={() => onClose(true)} className={buttonClasses('primary')}>
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
    <BottomSheet title={request.title} onClose={close}>
      <div className="space-y-4">
        <h2 className="text-lg font-extrabold">{request.title}</h2>
        {request.summary ? (
          <div className="rounded-theme border border-line bg-surface-raised p-4">
            <p className="text-base font-extrabold leading-snug">{request.summary.title}</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              {request.summary.when}
            </p>
            {request.summary.where && (
              <p className="mt-1 flex items-start gap-2 text-sm text-ink-muted">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{request.summary.where}</span>
              </p>
            )}
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
