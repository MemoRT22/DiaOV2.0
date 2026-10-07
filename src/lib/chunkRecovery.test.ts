import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  installChunkRecovery, isChunkLoadError, isRecovering, RECOVERY_KEY, RECOVERY_WINDOW_MS, recoverFromStaleChunk, resetRecoveryState,
} from './chunkRecovery';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, data };
}

beforeEach(() => resetRecoveryState());
afterEach(() => vi.restoreAllMocks());

test('the first stale-chunk failure reloads once and remembers it (the URL is not touched)', () => {
  const storage = memoryStorage();
  const reload = vi.fn();
  const result = recoverFromStaleChunk({ storage, reload, now: () => 1_000, pathname: () => '/coordinacion/participantes/importar' });
  expect(result).toBe('reloading');
  expect(reload).toHaveBeenCalledTimes(1); // a plain reload() keeps the current URL: the route the user asked for mounts after it
  expect(JSON.parse(storage.data[RECOVERY_KEY])).toEqual({ at: 1_000, path: '/coordinacion/participantes/importar' });
  expect(isRecovering()).toBe(true);
});

test('loop guard: failing again right after the reload does NOT reload again', () => {
  const storage = memoryStorage();
  const reload = vi.fn();
  recoverFromStaleChunk({ storage, reload, now: () => 1_000 });
  resetRecoveryState(); // the reload replaced the page: module state starts over, sessionStorage survives
  const second = recoverFromStaleChunk({ storage, reload, now: () => 1_000 + 2_000 });
  expect(second).toBe('exhausted');
  expect(reload).toHaveBeenCalledTimes(1);
  expect(isRecovering()).toBe(false);
});

test('a bad connection cannot make a loop: every attempt inside the window is refused, whatever the path', () => {
  const storage = memoryStorage();
  const reload = vi.fn();
  recoverFromStaleChunk({ storage, reload, now: () => 0, pathname: () => '/a' });
  for (const t of [1, 5_000, RECOVERY_WINDOW_MS - 1]) {
    resetRecoveryState();
    expect(recoverFromStaleChunk({ storage, reload, now: () => t, pathname: () => '/b' })).toBe('exhausted');
  }
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a later deploy in the same tab can recover again once the window has passed', () => {
  const storage = memoryStorage();
  const reload = vi.fn();
  recoverFromStaleChunk({ storage, reload, now: () => 0 });
  resetRecoveryState();
  expect(recoverFromStaleChunk({ storage, reload, now: () => RECOVERY_WINDOW_MS + 1 })).toBe('reloading');
  expect(reload).toHaveBeenCalledTimes(2);
});

test('without usable storage it never reloads on its own (it could not prove it is not looping)', () => {
  const reload = vi.fn();
  expect(recoverFromStaleChunk({ storage: null, reload })).toBe('exhausted');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  expect(recoverFromStaleChunk({ storage: broken, reload })).toBe('exhausted');
  expect(reload).not.toHaveBeenCalled();
});

test('a corrupted guard record is treated as «no record» only when it is not a valid recent one', () => {
  const reload = vi.fn();
  const storage = memoryStorage({ [RECOVERY_KEY]: '{not json' });
  expect(recoverFromStaleChunk({ storage, reload, now: () => 5 })).toBe('exhausted'); // fail safe: no reload on unreadable state
  expect(reload).not.toHaveBeenCalled();
});

test('simulated deploy: vite:preloadError → one reload, error swallowed; second failure → left to the error screen, no reload', () => {
  const storage = memoryStorage();
  const reload = vi.fn();
  let clock = 10_000;
  const remove = installChunkRecovery(window, { storage, reload, now: () => clock, pathname: () => '/coordinacion/participantes/importar' });

  const first = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(first);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(first.defaultPrevented).toBe(true); // Vite does not throw into the UI while the page is being replaced

  // after the reload the new page still cannot load the chunk (e.g. offline)
  resetRecoveryState();
  clock += 1_500;
  const second = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(second);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(second.defaultPrevented).toBe(false); // Vite rethrows → RouteErrorBoundary shows the human message

  remove();
  window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test.each([
  ['Failed to fetch dynamically imported module: https://x/assets/ParticipantImport-abc.js', true],
  ['error loading dynamically imported module', true],
  ['Importing a module script failed.', true],
  ['Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html"', true],
  ['Unable to preload CSS for /assets/x.css', true],
  ['Cannot read properties of undefined (reading "map")', false],
  ['INVALID_HIGH_SCHOOL', false],
])('chunk-load error detection: %s → %s', (message, expected) => {
  expect(isChunkLoadError(new Error(message))).toBe(expected);
});
