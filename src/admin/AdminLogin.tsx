import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { ADMIN_LOGO, ADMIN_PRODUCT_NAME } from './adminTheme';

export default function AdminLogin() {
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

  const wrongAccount = session && (profile || !staff);

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="admin-login-intro hidden flex-col justify-between border-r border-line p-12 lg:flex" aria-hidden>
        <div className="flex items-center gap-3">
          <span className="admin-brand-mark flex h-11 w-11 items-center justify-center rounded-lg p-1.5">
            <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
          </span>
          <span className="text-base font-bold text-ink">{ADMIN_PRODUCT_NAME}</span>
        </div>
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Universidad Anáhuac Cancún</p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight text-ink">Un espacio claro para coordinar el Día OV.</h2>
          <p className="mt-4 text-base text-ink-muted">
            Participantes, talleres y operación del evento en un mismo panel.
          </p>
        </div>
        <p className="text-xs text-ink-muted">Panel del personal</p>
      </aside>

      <div className="flex items-center justify-center px-5 py-10">
        <div className="admin-rise w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="admin-brand-mark flex h-10 w-10 items-center justify-center rounded-lg p-1.5">
              <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
            </span>
            <div>
              <p className="text-base font-bold">{ADMIN_PRODUCT_NAME}</p>
              <p className="text-sm text-ink-muted">Panel del personal</p>
            </div>
          </div>
          <div className="mb-6">
            <h1>Acceso del personal</h1>
            <p className="mt-2 text-sm text-ink-muted">Ingresa con tu cuenta del personal para continuar.</p>
          </div>

          {wrongAccount ? (
            <div className="card space-y-4 p-6">
              <Alert tone="warning">Esta sesión no corresponde a una cuenta activa del personal.</Alert>
              <Button variant="secondary" className="w-full" onClick={signOut}>
                Cerrar sesión
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="card space-y-4 p-6 sm:p-7">
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
            <Link to="/" className="text-xs font-medium text-ink-muted transition-colors hover:text-ink">
              Ir al acceso de aspirantes
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
