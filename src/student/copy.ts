/**
 * Student-facing naming convention (single source of truth).
 *
 * A «Misión» IS a workshop (taller) of Día OV. The student only ever reads «misión/misiones»; the word «taller» appears
 * once, as the descriptor that explains it («Misiones · Talleres de Día OV»), so nobody wonders whether they are two
 * different things. The wayfinding nouns (Inicio, Misiones, Escanear, Mi ruta, Bitácora) are fixed here on purpose:
 * they label navigation and primary actions, so a configurable theme text can never rename one screen and leave
 * another behind. The published theme keeps its narrative voice (ranks, stamps, guide, greetings, intros).
 */
export const MISSION = {
  one: 'Misión',
  many: 'Misiones',
  /** The one place where «taller» is said out loud: what a mission is. */
  descriptor: 'Talleres de Día OV',
} as const;

export const NAV = {
  home: 'Inicio',
  missions: MISSION.many,
  scan: 'Escanear',
  route: 'Mi ruta',
  /** «Bitácora de Explorador»: the student's logbook of stamps and ranks (route `/pasaporte`, kept for compatibility). */
  passport: 'Bitácora',
} as const;

export const LOGBOOK = { short: 'Bitácora', full: 'Bitácora de Explorador', mine: 'mi bitácora', yours: 'tu bitácora' } as const;

/** Primary call to action to register attendance; matches the «Escanear» tab so the student connects both. */
export const SCAN_CTA = 'Escanear asistencia';

/** «1 misión» / «3 misiones». */
export const missions = (n: number) => `${n} ${n === 1 ? 'misión' : 'misiones'}`;
