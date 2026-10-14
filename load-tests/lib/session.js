import exec from 'k6/execution';
import { sleep } from 'k6';
import { ENV } from './env.js';
import { ensureFresh, login } from './supabase.js';
import { userFor, userForGlobalVu } from './data.js';

// Sesión de la persona que representa ESTE usuario virtual. Se conserva entre iteraciones (como un navegador con la sesión abierta)
// y se renueva con el refresh_token antes de vencer.
let current = null;

/**
 * Sesión del VU. `slice` reparte el padrón entre escenarios: { base, size }. Cada VU es una persona distinta.
 * Si el inicio de sesión falla (p. ej. 429 agotado) devuelve null y espera: una persona real tampoco machaca el botón.
 */
export function studentSession(slice, globalUnique = false) {
  const index = exec.vu.idInTest - 1;
  const user = globalUnique ? userForGlobalVu(exec.vu.idInTest) : userFor(index, slice);
  if (current && current.email === user.email) {
    current = ensureFresh(current);
    return current;
  }
  const result = login(user);
  if (!result.ok) { sleep(5 + Math.random() * 10); return null; }
  current = { ...result, userIndex: user.index };
  return current;
}

export const readOnly = () => !ENV.writes;
