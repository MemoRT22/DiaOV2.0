import { CalendarClock, CheckCircle2, ClipboardList } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Backdrop, BrandFooter } from '../components/themed';
import { Alert, Button, PageSkeleton } from '../components/ui';
import {
  IntakeError,
  fetchWorkshopIntakeCatalog,
  type IntakeCatalog,
  type SubmissionReceipt,
} from '../lib/workshopIntakeApi';
import type { FormState } from '../lib/workshopForm';
import { useTheme } from '../theme/ThemeProvider';
import WorkshopWizard from './workshop/WorkshopWizard';

type View =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; catalog: IntakeCatalog }
  | { kind: 'done'; receipt: SubmissionReceipt; catalog: IntakeCatalog; contact: Pick<FormState, 'facilitator_name' | 'facilitator_email'> };

/** Página pública `/registro-taller`: sin login, solo consume la Edge Function `workshop-intake`. */
export default function WorkshopRegistration() {
  const { theme } = useTheme();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Página pública solo para quien tenga el enlace: que no se indexe.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    const previous = document.title;
    document.title = `Registro de talleres · ${theme.meta.eventName}`;
    return () => {
      meta.remove();
      document.title = previous;
    };
  }, [theme.meta.eventName]);

  const load = useCallback(async (): Promise<IntakeCatalog | 'unavailable' | 'error'> => {
    try {
      const catalog = await fetchWorkshopIntakeCatalog();
      // Un catálogo académico vacío ya no bloquea el formulario: Vida Universitaria no lo necesita.
      return catalog;
    } catch (err) {
      if (err instanceof IntakeError && err.code === 'NO_ACTIVE_EDITION') return 'unavailable';
      return 'error';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setView({ kind: 'loading' });
    void load().then((r) => {
      if (cancelled) return;
      setView(r === 'unavailable' ? { kind: 'unavailable' } : r === 'error' ? { kind: 'error' } : { kind: 'ready', catalog: r });
    });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  // Recarga el catálogo sin desmontar el asistente (se conservan las respuestas).
  const reloadCatalog = useCallback(async () => {
    const r = await load();
    setView((v) => {
      if (r === 'unavailable') return { kind: 'unavailable' };
      if (r === 'error') return v;
      return v.kind === 'ready' ? { kind: 'ready', catalog: r } : v;
    });
  }, [load]);

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <main className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <header className="mb-8 animate-fade-up">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{theme.meta.eventName}</p>
          <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">Registro de talleres</h1>
          {(view.kind === 'ready' || view.kind === 'loading') && (
            <p className="mt-2 max-w-2xl text-sm text-ink-muted sm:text-base">
              Propón un taller para los alumnos. Son unos minutos, no necesitas cuenta. El equipo organizador revisará tu propuesta y te contactará si hace falta ajustar algo.
            </p>
          )}
        </header>

        {view.kind === 'loading' && <PageSkeleton blocks={3} />}

        {view.kind === 'error' && (
          <div className="space-y-4" role="alert">
            <Alert tone="error">No pudimos cargar el formulario. Revisa tu conexión a internet e inténtalo de nuevo.</Alert>
            <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
              Reintentar
            </Button>
          </div>
        )}

        {view.kind === 'unavailable' && (
          <section className="card flex flex-col items-center gap-3 p-8 text-center" aria-labelledby="unavailable-title">
            <CalendarClock className="h-10 w-10 text-ink-muted" aria-hidden />
            <h2 id="unavailable-title" className="text-xl font-extrabold">
              Registro aún no disponible
            </h2>
            <p className="max-w-md text-sm text-ink-muted">
              Estamos preparando el formulario de registro de talleres. Vuelve a abrir este enlace más tarde; en cuanto esté listo podrás enviar tu propuesta.
            </p>
          </section>
        )}

        {view.kind === 'ready' && (
          <WorkshopWizard
            catalog={view.catalog}
            onReloadCatalog={reloadCatalog}
            onUnavailable={() => setView({ kind: 'unavailable' })}
            onSubmitted={(receipt, form) =>
              setView({
                kind: 'done',
                receipt,
                catalog: view.catalog,
                contact: { facilitator_name: form.facilitator_name, facilitator_email: form.facilitator_email },
              })
            }
          />
        )}

        {view.kind === 'done' && <Success receipt={view.receipt} email={view.contact.facilitator_email} onAnother={() => setView({ kind: 'ready', catalog: view.catalog })} />}

        <div className="mt-12">
          <BrandFooter />
        </div>
      </main>
    </div>
  );
}

function Success({ receipt, email, onAnother }: { receipt: SubmissionReceipt; email: string; onAnother: () => void }) {
  return (
    <section className="card space-y-5 p-6 sm:p-8" aria-labelledby="success-title" role="status">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-1 h-8 w-8 shrink-0 text-success-400" aria-hidden />
        <div>
          <h2 id="success-title" className="text-2xl font-extrabold">
            ¡Recibimos tu propuesta!
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Gracias por querer sumarte. Esto es lo que sigue:</p>
        </div>
      </div>
      <ul className="space-y-3 text-sm">
        <li className="flex gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-secondary-300" aria-hidden />
          <span>Tu propuesta fue recibida y será revisada por el equipo organizador.</span>
        </li>
        <li className="flex gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-secondary-300" aria-hidden />
          <span>
            Si hace falta ajustar algo, nos pondremos en contacto contigo al correo <strong className="break-all">{email}</strong>.
          </span>
        </li>
        <li className="flex gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-secondary-300" aria-hidden />
          <span>
            <strong>Todavía no significa que el taller esté publicado.</strong> Te avisaremos cuando haya una decisión.
          </span>
        </li>
      </ul>
      <p className="text-xs text-ink-muted">
        Folio de referencia: <span className="font-mono">{receipt.submission_id.slice(0, 8).toUpperCase()}</span>
      </p>
      <Button variant="secondary" onClick={onAnother}>
        Registrar otro taller
      </Button>
    </section>
  );
}
