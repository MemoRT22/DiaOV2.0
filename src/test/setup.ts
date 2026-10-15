import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetBoardCache } from '../lib/boardCache';

// Pruebas con `@vitest-environment node` (rasterizar PDF) no tienen DOM: lo de abajo solo aplica con jsdom.
const hasDom = typeof window !== 'undefined';

beforeEach(() => { resetBoardCache(); });
afterEach(() => { if (!hasDom) return; cleanup(); try { window.localStorage.clear(); } catch { /* none */ } });

// jsdom no implementa estas APIs de layout.
if (hasDom) {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  Element.prototype.scrollIntoView = () => undefined;

  // Node's experimental global localStorage can shadow jsdom's and leave `window.localStorage` unusable: give tests a working one.
  try { window.localStorage.setItem('probe', '1'); window.localStorage.removeItem('probe'); } catch {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); },
        removeItem: (key: string) => { store.delete(key); }, clear: () => store.clear(), key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size; },
      },
    });
  }
}
