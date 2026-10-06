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
        <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
          {visible.map((tab) => {
            const active = tab.isActive(pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500 ${
                  active ? 'border-primary-500 text-ink' : 'border-transparent text-ink-muted hover:text-ink'
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
