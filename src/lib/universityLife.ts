/**
 * Vida Universitaria in the student catalogue. A mission is Vida Universitaria because of its OFFICIAL activity type
 * (`activity_type = 'vida_universitaria'`), never because it happens to have no division. Its `experience_category`
 * lets the student explore it by kind of experience.
 */
export const UNIVERSITY_LIFE = 'Vida Universitaria';

/** Experience categories in the order they are offered to the student. */
export const EXPERIENCE_CATEGORIES = [
  { value: 'liderazgo', label: 'Liderazgo' },
  { value: 'deportiva', label: 'Deportiva' },
  { value: 'artistica_cultural', label: 'Artística y cultural' },
  { value: 'vida_universitaria', label: 'Vida Universitaria' },
  { value: 'otra', label: 'Otras experiencias' },
] as const;

export type ExperienceCategory = (typeof EXPERIENCE_CATEGORIES)[number]['value'];

const KNOWN = new Set<string>(EXPERIENCE_CATEGORIES.map((c) => c.value));

type Typed = { activity_type?: string | null; experience_category?: string | null };

/**
 * The experience category of a Vida Universitaria mission, or null when the mission is not Vida Universitaria.
 * `liderazgo` as a TYPE is the name this same type had before the official catalogue (old test data only).
 */
export function universityLifeCategory(mission: Typed): ExperienceCategory | null {
  if (mission.activity_type === 'liderazgo') return 'liderazgo';
  if (mission.activity_type !== 'vida_universitaria') return null;
  const category = mission.experience_category ?? '';
  return KNOWN.has(category) ? (category as ExperienceCategory) : 'otra';
}

export const isUniversityLife = (mission: Typed) => universityLifeCategory(mission) !== null;

export const experienceCategoryLabel = (category: string) =>
  EXPERIENCE_CATEGORIES.find((c) => c.value === category)?.label ?? 'Otras experiencias';

/** «Vida Universitaria · Deportiva» (the general category is not repeated). */
export function universityLifeLabel(category: ExperienceCategory): string {
  return category === 'vida_universitaria' ? UNIVERSITY_LIFE : `${UNIVERSITY_LIFE} · ${experienceCategoryLabel(category)}`;
}

/** The categories that actually have missions, in display order, with how many. */
export function experienceCategoriesIn(missions: Typed[]): { value: ExperienceCategory; label: string; count: number }[] {
  const counts = new Map<ExperienceCategory, number>();
  for (const mission of missions) {
    const category = universityLifeCategory(mission);
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return EXPERIENCE_CATEGORIES.filter((c) => counts.has(c.value)).map((c) => ({ ...c, count: counts.get(c.value)! }));
}
