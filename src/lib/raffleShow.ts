import type { RaffleCategory, RafflePrize, WinnerStatus } from './raffleApi';

/**
 * Pure rules of the draw screen. The server decides who is eligible and who wins; everything here only decides what
 * the operator may press next and how it is explained.
 */

export const WINNER_STATUS: Record<WinnerStatus, { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' }> = {
  seleccionado: { label: 'Pendiente de confirmar', tone: 'warning' },
  confirmado: { label: 'Confirmado', tone: 'success' },
  no_presentado: { label: 'No se presentó', tone: 'neutral' },
  invalidado: { label: 'Invalidado', tone: 'error' },
};

export type RaffleScope = 'real' | 'demo';
export const scopeOf = (category: Pick<RaffleCategory, 'is_demo'>): RaffleScope => (category.is_demo ? 'demo' : 'real');

/** A prize can be drawn while it is active and has units left (pending selections already count as taken). */
export const isDrawable = (prize: Pick<RafflePrize, 'is_active' | 'available'>) => prize.is_active && prize.available > 0;

/** Units still to hand out across the active prizes of a category. */
export const unitsLeft = (prizes: RafflePrize[]) => prizes.filter((prize) => prize.is_active).reduce((sum, prize) => sum + Math.max(0, prize.available), 0);

export type Blocker = { code: 'no-category' | 'inactive-category' | 'no-prizes' | 'no-prize' | 'inactive-prize' | 'unverified' | 'server-empty' | 'exhausted' | 'empty-pool'; message: string };

/** Things the screen knows that the aggregate numbers do not. */
export type DrawFlags = {
  /** The server could not be asked whether this prize already has a winner waiting: drawing could duplicate it. */
  unverified?: boolean;
  /** The server answered POOL_EMPTY for this prize with the figures currently on screen. */
  serverEmpty?: boolean;
};

/**
 * Answers of `draw_winner` that settle the matter: the server understood the request and refused it, so nothing was
 * chosen. Anything else (network, timeout, 5xx, an unknown message) leaves open whether a winner was recorded.
 */
const DEFINITIVE_DRAW_ERRORS = new Set(['POOL_EMPTY', 'PRIZE_EXHAUSTED', 'PRIZE_INACTIVE', 'CATEGORY_INACTIVE', 'NOT_AUTHORIZED', 'NOT_FOUND', 'PENDING_SELECTION']);
export const isDefinitiveDrawError = (code: string) => DEFINITIVE_DRAW_ERRORS.has(code);

export const SERVER_EMPTY_MESSAGE = 'El servidor no encontró participantes disponibles para esta ronda, aunque el conteo de la categoría todavía muestre candidatos (ese conteo no descuenta a quien ya tiene una selección pendiente ni al último «no se presentó» de este premio). Elige otro premio o categoría, o actualiza los datos.';

/** Why the draw cannot start, or null. Order matters: the first problem is the one the operator must fix. */
export function drawBlocker(category: RaffleCategory | undefined, prizes: RafflePrize[], prize: RafflePrize | undefined, poolCount: number, flags: DrawFlags = {}): Blocker | null {
  if (!category) return { code: 'no-category', message: 'Elige una categoría para empezar.' };
  if (!category.is_active) return { code: 'inactive-category', message: 'Esta categoría está inactiva y no puede sortearse.' };
  if (prizes.length === 0) return { code: 'no-prizes', message: 'Esta categoría todavía no tiene premios.' };
  if (!prize) return { code: 'no-prize', message: 'Elige el premio que vas a sortear.' };
  if (!prize.is_active) return { code: 'inactive-prize', message: 'Este premio está inactivo y no puede sortearse.' };
  if (flags.unverified) return { code: 'unverified', message: 'No pudimos comprobar si este premio ya tiene un ganador pendiente. Reintenta la comprobación antes de sortear para no duplicar la selección.' };
  if (prize.available <= 0) return { code: 'exhausted', message: 'Este premio está agotado: ya no quedan unidades.' };
  if (flags.serverEmpty) return { code: 'server-empty', message: SERVER_EMPTY_MESSAGE };
  if (poolCount <= 0) return { code: 'empty-pool', message: 'No hay participantes elegibles en esta categoría.' };
  return null;
}

export type Target = { categoryId: string; prizeId: string };

/**
 * Where the next round goes: the same prize while it has units, then the next drawable prize of the category, then
 * the next category (in the order shown) that still has something to draw. Null when nothing is left to give away.
 */
export function nextTarget(categories: RaffleCategory[], prizesByCategory: Record<string, RafflePrize[]>, current: Partial<Target>): Target | null {
  const drawable = (category: RaffleCategory) => category.is_active && (category.pool_count ?? 0) > 0;
  const firstIn = (category: RaffleCategory, from?: string): Target | null => {
    const prizes = prizesByCategory[category.id] ?? [];
    const start = from ? Math.max(0, prizes.findIndex((prize) => prize.id === from)) : 0;
    const ordered = [...prizes.slice(start), ...prizes.slice(0, start)];
    const found = ordered.find(isDrawable);
    return found ? { categoryId: category.id, prizeId: found.id } : null;
  };
  const index = categories.findIndex((category) => category.id === current.categoryId);
  const here = index >= 0 ? categories[index] : undefined;
  if (here && drawable(here)) {
    const same = firstIn(here, current.prizeId);
    if (same) return same;
  }
  const ordered = index >= 0 ? [...categories.slice(index + 1), ...categories.slice(0, index)] : categories;
  for (const category of ordered) {
    if (!drawable(category)) continue;
    const found = firstIn(category);
    if (found) return found;
  }
  return null;
}

/** The category to start on: the first one that can actually be drawn, otherwise the first one listed. */
export function initialCategory(categories: RaffleCategory[], prizesByCategory: Record<string, RafflePrize[]>): string {
  const ready = categories.find((category) => category.is_active && (category.pool_count ?? 0) > 0 && (prizesByCategory[category.id] ?? []).some(isDrawable));
  return (ready ?? categories[0])?.id ?? '';
}

/** The prize to start on within a category: one with a pending winner, else the first with units, else the first. */
export function initialPrize(prizes: RafflePrize[], pending: Record<string, boolean>): string {
  return (prizes.find((prize) => pending[prize.id]) ?? prizes.find(isDrawable) ?? prizes[0])?.id ?? '';
}

/** Timeline of a draw on screen: the pool spins, then the winner's name settles letter by letter. */
export const SPIN_MS = 4200;
export const REVEAL_MS = 1700;

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type NamePart = { char: string; /** the glyph shown while this letter is still changing, or null once it is final */ glyph: string | null };

/**
 * A name that settles letter by letter: the first `settled` letters are final, the rest still change on every tick.
 * Spaces and punctuation never change. Each part keeps its final character so the layout can be fixed by the real
 * name while the glyphs spin on top of it. Deterministic.
 */
export function scrambleParts(name: string, settled: number, tick: number): NamePart[] {
  let letters = 0;
  return Array.from(name).map((char, position) => {
    if (!/\p{L}/u.test(char)) return { char, glyph: null };
    const keep = letters < settled;
    letters += 1;
    return { char, glyph: keep ? null : GLYPHS[(tick * 7 + position * 13) % GLYPHS.length] };
  });
}

export const scrambleName = (name: string, settled: number, tick: number) => scrambleParts(name, settled, tick).map((part) => part.glyph ?? part.char).join('');

export const letterCount = (name: string) => Array.from(name).filter((char) => /\p{L}/u.test(char)).length;

/** Particles of the reveal burst: fixed, so the same draw always looks the same and tests are stable. */
export function burstParticles(count: number): { dx: number; dy: number; rotate: number; delay: number; tone: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 137.508 * (Math.PI / 180);
    const reach = 18 + (index % 5) * 9;
    return {
      dx: Math.round(Math.cos(angle) * reach * 10) / 10,
      dy: Math.round(Math.sin(angle) * reach * 10) / 10,
      rotate: (index * 53) % 360,
      delay: (index % 6) * 40,
      tone: index % 4,
    };
  });
}

/** Points of the orbits: tokens per ring, so the projection shows a crowd that grows with the pool. */
export function orbitTokens(pool: number): number[] {
  const total = Math.min(54, Math.max(12, Math.round(pool)));
  const inner = Math.round(total / 6);
  const middle = Math.round(total / 3);
  return [inner, middle, total - inner - middle];
}
