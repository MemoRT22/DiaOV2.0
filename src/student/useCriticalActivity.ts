import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/** Rutas donde la persona está en medio de algo que no se interrumpe (escanear el QR / escribir el código de la sesión). */
const CRITICAL_ROUTES = ['/escanear'];
/** Cualquier diálogo modal abierto (confirmar una reservación, el aviso de ganador…): se espera a que se cierre. */
const MODAL = '[aria-modal="true"]:not([data-exit-survey-dialog])';
/** Tras terminar una actividad crítica se espera un poco antes de invitar: no se cruza con el momento en que se cerró. */
const SETTLE_MS = 2500;

/**
 * ¿La persona está en una actividad crítica (escaneando, confirmando una operación)? Mientras lo esté, no se le muestra ninguna
 * invitación automática. Mira la ruta y el DOM (diálogos modales) y se «asienta» unos segundos al terminar.
 */
export function useCriticalActivity(): boolean {
  const { pathname } = useLocation();
  const routeCritical = CRITICAL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const [modal, setModal] = useState(() => typeof document !== 'undefined' && !!document.querySelector(MODAL));
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    const check = () => setModal(!!document.querySelector(MODAL));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => observer.disconnect();
  }, []);

  const busy = routeCritical || modal;
  useEffect(() => {
    if (busy) { setSettling(true); return; }
    const timer = window.setTimeout(() => setSettling(false), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);

  return busy || settling;
}
