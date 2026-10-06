import { expect, test } from 'vitest';
import { neutralTheme } from '../theme/neutralTheme';
import type { ThemeConfig } from '../theme/types';
import { progressNextMessage } from './progressText';

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
