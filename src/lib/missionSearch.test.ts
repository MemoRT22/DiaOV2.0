import { expect, test } from 'vitest';
import type { BoardSession } from './reservations';
import { matchesMission, normalizeText } from './missionSearch';

const slot = (over: Partial<BoardSession> = {}): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Media Lab Podcast: Producción y conducción', description: 'Dale voz a tus ideas frente al micrófono.',
  division_id: null, starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z', location: 'Media Center Media Studio', credits: 1,
  status: 'activa', capacity: 10, reserved: 0, remaining: 10, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});

test('normalizing ignores case, accents and extra spaces', () => {
  expect(normalizeText('  PRODUCCIÓN   y Conducción ')).toBe('produccion y conduccion');
});

test('an empty query matches everything', () => {
  expect(matchesMission([slot()], '')).toBe(true);
  expect(matchesMission([slot()], '   ')).toBe(true);
});

test('finds by title, concept, place and area, without accents', () => {
  const m = [slot()];
  expect(matchesMission(m, 'produccion')).toBe(true);
  expect(matchesMission(m, 'MICRÓFONO')).toBe(true);
  expect(matchesMission(m, 'media studio')).toBe(true);
  expect(matchesMission(m, 'creativas', ['Áreas Creativas'])).toBe(true);
});

test('every word must be present, in any order', () => {
  const m = [slot()];
  expect(matchesMission(m, 'voz podcast')).toBe(true);
  expect(matchesMission(m, 'podcast derecho')).toBe(false);
});

test('looks at the places of every schedule, not only the first', () => {
  expect(matchesMission([slot(), slot({ id: 't', location: 'Negocios 3104' })], '3104')).toBe(true);
});
