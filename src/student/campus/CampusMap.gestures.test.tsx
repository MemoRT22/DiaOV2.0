import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CampusMap from './CampusMap';
import { CAMPUS_ZONES } from './campusZones';
import { screenToMap } from './mapView';

const zone = CAMPUS_ZONES.find((z) => z.shapes.length > 0)!;
const FRAME = { left: 0, top: 0, width: 420, height: 584, right: 420, bottom: 584, x: 0, y: 0, toJSON: () => ({}) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  SVGElement.prototype.getBoundingClientRect = () => FRAME as DOMRect;
  (SVGElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
});
afterEach(() => vi.useRealTimers());

/** The first building drawn on the plan (a real tap target: role=button with its name). */
const building = () => screen.getAllByRole('button', { name: zone.name })[0];
const svg = () => document.querySelector('svg.campus-map') as SVGSVGElement;
const plan = () => (document.querySelector('.campus-plan') as SVGGElement).style.transform;
const scaleOf = () => Number(/scale\(([\d.]+)\)/.exec(plan())?.[1]);
const viewOf = () => {
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(plan())!;
  return { tx: Number(match[1]), ty: Number(match[2]), s: Number(match[3]) };
};
const touch = (type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  act(() => { svg().dispatchEvent(event); });
};
const pinchOut = () => {
  touch('pointerdown', 1, 150, 300);
  touch('pointerdown', 2, 270, 300);
  touch('pointermove', 1, 110, 300);
  touch('pointermove', 2, 310, 300);
};
const release = () => { touch('pointerup', 1, 110, 300); touch('pointerup', 2, 310, 300); act(() => { vi.advanceTimersByTime(5); }); };

describe('the plan handles its own pinch and drag', () => {
  test('a pinch on the plan zooms the PLAN, and keeps the touches (the page is not zoomed)', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    expect(scaleOf()).toBe(1);
    expect(svg().style.touchAction).toBe('pan-y'); // one finger still scrolls the page at 1×; a pinch is not left to the browser
    pinchOut();
    expect(scaleOf()).toBeCloseTo(200 / 120, 2);
    expect(svg().style.touchAction).toBe('none'); // zoomed: the plan owns every touch so it can be dragged
    release();
    expect(svg().style.touchAction).toBe('none');
  });

  test('the zoom has limits: never below the whole campus, never beyond 4×', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    touch('pointerdown', 1, 200, 300);
    touch('pointerdown', 2, 220, 300);
    touch('pointermove', 1, 0, 300);
    touch('pointermove', 2, 420, 300);
    expect(scaleOf()).toBe(4);
    release();
    // pinching in on a 1× plan stays at 1×
    touch('pointerdown', 1, 50, 300);
    touch('pointerdown', 2, 350, 300);
    touch('pointermove', 1, 200, 300);
    touch('pointermove', 2, 210, 300);
    expect(scaleOf()).toBeLessThanOrEqual(4);
  });

  test('moving both fingers during a pinch pans and zooms as one coordinated gesture', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    touch('pointerdown', 1, 150, 260);
    touch('pointerdown', 2, 270, 260); // centre (210, 260), distance 120
    touch('pointermove', 1, 200, 290);
    touch('pointermove', 2, 440, 290); // centre (320, 290), distance 240: 2× plus a joint translation
    const moved = viewOf();
    expect(moved.s).toBeCloseTo(2, 5);
    const start = screenToMap(210, 260, FRAME);
    const current = screenToMap(320, 290, FRAME);
    // The map point initially under the centroid follows the centroid while the distance doubles.
    expect(moved.s * start.x + moved.tx).toBeCloseTo(current.x, 5);
    expect(moved.s * start.y + moved.ty).toBeCloseTo(current.y, 5);
  });

  test('a drag moves a zoomed plan, and ending the drag is NOT a tap on the building under the finger', () => {
    const onSelect = vi.fn();
    render(<CampusMap selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acercar mapa' }));
    const before = plan();
    touch('pointerdown', 1, 200, 300);
    touch('pointermove', 1, 170, 280);
    touch('pointermove', 1, 120, 250);
    expect(plan()).not.toBe(before);
    touch('pointerup', 1, 120, 250);
    fireEvent.click(building());
    expect(onSelect).not.toHaveBeenCalled(); // swallowed: it was a drag
    act(() => { vi.advanceTimersByTime(5); });
    fireEvent.click(building());
    expect(onSelect).toHaveBeenCalledWith(zone.id); // the next real tap works
  });

  test('a plain tap still selects the building', () => {
    const onSelect = vi.fn();
    render(<CampusMap selected={null} onSelect={onSelect} />);
    touch('pointerdown', 1, 200, 300);
    touch('pointerup', 1, 201, 300);
    fireEvent.click(building());
    expect(onSelect).toHaveBeenCalledWith(zone.id);
  });

  test('dragging a 1× plan does not move it and leaves the page scroll alone', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    touch('pointerdown', 1, 200, 400);
    touch('pointermove', 1, 200, 200);
    touch('pointerup', 1, 200, 200);
    expect(plan()).toBe('translate(0px, 0px) scale(1)');
    expect(svg().style.touchAction).toBe('pan-y');
  });
});

describe('the same zoom as buttons (a pinch is never the only way)', () => {
  test('zoom in, zoom out and reset, with names, 44 px targets and sensible disabled states', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    const group = screen.getByRole('group', { name: 'Zoom del mapa' });
    const zoomIn = screen.getByRole('button', { name: 'Acercar mapa' });
    const zoomOut = screen.getByRole('button', { name: 'Alejar mapa' });
    expect(group).toContainElement(zoomIn);
    expect(zoomOut).toBeDisabled(); // already the whole campus
    expect(screen.queryByRole('button', { name: 'Restablecer vista del mapa' })).not.toBeInTheDocument();
    for (const button of [zoomIn, zoomOut]) expect(button.className).toMatch(/h-11 w-11/);
    fireEvent.click(zoomIn);
    expect(scaleOf()).toBeCloseTo(1.5, 5);
    fireEvent.click(zoomIn);
    expect(scaleOf()).toBeCloseTo(2.25, 5);
    expect(zoomOut).toBeEnabled();
    fireEvent.click(zoomOut);
    expect(scaleOf()).toBeCloseTo(1.5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer vista del mapa' }));
    expect(plan()).toBe('translate(0px, 0px) scale(1)');
    expect(screen.queryByRole('button', { name: 'Restablecer vista del mapa' })).not.toBeInTheDocument();
  });

  test('zoom in stops at the maximum', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    const zoomIn = screen.getByRole('button', { name: 'Acercar mapa' });
    for (let i = 0; i < 8; i += 1) fireEvent.click(zoomIn);
    expect(scaleOf()).toBe(4);
    expect(zoomIn).toBeDisabled();
  });
});

describe('focus and desktop', () => {
  test('focusing a building still centres it (and replaces whatever zoom the student had)', () => {
    const { rerender } = render(<CampusMap selected={null} onSelect={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acercar mapa' }));
    rerender(<CampusMap selected={zone.id} onSelect={() => undefined} focus={zone.id} />);
    expect(scaleOf()).toBe(1.75);
    rerender(<CampusMap selected={zone.id} onSelect={() => undefined} focus={null} />);
    expect(plan()).toBe('translate(0px, 0px) scale(1)');
  });

  test('Ctrl+wheel (a trackpad pinch) zooms the plan; a plain wheel still scrolls the page', () => {
    render(<CampusMap selected={null} onSelect={() => undefined} />);
    const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 200, clientY: 300 });
    act(() => { svg().dispatchEvent(plain); });
    expect(plain.defaultPrevented).toBe(false);
    expect(scaleOf()).toBe(1);
    const pinch = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 200, clientY: 300, ctrlKey: true });
    act(() => { svg().dispatchEvent(pinch); });
    expect(pinch.defaultPrevented).toBe(true);
    expect(scaleOf()).toBeGreaterThan(1);
  });
});
