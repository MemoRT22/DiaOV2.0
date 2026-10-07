import type { RecommendedActivity } from './recommendationsApi';

/** «A», «A y B», «A, B y C» — natural Spanish list of the matched careers. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export type RecommendationReason = {
  /** One discreet line: «Por tu interés en X» / «Por tus intereses en X y Y» / «Relacionado con <división>». */
  reason: string;
  kind: 'exact_career' | 'same_division';
};

/**
 * The server explains each suggestion (`recommendation_type`, `matched_careers`, `matched_division`); the screen only words it.
 * An exact match names the careers; a same-division suggestion names only the division and never claims a career match.
 * Older payloads (without those fields) are treated as exact matches by career.
 */
export function recommendationReason(rec: RecommendedActivity): RecommendationReason {
  if (rec.recommendation_type === 'same_division') {
    const division = rec.matched_division?.division_name ?? rec.division_name ?? '';
    return { reason: division ? `Relacionado con ${division}` : '', kind: 'same_division' };
  }
  const names = rec.matched_careers?.map((c) => c.career_name) ?? rec.careers.map((c) => c.career_name);
  if (names.length === 0) return { reason: '', kind: 'exact_career' };
  return { reason: `${names.length === 1 ? 'Por tu interés en' : 'Por tus intereses en'} ${joinNames(names)}`, kind: 'exact_career' };
}
