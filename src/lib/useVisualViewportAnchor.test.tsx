import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { anchorTransform, useVisualViewportAnchor, ZOOM_EPSILON } from './useVisualViewportAnchor';

type Fake = EventTarget & { scale: number; offsetLeft: number; offsetTop: number; pageLeft: number; pageTop: number; width: number; height: number };
let vv: Fake;
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  // no scroll in these tests, so the page position of the visible area equals its offset
  vv = Object.defineProperties(Object.assign(new EventTarget(), { scale: 1, offsetLeft: 0, offsetTop: 0, width: 400, height: 800 }), {
    pageLeft: { get() { return (this as unknown as Fake).offsetLeft; } },
    pageTop: { get() { return (this as unknown as Fake).offsetTop; } },
  }) as Fake;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});
afterEach(() => {
  vi.useRealTimers();
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport); else delete (window as { visualViewport?: unknown }).visualViewport;
});

const flush = () => act(() => { vi.advanceTimersByTime(20); });
const move = (patch: Partial<Fake>) => act(() => { Object.assign(vv, patch); vv.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(20); });

function Bars({ edge }: { edge: 'top' | 'bottom' }) {
  const ref = useVisualViewportAnchor<HTMLDivElement>(edge);
  return <div ref={(el) => {
    // jsdom has no layout: say where the browser would put this bar (the bottom bar at the bottom of the 800 px layout viewport)
    if (el) el.getBoundingClientRect = () => ({ left: 0, top: edge === 'top' ? 0 : 752, bottom: edge === 'top' ? 48 : 800, right: 400, width: 400, height: 48, x: 0, y: 0, toJSON: () => ({}) });
    ref(el);
  }} data-testid={edge} />;
}

describe('anchorTransform (pure)', () => {
  const natural = { left: 0, top: 0, bottom: 800 };
  test('without zoom nothing has to change', () => {
    expect(anchorTransform({ scale: 1, pageLeft: 0, pageTop: 0, height: 800 }, natural, 'bottom')).toBeNull();
    expect(anchorTransform({ scale: ZOOM_EPSILON, pageLeft: 0, pageTop: 0, height: 800 }, natural, 'top')).toBeNull();
  });

  test('zoomed in: the bottom bar goes to the bottom of what is VISIBLE and keeps its on-screen size', () => {
    // 2.2× zoom: the screen shows a 182×364 window of the 400×800 layout, panned to (100, 200)
    const t = anchorTransform({ scale: 2.2, pageLeft: 100, pageTop: 200, height: 364 }, natural, 'bottom');
    expect(t).toBe(`translate(100px, ${200 + 364 - 800}px) scale(${1 / 2.2})`);
  });

  test('zoomed in: the top bar goes to the top of the visible area', () => {
    expect(anchorTransform({ scale: 2, pageLeft: 30, pageTop: 120, height: 400 }, natural, 'top')).toBe('translate(30px, 120px) scale(0.5)');
  });

  test('it starts from wherever the browser really puts the bar, not from a guess about innerHeight (Chrome and Safari differ)', () => {
    // Safari: the layout viewport is 402×714 even though innerHeight shrinks with the zoom. The bar's own box says where it is.
    const t = anchorTransform({ scale: 1.98, pageLeft: 100, pageTop: 183, height: 360 }, { left: 0, top: 654, bottom: 714 }, 'bottom');
    expect(t).toBe(`translate(100px, ${183 + 360 - 714}px) scale(${1 / 1.98})`);
    // a sticky header that is stuck somewhere other than 0 (content scrolled under it)
    expect(anchorTransform({ scale: 2, pageLeft: 0, pageTop: 300, height: 400 }, { left: 0, top: 250, bottom: 298 }, 'top')).toBe('translate(0px, 50px) scale(0.5)');
  });

  test('Safari (measured on iOS 26, iPhone 17): the page is scrolled to where the visible area is, so client coordinates are page minus scroll', () => {
    // scale 1.98, visible 203×360 at page (100,183), window scrolled to (100,183): the sticky header sits at client (-100,-183),
    // the fixed bar at client top 471 / bottom 531 (it was laid out against the 402×714 layout viewport)
    const vv = { scale: 1.98, pageLeft: 100, pageTop: 183, height: 360 };
    const scroll = { x: 100, y: 183 };
    expect(anchorTransform(vv, { left: -100, top: -183, bottom: -135 }, 'top', scroll)).toBe(`translate(100px, 183px) scale(${1 / 1.98})`);
    // the visible bottom is client 360: the bar's own bottom (531) has to move up by 171
    expect(anchorTransform(vv, { left: -100, top: 471, bottom: 531 }, 'bottom', scroll)).toBe(`translate(100px, -171px) scale(${1 / 1.98})`);
  });
});

describe('useVisualViewportAnchor', () => {
  test('does nothing at all while the page is not zoomed (plain CSS positioning, no transform, no layer)', () => {
    const { getByTestId } = render(<><Bars edge="bottom" /><Bars edge="top" /></>);
    flush();
    for (const id of ['bottom', 'top']) {
      expect(getByTestId(id).style.transform).toBe('');
      expect(getByTestId(id).style.willChange).toBe('');
    }
  });

  test('follows a pinch-zoom and the panning that comes with it, and lets go when the zoom is undone', () => {
    const { getByTestId } = render(<Bars edge="bottom" />);
    const bar = getByTestId('bottom');
    move({ scale: 2, width: 200, height: 400, offsetLeft: 0, offsetTop: 0 });
    expect(bar.style.transform).toBe('translate(0px, -400px) scale(0.5)');
    expect(bar.style.transformOrigin).toBe('0 100%');
    expect(bar.style.willChange).toBe('transform');
    // panning the zoomed page moves the visible area: the bar goes with it
    act(() => { vv.offsetTop = 150; vv.offsetLeft = 60; vv.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(bar.style.transform).toBe('translate(60px, -250px) scale(0.5)');
    // zooming back out removes every trace
    move({ scale: 1, width: 400, height: 800, offsetLeft: 0, offsetTop: 0 });
    expect(bar.style.transform).toBe('');
    expect(bar.style.transformOrigin).toBe('');
    expect(bar.style.willChange).toBe('');
  });

  test('a burst of events costs one update per animation frame (one measurement and one write, not thirty)', () => {
    const { getByTestId } = render(<Bars edge="top" />);
    const bar = getByTestId('top');
    const spy = vi.spyOn(bar.style, 'transform', 'set');
    act(() => {
      for (let i = 1; i <= 30; i += 1) { Object.assign(vv, { scale: 1 + i / 10, offsetTop: i }); vv.dispatchEvent(new Event('resize')); }
      vi.advanceTimersByTime(20);
    });
    expect(spy.mock.calls.filter(([value]) => value !== '')).toHaveLength(1); // the clear before measuring is not a visible change
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bar.style.transform).toContain('translate(0px, 30px)');
  });

  test('on unmount the listeners are removed and the bar is left clean', () => {
    const remove = vi.spyOn(vv, 'removeEventListener');
    const { getByTestId, unmount } = render(<Bars edge="bottom" />);
    move({ scale: 2, height: 400, width: 200 });
    const bar = getByTestId('bottom');
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(bar.style.transform).toBe('');
  });

  test('a browser without visualViewport is left alone', () => {
    delete (window as { visualViewport?: unknown }).visualViewport;
    const { getByTestId } = render(<Bars edge="bottom" />);
    flush();
    expect(getByTestId('bottom').style.transform).toBe('');
  });
});
