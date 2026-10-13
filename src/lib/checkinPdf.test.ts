// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildPlan, normalizeWorkshops, type ExportDocument, type ExportWorkshop } from './checkinExport';
import { buildDocumentPdf, fitText, pdfSafe, qrMatrix, sessionLabel, wrapText, PAGE } from './checkinPdf';
import { buildFixtureMeta, credentialFor } from '../test/qrExportFixtures';
import { decodeAllQr, pageTexts } from '../test/pdfRaster';

const workshops = normalizeWorkshops(buildFixtureMeta());
const real = workshops.filter((w) => !w.isDemo);
const logo = new Uint8Array(readFileSync('public/assets/images/Logo_Anahuac_NRA_Licenciaturas.png'));
const creds = (list: ExportWorkshop[]) => new Map(list.map((w) => [w.id, credentialFor(w.id)]));
const docOf = (list: ExportWorkshop[]): ExportDocument => ({ ...buildPlan(list, 'general').documents[0], workshops: list });
const byId = (id: string) => workshops.find((w) => w.id === id)!;

describe('PDF del QR', () => {
  test('una página Carta por taller, en el orden recibido', async () => {
    const list = [byId('act-00'), byId('act-01'), byId('act-02')];
    const { bytes, pages } = await buildDocumentPdf(docOf(list), creds(list), { logo });
    expect(pages).toBe(3);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(3);
    expect(parsed.getPage(0).getSize()).toEqual({ width: PAGE.width, height: PAGE.height });
    expect(PAGE).toEqual({ width: 612, height: 792 }); // US Letter
    const texts = await pageTexts(bytes);
    list.forEach((w, index) => expect(texts[index]).toContain(w.title));
  });

  test('el QR impreso es el token de la credencial: un solo QR por taller aunque tenga varios horarios', async () => {
    const list = real.slice(0, 8);
    const c = creds(list);
    const decoded = await decodeAllQr((await buildDocumentPdf(docOf(list), c, { logo })).bytes);
    expect(decoded).toEqual(list.map((w) => c.get(w.id)!.qr_token));
    expect(list.some((w) => w.sessions.length > 1)).toBe(true);
  });

  test('imprime el código manual de la MISMA credencial y los datos del taller, sin enlaces ni datos de participantes', async () => {
    const w = byId('act-09'); // cambia de espacio en su segundo horario
    const c = creds([w]);
    const { bytes } = await buildDocumentPdf(docOf([w]), c, { logo });
    const [text] = await pageTexts(bytes);
    expect(text.replace(/ /g, '')).toContain(c.get(w.id)!.manual_code);
    expect(text).toContain(w.title);
    expect(text).toContain(w.responsible!.name!);
    expect(text).toContain(w.divisions[0].name);
    expect(text).toContain(w.place);
    expect(text).toContain('Auditorio Principal'); // el lugar del horario solo aparece cuando es distinto
    expect(text).toContain('Pasaporte Digital');
    expect(text).toContain('Anáhuac Cancún');
    expect(text).toContain('Día OV 2026');
    expect(text).not.toMatch(/https?:\/\/|\/coordinacion|@example\.test/);
    // el token solo existe como QR: no hay texto con él ni en el archivo
    expect(Buffer.from(bytes).toString('latin1')).not.toContain(c.get(w.id)!.qr_token);
    expect(text).not.toContain(c.get(w.id)!.qr_token);
  });

  test('el lugar de un horario no se repite cuando es el del taller', async () => {
    const w = byId('act-02');
    const [text] = await pageTexts((await buildDocumentPdf(docOf([w]), creds([w]), { logo })).bytes);
    expect(text.split(w.place).length - 1).toBe(1); // solo en «Lugar»
  });

  test('nombres larguísimos se imprimen completos y no se salen de la página', async () => {
    for (const id of ['act-07', 'act-33', 'act-50']) {
      const w = byId(id);
      const { bytes } = await buildDocumentPdf(docOf([w]), creds([w]), { logo });
      const [text] = await pageTexts(bytes);
      expect(text.replace(/[\s-]/g, '')).toContain(w.title.replace(/[\s-]/g, '')); // completo, sin «…» ni cortes
      expect(text).not.toContain('…');
      expect(await decodeAllQr(bytes)).toEqual([credentialFor(id).qr_token]); // y el QR sigue legible
    }
  });

  test('un taller con 14 horarios los muestra todos', async () => {
    const w = byId('act-33');
    expect(w.sessions).toHaveLength(14);
    const [text] = await pageTexts((await buildDocumentPdf(docOf([w]), creds([w]), { logo })).bytes);
    expect(text.match(/\d{2}:\d{2}–\d{2}:\d{2}/g) ?? []).toHaveLength(14);
  });

  test('con muchísimos horarios sigue cabiendo y el QR sigue legible', async () => {
    const hours = (n: number, plus: number) => new Date(Date.UTC(2026, 9, 14 + (n % 2), 14 + (n % 9) + plus)).toISOString();
    const w: ExportWorkshop = {
      ...byId('act-12'),
      sessions: Array.from({ length: 36 }, (_, n) => ({ id: `x${n}`, startsAt: hours(n, 0), endsAt: hours(n, 1), location: n === 3 ? 'Sala especial muy larga para forzar el recorte del renglón de horarios' : null })),
    };
    const { bytes } = await buildDocumentPdf(docOf([w]), creds([w]), { logo });
    const [text] = await pageTexts(bytes);
    expect(text.match(/\d{2}:\d{2}–\d{2}:\d{2}/g) ?? []).toHaveLength(36);
    expect(await decodeAllQr(bytes)).toEqual([credentialFor(w.id).qr_token]);
  });

  test('sin logotipo el encabezado sigue completo', async () => {
    const w = byId('act-00');
    const [text] = await pageTexts((await buildDocumentPdf(docOf([w]), creds([w]), { logo: null })).bytes);
    expect(text).toContain('ANÁHUAC');
  });

  test('un taller sin responsable ni división no imprime campos vacíos', async () => {
    const w = byId('act-61');
    expect(w.responsible).toBeNull();
    const [text] = await pageTexts((await buildDocumentPdf(docOf([w]), creds([w]), { logo })).bytes);
    expect(text).not.toContain('Responsable');
    expect(text).not.toMatch(/undefined|null/);
  });

  test('caracteres que la fuente del PDF no tiene no rompen la generación', async () => {
    const w: ExportWorkshop = { ...byId('act-00'), title: 'Taller 日本語 con ñandú, “comillas” y emoji 🎉 — ok' };
    const { bytes } = await buildDocumentPdf(docOf([w]), creds([w]), { logo });
    const [text] = await pageTexts(bytes);
    expect(text).toContain('ñandú');
    expect(text).toContain('“comillas”');
    expect(await decodeAllQr(bytes)).toEqual([credentialFor(w.id).qr_token]);
  });

  test('si falta la credencial de un taller NO se produce un PDF incompleto', async () => {
    const list = [byId('act-00'), byId('act-01')];
    await expect(buildDocumentPdf(docOf(list), creds(list.slice(0, 1)), { logo })).rejects.toThrow(/MISSING_CREDENTIAL:act-01/);
    const empty = new Map([[list[1].id, { qr_token: '', manual_code: 'ABC234' }]]);
    await expect(buildDocumentPdf(docOf([list[1]]), empty, { logo })).rejects.toThrow(/MISSING_CREDENTIAL/);
  });

  test('metadatos del archivo con la identidad del evento', async () => {
    const w = byId('act-00');
    const { bytes } = await buildDocumentPdf(docOf([w]), creds([w]), { logo });
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getAuthor()).toBe('Anáhuac Cancún');
    expect(parsed.getTitle()).toContain('QR de asistencia');
  });
});

describe('ayudas de dibujo', () => {
  test('la matriz del QR es cuadrada y trae los tres patrones de esquina', () => {
    const matrix = qrMatrix(credentialFor('x').qr_token);
    expect(matrix.length).toBe(matrix[0].length);
    expect(matrix.length).toBeGreaterThanOrEqual(33);
    for (const [r, c] of [[0, 0], [0, matrix.length - 7], [matrix.length - 7, 0]]) {
      expect(matrix[r][c] && matrix[r + 6][c + 6] && matrix[r][c + 6] && matrix[r + 6][c]).toBe(true);
    }
  });
  test('etiqueta de horario en hora de Cancún, sin depender de la zona del equipo', () => {
    expect(sessionLabel('2026-10-14T15:00:00.000Z', '2026-10-14T16:00:00.000Z')).toBe('mié 14 oct · 10:00–11:00');
    expect(sessionLabel('2026-10-15T04:30:00.000Z', '2026-10-15T05:00:00.000Z')).toBe('mié 14 oct · 23:30–00:00');
  });
  test('texto sin símbolos que la fuente no tiene', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(pdfSafe('Ñandú ā 日 🎉  x', font)).toBe('Ñandú a ? ?  x');
  });
  test('wrapText y fitText: ninguna línea excede el ancho y se corta por guiones', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    const text = 'uno-dos-tres-cuatro-cinco-seis-siete-ocho-nueve-diez-once-doce';
    const lines = wrapText(text, font, 20, 150);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => font.widthOfTextAtSize(line, 20) <= 150)).toBe(true);
    expect(lines.join('')).toBe(text);
    const fit = fitText('palabra '.repeat(80), font, 300, 28, 12, 3);
    expect(fit.lines.length).toBeLessThanOrEqual(3);
    expect(fit.lines[fit.lines.length - 1]).toMatch(/…$/);
  });
});
