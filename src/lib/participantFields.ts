import { fold } from './csv';

/** Valores estables guardados en la base de datos; la etiqueta es solo para mostrar. */
export const GRADE_OPTIONS = [
  { value: '1', label: '1.º año' },
  { value: '2', label: '2.º año' },
  { value: '3', label: '3.º año' },
  { value: 'graduado', label: 'Egresado' },
] as const;

export const PERIOD_OPTIONS = [
  { value: '2027-01', label: 'Enero 2027' },
  { value: '2027-08', label: 'Agosto 2027' },
  { value: '2028-01', label: 'Enero 2028' },
  { value: '2028-08', label: 'Agosto 2028' },
] as const;

export type GradeValue = (typeof GRADE_OPTIONS)[number]['value'];
export type PeriodValue = (typeof PERIOD_OPTIONS)[number]['value'];

export const gradeLabel = (value: string | null | undefined) => GRADE_OPTIONS.find((o) => o.value === value)?.label ?? null;
export const periodLabel = (value: string | null | undefined) => PERIOD_OPTIONS.find((o) => o.value === value)?.label ?? null;

const GRADE_WORDS: Record<string, GradeValue> = {
  '1': '1', '1o': '1', '1er': '1', '1 o': '1', primero: '1', primer: '1', '1 ano': '1', '1o ano': '1', '1er ano': '1', 'primer ano': '1', 'primero de preparatoria': '1',
  '2': '2', '2o': '2', '2 o': '2', segundo: '2', '2 ano': '2', '2o ano': '2', 'segundo ano': '2', 'segundo de preparatoria': '2',
  '3': '3', '3o': '3', '3er': '3', '3 o': '3', tercero: '3', tercer: '3', '3 ano': '3', '3o ano': '3', '3er ano': '3', 'tercer ano': '3', 'tercero de preparatoria': '3',
  graduado: 'graduado', graduada: 'graduado', egresado: 'graduado', egresada: 'graduado', 'ya egrese': 'graduado', 'ya termine': 'graduado',
};

/** «1.º año», «3° año», «tercero», «Egresado»… → valor estable. Devuelve null si no se reconoce. */
export function normalizeGrade(raw: string | null | undefined): GradeValue | null {
  const text = String(raw ?? '')
    .replace(/[º°ª]/g, 'o')
    .replace(/(\d)\.(?=\s*o\b)/g, '$1');
  const key = fold(text);
  if (!key) return null;
  return GRADE_WORDS[key] ?? null;
}

const MONTHS: Record<string, '01' | '08'> = {
  enero: '01', ene: '01', agosto: '08', ago: '08',
};

/** «Enero 2027», «agosto de 2028», «2027-08» → valor estable. Devuelve null si no se reconoce. */
export function normalizePeriod(raw: string | null | undefined): PeriodValue | null {
  const key = fold(String(raw ?? '')).replace(/\bde\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return null;
  const iso = /^(\d{4}) (0[18])$/.exec(key);
  if (iso) return PERIOD_OPTIONS.find((o) => o.value === `${iso[1]}-${iso[2]}`)?.value ?? null;
  const named = /^([a-z]+) (\d{4})$/.exec(key);
  if (named && MONTHS[named[1]]) return PERIOD_OPTIONS.find((o) => o.value === `${named[2]}-${MONTHS[named[1]]}`)?.value ?? null;
  return null;
}

/** Nombre completo determinista a partir de Nombre y Apellidos (se guarda solo `full_name`). */
export function joinFullName(firstName: string | null | undefined, lastName: string | null | undefined) {
  return [firstName, lastName].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** Código de error amigable, o null si la contraseña es aceptable. La política es mínima a propósito. */
export function passwordProblem(password: string): 'INVALID_PASSWORD' | null {
  return password.length >= PASSWORD_MIN && new TextEncoder().encode(password).length <= PASSWORD_MAX ? null : 'INVALID_PASSWORD';
}
