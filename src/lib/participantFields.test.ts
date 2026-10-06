import { describe, expect, it } from 'vitest';
import {
  GRADE_OPTIONS, PERIOD_OPTIONS, gradeLabel, joinFullName, normalizeGrade, normalizePeriod, passwordProblem, periodLabel,
} from './participantFields';

describe('grado y periodo estables', () => {
  it('expone exactamente las opciones del Forms con valores estables', () => {
    expect(GRADE_OPTIONS.map((o) => [o.value, o.label])).toEqual([['1', '1.º año'], ['2', '2.º año'], ['3', '3.º año'], ['graduado', 'Egresado']]);
    expect(PERIOD_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['2027-01', 'Enero 2027'], ['2027-08', 'Agosto 2027'], ['2028-01', 'Enero 2028'], ['2028-08', 'Agosto 2028'],
    ]);
    expect(gradeLabel('graduado')).toBe('Egresado');
    expect(periodLabel('2028-08')).toBe('Agosto 2028');
    expect(gradeLabel(null)).toBeNull();
    expect(periodLabel('2031-01')).toBeNull();
  });

  it.each([
    ['1.º año', '1'], ['2.º año', '2'], ['3.º año', '3'], ['3° año', '3'], ['1er año', '1'], ['Tercero', '3'], ['  segundo año ', '2'],
    ['Egresado', 'graduado'], ['egresada', 'graduado'], ['Graduado', 'graduado'], ['3', '3'],
  ])('normaliza el grado %s → %s', (raw, expected) => {
    expect(normalizeGrade(raw)).toBe(expected);
  });

  it.each([['quinto'], ['4.º año'], [''], [null], [undefined]])('no reconoce el grado %s', (raw) => {
    expect(normalizeGrade(raw as string)).toBeNull();
  });

  it.each([
    ['Enero 2027', '2027-01'], ['agosto 2027', '2027-08'], ['Enero 2028', '2028-01'], ['Agosto de 2028', '2028-08'],
    ['AGOSTO  2028', '2028-08'], ['2027-08', '2027-08'],
  ])('normaliza el periodo %s → %s', (raw, expected) => {
    expect(normalizePeriod(raw)).toBe(expected);
  });

  it.each([['Enero 2026'], ['Mayo 2027'], ['2029-01'], ['2027-02'], [''], [null]])('no reconoce el periodo %s', (raw) => {
    expect(normalizePeriod(raw as string)).toBeNull();
  });
});

describe('nombre completo y contraseña', () => {
  it('une Nombre y Apellidos de forma determinista', () => {
    expect(joinFullName(' Ana  María ', 'López   Pérez')).toBe('Ana María López Pérez');
    expect(joinFullName('Ana', '')).toBe('Ana');
    expect(joinFullName(undefined, 'López')).toBe('López');
    expect(joinFullName(null, null)).toBe('');
  });

  it('exige entre 8 y 72 caracteres, sin más reglas', () => {
    expect(passwordProblem('1234567')).toBe('INVALID_PASSWORD');
    expect(passwordProblem('12345678')).toBeNull();
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toBe('INVALID_PASSWORD');
    expect(passwordProblem('ñ'.repeat(40))).toBe('INVALID_PASSWORD');
  });
});
