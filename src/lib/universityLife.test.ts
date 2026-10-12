import { describe, expect, it } from 'vitest';
import { experienceCategoriesIn, experienceCategoryLabel, isUniversityLife, universityLifeCategory, universityLifeLabel } from './universityLife';

describe('Vida Universitaria is decided by the official activity type', () => {
  it('recognises the official type with any experience category', () => {
    for (const category of ['liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra']) {
      expect(universityLifeCategory({ activity_type: 'vida_universitaria', experience_category: category })).toBe(category);
    }
    expect(universityLifeCategory({ activity_type: 'vida_universitaria', experience_category: null })).toBe('otra');
    expect(universityLifeCategory({ activity_type: 'vida_universitaria', experience_category: 'algo_nuevo' })).toBe('otra');
  });

  it('never treats an academic mission as Vida Universitaria, even without a division or with the word «liderazgo»', () => {
    expect(isUniversityLife({ activity_type: 'academica', experience_category: null })).toBe(false);
    expect(isUniversityLife({ activity_type: 'academica', experience_category: 'liderazgo' })).toBe(false);
  });

  it('does not guess when the type is unknown (a backend that does not report it yet)', () => {
    expect(isUniversityLife({})).toBe(false);
    expect(isUniversityLife({ activity_type: null })).toBe(false);
  });

  it('maps the pre-catalogue type «liderazgo» to its category', () => {
    expect(universityLifeCategory({ activity_type: 'liderazgo', experience_category: null })).toBe('liderazgo');
  });
});

describe('experience categories for the student', () => {
  it('uses the student-facing names', () => {
    expect(['liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra'].map(experienceCategoryLabel))
      .toEqual(['Liderazgo', 'Deportiva', 'Artística y cultural', 'Vida Universitaria', 'Otras experiencias']);
    expect(universityLifeLabel('deportiva')).toBe('Vida Universitaria · Deportiva');
    expect(universityLifeLabel('vida_universitaria')).toBe('Vida Universitaria');
  });

  it('lists only the categories that have missions, in a fixed order, with their counts', () => {
    const missions = [
      { activity_type: 'vida_universitaria', experience_category: 'otra' },
      { activity_type: 'academica', experience_category: null },
      { activity_type: 'vida_universitaria', experience_category: 'deportiva' },
      { activity_type: 'vida_universitaria', experience_category: 'liderazgo' },
      { activity_type: 'vida_universitaria', experience_category: 'liderazgo' },
    ];
    expect(experienceCategoriesIn(missions)).toEqual([
      { value: 'liderazgo', label: 'Liderazgo', count: 2 },
      { value: 'deportiva', label: 'Deportiva', count: 1 },
      { value: 'otra', label: 'Otras experiencias', count: 1 },
    ]);
    expect(experienceCategoriesIn([{ activity_type: 'academica' }])).toEqual([]);
  });
});
