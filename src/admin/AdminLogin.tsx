import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';

export default function AdminLogin() {
  const { theme } = useTheme();
  const { session, staff, profile, signInStaff, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signInStaff(email, password);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const wrongAccount = session && (profile || (staff && staff.role !== 'coordinacion') || !staff);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-10 w-10 object-contain" />}
          <div>
            <p className="font-display text-lg font-extrabold">{theme.meta.eventName}</p>
            <p className="text-sm text-ink-muted">Panel de Coordinación</p>
          </div>
        </div>

        {wrongAccount ? (
          <div className="card space-y-4 p-6">
            <Alert tone="warning">
              {staff?.role === 'staff'
                ? 'Tu cuenta de personal no tiene acceso al panel de Coordinación.'
                : 'Esta sesión no corresponde a una cuenta de Coordinación.'}
            </Alert>
            <Button variant="secondary" className="w-full" onClick={signOut}>
              Cerrar sesión
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card space-y-4 p-6">
            <Field label="Correo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" className="w-full" loading={submitting}>
              Entrar
            </Button>
          </form>
        )}
        <p className="mt-6 text-center">
          <Link to="/" className="text-xs text-ink-muted hover:text-ink">
            Ir al acceso de aspirantes
          </Link>
        </p>
      </div>
    </div>
  );
}
