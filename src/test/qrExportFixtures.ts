import { createHash } from 'node:crypto';
import type { ExportMeta, ExportMetaCareer, ExportMetaDivision, ExportMetaSession } from '../lib/checkinExport';
import type { RunDeps } from '../lib/checkinExportRun';

/*
 * Datos FICTICIOS que reproducen la forma de la edición: 73 talleres = 64 reales publicados + 9 DEMO. Nada de esto es información
 * real: nombres, correos (@example.test), edificios y credenciales son inventados y deterministas.
 */

export const DIVISIONS: ExportMetaDivision[] = [
  { id: 'div-salud', code: 'DIV-SALUD', name: 'División de Ciencias de la Salud' },
  { id: 'div-negocios', code: 'DIV-NEGOCIOS', name: 'División de Negocios' },
  { id: 'div-creativas', code: 'DIV-CREATIVAS', name: 'División de Industrias Creativas y Diseño' },
  { id: 'div-turismo', code: 'DIV-TURISMO', name: 'División de Turismo, Hotelería y Gastronomía' },
  { id: 'div-sociales', code: 'DIV-SOCIALES', name: 'División de Ciencias Sociales y Jurídicas' },
  { id: 'div-ingenieria', code: 'DIV-INGENIERIA', name: 'División de Ingeniería y Tecnología' },
];

export const CAREERS: ExportMetaCareer[] = DIVISIONS.flatMap((division, d) =>
  [1, 2, 3].map((n) => ({ id: `car-${d}-${n}`, code: `C${d}${n}`, name: `Licenciatura ${d + 1}.${n} (ficticia)`, division_id: division.id })));

export const BUILDINGS = ['Edificio A', 'Edificio B', 'Edificio C', 'Edificio D', 'Lions Sport Center'];

const FIRST = ['Ana', 'Luis', 'María', 'José', 'Fernanda', 'Carlos', 'Sofía', 'Jorge', 'Valeria', 'Miguel', 'Daniela', 'Andrés', 'Paola', 'Ricardo', 'Lucía', 'Héctor', 'Camila', 'Raúl', 'Isabel', 'Óscar'];
const LAST = ['García', 'Hernández', 'López', 'Martínez', 'Pérez', 'Rodríguez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Gómez', 'Díaz', 'Cruz', 'Reyes', 'Morales', 'Ortiz', 'Castillo', 'Núñez', 'Peña', 'Ibarra'];
const TOPIC = ['Cocina molecular', 'Primeros auxilios', 'Finanzas personales', 'Fotografía móvil', 'Robótica educativa', 'Oratoria', 'Cata de café', 'Diseño de empaques', 'Derecho y tecnología', 'Nutrición deportiva', 'Marketing digital', 'Hotelería de lujo', 'Realidad aumentada', 'Psicología del consumidor', 'Cerámica', 'Cine documental', 'Bartending sin alcohol', 'Emprendimiento social', 'Podcasting', 'Ciberseguridad básica'];

/** Un mismo responsable puede estar al frente de varios talleres. */
export const TALLERISTAS = Array.from({ length: 40 }, (_, k) => {
  const name = `${FIRST[k % FIRST.length]} ${LAST[(k * 7 + Math.floor(k / 20) * 3) % LAST.length]} ${LAST[(k * 3 + 5) % LAST.length]}`;
  return { name, email: k >= 10 && k <= 13 ? null : `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.')}.${k}@example.test` };
});

const at = (iso: string): string => iso;
/** 10:00 en Cancún = 15:00 UTC. */
const slot = (day: number, hour: number, minutes = 60): { starts: string; ends: string } => {
  const start = Date.UTC(2026, 9, day, hour + 5, 0, 0);
  return { starts: new Date(start).toISOString(), ends: new Date(start + minutes * 60_000).toISOString() };
};

const sessionsFor = (index: number, place: string, minutes: number): ExportMetaSession[] => {
  const count = index === 33 ? 14 : 1 + (index % 6);
  return Array.from({ length: count }, (_, n) => {
    const { starts, ends } = slot(n < 8 ? 14 : 15, 9 + (n % 8), minutes);
    return {
      session_id: `s-${index}-${n}`, starts_at: at(starts), ends_at: at(ends), status: 'activa',
      // Algunos talleres cambian de espacio en un horario.
      location: index % 9 === 0 && n === 1 ? 'Auditorio Principal' : place,
    };
  });
};

const LONG_TITLES: Record<number, string> = {
  7: 'Taller intensivo de introducción a la inteligencia artificial aplicada a la educación superior, la investigación y la vida profesional de las y los jóvenes universitarios del Caribe mexicano',
  33: 'Laboratorio interdisciplinario de innovación social, sostenibilidad ambiental, turismo regenerativo, derechos humanos y economía circular: de la idea al prototipo en una sola jornada de trabajo colaborativo con especialistas nacionales e internacionales (edición Día OV 2026, año del 60 aniversario de la Red de Universidades Anáhuac)',
  50: 'Supercalifragilisticoespialidosamente-largo-sin-espacios-para-probar-el-corte-de-palabras-extensas',
};

export const REAL_COUNT = 64;
export const DEMO_COUNT = 9;

const credentialRotated = '2026-10-01T18:00:00.000Z';

/** 64 talleres reales publicados + 9 DEMO, con la mezcla de casos que tiene el catálogo. */
export function buildFixtureMeta(): ExportMeta[] {
  const meta: ExportMeta[] = [];
  for (let i = 0; i < REAL_COUNT; i += 1) {
    const academic = i < 52;
    const noDivision = [8, 21, 40].includes(i);
    const divisionIds = academic && !noDivision
      ? i === 30 ? [DIVISIONS[0].id, DIVISIONS[1].id, DIVISIONS[5].id]
        : i === 4 || i === 17 ? [DIVISIONS[i % 6].id, DIVISIONS[(i + 2) % 6].id]
        : [DIVISIONS[i % 6].id]
      : [];
    const divisions = divisionIds.map((id) => DIVISIONS.find((division) => division.id === id)!);
    const careers = CAREERS.filter((career) => divisionIds.includes(career.division_id)).slice(0, 4);
    // Los últimos tres son altas manuales: sin propuesta, sin responsable.
    const tallerista = i >= 61 ? null : i < 40 ? TALLERISTAS[i] : TALLERISTAS[[0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18, 19, 20, 21][i - 40]];
    const building = tallerista ? BUILDINGS[i % BUILDINGS.length] : null;
    const room = tallerista ? `Aula ${100 + i}` : null;
    const place = tallerista ? `${building} ${room}` : 'Plaza central';
    meta.push({
      activity_id: `act-${String(i).padStart(2, '0')}`,
      title: LONG_TITLES[i] ?? `${TOPIC[i % TOPIC.length]} ${i + 1}`,
      activity_type: academic ? 'academica' : i === 63 ? 'liderazgo' : 'vida_universitaria',
      experience_category: academic ? null : ['deportiva', 'artistica_cultural', 'liderazgo'][i % 3],
      is_demo: false,
      location: place,
      building,
      room_space: room,
      facilitator_name: tallerista?.name ?? null,
      // El mismo correo escrito con mayúsculas en un taller: el servidor ya lo entrega en minúsculas.
      facilitator_email: tallerista?.email ?? null,
      has_credential: true,
      credential_rotated_at: credentialRotated,
      divisions, careers,
      sessions: sessionsFor(i, place, academic ? 60 : 30),
    });
  }
  for (let d = 0; d < DEMO_COUNT; d += 1) {
    meta.push({
      activity_id: `demo-${d}`, title: `DEMO · Taller de prueba ${d + 1}`, activity_type: 'academica', experience_category: null, is_demo: true,
      location: 'Aula DEMO', building: 'Edificio DEMO', room_space: `Aula ${d}`, facilitator_name: 'Tallerista DEMO', facilitator_email: 'demo@example.test',
      has_credential: true, credential_rotated_at: credentialRotated, divisions: [DIVISIONS[d % 6]], careers: [CAREERS[d]],
      sessions: sessionsFor(d + 100, 'Aula DEMO', 60),
    });
  }
  return meta;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Credencial con el mismo formato que la real: 64 hex de token y 6 caracteres de código manual. */
export function credentialFor(activityId: string, generation = 0) {
  const digest = createHash('sha256').update(`${activityId}:${generation}`).digest();
  return {
    qr_token: digest.toString('hex'),
    manual_code: Array.from({ length: 6 }, (_, k) => ALPHABET[digest[k] % 32]).join(''),
  };
}

/**
 * Servidor simulado con el contrato de Check-in: un QR por actividad, regenerar invalida el anterior y `checkIn` solo reconoce la vigente.
 * No es la base real: es el ambiente controlado de las pruebas.
 */
export function createFakeServer(initial: ExportMeta[] = buildFixtureMeta()) {
  const meta = new Map(initial.map((item) => [item.activity_id, structuredClone(item)]));
  const generation = new Map<string, number>();
  const calls = { metadata: 0, credentials: [] as string[], regenerations: 0 };
  const failing = new Map<string, number>(); // id → intentos que todavía deben fallar
  let denied = false;

  const server = {
    meta, calls,
    failOn(id: string, times = Infinity) { failing.set(id, times); },
    deny() { denied = true; },
    /** Equivalente a `rotate_activity_credential`: el QR anterior deja de servir. */
    regenerate(id: string) {
      generation.set(id, (generation.get(id) ?? 0) + 1);
      meta.get(id)!.credential_rotated_at = new Date(Date.parse(credentialRotated) + (generation.get(id) ?? 0) * 60_000).toISOString();
      calls.regenerations += 1;
    },
    current: (id: string) => credentialFor(id, generation.get(id) ?? 0),
    /** Equivalente a `check_in(p_credential)`: devuelve la actividad si el token o el código son los vigentes. */
    checkIn(credential: string): string | null {
      for (const id of meta.keys()) {
        const current = server.current(id);
        if (credential === current.qr_token || credential.toLowerCase() === current.manual_code.toLowerCase()) return id;
      }
      return null;
    },
    deps(extra: Partial<RunDeps> = {}): Partial<RunDeps> {
      return {
        fetchMetadata: async () => {
          if (denied) throw new Error('NOT_AUTHORIZED');
          calls.metadata += 1;
          return [...meta.values()].map((item) => structuredClone(item));
        },
        fetchCredential: async (id: string) => {
          if (denied) throw new Error('NOT_AUTHORIZED');
          const left = failing.get(id);
          if (left !== undefined && left > 0) { failing.set(id, left - 1); throw new Error('Failed to fetch'); }
          calls.credentials.push(id);
          return { activity_id: id, ...server.current(id) };
        },
        loadLogo: async () => null,
        now: () => new Date('2026-10-13T12:00:00.000Z'),
        ...extra,
      };
    },
  };
  return server;
}
