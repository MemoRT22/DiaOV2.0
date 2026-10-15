import { expect, test } from 'vitest';
import { neutralTheme } from '../theme/neutralTheme';
import type { ThemeConfig } from '../theme/types';
import { progressNextMessage, projectedRankLevel } from './progressText';

const term = (key: 'stamp' | 'division', plural = false) => neutralTheme.vocabulary[key][plural ? 'many' : 'one'];
const rankName = (level: number) => (level === 3 ? 'Piloto Interestelar' : `Nivel ${level}`);
const next = (required_divisions: number) => ({ level: 3, required_attendances: 2, required_divisions });

// Exactly the text of the theme currently published in production.
const published: ThemeConfig = {
  ...neutralTheme,
  texts: {
    ...neutralTheme.texts,
    progressNext: 'Completa {activities} {activityTerm} más en {divisions} {divisionTerm} distintos para ascender a {rank}.',
  },
};

test('with no division requirement the published theme text is not used and no division or zero appears', () => {
  const message = progressNextMessage(published, next(0), 1, term, rankName);
  expect(message).toBe('Te falta 1 sello para llegar a Piloto Interestelar.');
  expect(message).not.toMatch(/divisi/i);
  expect(message).not.toContain('0');
  expect(message).not.toContain('Completa');
});

test('plural agrees with the verb', () => {
  expect(progressNextMessage(published, next(0), 2, term, rankName)).toBe('Te faltan 2 sellos para llegar a Piloto Interestelar.');
});

test('the neutral theme text is also ignored when no divisions are required', () => {
  expect(progressNextMessage(neutralTheme, next(0), 3, term, rankName)).toBe('Te faltan 3 sellos para llegar a Piloto Interestelar.');
});

test('when divisions are required the configurable theme text is used', () => {
  expect(progressNextMessage(published, next(2), 1, term, rankName)).toBe(
    'Completa 1 sello más en 2 divisiones distintos para ascender a Piloto Interestelar.',
  );
});

// ---- rank projected from the OFFICIAL stamp total (my_progress), never from the partial reservation board ----
const official = (stamps: number, level = Math.min(stamps, 4) + 1) => ({
  stamps, level, next: level >= 5 ? null : { level: level + 1, required_attendances: level, required_divisions: 0 },
});

test('projected rank = official stamps + still-possible stamps, one stamp one rank, capped at the last rank', () => {
  expect(projectedRankLevel(official(0), 1)).toBe(2);
  expect(projectedRankLevel(official(1), 2)).toBe(4);
  expect(projectedRankLevel(official(2), 4)).toBe(5); // 6 stamps never create a sixth rank
  expect(projectedRankLevel(official(0), 0)).toBe(1);
});

test('a projection is never lower than the rank the participant already has', () => {
  for (let stamps = 0; stamps <= 6; stamps += 1) {
    for (let planned = 0; planned <= 5; planned += 1) {
      const level = projectedRankLevel(official(stamps), planned);
      expect(level).not.toBeNull();
      expect(level!).toBeGreaterThanOrEqual(official(stamps).level);
      expect(level!).toBeLessThanOrEqual(5);
    }
  }
  // even if a (stale) total lags behind the rank the server reports, the held rank is the floor
  expect(projectedRankLevel({ stamps: 1, level: 4, next: { level: 5, required_attendances: 4, required_divisions: 0 } }, 0)).toBe(4);
});

test('stamps won without a reservation count: the official total (2) plus one possible stamp reaches rank 4, a board-only total (0) would not', () => {
  const boardOnly = projectedRankLevel(official(0), 1); // what a partial board total would have produced
  const authoritative = projectedRankLevel(official(2), 1);
  expect(boardOnly).toBe(2);
  expect(authoritative).toBe(4);
  expect(authoritative!).toBeGreaterThanOrEqual(official(2).level);
});

test('if the progression stops being «one stamp, one rank» no rank is projected', () => {
  expect(projectedRankLevel({ stamps: 2, level: 2, next: { level: 3, required_attendances: 5, required_divisions: 0 } }, 1)).toBeNull();
  expect(projectedRankLevel({ stamps: 2, level: 2, next: { level: 3, required_attendances: 2, required_divisions: 2 } }, 1)).toBeNull();
});
