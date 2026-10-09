import { useId } from 'react';

/**
 * Decorative space scenery drawn with the theme tokens (no bitmap): the curved, glowing horizon of a planet seen from
 * orbit, and thin orbit arcs. Always `aria-hidden`, never interactive, and cheap to paint (one SVG, no blur filters).
 */
export function PlanetHorizon({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 120"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full ${className}`}
    >
      <defs>
        <radialGradient id={`atm${id}`} cx="50%" cy="100%" r="75%">
          <stop offset="0%" stopColor="rgb(var(--c-secondary-500))" stopOpacity="0.32" />
          <stop offset="55%" stopColor="rgb(var(--c-secondary-500))" stopOpacity="0.08" />
          <stop offset="100%" stopColor="rgb(var(--c-secondary-500))" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`rim${id}`} x1="0" x2="1">
          <stop offset="0%" stopColor="rgb(var(--c-secondary-400))" stopOpacity="0" />
          <stop offset="40%" stopColor="rgb(var(--c-secondary-300))" stopOpacity="0.9" />
          <stop offset="85%" stopColor="rgb(var(--c-primary-400))" stopOpacity="1" />
          <stop offset="100%" stopColor="rgb(var(--c-primary-500))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="200" cy="190" rx="330" ry="110" fill={`url(#atm${id})`} />
      <path d="M -40 118 Q 200 52 440 118" fill="none" stroke={`url(#rim${id})`} strokeWidth="1.6" />
    </svg>
  );
}

/** Two thin orbit arcs with a tiny "planet" on each; used in a hero corner. */
export function OrbitArcs({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 160" className={`pointer-events-none absolute ${className}`}>
      <circle cx="120" cy="40" r="70" fill="none" stroke="rgb(var(--c-primary-400))" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="120" cy="40" r="44" fill="none" stroke="rgb(var(--c-secondary-400))" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="2 5" />
      <circle cx="52" cy="66" r="4" fill="rgb(var(--c-primary-400))" />
      <circle cx="86" cy="76" r="2.5" fill="rgb(var(--c-secondary-300))" />
    </svg>
  );
}
