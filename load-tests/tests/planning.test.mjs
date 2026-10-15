import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountIndexForGlobalVu, allocateFullDay, arrivalDelayMs, assertDisjointCohorts, authPlan,
} from '../lib/planning.js';

test('peak2000 programa exactamente 2,000 accesos únicos sin solicitudes extra', () => {
  const plan = authPlan('peak2000', 1, 2000);
  assert.equal(plan.users, 2000);
  const delays = Array.from({ length: plan.users }, (_, index) => arrivalDelayMs(index, plan));
  assert.equal(delays.length, 2000);
  assert.equal(delays[0], 0);
  assert.equal(delays.at(-1), 120_000);
  assert.ok(delays.every((value, index) => index === 0 || value >= delays[index - 1]));
});

test('escala y MAX_VUS reducen el volumen esperado de forma explícita', () => {
  assert.equal(authPlan('peak2000', 0.1, 2000).users, 200);
  assert.equal(authPlan('peak2000', 1, 350).users, 350);
});

test('cada ID global obtiene una identidad exacta y nunca hace módulo', () => {
  const assigned = Array.from({ length: 2000 }, (_, index) => accountIndexForGlobalVu(index + 1, 2000));
  assert.equal(new Set(assigned).size, 2000);
  assert.throws(() => accountIndexForGlobalVu(2001, 2000), /no tiene una identidad exclusiva/);
});

test('las cohortes son disjuntas, exhaustivas y detectan solapamientos', () => {
  const cohorts = {
    navigation: { base: 0, size: 1100 }, reservations_contention: { base: 1100, size: 200 },
    reservations_steady: { base: 1300, size: 300 }, checkin: { base: 1600, size: 160 },
    survey: { base: 1760, size: 120 }, realtime: { base: 1880, size: 120 },
  };
  assert.equal(assertDisjointCohorts(cohorts, 2000), true);
  assert.throws(() => assertDisjointCohorts({ a: { base: 0, size: 2 }, b: { base: 1, size: 1 } }, 2), /superponen/);
});

test('smoke cubre todos los flujos críticos y peak suma exactamente 2,000 VU', () => {
  const smoke = allocateFullDay(5, 'smoke');
  assert.ok(Object.values(smoke).every((value) => value === 1));
  const peak = allocateFullDay(2000, 'peak2000');
  assert.equal(Object.values(peak).reduce((sum, value) => sum + value, 0), 2000);
  assert.ok(Object.values(peak).every((value) => value > 0));
});
