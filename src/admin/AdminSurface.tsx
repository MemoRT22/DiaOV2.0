import { useLayoutEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { paintAdminSurface } from '../theme/surface';

/**
 * Layout route of the back office. It paints the fixed admin visual system on the document, so the configurable
 * public theme can change freely without ever altering colours, typography or layout of the admin.
 */
export default function AdminSurface() {
  useLayoutEffect(() => {
    paintAdminSurface();
  }, []);
  return <Outlet />;
}
