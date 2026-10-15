import { describe, expect, test } from 'vitest';
import { MAP_VIEWBOX as VB } from './campusZones';
import { clampView, IDENTITY, isZoomed, MAX_ZOOM, panView, sameView, screenToMap, twoFingers, zoomAbout } from './mapView';

const centre = { x: VB.x + VB.w / 2, y: VB.y + VB.h / 2 };

describe('map view math', () => {
  test('the plan never leaves the frame: no empty space at any zoom', () => {
    const v = clampView({ s: 2, tx: 5000, ty: -5000 });
    expect(v.tx).toBe(VB.x - 2 * VB.x);
    expect(v.ty).toBe(VB.y + VB.h - 2 * (VB.y + VB.h));
    expect(clampView({ s: 99, tx: 0, ty: 0 }).s).toBe(MAX_ZOOM);
    expect(clampView({ s: 0.2, tx: 300, ty: 300 })).toEqual(IDENTITY === undefined ? IDENTITY : clampView({ s: 1, tx: 300, ty: 300 }));
    expect(clampView({ s: 0.2, tx: 300, ty: 300 }).s).toBe(1);
  });

  test('zooming about a point keeps that point still on the screen', () => {
    const f = { x: VB.x + 200, y: VB.y + 300 };
    const v = zoomAbout(IDENTITY, 2.5, f.x, f.y);
    expect(v.s).toBe(2.5);
    // the plan point that was under f is still under f: s·p + t = f  ⇒  p = (f - t) / s must equal f at 1×
    const mapped = { x: v.s * f.x + v.tx, y: v.s * f.y + v.ty };
    expect(mapped.x).toBeCloseTo(f.x, 5);
    expect(mapped.y).toBeCloseTo(f.y, 5);
  });

  test('zoom out to 1× returns exactly to the whole campus', () => {
    const zoomed = zoomAbout(IDENTITY, 3, centre.x, centre.y);
    expect(isZoomed(zoomed)).toBe(true);
    const back = zoomAbout(zoomed, 1, centre.x, centre.y);
    expect(sameView(back, IDENTITY)).toBe(true);
    expect(isZoomed(back)).toBe(false);
  });

  test('dragging a 1× plan does nothing (nothing to see beyond the edges), a zoomed one moves within its limits', () => {
    expect(sameView(panView(IDENTITY, 400, 400), IDENTITY)).toBe(true);
    const zoomed = zoomAbout(IDENTITY, 2, centre.x, centre.y);
    const moved = panView(zoomed, -120, 80);
    expect(moved.tx).toBeCloseTo(zoomed.tx - 120, 5);
    expect(moved.ty).toBeCloseTo(zoomed.ty + 80, 5);
    expect(panView(zoomed, -1e6, -1e6)).toEqual(clampView({ ...zoomed, tx: -1e9, ty: -1e9 }));
  });

  test('screen pixels map to drawing units with the margins of «meet» (a frame wider or taller than the plan)', () => {
    // frame 2× the plan's aspect in width: the plan is centred with side margins
    const wide = { left: 10, top: 20, width: 2 * VB.w, height: VB.h };
    const middle = screenToMap(10 + wide.width / 2, 20 + wide.height / 2, wide);
    expect(middle.x).toBeCloseTo(centre.x, 5);
    expect(middle.y).toBeCloseTo(centre.y, 5);
    const left = screenToMap(10 + VB.w / 2, 20, wide); // the plan starts VB.w/2 px in from the left edge
    expect(left.x).toBeCloseTo(VB.x, 5);
    expect(left.y).toBeCloseTo(VB.y, 5);
    expect(screenToMap(0, 0, { left: 0, top: 0, width: VB.w / 2, height: VB.h / 2 }).unitsPerPx).toBeCloseTo(2, 5);
  });

  test('two fingers give their centre and separation', () => {
    expect(twoFingers({ x: 0, y: 0 }, { x: 6, y: 8 })).toEqual({ cx: 3, cy: 4, distance: 10 });
  });
});
