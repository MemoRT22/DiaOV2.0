import { BookUser, House, Rocket, ScanQrCode, Waypoints, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { NAV } from './copy';

type Tab = { to: string; label: string; icon: LucideIcon; also?: (path: string) => boolean };

/**
 * Bottom navigation, always visible while the student is signed in. Five fixed, short labels:
 * Inicio · Misiones · [Escanear] · Mi ruta · Bitácora. «Escanear» is the centre action — the one physical gesture of
 * the event — raised above the bar inside a glowing ring, so «cuando termino una misión, escaneo» is impossible to miss.
 * Intereses is contextual and lives under Bitácora.
 */
export default function BottomNav() {
  const { pathname } = useLocation();

  const left: Tab[] = [
    { to: '/bitacora', label: NAV.home, icon: House },
    { to: '/misiones', label: NAV.missions, icon: Rocket, also: (p) => p.startsWith('/misiones/') },
  ];
  const right: Tab[] = [
    { to: '/ruta', label: NAV.route, icon: Waypoints },
    { to: '/pasaporte', label: NAV.passport, icon: BookUser, also: (p) => p === '/destinos' },
  ];
  const scanActive = pathname === '/escanear';

  const renderTab = ({ to, label, icon: Icon, also }: Tab) => {
    const active = pathname === to || !!also?.(pathname);
    return (
      <Link
        key={to}
        to={to}
        aria-current={active ? 'page' : undefined}
        className="group relative flex min-h-[4.25rem] flex-col items-center justify-end gap-1 pb-2 text-[11px] font-semibold leading-none"
      >
        {active && <span className="anim-nav-pop absolute top-0 h-1 w-8 rounded-b-full bg-primary-500 shadow-[0_0_10px_rgb(var(--c-primary-500)/0.9)]" aria-hidden />}
        <span
          className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ${
            active ? 'bg-primary-500/20 text-fg-brand' : 'text-ink-muted group-hover:text-ink'
          }`}
        >
          <Icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={active ? 2.4 : 2} aria-hidden />
        </span>
        <span className={`max-w-full truncate px-1 ${active ? 'font-extrabold text-ink' : 'text-ink-muted'}`}>{label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface-sunken/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5 items-end px-1">
        {left.map(renderTab)}
        <Link
          to="/escanear"
          aria-label="Escanear asistencia"
          aria-current={scanActive ? 'page' : undefined}
          className="group flex min-h-[4.25rem] flex-col items-center justify-end gap-1 pb-2 text-[11px] font-extrabold leading-none"
        >
          <span
            className={`relative -mt-8 flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full bg-gradient-to-b from-primary-400 to-primary-600 text-on-primary shadow-[0_10px_28px_-6px_rgb(var(--c-primary-500)/0.85)] ring-4 ring-surface-sunken transition-transform duration-200 active:scale-95 ${
              scanActive ? 'scale-105' : ''
            }`}
          >
            {/* orbit ring around the scan button */}
            <span className="pointer-events-none absolute -inset-[7px] rounded-full border border-dashed border-primary-400/70" aria-hidden />
            <ScanQrCode className="h-8 w-8" strokeWidth={2.2} aria-hidden />
          </span>
          <span className={scanActive ? 'text-fg-brand' : 'text-ink'}>{NAV.scan}</span>
        </Link>
        {right.map(renderTab)}
      </div>
    </nav>
  );
}
