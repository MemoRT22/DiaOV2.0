import { CloudOff, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { GuideAvatar } from './Guide';

/** Empty state of the student experience: an orb (or the guide), one title, one sentence and one clear way forward. */
export function EmptyState({
  icon: Icon,
  guide = false,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  guide?: boolean;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-card relative animate-fade-up overflow-hidden px-6 py-8 text-center">
      {guide ? (
        <GuideAvatar size={84} className="mx-auto" />
      ) : Icon ? (
        <span className="icon-orb mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-fg-brand" aria-hidden>
          <Icon className="h-8 w-8" />
        </span>
      ) : null}
      <h2 className="mt-4 text-xl font-extrabold">{title}</h2>
      {children && <p className="mx-auto mt-1 max-w-xs text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

/** Recoverable error in the same visual language: what happened (plain words) and a retry. Nothing is lost. */
export function ErrorState({ error, onRetry, title = 'No pudimos cargar esta parte' }: { error: unknown; onRetry: () => void; title?: string }) {
  return (
    <section className="space-card animate-fade-up px-6 py-7 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-error-500/10 text-fg-error" aria-hidden>
        <CloudOff className="h-7 w-7" />
      </span>
      <h2 className="mt-3 text-lg font-extrabold">{title}</h2>
      <p role="alert" className="mx-auto mt-1 max-w-xs text-sm text-ink-muted">
        {friendlyError(error)}
      </p>
      <Button variant="secondary" className="mt-5 w-full sm:w-auto" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        Reintentar
      </Button>
    </section>
  );
}
