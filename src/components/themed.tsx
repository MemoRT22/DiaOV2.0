import { useId, type ReactNode } from 'react';
import { usePublicTheme } from '../theme/PublicThemeProvider';

export function Backdrop() {
  const { theme } = usePublicTheme();
  if (theme.style.background !== 'starfield') return null;
  return <div className="starfield" aria-hidden />;
}

export function ThemedTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { theme } = usePublicTheme();
  return <span className={`${theme.style.metallicTitles ? 'metallic-text' : 'text-ink'} ${className}`}>{children}</span>;
}

export function Tagline({ className = '' }: { className?: string }) {
  const { theme } = usePublicTheme();
  const { tagline, taglineHighlight } = theme.meta;
  const idx = taglineHighlight ? tagline.indexOf(taglineHighlight) : -1;
  if (idx < 0) return <p className={`font-display italic font-extrabold ${className}`}>{tagline}</p>;
  return (
    <p className={`font-display italic font-extrabold ${className}`}>
      <span>{tagline.slice(0, idx)}</span>
      <span className="rounded-md bg-accent-500 px-1.5 text-on-accent">{taglineHighlight}</span>
      <span>{tagline.slice(idx + taglineHighlight.length)}</span>
    </p>
  );
}

export function ProgressRing({
  value,
  size = 200,
  stroke = 10,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const { theme } = usePublicTheme();
  const id = useId().replace(/:/g, '');
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(value, 0), 1);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-secondary-400))" />
            <stop offset="55%" stopColor="rgb(var(--c-accent-500))" />
            <stop offset="100%" stopColor="rgb(var(--c-primary-500))" />
          </linearGradient>
          <filter id={`f${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped)}
          filter={theme.style.glowRing ? `url(#f${id})` : undefined}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function BrandFooter() {
  const { theme } = usePublicTheme();
  return (
    <div className="flex items-center justify-center gap-4 opacity-90">
      {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-8 w-8 object-contain" />}
      <div className="text-left font-display leading-tight">
        <p className="text-sm font-extrabold uppercase tracking-wide text-ink">{theme.meta.organizer}</p>
        <p className="text-[11px] text-ink-muted">The International University</p>
      </div>
    </div>
  );
}
