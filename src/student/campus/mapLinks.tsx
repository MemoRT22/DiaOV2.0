import { MapPinned } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Clean, shareable map URLs:
 *  - `/mapa`                → the campus
 *  - `/mapa?sesion=<id>`    → one concrete session (its own location, never «the first session» of the mission)
 *  - `/mapa?vista=ruta`     → my route, numbered
 * Every link carries where it came from in router state, so «Volver» returns to the exact screen (filters, change mode…).
 */
export const MAP_PATH = '/mapa';
export const mapForSession = (sessionId: string) => `${MAP_PATH}?sesion=${encodeURIComponent(sessionId)}`;
export const mapForRoute = () => `${MAP_PATH}?vista=ruta`;

export type MapReturnState = { from?: string };

export function MapLink({ to, children, className = '', ariaLabel }: { to: string; children: ReactNode; className?: string; ariaLabel?: string }) {
  const location = useLocation();
  const state: MapReturnState = { from: `${location.pathname}${location.search}` };
  return (
    <Link to={to} state={state} aria-label={ariaLabel} className={className}>
      {children}
    </Link>
  );
}

/** The small, secondary «Ver en el mapa» / «Cómo llegar» action used across screens. */
export function MapActionLink({ to, label = 'Ver en el mapa', emphasis = false, ariaLabel }: { to: string; label?: string; emphasis?: boolean; ariaLabel?: string }) {
  return (
    <MapLink
      to={to}
      ariaLabel={ariaLabel}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors ${
        emphasis ? 'bg-primary-500/15 text-fg-brand ring-1 ring-inset ring-primary-500/40 hover:bg-primary-500/25' : 'text-fg-brand hover:bg-surface-raised'
      }`}
    >
      <MapPinned className="h-4 w-4" aria-hidden />
      {label}
    </MapLink>
  );
}
