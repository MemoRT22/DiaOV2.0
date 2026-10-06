import { expect, test } from 'vitest';
import { neutralTheme } from '../theme/neutralTheme';
import type { ThemeConfig } from '../theme/types';
import { progressNextMessage } from './progressText';

const term = (key: 'stamp' | 'division', plural = false) => neutralTheme.vocabulary[key][plural ? 'many' : 'one'];
const rankName = (level: number) => `Nivel ${level}`;
const next = (required_divisions: number) => ({ level: 3, required_attendances: 2, required_divisions });

// A theme published before the rule change still mentions divisions in its text.
const legacy: ThemeConfig = {
  ...neutralTheme,
  texts: { ...neutralTheme.texts, progressNext: 'Te faltan {activities} {activityTerm} y {divisions} {divisionTerm} para llegar a {rank}.' },
};

test('the progress message only talks about stamps when the next level needs no divisions', () => {
  expect(progressNextMessage(neutralTheme, next(0), 2, term, rankName)).toBe('Te faltan 2 sellos para llegar a Nivel 3.');
  expect(progressNextMessage(neutralTheme, next(0), 1, term, rankName)).toBe('Te faltan 1 sello para llegar a Nivel 3.');
});

test('a previously published theme never asks for divisions when none are required', () => {
  const message = progressNextMessage(legacy, next(0), 1, term, rankName);
  expect(message).toBe('Te faltan 1 sello para llegar a Nivel 3.');
  expect(message).not.toMatch(/divisi/i);
});

test('divisions are still mentioned if a future rule requires them', () => {
  expect(progressNextMessage(legacy, next(2), 1, term, rankName)).toBe('Te faltan 1 sello y 2 divisiones para llegar a Nivel 3.');
});
