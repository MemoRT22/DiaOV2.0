import { expect, test } from 'vitest';
import { accountWithTheirData, lastSeenLabel, type Orientation } from './participantOrientation';

const base: Orientation = { id: 'a', last_seen_at: null, reservations_active: 0, attendances: 0, stamps: 0, category: null, others: [] };
const other = (over: Record<string, unknown>) => ({ id: 'b', full_name: 'B', email: 'b@x.com', origin: 'forms', has_login: true, last_seen_at: null, reservations_active: 0, attendances: 0, stamps: 0, ...over });

test('relative last activity in plain words', () => {
  const now = Date.parse('2026-10-15T16:00:00Z');
  expect(lastSeenLabel(null, now)).toBe('nunca ha entrado');
  expect(lastSeenLabel('2026-10-15T15:59:30Z', now)).toBe('ahora mismo');
  expect(lastSeenLabel('2026-10-15T15:40:00Z', now)).toBe('hace 20 min');
  expect(lastSeenLabel('2026-10-15T13:00:00Z', now)).toBe('hace 3 h');
  expect(lastSeenLabel('2026-10-13T16:00:00Z', now)).toBe('hace 2 d');
});

test('points to the other account only when this one is empty and another holds the route or the attendances', () => {
  expect(accountWithTheirData({ ...base, others: [other({ reservations_active: 2 })] })?.id).toBe('b');
  expect(accountWithTheirData({ ...base, others: [other({ attendances: 1 })] })?.id).toBe('b');
  expect(accountWithTheirData({ ...base, others: [other({})] })).toBeNull();
  expect(accountWithTheirData({ ...base, reservations_active: 1, others: [other({ reservations_active: 2 })] })).toBeNull();
});
