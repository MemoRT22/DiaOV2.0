import { useEffect, useRef } from 'react';

/** Marca, en `history.state`, la entrada de historial que representa «hay una hoja abierta». */
const MARK = '__sheet';

const current = () => {
  try { return window.history.state as Record<string, unknown> | null; } catch { return null; }
};

/** ¿La entrada de historial actual es la de una hoja abierta? (para saber si salir de ella debe REEMPLAZAR esa entrada) */
export const sheetEntryActive = () => !!current()?.[MARK];

let pendingPop: ReturnType<typeof setTimeout> | null = null;
/** Mientras se retira una entrada (`history.back()` es asíncrono) otra hoja que se abra espera a que termine, para no tomarla por suya. */
let popping: Promise<void> | null = null;
let counter = 0;

function popEntry() {
  popping = new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener('popstate', done);
      clearTimeout(guard);
      popping = null;
      resolve();
    };
    const guard = setTimeout(done, 1000); // sin popstate (sin historial previo): no se queda esperando
    window.addEventListener('popstate', done);
  });
  window.history.back();
}

/**
 * Una hoja o modal abierto es un «lugar» al que el botón Atrás del navegador debe poder volver: al abrirse agrega UNA entrada al
 * historial (misma URL) y Atrás la quita, cerrando la hoja en lugar de sacar a la persona de la pantalla.
 *
 * - Atrás con la hoja abierta → `onBack()` (la hoja se cierra y la pantalla de debajo se queda como estaba).
 * - Si `onBack` devuelve `false` (p. ej. hay una reservación en curso y no se puede cerrar) la entrada se restituye y la hoja sigue.
 * - Si la hoja se cierra por sus propios botones, la entrada que agregó se retira (`history.back()`), salvo que ya se haya
 *   salido de ella (un reemplazo con `sheetEntryActive()`): entonces no hay nada que retirar.
 * - Se reutiliza la entrada si ya existe (React StrictMode monta, desmonta y vuelve a montar; la hoja de confirmación pasa de «pregunta» a
 *   «éxito») y el retiro se difiere un instante para no chocar con ese segundo montaje. Una hoja que se abre mientras otra todavía
 *   retira su entrada espera a que termine.
 * La entrada conserva el estado del enrutador (`idx`, `key`, `usr`), así que React Router no ve ningún cambio de pantalla.
 */
export function useDismissOnBack(onBack: () => boolean | void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    let detach: (() => void) | undefined;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (pendingPop) { clearTimeout(pendingPop); pendingPop = null; }
      let owner = current()?.[MARK] as string | undefined;
      if (!owner) {
        owner = `s${++counter}`;
        try { window.history.pushState({ ...(current() ?? {}), [MARK]: owner }, ''); } catch { return; }
      }
      const mine = owner;
      const onPop = () => {
        if (current()?.[MARK] === mine) return; // sigue en la entrada de la hoja
        if (latest.current() === false) {
          try { window.history.pushState({ ...(current() ?? {}), [MARK]: mine }, ''); } catch { /* sin historial: la hoja sigue abierta */ }
        }
      };
      window.addEventListener('popstate', onPop);
      detach = () => {
        window.removeEventListener('popstate', onPop);
        if (current()?.[MARK] !== mine) return; // ya se salió de la entrada (Atrás o un reemplazo): nada que retirar
        pendingPop = setTimeout(() => {
          pendingPop = null;
          if (current()?.[MARK] === mine) popEntry();
        }, 0);
      };
    };
    if (popping) void popping.then(attach); else attach();
    return () => { cancelled = true; detach?.(); };
  }, []);
}
