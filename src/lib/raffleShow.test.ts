import { describe, expect, test } from 'vitest';
import type { RaffleCategory, RafflePrize } from './raffleApi';
import { burstParticles, drawBlocker, isDefinitiveDrawError, pickDataSet, initialCategory, initialPrize, isDrawable, letterCount, nextTarget, orbitTokens, scrambleName, unitsLeft } from './raffleShow';

const category = (id: string, pool: number, over: Partial<RaffleCategory> = {}): RaffleCategory => ({
  id, name: id, sort_order: 0, rules: [{ total: 3 }], required_academic: 0, required_leadership: 0,
  is_active: true, is_demo: false, visual_config: {}, pool_count: pool, ...over,
});
const prize = (id: string, categoryId: string, available: number, over: Partial<RafflePrize> = {}): RafflePrize => ({
  id, category_id: categoryId, name: id, description: '', quantity: 3, is_active: true, sort_order: 0, delivered: 3 - available, available, ...over,
});

describe('drawBlocker', () => {
  const cat = category('un', 10);
  const p = prize('tablet', 'un', 2);
  test('nothing blocks a ready round', () => expect(drawBlocker(cat, [p], p, 10)).toBeNull());
  test('explains the first problem to fix', () => {
    expect(drawBlocker(undefined, [], undefined, 0)?.code).toBe('no-category');
    expect(drawBlocker(category('un', 10, { is_active: false }), [p], p, 10)?.code).toBe('inactive-category');
    expect(drawBlocker(cat, [], undefined, 10)?.code).toBe('no-prizes');
    expect(drawBlocker(cat, [p], undefined, 10)?.code).toBe('no-prize');
    expect(drawBlocker(cat, [prize('x', 'un', 1, { is_active: false })], prize('x', 'un', 1, { is_active: false }), 10)?.code).toBe('inactive-prize');
    expect(drawBlocker(cat, [prize('x', 'un', 0)], prize('x', 'un', 0), 10)?.code).toBe('exhausted');
    expect(drawBlocker(cat, [p], p, 0)?.code).toBe('empty-pool');
  });
});

describe('prize availability', () => {
  test('drawable needs an active prize with units left', () => {
    expect(isDrawable(prize('a', 'c', 1))).toBe(true);
    expect(isDrawable(prize('a', 'c', 0))).toBe(false);
    expect(isDrawable(prize('a', 'c', 2, { is_active: false }))).toBe(false);
  });
  test('units left ignore inactive prizes and never go negative', () => {
    expect(unitsLeft([prize('a', 'c', 2), prize('b', 'c', 3, { is_active: false }), prize('c', 'c', -1)])).toBe(2);
  });
});

describe('nextTarget', () => {
  const categories = [category('un', 5), category('ga', 5), category('ss', 0)];
  const prizes = {
    un: [prize('un-1', 'un', 0), prize('un-2', 'un', 2)],
    ga: [prize('ga-1', 'ga', 1)],
    ss: [prize('ss-1', 'ss', 4)],
  };
  test('stays on the same prize while it has units', () => {
    expect(nextTarget(categories, prizes, { categoryId: 'un', prizeId: 'un-2' })).toEqual({ categoryId: 'un', prizeId: 'un-2' });
  });
  test('moves to the next drawable prize of the category', () => {
    expect(nextTarget(categories, prizes, { categoryId: 'un', prizeId: 'un-1' })).toEqual({ categoryId: 'un', prizeId: 'un-2' });
  });
  test('moves to the next category once the current one has nothing left', () => {
    const spent = { ...prizes, un: [prize('un-1', 'un', 0), prize('un-2', 'un', 0)] };
    expect(nextTarget(categories, spent, { categoryId: 'un', prizeId: 'un-2' })).toEqual({ categoryId: 'ga', prizeId: 'ga-1' });
  });
  test('skips categories without participants and returns null when nothing is left', () => {
    const spent = { un: [prize('un-1', 'un', 0)], ga: [prize('ga-1', 'ga', 0)], ss: [prize('ss-1', 'ss', 4)] };
    expect(nextTarget(categories, spent, { categoryId: 'ga', prizeId: 'ga-1' })).toBeNull(); // ss has units but no pool
  });
  test('wraps around to categories listed before the current one', () => {
    const spent = { ...prizes, ga: [prize('ga-1', 'ga', 0)], ss: [] };
    expect(nextTarget(categories, spent, { categoryId: 'ga', prizeId: 'ga-1' })).toEqual({ categoryId: 'un', prizeId: 'un-2' });
  });
});

describe('where to start', () => {
  test('the first category that can be drawn, else the first listed', () => {
    const cats = [category('a', 0), category('b', 3), category('c', 3)];
    expect(initialCategory(cats, { a: [prize('p', 'a', 1)], b: [prize('q', 'b', 0)], c: [prize('r', 'c', 1)] })).toBe('c');
    expect(initialCategory(cats, {})).toBe('a');
    expect(initialCategory([], {})).toBe('');
  });
  test('a prize with a pending winner wins over the first one with units', () => {
    const list = [prize('a', 'c', 2), prize('b', 'c', 0)];
    expect(initialPrize(list, { b: true })).toBe('b');
    expect(initialPrize(list, {})).toBe('a');
    expect(initialPrize([prize('z', 'c', 0)], {})).toBe('z');
    expect(initialPrize([], {})).toBe('');
  });
});

describe('scrambleName', () => {
  const name = 'Ana María López';
  test('settles from the left and keeps spaces', () => {
    expect(scrambleName(name, letterCount(name), 3)).toBe(name);
    const partial = scrambleName(name, 3, 5);
    expect(partial.startsWith('Ana')).toBe(true);
    expect(partial[3]).toBe(' ');
    expect(partial).not.toBe(name);
    expect(partial).toHaveLength(name.length);
  });
  test('changes between ticks until it settles and is deterministic', () => {
    expect(scrambleName(name, 0, 1)).not.toBe(scrambleName(name, 0, 2));
    expect(scrambleName(name, 2, 4)).toBe(scrambleName(name, 2, 4));
  });
  test('counts letters only', () => expect(letterCount('Ana María')).toBe(8));
});

describe('visual helpers', () => {
  test('orbit tokens grow with the pool within sensible bounds and add up', () => {
    for (const pool of [0, 5, 20, 54, 400]) {
      const rings = orbitTokens(pool);
      expect(rings.reduce((a, b) => a + b, 0)).toBe(Math.min(54, Math.max(12, pool)));
      expect(rings.every((n) => n > 0)).toBe(true);
    }
  });
  test('burst particles are fixed for a given count', () => {
    expect(burstParticles(12)).toEqual(burstParticles(12));
    expect(burstParticles(12)).toHaveLength(12);
  });
});

describe('uncertainty and server refusals', () => {
  const cat = category('un', 10);
  const p = prize('tablet', 'un', 2);
  test('a prize that could not be checked for a pending winner cannot be drawn, even when it shows no units', () => {
    expect(drawBlocker(cat, [p], p, 10, { unverified: true })?.code).toBe('unverified');
    const spent = prize('tablet', 'un', 0);
    expect(drawBlocker(cat, [spent], spent, 10, { unverified: true })?.code).toBe('unverified');
    expect(drawBlocker(cat, [p], p, 10, { unverified: false })).toBeNull();
  });
  test('after POOL_EMPTY the same round is not offered again while the aggregate still shows candidates', () => {
    expect(drawBlocker(cat, [p], p, 10, { serverEmpty: true })?.code).toBe('server-empty');
  });
  test('only refusals that settle the matter are definitive; connection problems are not', () => {
    for (const code of ['POOL_EMPTY', 'PRIZE_EXHAUSTED', 'PRIZE_INACTIVE', 'CATEGORY_INACTIVE', 'NOT_AUTHORIZED', 'NOT_FOUND', 'PENDING_SELECTION']) expect(isDefinitiveDrawError(code)).toBe(true);
    for (const code of ['', 'NETWORK', 'Failed to fetch', 'upstream request timeout', 'JWT expired', 'AbortError']) expect(isDefinitiveDrawError(code)).toBe(false);
  });
});

describe('pickDataSet: which set of server records the raffle uses', () => {
  const cat = (is_demo: boolean, pool_count: number, name = 'Universo') => ({ is_demo, pool_count, name });
  const pick = (rehearsal: boolean, canConfigure: boolean, categories: ReturnType<typeof cat>[]) => pickDataSet({ rehearsal, canConfigure, categories });

  test('official operation uses the real records', () => {
    expect(pick(false, true, [cat(false, 5), cat(true, 9)])).toBe('real');
    expect(pick(false, false, [cat(false, 0), cat(true, 9)])).toBe('real');
  });
  test('raffle staff in a rehearsal can only use what the server allows them: the test records', () => {
    expect(pick(true, false, [cat(false, 50), cat(true, 0)])).toBe('demo');
  });
  test('Coordinación in a rehearsal uses the set that holds the rehearsal participants', () => {
    expect(pick(true, true, [cat(false, 40), cat(true, 0)])).toBe('real');
    expect(pick(true, true, [cat(false, 0), cat(true, 7)])).toBe('demo');
  });
  test('with candidates in both, or in neither, it prefers the rehearsal set when it exists and falls back to the other one', () => {
    expect(pick(true, true, [cat(false, 40), cat(true, 7)])).toBe('demo');
    expect(pick(true, true, [cat(false, 0), cat(true, 0)])).toBe('demo');
    expect(pick(true, true, [cat(false, 0)])).toBe('real');
    expect(pick(true, true, [])).toBe('demo');
  });
});
