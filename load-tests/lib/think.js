import { sleep } from 'k6';
import { ENV } from './env.js';

/** Espera realista entre acciones de una persona (segundos, uniforme en [min, max]), escalable con THINK_SCALE (0 = sin esperas). */
export const think = (min, max) => { const seconds = (min + Math.random() * (max - min)) * ENV.thinkScale; if (seconds > 0) sleep(seconds); };
export const pick = (items) => items[Math.floor(Math.random() * items.length)];
export const chance = (probability) => Math.random() < probability;
/** Elige una clave según pesos: weighted({ a: 3, b: 1 }) → «a» el 75 % de las veces. */
export function weighted(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let point = Math.random() * total;
  for (const [key, weight] of entries) { point -= weight; if (point <= 0) return key; }
  return entries[entries.length - 1][0];
}
