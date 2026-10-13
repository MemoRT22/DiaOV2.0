// @vitest-environment node
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { applyFilters, DEFAULT_FILTERS, normalizeWorkshops, slugify } from './checkinExport';
import { ExportAborted, exportSingleWorkshop, runExport, type RunProgress, type RunResult } from './checkinExportRun';
import { createFakeServer } from '../test/qrExportFixtures';
import { decodeAllQr } from '../test/pdfRaster';

const realIds = (server = createFakeServer()) =>
  applyFilters(normalizeWorkshops([...server.meta.values()]), DEFAULT_FILTERS).map((w) => w.id);

const unzip = async (result: RunResult) => {
  if (result.kind !== 'done') throw new Error('se esperaba un archivo');
  return JSZip.loadAsync(new Uint8Array(await result.file.blob.arrayBuffer()));
};
const done = (result: RunResult) => {
  if (result.kind !== 'done') throw new Error(`se esperaba un archivo y fue «${result.kind}»`);
  return result;
};

afterEach(() => vi.restoreAllMocks());
// friendlyError registra los fallos de red en consola: en estas pruebas son esperados.
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

describe('ZIP por tallerista', () => {
  test('un ZIP con un PDF por responsable, la lista de control y los destinatarios', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'tallerista', includeControl: true, deps: server.deps() }));
    expect(result.file.name).toBe('DiaOV2026_QR_Talleristas_2026-10-13.zip');
    expect(result.file.mime).toBe('application/zip');
    const zip = await unzip(result);
    const names = Object.keys(zip.files);
    const pdfs = names.filter((n) => n.endsWith('.pdf'));
    expect(pdfs).toHaveLength(result.documents);
    expect(result.documents).toBe(result.plan.documents.length);
    expect(names).toEqual(expect.arrayContaining(['Lista-de-control.csv', 'Destinatarios.csv']));
    expect(pdfs.filter((n) => n.startsWith('Sin responsable/'))).toHaveLength(3);
    expect(result.included).toHaveLength(64);
    expect(result.pages).toBe(64);
  }, 120_000);

  test('cada QR de cada PDF pasa por el Check-in existente y llega a SU taller; el código manual también', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'tallerista', includeControl: false, deps: server.deps() }));
    const zip = await unzip(result);
    let scanned = 0;
    for (const doc of result.plan.documents) {
      const entry = zip.file(`${doc.folder ? `${doc.folder}/` : ''}${doc.fileName}`)!;
      const decoded = await decodeAllQr(await entry.async('uint8array'));
      expect(decoded).toHaveLength(doc.workshops.length);
      decoded.forEach((token, index) => {
        expect(token).not.toBeNull();
        expect(server.checkIn(token!)).toBe(doc.workshops[index].id); // el QR abre ESE taller
        expect(server.checkIn(server.current(doc.workshops[index].id).manual_code)).toBe(doc.workshops[index].id); // y el código manual es el de la misma credencial
        scanned += 1;
      });
    }
    expect(scanned).toBe(64);
  }, 240_000);

  test('un tallerista con 3 talleres recibe un PDF de 3 páginas', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'tallerista', includeControl: false, deps: server.deps() }));
    const doc = result.plan.documents.find((d) => d.workshops.length === 3)!;
    const zip = await unzip(result);
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(await zip.file(doc.fileName)!.async('uint8array'));
    expect(parsed.getPageCount()).toBe(3);
  }, 120_000);

  test('la lista de control del ZIP no lleva tokens ni códigos manuales', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'tallerista', includeControl: true, deps: server.deps() }));
    const zip = await unzip(result);
    const text = (await zip.file('Lista-de-control.csv')!.async('string')) + (await zip.file('Destinatarios.csv')!.async('string'));
    for (const id of realIds(server)) {
      const { qr_token, manual_code } = server.current(id);
      expect(text).not.toContain(qr_token);
      expect(text).not.toContain(manual_code);
    }
  }, 120_000);
});

describe('otros formatos', () => {
  test('por división: un PDF por grupo; un taller de dos divisiones va en ambos con el mismo QR', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'division', includeControl: false, deps: server.deps() }));
    const zip = await unzip(result);
    const docs = result.plan.documents.filter((d) => d.workshops.some((w) => w.id === 'act-04'));
    expect(docs).toHaveLength(2);
    const tokens = await Promise.all(docs.map(async (d) => {
      const decoded = await decodeAllQr(await zip.file(d.fileName)!.async('uint8array'));
      return decoded[d.workshops.findIndex((w) => w.id === 'act-04')];
    }));
    expect(tokens[0]).toBe(server.current('act-04').qr_token);
    expect(tokens[1]).toBe(tokens[0]);
    expect(result.pages).toBeGreaterThan(64);
    // una credencial por taller, no una por página
    expect(server.calls.credentials.filter((id) => id === 'act-04')).toHaveLength(1);
    expect(server.calls.credentials).toHaveLength(64);
  }, 240_000);

  test('concentrado general sin lista de control: UN solo PDF con un QR por taller y sin duplicados', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, deps: server.deps() }));
    expect(result.file.mime).toBe('application/pdf');
    expect(result.file.name).toBe('DiaOV2026_QR_Concentrado.pdf');
    const bytes = new Uint8Array(await result.file.blob.arrayBuffer());
    const decoded = await decodeAllQr(bytes);
    expect(decoded).toHaveLength(64);
    expect(new Set(decoded).size).toBe(64);
    expect(new Set(decoded.map((token) => server.checkIn(token!))).size).toBe(64);
  }, 240_000);

  test('concentrado con lista de control: un ZIP con el PDF y el CSV', async () => {
    const server = createFakeServer();
    const result = done(await runExport({ workshopIds: realIds(server), format: 'general', includeControl: true, deps: server.deps() }));
    expect(Object.keys((await unzip(result)).files).sort()).toEqual(['DiaOV2026_QR_Concentrado.pdf', 'Lista-de-control.csv']);
  }, 120_000);

  test('por defecto los DEMO no entran; si se piden, van marcados', async () => {
    const server = createFakeServer();
    const demoOnly = [...server.meta.values()].filter((m) => m.is_demo).map((m) => m.activity_id);
    const result = done(await runExport({ workshopIds: demoOnly, format: 'general', includeControl: false, deps: server.deps() }));
    expect(result.file.name).toBe('DiaOV2026_QR_Concentrado_DEMO.pdf');
    expect(result.included).toHaveLength(9);
  }, 120_000);
});

describe('no toca credenciales', () => {
  test('exportar nunca regenera: la credencial es la misma antes y después, y solo se lee una vez por taller', async () => {
    const server = createFakeServer();
    const before = realIds(server).map((id) => server.current(id).qr_token);
    done(await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, deps: server.deps() }));
    expect(server.calls.regenerations).toBe(0);
    expect(realIds(server).map((id) => server.current(id).qr_token)).toEqual(before);
    expect([...server.calls.credentials].sort()).toEqual([...realIds(server)].sort());
    expect(Object.keys(await import('./checkinExportRun'))).not.toContain('regenerateActivityCredential');
  }, 120_000);

  test('los tokens no salen por consola', async () => {
    const server = createFakeServer();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    server.failOn('act-02', 5);
    await runExport({ workshopIds: realIds(server).slice(0, 6), format: 'general', includeControl: false, deps: server.deps() });
    const output = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const id of realIds(server).slice(0, 6)) expect(output).not.toContain(server.current(id).qr_token);
  }, 120_000);

  test('regenerar una credencial después de descargar invalida el PDF anterior y solo ese', async () => {
    const server = createFakeServer();
    const ids = realIds(server).slice(0, 4);
    const result = done(await runExport({ workshopIds: ids, format: 'general', includeControl: false, deps: server.deps() }));
    const oldTokens = await decodeAllQr(new Uint8Array(await result.file.blob.arrayBuffer()));
    expect(oldTokens.map((token) => server.checkIn(token!))).toEqual(result.plan.documents[0].workshops.map((w) => w.id));
    server.regenerate('act-01');
    expect(server.checkIn(oldTokens[result.plan.documents[0].workshops.findIndex((w) => w.id === 'act-01')]!)).toBeNull();
    expect(oldTokens.filter((token) => server.checkIn(token!) !== null)).toHaveLength(3);
    // una descarga nueva trae la vigente
    const again = done(await runExport({ workshopIds: ids, format: 'general', includeControl: false, deps: server.deps() }));
    const fresh = await decodeAllQr(new Uint8Array(await again.file.blob.arrayBuffer()));
    expect(fresh.every((token) => server.checkIn(token!) !== null)).toBe(true);
  }, 240_000);
});

describe('errores a mitad de la exportación', () => {
  beforeEach(() => { quiet(); });
  test('si un QR no se puede obtener NO hay archivo: se dice cuál, y qué sí se obtuvo', async () => {
    const server = createFakeServer();
    server.failOn('act-20');
    const result = await runExport({ workshopIds: realIds(server), format: 'tallerista', includeControl: true, deps: server.deps() });
    expect(result.kind).toBe('incomplete');
    if (result.kind !== 'incomplete') return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ workshopId: 'act-20' });
    expect(result.failures[0].title).toBe('Cocina molecular 21');
    expect(result.held.size).toBe(63);
  }, 120_000);

  test('reintentar pide solo lo que faltó', async () => {
    const server = createFakeServer();
    server.failOn('act-20', 2); // falla los dos intentos del primer pase
    const first = await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, deps: server.deps() });
    expect(first.kind).toBe('incomplete');
    if (first.kind !== 'incomplete') return;
    server.calls.credentials.length = 0;
    const second = done(await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, held: first.held, deps: server.deps() }));
    expect(server.calls.credentials).toEqual(['act-20']);
    expect(second.included).toHaveLength(64);
    expect(second.missing).toHaveLength(0);
  }, 240_000);

  test('un fallo pasajero se reintenta solo, sin molestar a Coordinación', async () => {
    const server = createFakeServer();
    server.failOn('act-20', 1);
    const result = await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, deps: server.deps() });
    expect(result.kind).toBe('done');
  }, 120_000);

  test('descarga parcial solo si se pide: sin ese taller, con FALTANTES.txt y marcado en la lista de control', async () => {
    const server = createFakeServer();
    server.failOn('act-20');
    const result = done(await runExport({ workshopIds: realIds(server), format: 'tallerista', includeControl: true, allowPartial: true, deps: server.deps() }));
    expect(result.file.name).toContain('_INCOMPLETO');
    expect(result.missing.map((m) => m.workshopId)).toEqual(['act-20']);
    expect(result.included).toHaveLength(63);
    const zip = await unzip(result);
    expect(await zip.file('FALTANTES.txt')!.async('string')).toContain('NO está completo');
    expect(await zip.file('FALTANTES.txt')!.async('string')).toContain(result.missing[0].title);
    const control = await zip.file('Lista-de-control.csv')!.async('string');
    const row = control.split('\r\n').find((line) => line.startsWith(result.missing[0].title))!;
    expect(row).toContain('QR no obtenido');
    expect(row).toContain('Requiere revisión');
  }, 120_000);

  test('si una credencial se regenera mientras se descarga, esa no se entrega: se pide reintentar', async () => {
    const server = createFakeServer();
    const deps = server.deps();
    const original = deps.fetchCredential!;
    deps.fetchCredential = async (id) => {
      const value = await original(id);
      if (id === 'act-05') server.regenerate('act-05'); // otra persona regenera justo después de leerla
      return value;
    };
    const result = await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, deps });
    expect(result.kind).toBe('incomplete');
    if (result.kind !== 'incomplete') return;
    expect(result.failures[0]).toMatchObject({ workshopId: 'act-05' });
    expect(result.failures[0].reason).toMatch(/regeneró/);
    expect(result.held.has('act-05')).toBe(false);
    // reintentar trae la nueva
    const retried = done(await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, held: result.held, deps: server.deps() }));
    const decoded = await decodeAllQr(new Uint8Array(await retried.file.blob.arrayBuffer()));
    expect(decoded.every((token) => server.checkIn(token!) !== null)).toBe(true);
  }, 240_000);

  test('una credencial retenida de un intento anterior se descarta si el servidor ya la cambió', async () => {
    const server = createFakeServer();
    server.failOn('act-20', 2);
    const first = await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, deps: server.deps() });
    if (first.kind !== 'incomplete') throw new Error('esperaba incompleto');
    server.regenerate('act-03');
    server.calls.credentials.length = 0;
    const second = done(await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, held: first.held, deps: server.deps() }));
    expect([...server.calls.credentials].sort()).toEqual(['act-03', 'act-20']);
    const decoded = await decodeAllQr(new Uint8Array(await second.file.blob.arrayBuffer()));
    expect(decoded.every((token) => server.checkIn(token!) !== null)).toBe(true);
  }, 240_000);

  test('una credencial incompleta del servidor cuenta como falla, no como PDF sin código', async () => {
    const server = createFakeServer();
    const deps = server.deps({ fetchCredential: async (id) => (id === 'act-07' ? { activity_id: id, qr_token: '', manual_code: 'ABC234' } : { activity_id: id, ...server.current(id) }) });
    const result = await runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, attempts: 1, deps });
    expect(result.kind).toBe('incomplete');
    if (result.kind === 'incomplete') expect(result.failures[0]).toMatchObject({ workshopId: 'act-07', reason: 'El servidor devolvió una credencial incompleta.' });
  }, 120_000);

  test('un taller confirmado que ya no existe se informa', async () => {
    const server = createFakeServer();
    const ids = realIds(server).slice(0, 5);
    server.meta.delete('act-02');
    const result = await runExport({ workshopIds: ids, format: 'general', includeControl: false, deps: server.deps() });
    expect(result.kind).toBe('incomplete');
    if (result.kind === 'incomplete') expect(result.failures[0]).toMatchObject({ workshopId: 'act-02', reason: expect.stringContaining('Ya no existe') });
  }, 120_000);
});

describe('permisos', () => {
  test('sin permiso no se entrega nada ni se pide ninguna credencial', async () => {
    const server = createFakeServer();
    server.deny();
    await expect(runExport({ workshopIds: realIds(createFakeServer()), format: 'general', includeControl: false, deps: server.deps() })).rejects.toThrow('NOT_AUTHORIZED');
    expect(server.calls.credentials).toHaveLength(0);
  });
  test('si se pierde el permiso a mitad de camino, las credenciales fallan y no hay archivo', async () => {
    const server = createFakeServer();
    const deps = server.deps({ fetchCredential: async () => { throw new Error('NOT_AUTHORIZED'); } });
    const result = await runExport({ workshopIds: realIds(server).slice(0, 3), format: 'general', includeControl: false, attempts: 1, deps });
    expect(result.kind).toBe('incomplete');
    if (result.kind === 'incomplete') expect(result.failures[0].reason).toMatch(/No tienes permiso/);
  });
});

describe('talleres que no se pueden producir', () => {
  test('un taller que se canceló mientras tanto no se exporta como válido', async () => {
    const server = createFakeServer();
    const ids = realIds(server).slice(0, 5);
    server.meta.get('act-01')!.sessions.forEach((s) => { s.status = 'cancelada'; });
    const result = done(await runExport({ workshopIds: ids, format: 'general', includeControl: true, deps: server.deps() }));
    expect(result.included.map((w) => w.id)).not.toContain('act-01');
    expect(result.plan.excluded.map((e) => e.workshop.id)).toEqual(['act-01']);
    expect(server.calls.credentials).not.toContain('act-01'); // ni siquiera se pide su credencial
    const control = await (await unzip(result)).file('Lista-de-control.csv')!.async('string');
    expect(control).toContain('Sin horarios vigentes');
  });
  test('un solo taller sin horarios explica por qué', async () => {
    const server = createFakeServer();
    server.meta.get('act-01')!.sessions.forEach((s) => { s.status = 'cancelada'; });
    const workshop = normalizeWorkshops([...server.meta.values()]).find((w) => w.id === 'act-01')!;
    await expect(exportSingleWorkshop(workshop, server.deps())).rejects.toThrow(/Sin horarios vigentes/);
  });
  test('descarga de un solo taller: un PDF de una página con su QR', async () => {
    const server = createFakeServer();
    const workshop = normalizeWorkshops([...server.meta.values()]).find((w) => w.id === 'act-05')!;
    const file = await exportSingleWorkshop(workshop, server.deps());
    expect(file.name).toBe(`DiaOV2026_QR_${slugify(workshop.title)}.pdf`);
    const decoded = await decodeAllQr(new Uint8Array(await file.blob.arrayBuffer()));
    expect(decoded.map((token) => server.checkIn(token!))).toEqual(['act-05']);
  });
});

describe('cancelación durante la generación', () => {
  test('cancelar mientras se generan los PDF no entrega nada', async () => {
    const server = createFakeServer();
    const controller = new AbortController();
    await expect(runExport({
      workshopIds: realIds(server).slice(0, 10), format: 'tallerista', includeControl: true, signal: controller.signal, deps: server.deps(),
      onProgress: (p) => { if (p.phase === 'documentos' && p.done === 2) controller.abort(); },
    })).rejects.toBeInstanceOf(ExportAborted);
  }, 120_000);
  test('cancelar durante la compresión ZIP descarta el archivo', async () => {
    const server = createFakeServer();
    const controller = new AbortController();
    await expect(runExport({
      workshopIds: realIds(server).slice(0, 10), format: 'tallerista', includeControl: true, signal: controller.signal, deps: server.deps(),
      onProgress: (p) => { if (p.phase === 'comprimiendo') controller.abort(); },
    })).rejects.toBeInstanceOf(ExportAborted);
  }, 120_000);
  test('cancelar justo después del último PDF de un concentrado sin ZIP también descarta el archivo', async () => {
    const server = createFakeServer();
    const controller = new AbortController();
    await expect(runExport({
      workshopIds: realIds(server).slice(0, 3), format: 'general', includeControl: false, signal: controller.signal, deps: server.deps(),
      onProgress: (p) => { if (p.phase === 'documentos' && p.done === 1) controller.abort(); },
    })).rejects.toBeInstanceOf(ExportAborted);
  }, 120_000);
});

describe('Vida Universitaria heredada con división: mismos QR y códigos', () => {
  test('el ZIP por división agrupa por tipo y cada PDF conserva su QR y código manual', async () => {
    const server = createFakeServer();
    for (const id of ['act-55', 'act-63']) { const m = server.meta.get(id)!; m.activity_type = 'liderazgo'; m.divisions = [server.meta.get('act-00')!.divisions[0]]; }
    const ids = ['act-00', 'act-04', 'act-55', 'act-63', 'act-08'];
    const result = done(await runExport({ workshopIds: ids, format: 'division', includeControl: true, deps: server.deps() }));
    const zip = await unzip(result);
    const vida = result.plan.documents.find((d) => d.title === 'Vida Universitaria')!;
    expect(vida.workshops.map((w) => w.id).sort()).toEqual(['act-55', 'act-63']);
    const decoded = await decodeAllQr(await zip.file(vida.fileName)!.async('uint8array'));
    decoded.forEach((token, index) => {
      expect(token).toBe(server.current(vida.workshops[index].id).qr_token);
      expect(server.checkIn(server.current(vida.workshops[index].id).manual_code)).toBe(vida.workshops[index].id);
    });
    const control = (await zip.file('Lista-de-control.csv')!.async('string')).trim().split('\r\n');
    expect(control).toHaveLength(1 + ids.length);
  }, 120_000);
});

describe('progreso y cancelación', () => {
  test('avanza por fases, en orden y sin retroceder dentro de cada una', async () => {
    const server = createFakeServer();
    const events: RunProgress[] = [];
    done(await runExport({ workshopIds: realIds(server).slice(0, 12), format: 'tallerista', includeControl: true, deps: server.deps(), onProgress: (p) => events.push(p) }));
    const order = ['preparando', 'credenciales', 'documentos', 'comprimiendo'];
    const phases = events.map((e) => e.phase);
    expect([...new Set(phases)]).toEqual(order);
    expect(phases).toEqual([...phases].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const phase of order) {
      const values = events.filter((e) => e.phase === phase).map((e) => e.done);
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
    expect(events.filter((e) => e.phase === 'credenciales').slice(-1)[0]).toMatchObject({ done: 12, total: 12 });
  }, 120_000);

  test('cancelar detiene la exportación y no entrega nada', async () => {
    const server = createFakeServer();
    const controller = new AbortController();
    const deps = server.deps();
    const original = deps.fetchCredential!;
    let reads = 0;
    deps.fetchCredential = async (id) => { reads += 1; if (reads === 3) controller.abort(); return original(id); };
    await expect(runExport({ workshopIds: realIds(server), format: 'general', includeControl: false, concurrency: 1, signal: controller.signal, deps })).rejects.toBeInstanceOf(ExportAborted);
    expect(reads).toBeLessThan(10);
  });
});
