import { Rocket } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePublicTheme } from '../../theme/PublicThemeProvider';

/**
 * The mission guide: the university mascot (theme asset `mascot`) framed in an astronaut-helmet porthole, so the
 * official illustration is never redrawn or altered. Swap the asset in the theme and every appearance follows.
 * Without a mascot asset it shows a neutral rocket badge instead.
 *
 * Used with intent and sparingly: welcome, empty states, a completed route, the first check-in reward and the passport
 * before the first stamp. Never on every screen and never covering information.
 */
export function GuideAvatar({ size = 64, className = '' }: { size?: number; className?: string }) {
  const { theme } = usePublicTheme();
  return (
    <span
      aria-hidden
      className={`guide-helmet relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size }}
    >
      {theme.assets?.mascot ? (
        <img src={theme.assets.mascot} alt="" className="guide-helmet-img h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <Rocket className="h-1/2 w-1/2 text-fg-brand" />
      )}
    </span>
  );
}

/** The guide speaking: avatar + a short speech bubble. Keep `children` to one sentence and at most one action. */
export function GuideTip({
  title,
  children,
  action,
  size = 56,
  className = '',
}: {
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  size?: number;
  className?: string;
}) {
  const { theme } = usePublicTheme();
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <GuideAvatar size={size} />
      <div className="guide-bubble relative min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-surface-raised/90 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-fg-brand">{theme.meta?.guideName ?? 'Tu guía'} · Guía de misión</p>
        {title && <p className="mt-0.5 font-display text-base font-extrabold leading-snug text-ink">{title}</p>}
        {children && <div className="mt-0.5 text-sm text-ink-muted">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
