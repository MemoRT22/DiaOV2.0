import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const STORAGE_KEY = 'diaov-scroll';
const MAX_ENTRIES = 60;
/** Cuánto se espera a que la pantalla de destino tenga contenido suficiente para volver al punto guardado. */
export const RESTORE_TIMEOUT_MS = 4000;

const read = (): Record<string, number> => {
  try { return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
};
const write = (all: Record<string, number>) => {
  try {
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k];
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* sin almacenamiento: solo se pierde la restauración */ }
};

/**
 * Posición de scroll de la aplicación del alumno, como la esperaría quien usa una app:
 * - entrar a otra pantalla (PUSH a otra ruta) empieza arriba;
 * - volver (Atrás) deja la pantalla donde estaba, aunque el contenido tarde en cargar (el catálogo se pide de nuevo): se reintenta hasta que
 *   haya altura suficiente, y se cancela en cuanto la persona toca o desplaza;
 * - cambiar solo filtros o búsqueda (misma ruta) no mueve nada.
 * El navegador no puede hacerlo solo: la lista aparece DESPUÉS de cargar y `BrowserRouter` no restaura el scroll.
 */
export default function ScrollManager() {
  const location = useLocation();
  const type = useNavigationType();
  const keyRef = useRef(location.key);
  keyRef.current = location.key; // se actualiza al RENDERIZAR: el scroll que provoca el cambio de contenido ya cae en la clave nueva
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  // Guardar mientras la persona se desplaza.
  useEffect(() => {
    let frame = 0;
    const save = () => {
      frame = 0;
      const all = read();
      all[keyRef.current] = Math.round(window.scrollY);
      write(all);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(save); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);

  // Colocar al cambiar de pantalla.
  useEffect(() => {
    const samePath = previousPath.current === location.pathname;
    previousPath.current = location.pathname;
    if (location.hash) return; // las anclas (#horarios, #premio) las resuelve su propia pantalla
    if (type === 'POP') {
      const target = read()[location.key];
      if (!target) return;
      let frame = 0;
      let cancelled = false;
      const startedAt = performance.now();
      let reachedAt = 0;
      const stop = () => { cancelled = true; };
      const events = ['touchstart', 'wheel', 'keydown', 'mousedown'] as const;
      events.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
      const tick = () => {
        if (cancelled) return;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        if (room >= target - 1) {
          if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
          reachedAt ||= performance.now();
          if (performance.now() - reachedAt > 400) return; // estable: listo
        }
        if (performance.now() - startedAt < RESTORE_TIMEOUT_MS) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => { cancelled = true; if (frame) cancelAnimationFrame(frame); events.forEach((name) => window.removeEventListener(name, stop)); };
    }
    if (type === 'PUSH' && !samePath) {
      try { window.scrollTo(0, 0); } catch { /* jsdom */ }
    }
    return undefined;
  }, [location.key, location.pathname, location.hash, type]);

  return null;
}
