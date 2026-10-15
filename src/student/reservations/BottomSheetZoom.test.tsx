import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BottomSheet } from './ConfirmSheet';

type Fake = EventTarget & { scale: number; offsetLeft: number; offsetTop: number; width: number; height: number };
let vv: Fake;
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

beforeEach(() => {
  vi.useFakeTimers();
  vv = Object.defineProperties(Object.assign(new EventTarget(), { scale: 1, offsetLeft: 0, offsetTop: 0, width: 400, height: 800 }), {
    pageLeft: { get() { return (this as unknown as Fake).offsetLeft; } },
    pageTop: { get() { return (this as unknown as Fake).offsetTop; } },
  }) as Fake;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
});
afterEach(() => {
  vi.useRealTimers();
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport); else delete (window as { visualViewport?: unknown }).visualViewport;
});

const overlay = () => screen.getByRole('dialog').parentElement!;
const open = () => render(<MemoryRouter><BottomSheet title="Reservar lugar" onClose={() => undefined}><p>contenido</p></BottomSheet></MemoryRouter>);

test('with pinch-zoom the sheet overlay follows the visible area and is counter-scaled, so the whole sheet stays reachable', () => {
  open();
  act(() => { vi.advanceTimersByTime(20); });
  expect(overlay().style.transform).toBe('');
  act(() => { Object.assign(vv, { scale: 2, offsetLeft: 100, offsetTop: 300 }); vv.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20); });
  expect(overlay().style.transform).toMatch(/scale\(0\.5\)/);
  expect(overlay().style.transformOrigin).toBe('0 100%');
});

test('closing the zoom hands the overlay back to plain CSS', () => {
  open();
  act(() => { Object.assign(vv, { scale: 2, offsetLeft: 100, offsetTop: 300 }); vv.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20); });
  act(() => { Object.assign(vv, { scale: 1, offsetLeft: 0, offsetTop: 0 }); vv.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20); });
  expect(overlay().style.transform).toBe('');
});
