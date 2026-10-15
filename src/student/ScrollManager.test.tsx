import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ScrollManager from './ScrollManager';

let nav: ReturnType<typeof useNavigate>;
function Probe() { nav = useNavigate(); return null; }

let y = 0;
let pageHeight = 5000;
const scrollTo = vi.fn((_x: number, top: number) => { y = top; });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  y = 0; pageHeight = 5000; scrollTo.mockClear();
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => pageHeight });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  window.sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

const mount = (initial = '/misiones?f=all') => render(<MemoryRouter initialEntries={[initial]}><ScrollManager /><Probe /></MemoryRouter>);
const scrollTo_ = (top: number) => act(() => { y = top; window.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
const go = (fn: () => void) => act(() => { fn(); vi.advanceTimersByTime(20); });
const frames = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

test('entering another screen starts at the top', () => {
  mount();
  scrollTo_(3000);
  go(() => nav('/misiones/abc?f=all'));
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
});

test('going back returns to where the list was, even when the list takes a moment to come back', () => {
  mount();
  scrollTo_(3000);
  go(() => nav('/misiones/abc?f=all'));
  scrollTo.mockClear();
  pageHeight = 600; // the catalogue is loading again: the page is short
  y = 0;
  go(() => nav(-1));
  frames(200);
  expect(scrollTo).not.toHaveBeenCalled(); // it does not jump to a place that does not exist yet
  pageHeight = 7000; // the list arrived
  frames(100);
  expect(scrollTo).toHaveBeenCalledWith(0, 3000);
  expect(y).toBe(3000);
});

test('it stops insisting once the position is stable, and the person can always take over', () => {
  mount();
  scrollTo_(2200);
  go(() => nav('/ruta'));
  y = 0; scrollTo.mockClear();
  go(() => nav(-1));
  frames(1000);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  // touching the screen while it is still waiting for the content cancels the restoration
  go(() => nav('/pasaporte'));
  scrollTo.mockClear(); pageHeight = 300; y = 0;
  go(() => nav(-1));
  fireEvent.touchStart(window);
  pageHeight = 9000;
  frames(300);
  expect(scrollTo).not.toHaveBeenCalled();
});

test('changing only the filters or the search of the same screen does not move the page', () => {
  mount('/misiones');
  scrollTo_(1500);
  scrollTo.mockClear();
  go(() => nav('/misiones?f=division&d=salud')); // push, same path
  go(() => nav('/misiones?f=division&d=salud&q=radio', { replace: true }));
  expect(scrollTo).not.toHaveBeenCalled();
});

test('anchors are left to their own screen (#premio, #horarios)', () => {
  mount();
  scrollTo_(900);
  scrollTo.mockClear();
  go(() => nav('/pasaporte#premio'));
  expect(scrollTo).not.toHaveBeenCalled();
});

test('the browser is told not to restore by itself, and gets its setting back', () => {
  const previous = window.history.scrollRestoration;
  const view = mount();
  expect(window.history.scrollRestoration).toBe('manual');
  view.unmount();
  expect(window.history.scrollRestoration).toBe(previous);
});

test('positions survive a reload of the page (session storage), per history entry', () => {
  mount('/misiones?f=all');
  scrollTo_(1234);
  const saved = JSON.parse(window.sessionStorage.getItem('diaov-scroll') ?? '{}') as Record<string, number>;
  expect(Object.values(saved)).toContain(1234);
});
