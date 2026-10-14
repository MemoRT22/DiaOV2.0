import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useBackgroundLocked } from './backgroundLock';

/**
 * Comportamiento de un diálogo modal accesible: mientras está abierto el resto de la aplicación no recibe foco ni lo leen los
 * lectores de pantalla (bloqueo compartido con los demás diálogos: `backgroundLock.ts`), el foco entra al botón
 * principal, Tab gira dentro y, al cerrarse, regresa a donde estaba la persona. Escape cierra.
 */
export function useModalDialog(open: boolean, panel: RefObject<HTMLElement | null>, primary: RefObject<HTMLElement | null>, onClose: () => void) {
  const returnFocus = useRef<HTMLElement | null>(null);

  useBackgroundLocked(open);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    primary.current?.focus();
    return () => {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target && document.contains(target)) target.focus();
    };
  }, [open, primary]);

  // Si el foco llegara a escapar (clic fuera en un navegador sin `inert`), vuelve al diálogo. Si el foco entra a OTRO diálogo modal
  // (el aviso de ganador, una confirmación) no se le disputa: dos trampas de foco a la vez se pelearían indefinidamente.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!panel.current || !(target instanceof Node) || panel.current.contains(target)) return;
      if (target instanceof Element && target.closest('[aria-modal="true"]')) return;
      primary.current?.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open, panel, primary]);

  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.current.contains(active)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
}
