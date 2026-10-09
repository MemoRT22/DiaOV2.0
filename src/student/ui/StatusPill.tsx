import {
  Ban, BadgeCheck, CalendarCheck, CircleDot, Clock3, Hourglass, QrCode, Rocket, Route, Sparkles, XCircle, type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Every mission/session state the student can meet, with ONE look each (icon + colour + word), shared by Misiones,
 * the mission detail, Mi ruta and Inicio. State is never carried by colour alone.
 */
export type StatusKind =
  | 'available'
  | 'few'
  | 'full'
  | 'live'
  | 'in_route'
  | 'next'
  | 'done'
  | 'for_you'
  | 'to_scan'
  | 'ended'
  | 'cancelled'
  | 'waiting';

type Look = { icon: LucideIcon; className: string; pulse?: boolean };

const LOOKS: Record<StatusKind, Look> = {
  available: { icon: Rocket, className: 'bg-success-500/15 text-fg-success ring-success-500/30' },
  few: { icon: Hourglass, className: 'bg-warning-500/15 text-fg-warning ring-warning-500/35' },
  full: { icon: Ban, className: 'bg-error-500/10 text-fg-error ring-error-500/30' },
  live: { icon: CircleDot, className: 'bg-primary-500 text-on-primary ring-primary-400/60', pulse: true },
  in_route: { icon: Route, className: 'bg-secondary-500/15 text-fg-info ring-secondary-500/35' },
  next: { icon: CalendarCheck, className: 'bg-primary-500/15 text-fg-brand ring-primary-500/40' },
  done: { icon: BadgeCheck, className: 'bg-success-500/15 text-fg-success ring-success-500/35' },
  for_you: { icon: Sparkles, className: 'bg-accent-500/15 text-fg-accent ring-accent-500/40' },
  to_scan: { icon: QrCode, className: 'bg-warning-500/15 text-fg-warning ring-warning-500/40' },
  ended: { icon: Clock3, className: 'bg-neutral-500/15 text-ink-muted ring-line' },
  cancelled: { icon: XCircle, className: 'bg-error-500/10 text-fg-error ring-error-500/30' },
  waiting: { icon: Clock3, className: 'bg-neutral-500/15 text-ink-muted ring-line' },
};

export function StatusPill({ kind, children, className = '' }: { kind: StatusKind; children: ReactNode; className?: string }) {
  const { icon: Icon, className: look, pulse } = LOOKS[kind];
  return (
    <span
      className={`status-pill inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${look} ${className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${pulse ? 'anim-blink' : ''}`} aria-hidden />
      {children}
    </span>
  );
}
