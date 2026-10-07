import { BookMarked, Home, QrCode, Route, Sparkles, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { usePublicTheme } from '../theme/PublicThemeProvider';

type Tab = { to: string; label: string; icon: LucideIcon; also?: string[] };

/**
 * Bottom navigation, always visible while the student is signed in. «Escanear» is the centre action:
 * larger, raised and in the brand colour, one tap away from anywhere.
 * Inicio · Talleres · [Escanear] · Mi ruta · Pasaporte  (Intereses is contextual and lives under Pasaporte).
 */
export default function BottomNav() {
  const { text } = usePublicTheme();
  const { pathname } = useLocation();

  const left: Tab[] = [
    { to: '/bitacora', label: 'Inicio', icon: Home },
    { to: '/misiones', label: text('navActivities'), icon: Sparkles },
  ];
  const right: Tab[] = [
    { to: '/ruta', label: 'Mi ruta', icon: Route },
    { to: '/pasaporte', label: text('navPassport'), icon: BookMarked, also: ['/destinos'] },
  ];
  const scanActive = pathname === '/escanear';

  const renderTab = ({ to, label, icon: Icon, also = [] }: Tab) => {
    const active = pathname === to || also.includes(pathname);
    return (
      <Link
        key={to}
        to={to}
        aria-current={active ? 'page' : undefined}
        className="group flex min-h-16 flex-col items-center justify-end gap-1 pb-2 text-[11px] font-semibold leading-none"
      >
        <span
          className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
            active ? 'bg-primary-500/20 text-fg-brand' : 'text-ink-muted group-hover:text-ink'
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className={`max-w-full truncate px-1 ${active ? 'font-extrabold text-ink' : 'text-ink-muted'}`}>{label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-surface-sunken/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5 items-end px-1">
        {left.map(renderTab)}
        <Link
          to="/escanear"
          aria-label="Escanear asistencia"
          aria-current={scanActive ? 'page' : undefined}
          className="group flex min-h-16 flex-col items-center justify-end gap-1 pb-2 text-[11px] font-extrabold leading-none"
        >
          <span
            className={`-mt-7 flex h-16 w-16 items-center justify-center rounded-full bg-primary-500 text-on-primary shadow-[0_10px_28px_-8px_rgb(var(--c-primary-500)/0.8)] ring-4 ring-surface-sunken transition-transform active:scale-95 ${
              scanActive ? 'scale-105' : ''
            }`}
          >
            <QrCode className="h-7 w-7" aria-hidden />
          </span>
          <span className="text-ink">Escanear</span>
        </Link>
        {right.map(renderTab)}
      </div>
    </nav>
  );
}
