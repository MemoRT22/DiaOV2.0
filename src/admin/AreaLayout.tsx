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
        <nav aria-label={label} className="admin-area-tabs no-scrollbar">
          {visible.map((tab) => {
            const active = tab.isActive(pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className="admin-area-tab"
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
