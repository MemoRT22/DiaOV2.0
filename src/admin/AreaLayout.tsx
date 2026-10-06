import { Link, Outlet, useLocation } from 'react-router-dom';
import { hasRole, useAuth } from '../lib/auth';
import type { AreaTab } from './navigation';

type Props = {
  label: string;
  tabs: AreaTab[];
  /** Path at which the tab bar is hidden (e.g. the Configuración home already lists every section). */
  hideAt?: string;
};

/** Secondary navigation of an area: sections of one product area instead of one sidebar entry per tool. */
export default function AreaLayout({ label, tabs, hideAt }: Props) {
  const { staff } = useAuth();
  const { pathname } = useLocation();
  const coord = hasRole(staff, 'coordinacion');
  const visible = tabs.filter((tab) => coord || !tab.coordOnly);
  const showTabs = visible.length > 1 && pathname !== hideAt;

  return (
    <div className="space-y-6">
      {showTabs && (
        <nav aria-label={label} className="flex max-w-full gap-1 self-start overflow-x-auto rounded-2xl border border-line/80 bg-surface/70 p-1.5 shadow-sm backdrop-blur [width:fit-content]">
          {visible.map((tab) => {
            const active = tab.isActive(pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none ${
                  active
                    ? 'bg-ink text-white shadow-[0_8px_20px_-10px_rgba(28,25,23,0.7)]'
                    : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
      <Outlet />
    </div>
  );
}
