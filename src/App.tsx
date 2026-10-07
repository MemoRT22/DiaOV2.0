import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import { BootSpinner } from './components/BootSpinner';
import { hasRole, useAuth } from './lib/auth';
import AdminSurface from './admin/AdminSurface';
import AreaLayout from './admin/AreaLayout';
import { OPERATION_TABS, SETTINGS_BASE, SETTINGS_TABS, WORKSHOP_TABS } from './admin/navigation';
import StudentLogin from './student/StudentLogin';
import { PublicSurface } from './theme/PublicThemeProvider';

const StudentLayout = lazy(() => import('./student/StudentLayout'));
const Welcome = lazy(() => import('./student/Welcome'));
const Home = lazy(() => import('./student/Home'));
const PassportPage = lazy(() => import('./student/PassportPage'));
const Missions = lazy(() => import('./student/Missions'));
const MyRoute = lazy(() => import('./student/MyRoute'));
const Interests = lazy(() => import('./student/Interests'));
const WorkshopRegistration = lazy(() => import('./public/WorkshopRegistration'));

const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const CoordinationOnly = lazy(() => import('./admin/CoordinationOnly'));
const Overview = lazy(() => import('./admin/Overview'));
const SettingsHome = lazy(() => import('./admin/SettingsHome'));
const Participants = lazy(() => import('./admin/participants/Participants'));
const ParticipantDetail = lazy(() => import('./admin/participants/ParticipantDetail'));
const ParticipantImport = lazy(() => import('./admin/imports/ParticipantImport'));
const ExportPage = lazy(() => import('./admin/export/ExportPage'));
const Catalog = lazy(() => import('./admin/catalog/Catalog'));
const CatalogImport = lazy(() => import('./admin/catalog/CatalogImport'));
const WorkshopInbox = lazy(() => import('./admin/workshops/WorkshopInbox'));
const WorkshopDetail = lazy(() => import('./admin/workshops/WorkshopDetail'));
const WorkshopProgram = lazy(() => import('./admin/workshops/WorkshopProgram'));
const StaffAccounts = lazy(() => import('./admin/staff/StaffAccounts'));
const Operation = lazy(() => import('./admin/Operation'));
const OperationsCenter = lazy(() => import('./admin/OperationsCenter'));
const ThemeEditor = lazy(() => import('./admin/theme/ThemeEditor'));
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

const to = (path: string) => <Navigate to={path} replace />;

/**
 * Routes retired when their capability was absorbed by another flow. They keep working as redirects so bookmarks
 * and links shared before the reorganisation land in the right place.
 */
const REDIRECTS: Array<[from: string, target: string]> = [
  ['acceso', '/coordinacion/participantes'],
  ['importar', '/coordinacion/participantes/importar'],
  ['conflictos', '/coordinacion/participantes/importar'],
  ['exportacion', '/coordinacion/participantes/exportar'],
  ['mas', SETTINGS_BASE],
  ['rangos', SETTINGS_BASE],
  ['personal', `${SETTINGS_BASE}/personal`],
  ['tematica', `${SETTINGS_BASE}/experiencia-publica`],
  ['reservaciones', `${SETTINGS_BASE}/reservaciones`],
  ['operacion', `${SETTINGS_BASE}/preparacion`],
  ['catalogo', `${SETTINGS_BASE}/catalogo`],
  ['catalogo/importar', `${SETTINGS_BASE}/catalogo/importar`],
  ['auditoria', `${SETTINGS_BASE}/auditoria`],
];

export default function App() {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary fullScreen resetKey={pathname}>
      <Suspense fallback={<BootSpinner />}>
        <Routes>
          <Route element={<PublicSurface />}>
            <Route path="/" element={<StudentLogin />} />
            <Route path="/registro-taller" element={<WorkshopRegistration />} />
            <Route element={<StudentLayout />}>
              <Route path="/bienvenida" element={<Welcome />} />
              <Route path="/bitacora" element={<Home />} />
              <Route path="/pasaporte" element={<PassportPage />} />
              <Route path="/misiones" element={<Missions />} />
              <Route path="/ruta" element={<MyRoute />} />
              <Route path="/escanear" element={<Scanner />} />
              <Route path="/destinos" element={<Interests />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>

          <Route element={<AdminSurface />}>
            <Route path="/coordinacion" element={<AdminLayout />}>
              <Route index element={<AdminHome />} />
              <Route path="participantes" element={<Participants />} />
              <Route path="participantes/:id" element={<ParticipantDetail />} />
              <Route path="cuenta" element={<Account />} />
              <Route path="sorteo" element={<RaffleOperator />} />

              <Route element={<AreaLayout label="Operación" tabs={OPERATION_TABS} />}>
                <Route path="operacion-en-vivo" element={<OperationsCenter />} />
                <Route path="checkin" element={<CheckinModule />} />
                <Route element={<CoordinationOnly />}>
                  <Route path="sorteo-admin" element={<RaffleAdmin />} />
                </Route>
              </Route>

              <Route element={<CoordinationOnly />}>
                <Route path="participantes/importar" element={<ParticipantImport />} />
                <Route path="participantes/exportar" element={<ExportPage />} />

                <Route element={<AreaLayout label="Talleres" tabs={WORKSHOP_TABS} />}>
                  <Route path="talleres" element={<WorkshopInbox />} />
                  <Route path="talleres/programa" element={<WorkshopProgram />} />
                  <Route path="talleres/programa/importar" element={<CatalogImport initialKind="workshops" backLabel="Programa de talleres" />} />
                  <Route path="talleres/:id" element={<WorkshopDetail />} />
                </Route>

                <Route path="configuracion" element={<AreaLayout label="Configuración" tabs={SETTINGS_TABS} hideAt={SETTINGS_BASE} />}>
                  <Route index element={<SettingsHome />} />
                  <Route path="personal" element={<StaffAccounts />} />
                  <Route path="experiencia-publica" element={<ThemeEditor />} />
                  <Route path="reservaciones" element={<ReservationRules />} />
                  <Route path="preparacion" element={<Operation />} />
                  <Route path="catalogo" element={<Catalog />} />
                  <Route path="catalogo/importar" element={<CatalogImport />} />
                  <Route path="auditoria" element={<AuditLog />} />
                </Route>

                {REDIRECTS.map(([from, target]) => <Route key={from} path={from} element={to(target)} />)}
              </Route>
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
