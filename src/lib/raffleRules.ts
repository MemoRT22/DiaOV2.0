/**
 * Raffle categories are unlocked with STAMPS (a 60-minute workshop grants 2), split by activity type.
 * The backend is the only authority on who belongs to which category (`participant_raffle_category`); this module
 * mirrors the rule format so the UI can explain it: what a category asks for and what is missing for the next one.
 */

/** One alternative: minimum stamps of each kind and/or in total. A category is reached when ANY alternative is met. */
export type RaffleRule = { academic?: number; university_life?: number; total?: number };

export type StampCount = { academic: number; university_life: number };

export type RaffleTier = { id: string; name: string; sort_order: number; rules: RaffleRule[] };

export type MyRaffleStatus = {
  academic_stamps: number;
  university_life_stamps: number;
  total_stamps: number;
  raffle_category: string | null;
  raffle_category_name: string | null;
  has_won: boolean;
  /** Active categories of the participant's mode, lowest first. */
  categories: RaffleTier[];
};

const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

/** Accepts the current payload and the previous one (`*_tickets`, no categories) so a deploy never breaks the screen. */
export function normalizeRaffleStatus(raw: Record<string, unknown> | null | undefined): MyRaffleStatus {
  const r = raw ?? {};
  const academic = int(r.academic_stamps ?? r.academic_tickets);
  const universityLife = int(r.university_life_stamps ?? r.leadership_tickets);
  const categories = Array.isArray(r.categories) ? (r.categories as RaffleTier[]) : [];
  return {
    academic_stamps: academic,
    university_life_stamps: universityLife,
    total_stamps: academic + universityLife,
    raffle_category: (r.raffle_category as string | null) ?? null,
    raffle_category_name: (r.raffle_category_name as string | null) ?? null,
    has_won: r.has_won === true,
    categories: categories
      .map((c) => ({ ...c, rules: Array.isArray(c.rules) ? c.rules : [] }))
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}

export const ruleMet = (rule: RaffleRule, stamps: StampCount) =>
  int(rule.academic) <= stamps.academic &&
  int(rule.university_life) <= stamps.university_life &&
  int(rule.total) <= stamps.academic + stamps.university_life;

export const rulesMet = (rules: RaffleRule[], stamps: StampCount) => rules.some((rule) => ruleMet(rule, stamps));

/** The highest category whose rules are met (same order the backend uses), or null. */
export function tierFor<T extends { sort_order: number; rules: RaffleRule[] }>(tiers: T[], stamps: StampCount): T | null {
  return [...tiers].sort((a, b) => b.sort_order - a.sort_order).find((tier) => rulesMet(tier.rules, stamps)) ?? null;
}

const academicWord = (n: number) => (n === 1 ? 'académico' : 'académicos');

/** «3 académicos + 1 de Vida Universitaria» · «4 sellos en total» · «Sin requisito». */
export function describeRule(rule: RaffleRule): string {
  const academic = int(rule.academic);
  const universityLife = int(rule.university_life);
  const total = int(rule.total);
  const parts: string[] = [];
  if (academic > 0) parts.push(`${academic} ${academicWord(academic)}`);
  if (universityLife > 0) parts.push(`${universityLife} de Vida Universitaria`);
  const typed = parts.join(' + ');
  if (total > academic + universityLife) {
    const totalText = `${total} ${total === 1 ? 'sello' : 'sellos'} en total`;
    return typed ? `${typed} (${totalText})` : totalText;
  }
  return typed || 'Sin requisito';
}

/** Alternatives joined with «o»: «2 académicos + 1 de Vida Universitaria, o 4 sellos en total». */
export const describeRules = (rules: RaffleRule[]) => rules.map(describeRule).join(', o ');

type Missing = { academic: number; university_life: number; any: number; cost: number };

/** Fewest extra stamps that would satisfy `rule`: typed ones first, then stamps of any kind to reach the total. */
export function missingFor(rule: RaffleRule, stamps: StampCount): Missing {
  const academic = Math.max(0, int(rule.academic) - stamps.academic);
  const universityLife = Math.max(0, int(rule.university_life) - stamps.university_life);
  const any = Math.max(0, int(rule.total) - (stamps.academic + stamps.university_life + academic + universityLife));
  return { academic, university_life: universityLife, any, cost: academic + universityLife + any };
}

function missingText(m: Missing): string {
  const parts: string[] = [];
  if (m.academic > 0) parts.push(`${m.academic} ${m.academic === 1 ? 'sello académico' : 'sellos académicos'}`);
  if (m.university_life > 0) {
    parts.push(parts.length ? `${m.university_life} de Vida Universitaria` : `${m.university_life} ${m.university_life === 1 ? 'sello' : 'sellos'} de Vida Universitaria`);
  }
  if (m.any > 0) parts.push(parts.length ? `${m.any} más de cualquier tipo` : `${m.any} ${m.any === 1 ? 'sello' : 'sellos'} de cualquier tipo`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

export type NextTierHint = { tier: string; cost: number; text: string };

/**
 * The closest step up: among the categories above the current one, the one that needs the fewest extra stamps
 * (the highest of them on a tie). Null when there is nothing higher to reach.
 */
export function nextTierHint(status: Pick<MyRaffleStatus, 'academic_stamps' | 'university_life_stamps' | 'categories'>): NextTierHint | null {
  const stamps = { academic: status.academic_stamps, university_life: status.university_life_stamps };
  const current = tierFor(status.categories, stamps);
  const higher = status.categories.filter((tier) => tier.rules.length > 0 && (!current || tier.sort_order > current.sort_order));
  let best: { tier: RaffleTier; cost: number } | null = null;
  for (const tier of higher) {
    const cost = Math.min(...tier.rules.map((rule) => missingFor(rule, stamps).cost));
    if (cost <= 0) continue;
    if (!best || cost < best.cost || (cost === best.cost && tier.sort_order > best.tier.sort_order)) best = { tier, cost };
  }
  if (!best) return null;
  const { tier, cost } = best;
  const options = [...new Set(tier.rules.map((rule) => missingFor(rule, stamps)).filter((m) => m.cost === cost).map(missingText))].slice(0, 2);
  return { tier: tier.name, cost, text: `${cost === 1 ? 'Te falta' : 'Te faltan'} ${options.join(' o ')} para ${tier.name}.` };
}
