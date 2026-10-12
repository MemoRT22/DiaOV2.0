import { describe, expect, it } from 'vitest';
import { describeRule, describeRules, missingFor, nextTierHint, normalizeRaffleStatus, rulesMet, tierFor, type RaffleTier } from './raffleRules';

/** The official Día OV 2026 categories, exactly as the backend stores them. */
const OFFICIAL: RaffleTier[] = [
  { id: 'ss', name: 'Sistema Solar', sort_order: 10, rules: [{ academic: 1, university_life: 1 }] },
  { id: 'ga', name: 'Galaxia', sort_order: 20, rules: [{ academic: 2, university_life: 1 }, { total: 4 }] },
  { id: 'un', name: 'Universo', sort_order: 30, rules: [{ academic: 3, university_life: 1 }, { academic: 2, university_life: 2 }] },
];

const tierName = (academic: number, university_life: number) => tierFor(OFFICIAL, { academic, university_life })?.name ?? null;

describe('official raffle classification (mirror of the backend rules)', () => {
  it.each([
    [1, 0, null],
    [1, 1, 'Sistema Solar'],
    [1, 2, 'Sistema Solar'],
    [2, 1, 'Galaxia'],
    [2, 2, 'Universo'],
    [3, 1, 'Universo'],
    [4, 0, 'Galaxia'],
    [0, 4, 'Galaxia'],
    [3, 0, null],
    [1, 3, 'Galaxia'],
    [0, 0, null],
    [2, 0, null],
    [0, 3, null],
    [4, 1, 'Universo'],
    [5, 0, 'Galaxia'],
    [3, 3, 'Universo'],
  ])('%i académicos + %i de Vida Universitaria → %s', (academic, universityLife, expected) => {
    expect(tierName(academic, universityLife)).toBe(expected);
  });

  it('assigns only the highest category reached, whatever the order of the list', () => {
    expect(tierFor([...OFFICIAL].reverse(), { academic: 3, university_life: 1 })?.name).toBe('Universo');
    expect(rulesMet(OFFICIAL[0].rules, { academic: 3, university_life: 1 })).toBe(true);
  });

  it('a category without alternatives is never reached', () => {
    expect(tierFor([{ id: 'x', name: 'Vacía', sort_order: 99, rules: [] }], { academic: 9, university_life: 9 })).toBeNull();
  });
});

describe('describing the rules', () => {
  it('names each kind of stamp and the total', () => {
    expect(describeRule({ academic: 3, university_life: 1 })).toBe('3 académicos + 1 de Vida Universitaria');
    expect(describeRule({ academic: 1, university_life: 1 })).toBe('1 académico + 1 de Vida Universitaria');
    expect(describeRule({ total: 4 })).toBe('4 sellos en total');
    expect(describeRule({ academic: 2, total: 5 })).toBe('2 académicos (5 sellos en total)');
    expect(describeRule({ academic: 2, university_life: 0, total: 2 })).toBe('2 académicos');
    expect(describeRule({})).toBe('Sin requisito');
  });

  it('joins the alternatives with «o»', () => {
    expect(describeRules(OFFICIAL[1].rules)).toBe('2 académicos + 1 de Vida Universitaria, o 4 sellos en total');
    expect(describeRules(OFFICIAL[2].rules)).toBe('3 académicos + 1 de Vida Universitaria, o 2 académicos + 2 de Vida Universitaria');
  });
});

describe('what is missing for the next category', () => {
  const hint = (academic: number, universityLife: number) =>
    nextTierHint({ academic_stamps: academic, university_life_stamps: universityLife, categories: OFFICIAL })?.text ?? null;

  it('counts the fewest extra stamps of each kind', () => {
    expect(missingFor({ academic: 3, university_life: 1 }, { academic: 1, university_life: 0 })).toEqual({ academic: 2, university_life: 1, any: 0, cost: 3 });
    expect(missingFor({ total: 4 }, { academic: 1, university_life: 2 })).toEqual({ academic: 0, university_life: 0, any: 1, cost: 1 });
    expect(missingFor({ academic: 2, university_life: 1 }, { academic: 2, university_life: 1 }).cost).toBe(0);
  });

  it('points at the closest step up', () => {
    expect(hint(0, 0)).toBe('Te faltan 1 sello académico y 1 de Vida Universitaria para Sistema Solar.');
    expect(hint(1, 0)).toBe('Te falta 1 sello de Vida Universitaria para Sistema Solar.');
    expect(hint(1, 1)).toBe('Te falta 1 sello académico para Galaxia.');
    expect(hint(4, 0)).toBe('Te falta 1 sello de Vida Universitaria para Universo.');
    expect(hint(0, 4)).toBe('Te faltan 2 sellos académicos para Universo.');
  });

  it('on a tie prefers the highest category that the same stamps unlock', () => {
    // 3 académicos: one Vida Universitaria stamp unlocks Sistema Solar, Galaxia AND Universo — the student gets Universo.
    expect(hint(3, 0)).toBe('Te falta 1 sello de Vida Universitaria para Universo.');
  });

  it('offers both alternatives when they cost the same', () => {
    expect(hint(2, 1)).toBe('Te falta 1 sello académico o 1 sello de Vida Universitaria para Universo.');
  });

  it('has nothing to suggest at the top', () => {
    expect(hint(3, 1)).toBeNull();
    expect(hint(2, 2)).toBeNull();
  });
});

describe('normalizing the status payload', () => {
  it('reads the current payload', () => {
    const status = normalizeRaffleStatus({
      academic_stamps: 2, university_life_stamps: 1, total_stamps: 3, raffle_category: 'ga', raffle_category_name: 'Galaxia',
      has_won: false, categories: [OFFICIAL[2], OFFICIAL[0], OFFICIAL[1]],
    });
    expect(status).toMatchObject({ academic_stamps: 2, university_life_stamps: 1, total_stamps: 3, raffle_category_name: 'Galaxia', has_won: false });
    expect(status.categories.map((c) => c.name)).toEqual(['Sistema Solar', 'Galaxia', 'Universo']);
  });

  it('still understands the previous payload (tickets, no categories)', () => {
    expect(normalizeRaffleStatus({ academic_tickets: 3, leadership_tickets: 1, raffle_category_name: null, has_won: false })).toEqual({
      academic_stamps: 3, university_life_stamps: 1, total_stamps: 4, raffle_category: null, raffle_category_name: null, has_won: false, categories: [],
    });
    expect(normalizeRaffleStatus(null).total_stamps).toBe(0);
  });
});
