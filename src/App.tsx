import { Navigate, Route, Routes } from 'react-router-dom';
import Account from './admin/Account';
import AdminLayout from './admin/AdminLayout';
import AuditLog from './admin/AuditLog';
import Operation from './admin/Operation';
import Overview from './admin/Overview';
import RankRules from './admin/RankRules';
import ThemeEditor from './admin/theme/ThemeEditor';
import Interests from './student/Interests';
import Missions from './student/Missions';
import Passport from './student/Passport';
import StudentLayout from './student/StudentLayout';
import StudentLogin from './student/StudentLogin';
import Welcome from './student/Welcome';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StudentLogin />} />
      <Route element={<StudentLayout />}>
        <Route path="/bienvenida" element={<Welcome />} />
        <Route path="/bitacora" element={<Passport />} />
        <Route path="/misiones" element={<Missions />} />
        <Route path="/destinos" element={<Interests />} />
      </Route>
      <Route path="/coordinacion" element={<AdminLayout />}>
        <Route index element={<Overview />} />
        <Route path="operacion" element={<Operation />} />
        <Route path="tematica" element={<ThemeEditor />} />
        <Route path="rangos" element={<RankRules />} />
        <Route path="auditoria" element={<AuditLog />} />
        <Route path="cuenta" element={<Account />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
