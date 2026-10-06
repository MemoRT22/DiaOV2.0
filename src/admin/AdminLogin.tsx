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
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="admin-hero hidden flex-col justify-between p-12 lg:flex" aria-hidden>
        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-2 shadow-[0_10px_26px_-10px_rgba(28,25,23,0.4)] ring-1 ring-line">
            <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-ink">{ADMIN_PRODUCT_NAME}</span>
        </div>
        <div className="relative z-10 max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white/80 px-3 py-1 text-xs font-semibold text-ink-muted shadow-sm backdrop-blur">
            <span className="admin-pulse h-2 w-2 rounded-full bg-emerald-500 text-emerald-500" />
            Universidad Anáhuac Cancún
          </p>
          <h2 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-ink">
            Orienta, opera y <span className="gradient-text">celebra</span> cada decisión vocacional.
          </h2>
          <p className="mt-5 text-base text-ink-muted">
            Todo el Día de Orientación Vocacional en un solo lugar: participantes, talleres, check-in y sorteo.
          </p>
        </div>
        <p className="relative z-10 text-xs text-ink-muted">Panel del personal</p>
      </aside>

      <div className="flex items-center justify-center px-5 py-10">
        <div className="admin-rise w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white p-1.5 shadow-md ring-1 ring-line">
              <img src={ADMIN_LOGO} alt="" className="h-full w-full object-contain" />
            </span>
            <div>
              <p className="font-display text-lg font-extrabold">{ADMIN_PRODUCT_NAME}</p>
              <p className="text-sm text-ink-muted">Panel del personal</p>
            </div>
          </div>
          <div className="mb-6 hidden lg:block">
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Te damos la bienvenida</h1>
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
