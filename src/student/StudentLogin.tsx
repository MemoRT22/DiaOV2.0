import { CalendarDays, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Backdrop, BrandFooter, Tagline, ThemedTitle } from '../components/themed';
import { Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatEventDate } from '../lib/catalog';
import { studentAccess, type AccessState } from '../lib/studentAccess';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { EmailStep, LoginStep, RegisterStep, SetupStep } from './StudentAccessSteps';

type Step = { kind: 'email' | AccessState; email: string };

/**
 * Acceso de participantes: correo → el sistema decide → contraseña.
 * La pantalla solo conoce uno de tres estados (iniciar sesión, crear contraseña, registrarse); nunca datos personales.
 */
export default function StudentLogin() {
  const { theme, text } = usePublicTheme();
  const { edition } = useEdition();
  const { ready, profile, signInParticipant } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'email', email: '' });

  if (!ready) return <Spinner />;
  if (profile) return <Navigate to="/bitacora" replace />;

  const back = () => setStep((s) => ({ kind: 'email', email: s.email }));

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

        <div className="card mt-8 bg-surface/80 p-6 backdrop-blur animate-fade-up [animation-delay:120ms]">
          {step.kind === 'email' && <EmailStep title={text('loginTitle')} initial={step.email} onContinue={(email, kind) => setStep({ kind, email })} />}
          {step.kind === 'password_login' && (
            <LoginStep email={step.email} onBack={back} onSignIn={(password) => signInParticipant(step.email, password)} />
          )}
          {step.kind === 'password_setup' && (
            <SetupStep
              email={step.email}
              onBack={back}
              onSetup={async (password) => {
                await studentAccess.setupPassword(step.email, password);
                await signInParticipant(step.email, password);
              }}
            />
          )}
          {step.kind === 'self_registration' && (
            <RegisterStep
              email={step.email}
              onBack={back}
              onRegister={async ({ password, ...fields }) => {
                await studentAccess.register({ ...fields, password, email: step.email });
                await signInParticipant(step.email, password);
              }}
            />
          )}
        </div>

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
