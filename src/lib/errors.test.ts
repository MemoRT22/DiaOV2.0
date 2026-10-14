import { expect, test, vi } from 'vitest';
import { ENROLLMENT_CLOSED, friendlyError } from './errors';

test('a closed enrollment is explained in plain Spanish with a way forward', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(friendlyError(new Error('ENROLLMENT_CLOSED'))).toBe(ENROLLMENT_CLOSED);
  expect(ENROLLMENT_CLOSED).toBe('Esta misión ya comenzó y terminó su periodo de inscripción. Explora otros horarios disponibles.');
});

test('a scan without reservation tells the student to enrol first, keeping the existing wording prefix', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const msg = friendlyError({ message: 'NO_RESERVATION' });
  expect(msg).toMatch(/^No tienes reservación/);
  expect(msg).toMatch(/primero debes inscribirte/);
});
