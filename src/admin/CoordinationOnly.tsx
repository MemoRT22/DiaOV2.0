import { Navigate, Outlet } from 'react-router-dom';
import { hasRole, useAuth } from '../lib/auth';

export default function CoordinationOnly() {
  const { staff } = useAuth();
  if (!hasRole(staff, 'coordinacion')) return <Navigate to="/coordinacion/participantes" replace />;
  return <Outlet />;
}
