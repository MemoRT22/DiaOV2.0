import { describe, expect, test } from 'vitest';
import {
  applyFilters, buildPlan, controlCsv, controlRows, DEFAULT_FILTERS, filterOptions, normalizeWorkshops, NONE, recipientsCsv, slugify, toCsv,
  type ExportFilters, type ExportMeta,
} from './checkinExport';
import { buildFixtureMeta, credentialFor, DEMO_COUNT, DIVISIONS, REAL_COUNT } from '../test/qrExportFixtures';

const all = () => normalizeWorkshops(buildFixtureMeta());
const filtered = (patch: Partial<ExportFilters>) => applyFilters(all(), { ...DEFAULT_FILTERS, ...patch });

describe('catálogo de ejemplo (ficticio)', () => {
  test('reproduce 73 talleres: 64 reales y 9 DEMO', () => {
    const workshops = all();
    expect(workshops).toHaveLength(REAL_COUNT + DEMO_COUNT);
    expect(workshops.filter((w) => !w.isDemo)).toHaveLength(64);
    expect(workshops.filter((w) => w.isDemo)).toHaveLength(9);
  });
});

describe('DEMO', () => {
  test('por defecto solo talleres reales', () => {
    expect(filtered({})).toHaveLength(64);
    expect(filtered({}).every((w) => !w.isDemo)).toBe(true);
  });
  test('solo entran si Coordinación los pide', () => {
    expect(filtered({ includeDemo: true })).toHaveLength(73);
  });
  test('las opciones de filtro no muestran asociaciones DEMO mientras estén apagados', () => {
    const real = filterOptions(all(), false);
    const demo = filterOptions(all(), true);
    expect(real.responsibles.some((o) => o.label === 'Tallerista DEMO')).toBe(false);
    expect(demo.responsibles.some((o) => o.label === 'Tallerista DEMO')).toBe(true);
  });
  test('un archivo solo con DEMO queda marcado en su nombre', () => {
    const plan = buildPlan(filtered({ includeDemo: true }).filter((w) => w.isDemo), 'general');
    expect(plan.documents[0].fileName).toBe('DiaOV2026_QR_Concentrado_DEMO.pdf');
  });
});

describe('un QR por taller, sin duplicados', () => {
  test('un taller con 6 horarios, 2 divisiones y 4 carreras es un solo QR en el concentrado', () => {
    const plan = buildPlan(filtered({}), 'general');
    expect(plan.summary.qrCount).toBe(64);
    expect(plan.summary.pages).toBe(64);
    expect(plan.documents).toHaveLength(1);
    const ids = plan.documents[0].workshops.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const multi = plan.workshops.find((w) => w.id === 'act-04')!;
    expect(multi.divisions).toHaveLength(2);
    expect(multi.sessions.length).toBeGreaterThan(1);
    expect(ids.filter((id) => id === 'act-04')).toHaveLength(1);
  });
  test('si la misma actividad llega dos veces solo cuenta una', () => {
    const [first] = filtered({});
    expect(buildPlan([first, first, first], 'general').summary.qrCount).toBe(1);
  });
  test('solo cuentan los horarios vigentes: los cancelados y ocultos no aparecen', () => {
    const meta = buildFixtureMeta();
    meta[0].sessions[0].status = 'cancelada';
    const workshop = normalizeWorkshops(meta)[0];
    expect(workshop.sessions.map((s) => s.id)).not.toContain(meta[0].sessions[0].session_id);
    meta[1].sessions.forEach((s) => { s.status = 'oculta'; });
    expect(normalizeWorkshops(meta)[1].sessions).toHaveLength(0);
  });
});

describe('formato por tallerista', () => {
  const plan = buildPlan(filtered({}), 'tallerista');
  test('un tallerista con 3 talleres recibe un solo PDF de 3 páginas', () => {
    const doc = plan.documents.find((d) => d.recipient?.email?.endsWith('.0@example.test'))!;
    expect(doc.workshops).toHaveLength(3);
    expect(new Set(doc.workshops.map((w) => w.id)).size).toBe(3);
  });
  test('un tallerista solo recibe sus talleres', () => {
    for (const doc of plan.documents.filter((d) => d.recipient)) {
      expect(new Set(doc.workshops.map((w) => w.responsibleKey)).size).toBe(1);
    }
  });
  test('los talleres sin responsable van aparte, uno por PDF, en su carpeta', () => {
    const orphans = plan.documents.filter((d) => d.folder === 'Sin responsable');
    expect(orphans).toHaveLength(3);
    expect(orphans.every((d) => d.workshops.length === 1 && d.recipient === null && d.review.length > 0)).toBe(true);
  });
  test('un responsable sin correo se marca para revisión y no se descarta', () => {
    const noEmail = plan.documents.filter((d) => d.recipient && !d.recipient.email);
    expect(noEmail).toHaveLength(4);
    expect(noEmail.every((d) => d.review.includes('Sin correo del responsable'))).toBe(true);
    expect(plan.summary.withoutEmail).toBe(4);
    expect(plan.summary.withoutResponsible).toBe(3);
  });
  test('cada taller aparece en exactamente un PDF', () => {
    const ids = plan.documents.flatMap((d) => d.workshops.map((w) => w.id));
    expect(ids).toHaveLength(64);
    expect(new Set(ids).size).toBe(64);
  });
  test('el mismo correo escrito distinto es un solo destinatario', () => {
    const meta = buildFixtureMeta();
    meta[1].facilitator_email = meta[0].facilitator_email!.toUpperCase();
    meta[1].facilitator_name = 'Otro Nombre';
    const merged = buildPlan(applyFilters(normalizeWorkshops(meta), DEFAULT_FILTERS), 'tallerista');
    const docs = merged.documents.filter((d) => d.recipient?.email === meta[0].facilitator_email);
    expect(docs).toHaveLength(1);
    expect(docs[0].workshops.some((w) => w.id === 'act-01')).toBe(true);
  });
  test('los nombres de archivo son únicos, sin acentos ni símbolos', () => {
    const names = plan.documents.map((d) => `${d.folder ?? ''}/${d.fileName}`);
    expect(new Set(names).size).toBe(names.length);
    for (const doc of plan.documents) expect(doc.fileName).toMatch(/^DiaOV2026_QR_[A-Za-z0-9-]+\.pdf$/);
  });
  test('dos talleristas con el mismo nombre no se pisan el archivo', () => {
    const meta: ExportMeta[] = buildFixtureMeta().slice(0, 2);
    meta[0].facilitator_email = 'a@example.test'; meta[1].facilitator_email = 'b@example.test';
    meta[0].facilitator_name = meta[1].facilitator_name = 'Ana López';
    const names = buildPlan(normalizeWorkshops(meta), 'tallerista').documents.map((d) => d.fileName);
    expect(names).toEqual(['DiaOV2026_QR_Ana-Lopez.pdf', 'DiaOV2026_QR_Ana-Lopez-2.pdf']);
  });
});

describe('formato por división', () => {
  const plan = buildPlan(filtered({}), 'division');
  test('un taller de dos divisiones aparece en ambos paquetes con el mismo QR', () => {
    const containing = plan.documents.filter((d) => d.workshops.some((w) => w.id === 'act-04'));
    expect(containing).toHaveLength(2);
    expect(plan.summary.pages).toBeGreaterThan(plan.summary.workshops);
    expect(plan.summary.qrCount).toBe(64);
  });
  test('un taller en tres divisiones aparece en tres paquetes', () => {
    expect(plan.documents.filter((d) => d.workshops.some((w) => w.id === 'act-30'))).toHaveLength(3);
  });
  test('los talleres académicos sin división van al grupo «Sin división asignada», no se pierden', () => {
    const group = plan.documents.find((d) => d.id === `division:${NONE}`)!;
    expect(group.workshops.map((w) => w.id).sort()).toEqual(['act-08', 'act-21', 'act-40']);
    expect(group.review).not.toHaveLength(0);
    expect(group.fileName).toBe('DiaOV2026_QR_Sin-division.pdf');
  });
  test('Vida Universitaria sin división tiene su propio grupo', () => {
    const group = plan.documents.find((d) => d.title === 'Vida Universitaria')!;
    expect(group.workshops).toHaveLength(12);
    expect(group.workshops.every((w) => w.kind === 'vida_universitaria')).toBe(true);
  });
  test('cada taller está en al menos un paquete y los grupos salen en orden estable', () => {
    const ids = new Set(plan.documents.flatMap((d) => d.workshops.map((w) => w.id)));
    expect(ids.size).toBe(64);
    expect(plan.documents.map((d) => d.title).slice(-2)).toEqual(['Vida Universitaria', 'Sin división asignada']);
  });
});

describe('filtros', () => {
  test('por una división', () => {
    const result = filtered({ divisionIds: ['div-salud'] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((w) => w.divisions.some((d) => d.id === 'div-salud'))).toBe(true);
  });
  test('por varias divisiones suma sin repetir talleres', () => {
    const one = filtered({ divisionIds: ['div-salud'] }).length;
    const two = filtered({ divisionIds: ['div-salud', 'div-negocios'] });
    expect(two.length).toBeGreaterThan(one);
    expect(new Set(two.map((w) => w.id)).size).toBe(two.length);
  });
  test('por carrera real asociada', () => {
    const result = filtered({ careerIds: ['car-0-1'] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((w) => w.careers.some((c) => c.id === 'car-0-1'))).toBe(true);
  });
  test('«sin división» es un filtro propio', () => {
    expect(filtered({ divisionIds: [NONE] }).map((w) => w.id)).toContain('act-08');
    expect(filtered({ divisionIds: [NONE] }).some((w) => w.divisions.length > 0)).toBe(false);
  });
  test('por tipo de actividad', () => {
    expect(filtered({ kinds: ['vida_universitaria'] })).toHaveLength(12);
    expect(filtered({ kinds: ['academica'] })).toHaveLength(52);
    expect(filtered({ kinds: ['academica', 'vida_universitaria'] })).toHaveLength(64);
  });
  test('por tallerista, por taller, por edificio y por texto', () => {
    const tallerista = filtered({ responsibleKeys: [all()[0].responsibleKey] });
    expect(tallerista.every((w) => w.responsibleKey === all()[0].responsibleKey)).toBe(true);
    expect(tallerista).toHaveLength(3);
    expect(filtered({ workshopIds: ['act-03', 'act-05'] }).map((w) => w.id)).toEqual(['act-03', 'act-05']);
    expect(filtered({ buildings: ['Edificio A'] }).every((w) => w.building === 'Edificio A')).toBe(true);
    expect(filtered({ responsibleKeys: [NONE] })).toHaveLength(3);
    expect(filtered({ search: 'primeros auxilios' }).length).toBeGreaterThan(0);
    expect(filtered({ search: 'TALLERISTA DEMO' })).toHaveLength(0); // DEMO apagado
  });
  test('los filtros se combinan', () => {
    const result = filtered({ divisionIds: ['div-salud'], kinds: ['academica'], buildings: ['Edificio A'] });
    expect(result.every((w) => w.kind === 'academica' && w.building === 'Edificio A' && w.divisions.some((d) => d.id === 'div-salud'))).toBe(true);
  });
  test('las opciones salen de asociaciones reales, con conteos', () => {
    const options = filterOptions(all(), false);
    expect(options.divisions.map((o) => o.value)).toEqual(expect.arrayContaining(DIVISIONS.map((d) => d.id)));
    expect(options.divisions[options.divisions.length - 1].value).toBe(NONE);
    expect(options.divisions.find((o) => o.value === 'div-salud')!.count).toBe(filtered({ divisionIds: ['div-salud'] }).length);
    expect(options.careers.every((o) => o.label.startsWith('Licenciatura'))).toBe(true);
  });
});

describe('talleres que no pueden producirse', () => {
  test('solo con horarios cancelados u ocultos: se informa y no se exporta', () => {
    const meta = buildFixtureMeta();
    meta[2].sessions.forEach((s) => { s.status = 'cancelada'; });
    const plan = buildPlan(applyFilters(normalizeWorkshops(meta), DEFAULT_FILTERS), 'general');
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0]).toMatchObject({ reason: 'sin-horarios' });
    expect(plan.summary).toMatchObject({ matching: 64, qrCount: 63, withoutSessions: 1 });
    expect(plan.documents[0].workshops.map((w) => w.id)).not.toContain('act-02');
  });
  test('sin credencial: se informa y NO se genera', () => {
    const meta = buildFixtureMeta();
    meta[3].has_credential = false;
    const plan = buildPlan(applyFilters(normalizeWorkshops(meta), DEFAULT_FILTERS), 'tallerista');
    expect(plan.excluded[0]).toMatchObject({ reason: 'sin-credencial' });
    expect(plan.summary.withoutCredential).toBe(1);
    expect(plan.summary.qrCount).toBe(63);
  });
  test('un taller no válido sigue apareciendo en la lista de control como «Requiere revisión»', () => {
    const meta = buildFixtureMeta();
    meta[3].has_credential = false;
    const rows = controlRows(buildPlan(applyFilters(normalizeWorkshops(meta), DEFAULT_FILTERS), 'general'));
    const row = rows.find((r) => r.workshop.id === 'act-03')!;
    expect(row).toMatchObject({ status: 'Requiere revisión', pdf: '' });
    expect(row.notes.join(' ')).toMatch(/Sin credencial/);
  });
});

describe('lista de control', () => {
  const plan = buildPlan(filtered({}), 'tallerista');
  const csv = controlCsv(controlRows(plan));
  test('trae las columnas pedidas y una fila por taller', () => {
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Taller,Responsable,Correo,División / área,Sesiones,PDF,Estado,Observaciones');
    expect(lines).toHaveLength(65);
  });
  test('no contiene tokens ni códigos manuales', () => {
    for (const w of plan.workshops) {
      const { qr_token, manual_code } = credentialFor(w.id);
      expect(csv).not.toContain(qr_token);
      expect(csv).not.toContain(manual_code);
    }
    expect(csv).not.toMatch(/token|código manual/i);
  });
  test('estado listo vs requiere revisión', () => {
    const rows = controlRows(plan);
    expect(rows.find((r) => r.workshop.id === 'act-00')!.status).toBe('Listo');
    expect(rows.find((r) => r.workshop.id === 'act-10')!.status).toBe('Requiere revisión'); // sin correo
    expect(rows.find((r) => r.workshop.id === 'act-61')!.status).toBe('Requiere revisión'); // sin responsable
    expect(rows.find((r) => r.workshop.id === 'act-55')!.status).toBe('Listo'); // Vida Universitaria sin división
  });
  test('destinatarios sin repetir por correo, con sus talleres juntos', () => {
    const lines = recipientsCsv(plan).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Responsable,Correo,Talleres,Sesiones,PDF,Estado,Observaciones');
    const emails = lines.slice(1).map((line) => line.split(',')[1]).filter(Boolean);
    expect(new Set(emails).size).toBe(emails.length);
    expect(lines.length - 1).toBe(plan.summary.recipients);
  });
  test('las celdas que parecen fórmulas se neutralizan', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['normal, con coma']])).toContain("'=HYPERLINK");
    expect(toCsv(['a'], [['@x']])).toContain("'@x");
    expect(toCsv(['a'], [['normal, con coma']])).toContain('"normal, con coma"');
  });
  test('un taller sin QR obtenido se marca y su PDF queda vacío', () => {
    const rows = controlRows(plan, new Set(['act-00']));
    const row = rows.find((r) => r.workshop.id === 'act-00')!;
    expect(row.pdf).toBe('');
    expect(row.notes.join(' ')).toMatch(/QR no obtenido/);
  });
});

describe('nombres', () => {
  test('slugify quita acentos y símbolos y nunca queda vacío', () => {
    expect(slugify('Óscar Núñez / Peña')).toBe('Oscar-Nunez-Pena');
    expect(slugify('日本語')).toBe('sin-nombre');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
