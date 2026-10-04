import { Loader2, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { friendlyError } from '../lib/errors';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-500 text-on-primary hover:bg-primary-400 shadow-[0_8px_24px_-8px_rgb(var(--c-primary-500)/0.6)]',
  secondary: 'bg-surface-raised text-ink border border-line hover:border-secondary-400',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  danger: 'bg-error-600 text-white hover:bg-error-500',
};

export function buttonClasses(variant: ButtonVariant = 'primary', className = '') {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`;
}

// The virtual keyboard opens after focus; wait for the viewport to shrink before centering the field.
function keepAboveKeyboard(el: HTMLElement) {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
}

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={buttonClasses(variant, className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  className = '',
  onFocus,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 block text-sm font-semibold text-ink">{label}</span>
      <input
        {...rest}
        onFocus={(e) => {
          keepAboveKeyboard(e.currentTarget);
          onFocus?.(e);
        }}
        className="h-12 w-full rounded-theme border border-line bg-surface-raised px-4 text-base text-ink placeholder:text-ink-muted/70 transition-colors focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30 disabled:opacity-60 [color-scheme:dark]"
      />
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 block text-sm font-semibold text-ink">{label}</span>
      <select
        {...rest}
        className="h-12 w-full rounded-theme border border-line bg-surface-raised px-4 text-base text-ink transition-colors focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30 disabled:opacity-60 [color-scheme:dark]"
      >
        {children}
      </select>
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const TONES: Record<Tone, string> = {
  info: 'border-secondary-500/40 bg-secondary-500/10 text-ink',
  success: 'border-success-500/40 bg-success-500/10 text-ink',
  warning: 'border-warning-500/50 bg-warning-500/10 text-ink',
  error: 'border-error-500/50 bg-error-500/10 text-ink',
};

export function Alert({ tone = 'info', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-theme border px-4 py-3 text-sm ${TONES[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ tone = 'info', children }: { tone?: Tone | 'neutral'; children: ReactNode }) {
  const styles: Record<string, string> = {
    info: 'bg-secondary-500/15 text-secondary-200',
    success: 'bg-success-500/15 text-success-200',
    warning: 'bg-warning-500/15 text-warning-200',
    error: 'bg-error-500/15 text-error-200',
    neutral: 'bg-neutral-500/15 text-ink-muted',
  };
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-ink-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando">
      <div className="h-7 w-2/3 animate-pulse rounded-theme bg-surface-raised" />
      <div className="h-4 w-1/2 animate-pulse rounded-theme bg-surface-raised" />
      {Array.from({ length: blocks }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-theme border border-line bg-surface" />
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tone="error">{friendlyError(error)}</Alert>
      <Button variant="secondary" className="w-full sm:w-auto" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card max-h-[90dvh] w-full max-w-lg animate-fade-up overflow-y-auto bg-surface-raised p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1 text-ink-muted hover:text-ink" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
