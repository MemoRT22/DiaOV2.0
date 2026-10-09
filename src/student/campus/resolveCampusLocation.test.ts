import { describe, expect, test } from 'vitest';
import { CAMPUS_ZONES, SPACE_RULES, ZONE_BY_ID } from './campusZones';
import { formatPlace, placeDetailLine, resolveCampusLocation, unmappedLocations } from './resolveCampusLocation';

const zoneOf = (location: string) => resolveCampusLocation(location).zoneId;

describe('resolveCampusLocation — required examples', () => {
  test('«Negocios 3304, Tercer piso» → Escuela Internacional de Negocios, Salón 3304, Tercer piso', () => {
    const place = resolveCampusLocation('Negocios 3304, Tercer piso');
    expect(place).toMatchObject({ resolved: true, zoneId: 'negocios', building: 'Escuela Internacional de Negocios', detail: 'Salón 3304', floor: 'Tercer piso' });
    expect(placeDetailLine(place)).toBe('Salón 3304 · Tercer piso');
  });

  test.each([
    ['Negocios HUB de IA y Ciberseguridad, Planta baja', 'negocios', 'HUB de IA y Ciberseguridad', 'Planta baja'],
    ['Le Cordon Bleu Cocina 1, Planta baja', 'cordon', 'Cocina 1', 'Planta baja'],
    ['1 Sala de Juicios Orales, Planta baja', 'aulas', 'Sala de Juicios Orales', 'Planta baja'],
    ['Media Center VFX Lab', 'medios', 'VFX Lab', null],
    ['Laboratorios Centro de Simulación Odontológica', 'laboratorios', 'Centro de Simulación Odontológica', null],
    ['Rectoría Auditorio San Juan Pablo II', 'rectoria', 'Auditorio San Juan Pablo II', null],
    ['Iglesia Universitaria Santa María de Guadalupe Capilla', 'iglesia', 'Capilla', null],
  ])('%s → %s', (location, zoneId, detail, floor) => {
    expect(resolveCampusLocation(location)).toMatchObject({ resolved: true, zoneId, detail, floor, original: location });
  });

  test('an unknown place is never assigned to an invented building, keeps its text and degrades', () => {
    const place = resolveCampusLocation('Salón Demo A');
    expect(place).toMatchObject({ resolved: false, zoneId: null, zone: null, building: null, original: 'Salón Demo A' });
    expect(formatPlace('Salón Demo A')).toBe('Salón Demo A');
    expect(unmappedLocations()).toContain('Salón Demo A');
  });
});

describe('resolveCampusLocation — space rules (more specific than a building alias)', () => {
  test('«Negocios Arts Lab, Primer piso» is the 2nd-stage building (official map), keeping «Arts Lab» and the floor', () => {
    const place = resolveCampusLocation('Negocios Arts Lab, Primer piso');
    expect(place).toMatchObject({ resolved: true, zoneId: 'negocios2', building: 'Edificio de Negocios 2da Etapa', detail: 'Arts Lab', floor: 'Primer piso', pendingConfirmation: false });
    expect(formatPlace('Negocios Arts Lab, Primer piso')).toBe('Edificio de Negocios 2da Etapa · Arts Lab · Primer piso');
  });

  test('«Negocios Planta baja - Zona de descanso» (confirmed by Coordinación) is building 3, keeping space and floor', () => {
    const place = resolveCampusLocation('Negocios Planta baja - Zona de descanso');
    expect(place).toMatchObject({ resolved: true, zoneId: 'negocios', detail: 'Zona de descanso', floor: 'Planta baja', pendingConfirmation: false });
    expect(formatPlace('Negocios Planta baja - Zona de descanso')).toBe('Escuela Internacional de Negocios · Zona de descanso · Planta baja');
  });

  test('a space rule without a proven building degrades to «por confirmar»: original text, no zone, no pin', () => {
    SPACE_RULES.push({ building: 'Negocios', space: 'Sala Pendiente', zoneId: null, evidence: 'test' });
    try {
      expect(resolveCampusLocation('Negocios Sala Pendiente, Primer piso')).toMatchObject({
        resolved: false, zoneId: null, building: null, pendingConfirmation: true, original: 'Negocios Sala Pendiente, Primer piso',
      });
      expect(formatPlace('Negocios Sala Pendiente, Primer piso')).toBe('Negocios Sala Pendiente, Primer piso');
    } finally {
      SPACE_RULES.pop();
    }
  });

  test('the rules touch only their own spaces: every other «Negocios …» stays in building 3', () => {
    for (const location of ['Negocios 3304, Tercer piso', 'Negocios Sala Alpha, Primer piso', 'Negocios Sala Genera, Planta baja', 'Negocios Planta baja', 'Negocios Arts Labs']) {
      expect([location, zoneOf(location)]).toEqual([location, 'negocios']);
    }
    expect(resolveCampusLocation('Negocios Planta baja').floor).toBeNull(); // a bare floor word is not a «Planta baja - …» space
  });
});

describe('resolveCampusLocation — parsing rules', () => {
  test('the longest alias wins: «Negocios 2da Etapa …» is the 2nd-stage building, not «Negocios»', () => {
    expect(zoneOf('Negocios 2da Etapa 431, Primer piso')).toBe('negocios2');
    expect(zoneOf('Negocios 3101, Primer piso')).toBe('negocios');
  });

  test('aliases match whole words at the start only (no substring guessing)', () => {
    expect(zoneOf('10 Aula Magna')).toBeNull(); // «1» is building 1 only as a whole word
    expect(zoneOf('Laboratorio 1')).toBeNull(); // «Laboratorio» ≠ «Laboratorios»
    expect(zoneOf('CERT DEMO Plaza')).toBeNull();
    expect(zoneOf('Aula de Negocios')).toBeNull();
    expect(zoneOf('')).toBeNull();
  });

  test('accents and case do not matter; the original casing of the room is kept', () => {
    expect(resolveCampusLocation('rectoria CASA')).toMatchObject({ zoneId: 'rectoria', detail: 'CASA' });
    expect(resolveCampusLocation('CAFETERIA')).toMatchObject({ zoneId: 'cafeteria', detail: null });
  });

  test('a repeated building name is not shown twice; a floor written first is read as a floor', () => {
    expect(resolveCampusLocation('Cafetería Cafetería')).toMatchObject({ zoneId: 'cafeteria', detail: null, floor: null });
    expect(resolveCampusLocation('Le Cordon Bleu Planta baja - Recepción')).toMatchObject({ zoneId: 'cordon', detail: 'Recepción', floor: 'Planta baja' });
  });

  test('formatPlace reads as one line', () => {
    expect(formatPlace('Le Cordon Bleu 220, Primer piso')).toBe('Edificio Le Cordon Bleu · Salón 220 · Primer piso');
    expect(formatPlace('Media Center Foro')).toBe('Centro de Medios · Foro');
  });

  test('every zone has a footprint (own or shared), a pin and unique aliases', () => {
    const seen = new Set<string>();
    for (const zone of CAMPUS_ZONES) {
      expect(zone.shapes.length > 0 || !!zone.sharesFootprintWith).toBe(true);
      if (zone.sharesFootprintWith) expect(ZONE_BY_ID.get(zone.sharesFootprintWith)?.shapes.length).toBeGreaterThan(0);
      for (const alias of zone.aliases) {
        const key = alias.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        expect(seen.has(key), `duplicated alias ${alias}`).toBe(false);
        seen.add(key);
      }
    }
  });
});

/**
 * Snapshot (read-only query, 2026-10-09) of every distinct location the student board currently sends for REAL
 * workshops: `coalesce(nullif(activity_sessions.location, ''), activities.location)`. All must land on a building.
 */
const REAL_LOCATIONS: Array<[string, string]> = [
  ['1 125, Primer piso', 'aulas'], ['1 131 y Cámara Gesell, Tercer piso', 'aulas'], ['1 135, Tercer piso', 'aulas'],
  ['1 Clínica de Fisioterapia, Planta baja', 'aulas'], ['1 Sala de Juicios Orales, Planta baja', 'aulas'], ['1 Salón Sutton, Planta baja', 'aulas'],
  ['1 Taller de cerámica, Segundo piso', 'aulas'], ['1 Taller de costura, Tercer piso', 'aulas'], ['1 Taller de joyería', 'aulas'],
  ['Cafetería Cafetería', 'cafeteria'], ['Iglesia Universitaria Santa María de Guadalupe Capilla', 'iglesia'],
  ['Laboratorios Centro de Simulación Odontológica', 'laboratorios'], ['Laboratorios Laboratorio de Ciencias básicas 1', 'laboratorios'],
  ['Laboratorios Laboratorio de Ingeniería Civil', 'laboratorios'],
  ['Le Cordon Bleu 220, Primer piso', 'cordon'], ['Le Cordon Bleu 221, Primer piso', 'cordon'], ['Le Cordon Bleu 222, Primer piso', 'cordon'],
  ['Le Cordon Bleu 228, Primer piso', 'cordon'], ['Le Cordon Bleu 232, Tercer piso', 'cordon'], ['Le Cordon Bleu 233, Tercer piso', 'cordon'],
  ['Le Cordon Bleu 234, Tercer piso', 'cordon'], ['Le Cordon Bleu Cocina 1, Planta baja', 'cordon'], ['Le Cordon Bleu Cocina 2, Planta baja', 'cordon'],
  ['Le Cordon Bleu Demo 1, Planta baja', 'cordon'], ['Le Cordon Bleu Demo 2, Planta baja', 'cordon'], ['Le Cordon Bleu Hospitality Lab, Primer piso', 'cordon'],
  ['Le Cordon Bleu Salón Sommelier, Planta baja', 'cordon'], ['Le Cordon Bleu Tourism Virtual Lab, Segundo piso', 'cordon'],
  ['Media Center Audio Suite', 'medios'], ['Media Center Cabina radio', 'medios'], ['Media Center Design Animation Lab', 'medios'],
  ['Media Center Foro', 'medios'], ['Media Center Media Studio', 'medios'], ['Media Center Photo Lab', 'medios'],
  ['Media Center Post Production Lab', 'medios'], ['Media Center Sala Duality + Live Room', 'medios'], ['Media Center VFX Lab', 'medios'],
  ['Media Center Workstation Lab', 'medios'],
  ['Negocios 3101, Primer piso', 'negocios'], ['Negocios 3102, Primer piso', 'negocios'], ['Negocios 3103, Primer piso', 'negocios'],
  ['Negocios 3104, Primer piso', 'negocios'], ['Negocios 3106, Primer piso', 'negocios'], ['Negocios 3107, Primer piso', 'negocios'],
  ['Negocios 3108, Primer piso', 'negocios'], ['Negocios 3109, Primer piso', 'negocios'], ['Negocios 3201, Segundo piso', 'negocios'],
  ['Negocios 3202, Segundo piso', 'negocios'], ['Negocios 3301, Tercer piso', 'negocios'], ['Negocios 3302, Tercer piso', 'negocios'],
  ['Negocios 3303, Tercer piso', 'negocios'], ['Negocios 3304, Tercer piso', 'negocios'], ['Negocios 3305, Tercer piso', 'negocios'],
  ['Negocios Arts Lab, Primer piso', 'negocios2'], ['Negocios HUB de IA y Ciberseguridad, Planta baja', 'negocios'],
  ['Negocios Planta baja - Zona de descanso', 'negocios'], ['Negocios Sala Alpha, Primer piso', 'negocios'],
  ['Negocios Sala de cómputo, Segundo piso', 'negocios'], ['Negocios Sala Genera, Planta baja', 'negocios'],
  ['Rectoría Auditorio San Juan Pablo II', 'rectoria'], ['Rectoría CASA', 'rectoria'], ['Rectoría Jardín frontal', 'rectoria'],
];
const DEMO_LOCATIONS = ['CERT DEMO Aula Creativa', 'CERT DEMO Aula Mixta', 'CERT DEMO Aula Salud', 'CERT DEMO Plaza', 'Salón Demo A', 'Salón Demo B', 'Salón Demo C', 'Salón Demo L'];

test('all 62 distinct real locations (63 workshops) resolve to the expected building; the DEMO fixtures stay unmapped', () => {
  expect(REAL_LOCATIONS).toHaveLength(62);
  expect(REAL_LOCATIONS.filter(([location]) => resolveCampusLocation(location).pendingConfirmation)).toEqual([]);
  for (const [location, zoneId] of REAL_LOCATIONS) expect([location, zoneOf(location)]).toEqual([location, zoneId]);
  for (const location of DEMO_LOCATIONS) expect([location, zoneOf(location)]).toEqual([location, null]);
});
