import { useCallback, useRef } from 'react';

export type AnchorEdge = 'top' | 'bottom';

/** Below this the page is not pinch-zoomed (browsers report fractional scales while settling). */
export const ZOOM_EPSILON = 1.02;

type VisualViewportLike = Pick<VisualViewport, 'scale' | 'pageLeft' | 'pageTop' | 'height'>;
/** Where the element sits WITHOUT our transform, in client coordinates (what `getBoundingClientRect` returns). */
type Rect = { left: number; top: number; bottom: number };

/**
 * `position: fixed` / `sticky` elements are anchored to the LAYOUT viewport. When the person pinch-zooms, the screen only shows a
 * smaller part of it (the VISUAL viewport), so a bar anchored to the layout viewport slides out of sight and stays unreachable until
 * they zoom out. The zoom itself must stay available (accessibility), so instead of preventing it the bar follows what is visible:
 * it is moved to the corner of the visible area and counter-scaled by 1/zoom, which keeps its size on screen unchanged.
 *
 * It starts from where the browser itself puts the bar (`natural`, measured without the transform) instead of assuming how
 * `innerHeight` behaves: Chrome keeps it at the layout size while Safari shrinks it with the zoom.
 * Returns the CSS `transform` (to be applied with `transform-origin` at the bar's top-left or bottom-left corner), or `null` when
 * nothing has to change (not zoomed).
 */
export function anchorTransform(vv: VisualViewportLike, natural: Rect, edge: AnchorEdge, scroll: { x: number; y: number } = { x: 0, y: 0 }): string | null {
  if (vv.scale <= ZOOM_EPSILON) return null;
  // The visible area in the SAME coordinates as `getBoundingClientRect` (page position minus scroll). `visualViewport.offsetLeft/Top` are
  // not reliable for this: Safari reports them as page coordinates, Chrome as client ones.
  const left = vv.pageLeft - scroll.x;
  const top = vv.pageTop - scroll.y;
  const dx = left - natural.left;
  const dy = edge === 'bottom' ? top + vv.height - natural.bottom : top - natural.top;
  return `translate(${dx}px, ${dy}px) scale(${1 / vv.scale})`;
}

/**
 * Keeps a fixed/sticky bar reachable while the page is pinch-zoomed (see `anchorTransform`). Outside zoom it does nothing at all: the
 * element keeps its plain CSS positioning, so there is no extra work, no transform and no layer. Updates are written straight to the
 * element (no React state) and coalesced into one per animation frame.
 *
 * Returns a callback ref: the bar may be rendered only after the app is ready, so the listeners follow the element, not the component.
 */
export function useVisualViewportAnchor<T extends HTMLElement>(edge: AnchorEdge): (element: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!el || !vv) return;
    let frame = 0;
    let applied = false;
    const reset = () => {
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.style.willChange = '';
      applied = false;
    };
    const apply = () => {
      frame = 0;
      if (vv.scale <= ZOOM_EPSILON) {
        if (applied) reset();
        return;
      }
      // measure where the browser puts the bar on its own (no transform), then write the new one: both in the same task, so nothing paints in between
      el.style.transform = '';
      const natural = el.getBoundingClientRect();
      const transform = anchorTransform(vv, natural, edge, { x: window.scrollX, y: window.scrollY });
      if (!transform) { if (applied) reset(); return; }
      if (!applied) {
        el.style.transformOrigin = edge === 'bottom' ? '0 100%' : '0 0';
        el.style.willChange = 'transform';
        applied = true;
      }
      el.style.transform = transform;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    schedule();
    cleanup.current = () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      reset();
    };
  }, [edge]);
  return ref;
}
