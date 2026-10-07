import type { RecommendedActivity } from './recommendationsApi';

/** «A», «A y B», «A, B y C» — natural Spanish list of the matched careers. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export type RecommendationReason = {
  /** Short label for the card: «Para ti» (exact career) or «También te puede interesar» (same division). */
  badge: string;
  /** Why it is here, in the student's words. Never claims a career the workshop is not linked to. */
  reason: string;
  kind: 'exact_career' | 'same_division';
};

/**
 * The server explains each recommendation (`recommendation_type`, `matched_careers`, `matched_division`);
 * the screen only words it. Older payloads (without those fields) are treated as exact matches by career.
 */
export function recommendationReason(rec: RecommendedActivity): RecommendationReason {
  if (rec.recommendation_type === 'same_division') {
    return { badge: 'También te puede interesar', reason: rec.matched_division?.division_name ?? rec.division_name ?? '', kind: 'same_division' };
  }
  const names = rec.matched_careers?.map((c) => c.career_name) ?? rec.careers.map((c) => c.career_name);
  return { badge: 'Para ti', reason: names.length ? `Porque te interesa ${joinNames(names)}` : '', kind: 'exact_career' };
}
