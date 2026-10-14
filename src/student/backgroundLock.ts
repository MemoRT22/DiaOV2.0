import { useEffect } from 'react';

const APP_ROOT = 'root';
let locks = 0;
let saved: { inert: boolean; hidden: string | null } | null = null;

/**
 * Bloqueo del fondo COMPARTIDO por todos los diálogos modales de la plataforma del alumno (aviso de ganador, invitación a la
 * encuesta…). Mientras haya al menos uno abierto, el resto de la aplicación no recibe foco ni lo leen los lectores de pantalla
 * (`inert` + `aria-hidden` en la raíz; los diálogos viven en portales fuera de ella). Se cuenta cuántos hay: el estado original de la
 * raíz se guarda al abrirse el PRIMERO y se restituye exactamente al cerrarse el ÚLTIMO, en cualquier orden. Sin esto, dos diálogos
 * que se solapan se guardarían mutuamente un estado «ya bloqueado» y la aplicación quedaría bloqueada para siempre.
 */
export function useBackgroundLocked(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.getElementById(APP_ROOT);
    if (locks === 0 && root) {
      saved = { inert: root.hasAttribute('inert'), hidden: root.getAttribute('aria-hidden') };
      root.setAttribute('inert', '');
      root.setAttribute('aria-hidden', 'true');
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks > 0 || !saved) return;
      const current = document.getElementById(APP_ROOT);
      if (current) {
        if (!saved.inert) current.removeAttribute('inert');
        if (saved.hidden === null) current.removeAttribute('aria-hidden'); else current.setAttribute('aria-hidden', saved.hidden);
      }
      saved = null;
    };
  }, [active]);
}

/** Para pruebas: cuántos diálogos tienen bloqueado el fondo. */
export const openModalCount = () => locks;
