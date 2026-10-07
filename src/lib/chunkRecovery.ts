/**
 * Recovery from a stale bundle.
 *
 * A tab that stays open across a deploy keeps references to the previous build's hashed chunks. The first time it navigates to a
 * lazy route the browser asks for a file that no longer exists (Netlify answers the SPA rewrite with `index.html`, so the import
 * fails with a MIME error): the URL has already changed but the screen can never render. Vite announces that failure with
 * `vite:preloadError`; a full reload of the same URL fetches the current build and mounts the route the user asked for.
 *
 * The reload happens at most once per `RECOVERY_WINDOW_MS`: a bad connection also makes dynamic imports fail and must not
 * turn into an endless reload loop. When the guard refuses, the error is left to `RouteErrorBoundary`, which shows a human message.
 */
export const RECOVERY_KEY = 'dia-ov:chunk-recovery';
export const RECOVERY_WINDOW_MS = 30_000;

type GuardRecord = { at: number; path: string };

export type RecoveryDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  reload: () => void;
  pathname: () => string;
};

let recovering = false;

/** True from the moment an automatic reload was triggered until the page is replaced. */
export const isRecovering = () => recovering;

export function resetRecoveryState() {
  recovering = false;
}

function defaultStorage(): RecoveryDeps['storage'] {
  try {
    return window.sessionStorage;
  } catch {
    return null; // blocked storage: we cannot prove we did not already reload, so we never reload automatically
  }
}

const defaultDeps = (): RecoveryDeps => ({
  storage: defaultStorage(),
  now: () => Date.now(),
  reload: () => window.location.reload(),
  pathname: () => window.location.pathname,
});

/** Messages browsers use when a dynamic import or its preload fails (Chrome, Firefox, Safari; Vite's own CSS preload). */
const CHUNK_ERROR = /dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|failed to load module script|loading chunk .* failed/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : '';
  return CHUNK_ERROR.test(message);
}

/**
 * Reloads the current URL once. Returns `'reloading'` when it did, `'exhausted'` when a recent recovery already happened
 * (or the guard cannot be stored), in which case the caller must fall back to the visible error screen.
 */
export function recoverFromStaleChunk(overrides: Partial<RecoveryDeps> = {}): 'reloading' | 'exhausted' {
  const deps = { ...defaultDeps(), ...overrides };
  if (recovering) return 'reloading';
  if (!deps.storage) return 'exhausted';

  const now = deps.now();
  try {
    const raw = deps.storage.getItem(RECOVERY_KEY);
    if (raw) {
      const last = JSON.parse(raw) as Partial<GuardRecord>;
      if (typeof last.at === 'number' && now - last.at < RECOVERY_WINDOW_MS && now >= last.at) return 'exhausted';
    }
    deps.storage.setItem(RECOVERY_KEY, JSON.stringify({ at: now, path: deps.pathname() } satisfies GuardRecord));
  } catch {
    return 'exhausted';
  }

  recovering = true;
  deps.reload();
  return 'reloading';
}

/** Listens, once and for the whole app, to Vite's `vite:preloadError`. Returns the function that removes the listener. */
export function installChunkRecovery(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window, overrides: Partial<RecoveryDeps> = {}) {
  const onPreloadError = (event: Event) => {
    if (recoverFromStaleChunk(overrides) === 'reloading') event.preventDefault(); // the reload replaces the page: do not surface the error meanwhile
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
