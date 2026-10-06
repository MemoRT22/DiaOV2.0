import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';
import { hasRole, useAuth } from './lib/auth';
import StudentLogin from './student/StudentLogin';

const StudentLayout = lazy(() => import('./student/StudentLayout'));
const Welcome = lazy(() => import('./student/Welcome'));
const Passport = lazy(() => import('./student/Passport'));
const Missions = lazy(() => import('./student/Missions'));
const MyRoute = lazy(() => import('./student/MyRoute'));
const Interests = lazy(() => import('./student/Interests'));
const WorkshopRegistration = lazy(() => import('./public/WorkshopRegistration'));

const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const CoordinationOnly = lazy(() => import('./admin/CoordinationOnly'));
const Overview = lazy(() => import('./admin/Overview'));
const Participants = lazy(() => import('./admin/participants/Participants'));
const ParticipantDetail = lazy(() => import('./admin/participants/ParticipantDetail'));
const AccessHelp = lazy(() => import('./admin/participants/AccessHelp'));
const ParticipantImport = lazy(() => import('./admin/imports/ParticipantImport'));
const Conflicts = lazy(() => import('./admin/imports/Conflicts'));
const Catalog = lazy(() => import('./admin/catalog/Catalog'));
const CatalogImport = lazy(() => import('./admin/catalog/CatalogImport'));
const WorkshopInbox = lazy(() => import('./admin/workshops/WorkshopInbox'));
const WorkshopDetail = lazy(() => import('./admin/workshops/WorkshopDetail'));
const ExportPage = lazy(() => import('./admin/export/ExportPage'));
const StaffAccounts = lazy(() => import('./admin/staff/StaffAccounts'));
const Operation = lazy(() => import('./admin/Operation'));
const OperationsCenter = lazy(() => import('./admin/OperationsCenter'));
const ThemeEditor = lazy(() => import('./admin/theme/ThemeEditor'));
const RankRules = lazy(() => import('./admin/RankRules'));
const ReservationRules = lazy(() => import('./admin/ReservationRules'));
const CheckinModule = lazy(() => import('./admin/CheckinModule'));
const RaffleAdmin = lazy(() => import('./admin/RaffleAdmin'));
const RaffleOperator = lazy(() => import('./admin/RaffleOperator'));
const Scanner = lazy(() => import('./student/Scanner'));
const AuditLog = lazy(() => import('./admin/AuditLog'));
const Account = lazy(() => import('./admin/Account'));

function AdminHome() {
  const { staff } = useAuth();
  if (hasRole(staff, 'sorteo') && !hasRole(staff, 'coordinacion') && !hasRole(staff, 'staff'))
    return <Navigate to="sorteo" replace />;
  if (hasRole(staff, 'coordinacion')) return <Overview />;
  if (hasRole(staff, 'staff')) return <Navigate to="operacion-en-vivo" replace />;
  return <Navigate to="participantes" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<StudentLogin />} />
        <Route path="/registro-taller" element={<WorkshopRegistration />} />
        <Route element={<StudentLayout />}>
          <Route path="/bienvenida" element={<Welcome />} />
          <Route path="/bitacora" element={<Passport />} />
          <Route path="/misiones" element={<Missions />} />
          <Route path="/ruta" element={<MyRoute />} />
          <Route path="/escanear" element={<Scanner />} />
          <Route path="/destinos" element={<Interests />} />
        </Route>
        <Route path="/coordinacion" element={<AdminLayout />}>
          <Route index element={<AdminHome />} />
          <Route path="participantes" element={<Participants />} />
          <Route path="participantes/:id" element={<ParticipantDetail />} />
          <Route path="acceso" element={<AccessHelp />} />
          <Route path="cuenta" element={<Account />} />
          <Route path="checkin" element={<CheckinModule />} />
          <Route path="operacion-en-vivo" element={<OperationsCenter />} />
          <Route path="sorteo" element={<RaffleOperator />} />
          <Route element={<CoordinationOnly />}>
            <Route path="importar" element={<ParticipantImport />} />
            <Route path="conflictos" element={<Conflicts />} />
            <Route path="catalogo" element={<Catalog />} />
            <Route path="catalogo/importar" element={<CatalogImport />} />
            <Route path="talleres" element={<WorkshopInbox />} />
            <Route path="talleres/:id" element={<WorkshopDetail />} />
            <Route path="exportacion" element={<ExportPage />} />
            <Route path="personal" element={<StaffAccounts />} />
            <Route path="operacion" element={<Operation />} />
            <Route path="tematica" element={<ThemeEditor />} />
            <Route path="rangos" element={<RankRules />} />
            <Route path="reservaciones" element={<ReservationRules />} />
            <Route path="sorteo-admin" element={<RaffleAdmin />} />
            <Route path="auditoria" element={<AuditLog />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
