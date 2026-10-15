import { MAP_VIEWBOX as VB } from './campusZones';

/**
 * Vista del plano: `pantalla = escala · punto + traslación`, en las unidades del dibujo (no en píxeles). Es el mismo modelo que ya usa
 * el enfoque a un edificio (`focusTransform`), así que el zoom del alumno y el enfoque se combinan sin casos especiales.
 */
export type MapView = { s: number; tx: number; ty: number };

export const IDENTITY: MapView = { s: 1, tx: 0, ty: 0 };
export const MAX_ZOOM = 4;
/** Cada toque en «+» / «−» multiplica o divide el zoom por esto. */
export const ZOOM_STEP = 1.5;

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Nunca se ve fuera del plano: el borde del dibujo no se aleja del borde del recuadro. */
export function clampView({ s, tx, ty }: MapView): MapView {
  const scale = clamp(s, 1, MAX_ZOOM);
  return {
    s: scale,
    tx: clamp(tx, VB.x + VB.w - scale * (VB.x + VB.w), VB.x - scale * VB.x),
    ty: clamp(ty, VB.y + VB.h - scale * (VB.y + VB.h), VB.y - scale * VB.y),
  };
}

/** Cambia el zoom a `s` manteniendo quieto el punto de la pantalla `(fx, fy)` (el centro del pellizco, o el centro del recuadro). */
export function zoomAbout(view: MapView, s: number, fx: number, fy: number): MapView {
  const next = clamp(s, 1, MAX_ZOOM);
  const k = next / view.s;
  return clampView({ s: next, tx: fx - (fx - view.tx) * k, ty: fy - (fy - view.ty) * k });
}

/** Arrastra el plano `(dx, dy)` unidades del dibujo. */
export function panView(view: MapView, dx: number, dy: number): MapView {
  return clampView({ ...view, tx: view.tx + dx, ty: view.ty + dy });
}

export const isZoomed = (view: MapView) => view.s > 1.001;
export const sameView = (a: MapView, b: MapView) => Math.abs(a.s - b.s) < 1e-3 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;

/**
 * Píxeles de pantalla → unidades del dibujo, con `preserveAspectRatio="xMidYMid meet"`: el dibujo se centra y se escala por el lado
 * más justo, así que hay que restar el margen que queda a los lados.
 */
export function screenToMap(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  const scale = Math.min(rect.width / VB.w, rect.height / VB.h) || 1;
  const offsetX = (rect.width - VB.w * scale) / 2;
  const offsetY = (rect.height - VB.h * scale) / 2;
  return { x: VB.x + (clientX - rect.left - offsetX) / scale, y: VB.y + (clientY - rect.top - offsetY) / scale, unitsPerPx: 1 / scale };
}

/** Centro y separación de dos dedos. */
export function twoFingers(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}
