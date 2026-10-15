export const FULL_DAY_SHARES = Object.freeze({
  navigation: 0.55,
  reservations_contention: 0.10,
  reservations_steady: 0.15,
  checkin: 0.08,
  survey: 0.06,
  realtime: 0.06,
});

export const AUTH_PLANS = Object.freeze({
  smoke: { users: 6, windowSeconds: 30 },
  baseline: { users: 100, windowSeconds: 300 },
  normal: { users: 2000, windowSeconds: 1200 },
  stress: { users: 2000, windowSeconds: 300 },
  peak2000: { users: 2000, windowSeconds: 120 },
  spike: { users: 2000, windowSeconds: 60 },
  soak: { users: 2000, windowSeconds: 3600 },
});

export function scaledUsers(users, scale = 1, maxVus = 2000) {
  return Math.max(1, Math.min(maxVus, Math.round(users * scale)));
}

export function authPlan(profile, scale = 1, maxVus = 2000) {
  const source = AUTH_PLANS[profile];
  if (!source) throw new Error(`Perfil Auth desconocido: ${profile}`);
  return { ...source, users: scaledUsers(source.users, scale, maxVus) };
}

/** Una iteración por persona, distribuida de forma uniforme dentro de la ventana. */
export function arrivalDelayMs(index, plan) {
  if (!Number.isInteger(index) || index < 0 || index >= plan.users) throw new Error(`Índice de llegada fuera de rango: ${index}`);
  return plan.users === 1 ? 0 : Math.floor((index / (plan.users - 1)) * plan.windowSeconds * 1000);
}

/** Reparto por mayor residuo. Smoke garantiza una persona en cada flujo crítico. */
export function allocateFullDay(total, profile) {
  const keys = Object.keys(FULL_DAY_SHARES);
  if (total === 0) return Object.fromEntries(keys.map((key) => [key, 0]));
  // A escalas diminutas el mínimo operativo sigue siendo seis: una persona por flujo. Nunca reportamos un flujo con 0 VU.
  if (profile === 'smoke' || total < keys.length) return Object.fromEntries(keys.map((key) => [key, 1]));
  const exact = keys.map((key) => ({ key, exact: total * FULL_DAY_SHARES[key] }));
  const result = Object.fromEntries(exact.map(({ key, exact: value }) => [key, Math.floor(value)]));
  let remaining = total - Object.values(result).reduce((sum, value) => sum + value, 0);
  exact.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; i < remaining; i += 1) result[exact[i].key] += 1;
  return result;
}

export function accountIndexForGlobalVu(vuId, availableUsers) {
  const index = vuId - 1;
  if (!Number.isInteger(vuId) || index < 0 || index >= availableUsers) {
    throw new Error(`VU global ${vuId} no tiene una identidad exclusiva en un padrón de ${availableUsers}`);
  }
  return index;
}

export function assertDisjointCohorts(cohorts, totalUsers) {
  const occupied = new Set();
  for (const [name, range] of Object.entries(cohorts)) {
    if (!Number.isInteger(range.base) || !Number.isInteger(range.size) || range.base < 0 || range.size < 1 || range.base + range.size > totalUsers) {
      throw new Error(`Cohorte inválida ${name}`);
    }
    for (let i = range.base; i < range.base + range.size; i += 1) {
      if (occupied.has(i)) throw new Error(`Las cohortes se superponen en la identidad ${i}`);
      occupied.add(i);
    }
  }
  if (occupied.size !== totalUsers) throw new Error(`Las cohortes cubren ${occupied.size} de ${totalUsers} identidades`);
  return true;
}
