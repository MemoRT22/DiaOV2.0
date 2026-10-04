import { CalendarDays, MapPin } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Backdrop, BrandFooter, Tagline, ThemedTitle } from '../components/themed';
import { Alert, Button, Field, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatEventDate } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';

export default function StudentLogin() {
  const { theme, edition, text } = useTheme();
  const { ready, profile, signInParticipant } = useAuth();
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!ready) return <Spinner />;
  if (profile) return <Navigate to="/bitacora" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signInParticipant(email, birthDate);
    } catch (cause) {
      setError(friendlyError(cause));
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Backdrop />
      <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-8 pt-10">
        <div className="flex flex-col items-center text-center animate-fade-up">
          <div className="relative flex h-56 w-56 items-center justify-center">
            {theme.style.glowRing && <div className="glow-ring absolute inset-0 rounded-full animate-spin-slow" aria-hidden />}
            <div className={`absolute ${theme.style.glowRing ? 'inset-[3px]' : 'inset-0 border border-line'} rounded-full bg-surface-sunken`} />
            <h1 className="relative flex flex-col font-display font-extrabold leading-none">
              <ThemedTitle className="text-4xl tracking-wide">{theme.meta.eventName.split(' ')[0]}</ThemedTitle>
              <ThemedTitle className="text-6xl">{theme.meta.eventName.split(' ').slice(1).join(' ')}</ThemedTitle>
            </h1>
          </div>
          <Tagline className="mt-6 text-lg text-ink" />
          {edition && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-4 w-4" aria-hidden />
                {formatEventDate(edition.event_date)} · {edition.start_time} h
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" aria-hidden />
                {edition.venue}
              </span>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="card mt-8 space-y-4 bg-surface/80 p-6 backdrop-blur animate-fade-up [animation-delay:120ms]">
          <div>
            <h2 className="text-xl font-extrabold">{text('loginTitle')}</h2>
            <p className="mt-1 text-sm text-ink-muted">{text('loginSubtitle')}</p>
          </div>
          <Field
            label="Correo electrónico"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
          />
          <Field
            label="Fecha de nacimiento"
            type="date"
            required
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" loading={submitting}>
            Entrar
          </Button>
          <p className="text-center text-xs text-ink-muted">{text('loginHelp')}</p>
        </form>

        <div className="mt-auto space-y-4 pt-10">
          <BrandFooter />
          <p className="text-center">
            <Link to="/coordinacion" className="text-xs text-ink-muted underline-offset-4 hover:text-ink hover:underline">
              Acceso del personal
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
