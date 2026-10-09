import { Link } from 'react-router-dom';
import { NAV } from '../copy';

/**
 * How full my route is, drawn as stations on a line (filled = reserved). It is a link to Mi ruta, with the count
 * spelled out for screen readers.
 */
export function RouteMeter({ active, max, className = '' }: { active: number; max: number; className?: string }) {
  return (
    <Link
      to="/ruta"
      aria-label={`${NAV.route}: ${active} de ${max} misiones reservadas`}
      className={`route-meter inline-flex min-h-11 items-center gap-3 rounded-full border border-line bg-surface/70 py-1.5 pl-3 pr-4 text-sm ${className}`}
    >
      <Stations active={active} max={max} />
      <span className="text-ink-muted">
        <span className="font-bold text-ink">{active}</span> de {max} en <span className="font-semibold text-fg-brand">{NAV.route.toLowerCase()}</span>
      </span>
    </Link>
  );
}

/** The stations alone (decorative): filled = reserved. Wide variant stretches across its container. */
export function Stations({ active, max, wide = false }: { active: number; max: number; wide?: boolean }) {
  return (
    <span className={`flex items-center ${wide ? 'w-full' : ''}`} aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`flex items-center ${wide && i > 0 ? 'flex-1' : ''}`}>
          {i > 0 && <span className={`h-0.5 ${wide ? 'flex-1' : 'w-3'} ${i < active ? 'bg-primary-500' : 'bg-line'}`} />}
          <span
            className={`h-3 w-3 shrink-0 rounded-full border-2 ${i < active ? 'border-primary-500 bg-primary-500 shadow-[0_0_8px_rgb(var(--c-primary-500)/0.7)]' : 'border-line bg-transparent'}`}
          />
        </span>
      ))}
    </span>
  );
}
