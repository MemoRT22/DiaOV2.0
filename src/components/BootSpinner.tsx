import { useEffect, useState } from 'react';
import { buttonClasses, Spinner } from './ui';

export const SLOW_LOAD_MS = 12_000;

/** Removes the locally stored Supabase session so a corrupted/stuck one cannot keep the app on «Cargando». */
export function clearStoredSession() {
  try {
    for (const key of Object.keys(window.localStorage)) if (/^sb-.*-auth-token/.test(key)) window.localStorage.removeItem(key);
  } catch {
    /* blocked storage: nothing to clear */
  }
}

/**
 * «Cargando» for the screens that cannot render until the session, the edition or a route chunk is ready.
 * A request that never answers (weak network) must not leave the person staring at a spinner forever: after a while we say so
 * and offer a way out. «Empezar de nuevo» lands on `restartTo`: the student login by default, `/coordinacion` inside the admin.
 */
export function BootSpinner({ after = SLOW_LOAD_MS, restartTo = '/' }: { after?: number; restartTo?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), after);
    return () => window.clearTimeout(id);
  }, [after]);

  return (
    <>
      <Spinner />
      {slow && (
        <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <p className="text-sm text-ink-muted">Está tardando más de lo normal. Revisa tu conexión e inténtalo de nuevo.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className={buttonClasses('primary')} onClick={() => window.location.reload()}>
              Reintentar
            </button>
            <button
              type="button"
              className={buttonClasses('secondary')}
              onClick={() => {
                clearStoredSession();
                window.location.assign(restartTo);
              }}
            >
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
