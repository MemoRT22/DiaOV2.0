import QRCode from 'qrcode';
import type { PDFFont, PDFPage, PDFImage } from 'pdf-lib';
import { fold } from './csv';
import { areaLabel, KIND_LABEL, type ExportDocument, type ExportWorkshop } from './checkinExport';
import { EVENT_TIME_ZONE } from './eventTime';

/*
 * PDF del QR de asistencia de un taller (Carta, una página por taller).
 *
 * El QR es el existente de la actividad: el mismo token que muestra Check-in, dibujado como vectores para que se imprima nítido a
 * cualquier tamaño. No lleva enlaces ni datos de participantes. pdf-lib se carga bajo demanda: solo se descarga al exportar.
 */

export type ExportCredential = { qr_token: string; manual_code: string };

export const PAGE = { width: 612, height: 792 } as const;
const MARGIN = 54;
const CONTENT = PAGE.width - MARGIN * 2;

const INK = [0.145, 0.165, 0.18] as const;
const MUTED = [0.4, 0.44, 0.47] as const;
const ORANGE = [0.725, 0.278, 0.125] as const;
const RULE = [0.89, 0.894, 0.89] as const;

/** Matriz de módulos del QR con la misma corrección de errores que usa la pantalla de Check-in (nivel M por defecto). */
export function qrMatrix(token: string): boolean[][] {
  const { modules } = QRCode.create(token, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => !!modules.get(row, col)));
}

const parts = new Intl.DateTimeFormat('es-MX', { timeZone: EVENT_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clock = new Intl.DateTimeFormat('es-MX', { timeZone: EVENT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** «mié 14 oct · 10:00–11:00», siempre en la hora de Cancún. Sin espacios especiales que la fuente del PDF no tenga. */
export function sessionLabel(startsAt: string, endsAt: string) {
  const start = Object.fromEntries(parts.formatToParts(new Date(startsAt)).map((part) => [part.type, part.value]));
  const weekday = (start.weekday ?? '').replace('.', '');
  const month = (start.month ?? '').replace('.', '');
  return `${weekday} ${start.day} ${month} · ${start.hour}:${start.minute}–${clock.format(new Date(endsAt))}`;
}

/** Deja solo los caracteres que la fuente estándar del PDF sabe dibujar: sin acento si hace falta, o «?» si no hay equivalente. */
export function pdfSafe(text: string, font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  let out = '';
  for (const char of text.normalize('NFC').replace(/[   ]/g, ' ').replace(/[\r\n\t]+/g, ' ')) {
    const code = char.codePointAt(0)!;
    if (supported.has(code)) { out += char; continue; }
    const base = char.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every((piece) => supported.has(piece.codePointAt(0)!)) ? base : '?';
  }
  return out;
}

/** Parte un texto en líneas que caben en `width`; una palabra más larga que la línea se corta. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  const fits = (value: string) => font.widthOfTextAtSize(value, size) <= width;
  // Cada palabra puede cortarse después de un guion; entre palabras va un espacio, entre trozos de una misma palabra no.
  const tokens = text.split(' ').filter(Boolean).flatMap((word) => word.split(/(?<=-)(?=.)/).map((piece, index) => ({ piece, space: index === 0 })));
  for (const { piece: original, space } of tokens) {
    let piece = original;
    while (!fits(piece)) {
      let cut = piece.length - 1;
      while (cut > 1 && !fits(piece.slice(0, cut))) cut -= 1;
      if (line) { lines.push(line); line = ''; }
      lines.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    const next = line ? `${line}${space ? ' ' : ''}${piece}` : piece;
    if (fits(next)) line = next;
    else { lines.push(line); line = piece; }
  }
  if (line) lines.push(line);
  return lines;
}

/** El tamaño más grande (entre `max` y `min`) con el que el texto entra en `maxLines`; si ni así cabe, se corta con «…». */
export function fitText(text: string, font: PDFFont, width: number, max: number, min: number, maxLines: number): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 1) {
    const lines = wrapText(text, font, size, width);
    if (lines.length <= maxLines) return { size, lines };
  }
  const lines = wrapText(text, font, min, width).slice(0, maxLines);
  let last = lines[maxLines - 1] ?? '';
  while (last && font.widthOfTextAtSize(`${last}…`, min) > width) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last.trimEnd()}…`;
  return { size: min, lines };
}

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

const color = (rgbFn: (r: number, g: number, b: number) => unknown, value: readonly [number, number, number]) => rgbFn(value[0], value[1], value[2]);

export type PdfOptions = {
  /** Logotipo PNG opcional; si no se puede cargar, el encabezado usa solo texto. */
  logo?: Uint8Array | null;
  now?: Date;
};

export type BuiltPdf = { bytes: Uint8Array; pages: number };

/**
 * Un PDF con una página por taller, en el orden recibido. `credentials` tiene que traer la credencial de TODOS los talleres: si falta
 * una, se lanza error en vez de producir un archivo incompleto.
 */
export async function buildDocumentPdf(document: ExportDocument, credentials: ReadonlyMap<string, ExportCredential>, options: PdfOptions = {}): Promise<BuiltPdf> {
  const missing = document.workshops.filter((workshop) => !credentials.get(workshop.id)?.qr_token);
  if (missing.length > 0) throw new Error(`MISSING_CREDENTIAL:${missing.map((workshop) => workshop.id).join(',')}`);

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`QR de asistencia · ${document.title}`);
  pdf.setAuthor('Anáhuac Cancún');
  pdf.setSubject('Día OV 2026 · Códigos de asistencia de talleres');
  pdf.setCreator('Día OV 2026');
  pdf.setProducer('Día OV 2026');
  pdf.setCreationDate(options.now ?? new Date());
  pdf.setModificationDate(options.now ?? new Date());

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.CourierBold),
  };
  let logo: PDFImage | null = null;
  if (options.logo) {
    try { logo = await pdf.embedPng(options.logo); } catch { logo = null; }
  }

  for (const workshop of document.workshops) {
    const credential = credentials.get(workshop.id)!;
    drawPage(pdf.addPage([PAGE.width, PAGE.height]), workshop, credential, fonts, logo, rgb as never);
  }
  return { bytes: await pdf.save(), pages: document.workshops.length };
}

type Layout = {
  title: { size: number; lines: string[] };
  details: { label: string; lines: string[] }[];
  sessions: { text: string; where: string | null }[];
  columns: number;
  rows: number;
  sessionSize: number;
  lineHeight: number;
  sessionsHeight: number;
  side: number;
  compact: boolean;
};

const HEADER = 30 + 10 + 26;
const FOOTER = 28;
const CODE_BLOCK = 74;
const INSTRUCTION_BLOCK = 44;

/** Mide todo lo que va en la página para repartir el espacio: el QR toma lo que sobra (entre 150 y 300 pt de lado). */
function measure(workshop: ExportWorkshop, fonts: Fonts, compact: boolean): Layout {
  const safe = (text: string, font: PDFFont) => pdfSafe(text, font);
  const title = fitText(safe(workshop.title, fonts.bold), fonts.bold, CONTENT, compact ? 22 : 28, compact ? 11 : 14, compact ? 8 : 5);

  const area = areaLabel(workshop);
  const entries: [string, string][] = [];
  if (workshop.responsible?.name) entries.push(['Responsable', workshop.responsible.name]);
  if (area) entries.push([workshop.kind === 'vida_universitaria' && workshop.divisions.length === 0 ? 'Tipo' : 'División / área', area]);
  if (workshop.place) entries.push(['Lugar', workshop.place]);
  if (!compact && (workshop.kind === 'academica' || workshop.divisions.length > 0)) entries.push(['Tipo', KIND_LABEL[workshop.kind]]);
  const details = entries.map(([label, value]) => ({ label, lines: wrapText(safe(value, fonts.regular), fonts.regular, 11, CONTENT - DETAIL_LABEL).slice(0, compact ? 2 : 3) }));
  const detailsHeight = details.reduce((total, detail) => total + 15 + (detail.lines.length - 1) * 13, 0);

  // El lugar del horario solo se muestra cuando es distinto al del taller.
  const place = fold(workshop.place);
  const sessions = workshop.sessions.map((session) => ({
    text: sessionLabel(session.startsAt, session.endsAt),
    where: session.location && fold(session.location) !== place ? session.location : null,
  }));
  const columns = sessions.length > 30 ? 4 : sessions.length > 16 ? 3 : sessions.length > 6 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(sessions.length / columns));
  const sessionSize = [10, 10, 9, 8, 7.5][columns];
  const lineHeight = sessionSize + 4;
  const sessionsHeight = sessions.length === 0 ? 0 : 22 + rows * lineHeight;

  const fixed = MARGIN + HEADER + 10 + title.size * 1.18 * title.lines.length + 12 + detailsHeight + 8 + 16 + (compact ? 64 : CODE_BLOCK + 8) + (compact ? 38 : INSTRUCTION_BLOCK) + sessionsHeight + FOOTER + MARGIN;
  const side = Math.max(150, Math.min(300, PAGE.height - fixed));
  return { title, details, sessions, columns, rows, sessionSize, lineHeight, sessionsHeight, side, compact };
}

const DETAIL_LABEL = 82;

function drawPage(page: PDFPage, workshop: ExportWorkshop, credential: ExportCredential, fonts: Fonts, logo: PDFImage | null, rgb: (r: number, g: number, b: number) => unknown) {
  const paint = (value: readonly [number, number, number]) => color(rgb, value) as ReturnType<typeof import('pdf-lib').rgb>;
  const safe = (text: string, font: PDFFont) => pdfSafe(text, font);
  let layout = measure(workshop, fonts, false);
  // Un nombre larguísimo o muchos horarios dejarían un QR pequeño: se compacta el resto (menos texto de apoyo) para que el QR siga grande.
  if (layout.side < 210) layout = measure(workshop, fonts, true);
  let y = PAGE.height - MARGIN; // cursor vertical: baja conforme se coloca contenido

  // --- Encabezado: identidad de Anáhuac Cancún y de la edición ---
  const headerHeight = 30;
  if (logo) {
    const width = (logo.width / logo.height) * headerHeight;
    page.drawImage(logo, { x: MARGIN, y: y - headerHeight, width, height: headerHeight });
  } else {
    page.drawText(safe('ANÁHUAC', fonts.bold), { x: MARGIN, y: y - 22, size: 22, font: fonts.bold, color: paint(ORANGE) });
  }
  const right = safe('Día OV 2026', fonts.bold);
  page.drawText(right, { x: PAGE.width - MARGIN - fonts.bold.widthOfTextAtSize(right, 16), y: y - 14, size: 16, font: fonts.bold, color: paint(INK) });
  const campus = safe('Anáhuac Cancún', fonts.regular);
  page.drawText(campus, { x: PAGE.width - MARGIN - fonts.regular.widthOfTextAtSize(campus, 10), y: y - 28, size: 10, font: fonts.regular, color: paint(MUTED) });
  y -= headerHeight + 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1.5, color: paint(ORANGE) });
  y -= 26;

  // --- Nombre del taller completo ---
  page.drawText(safe('CÓDIGO DE ASISTENCIA', fonts.bold), { x: MARGIN, y, size: 9.5, font: fonts.bold, color: paint(ORANGE) });
  y -= 10;
  for (const line of layout.title.lines) {
    y -= layout.title.size * 1.18;
    page.drawText(line, { x: MARGIN, y, size: layout.title.size, font: fonts.bold, color: paint(INK) });
  }
  y -= 12;

  // --- Responsable, área y lugar ---
  for (const detail of layout.details) {
    page.drawText(safe(detail.label, fonts.bold), { x: MARGIN, y: y - 11, size: 9.5, font: fonts.bold, color: paint(MUTED) });
    detail.lines.forEach((line, index) => page.drawText(line, { x: MARGIN + DETAIL_LABEL, y: y - 11 - index * 13, size: 11, font: fonts.regular, color: paint(INK) }));
    y -= 15 + (detail.lines.length - 1) * 13;
  }
  y -= 8;

  // --- QR: el existente de la actividad, en vectores ---
  const matrix = qrMatrix(credential.qr_token);
  const quiet = 4; // módulos de margen blanco, lo que exige la especificación para que el lector lo encuentre
  const total = matrix.length + quiet * 2;
  const side = layout.side;
  const module = side / total;
  const left = (PAGE.width - side) / 2;
  const top = y - 8;
  // Todos los módulos van en UN solo trazo, por tramos continuos de cada fila: así los visores los rellenan juntos y no aparecen costuras
  // entre módulos contiguos (con un rectángulo por módulo se ven líneas claras al ampliar o imprimir).
  const origin = { x: left + quiet * module, y: top - quiet * module };
  const path: string[] = [];
  const num = (value: number) => Number(value.toFixed(3));
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c += 1; continue; }
      let end = c;
      while (end < row.length && row[end]) end += 1;
      path.push(`M${num(c * module)} ${num(r * module)}h${num((end - c) * module)}v${num(module)}h${num(-(end - c) * module)}z`);
      c = end;
    }
  });
  page.drawSvgPath(path.join(''), { x: origin.x, y: origin.y, color: rgb(0, 0, 0) as never, borderWidth: 0 });
  y = top - side - 6;

  // --- Código manual ---
  const centered = (text: string, font: PDFFont, size: number, at: number, tone: readonly [number, number, number]) =>
    page.drawText(text, { x: (PAGE.width - font.widthOfTextAtSize(text, size)) / 2, y: at, size, font, color: paint(tone) });
  centered(safe('CÓDIGO MANUAL', fonts.bold), fonts.bold, 9, y - 8, MUTED);
  // El código se imprime tal cual (sin guiones ni espacios que el lector del Check-in no espere), con separación entre letras para leerlo de lejos.
  const code = credential.manual_code.replace(/[^\x20-\x7E]/g, '');
  const tracking = 9;
  const codeSize = Math.min(layout.compact ? 30 : 40, (CONTENT - 20 - tracking * Math.max(0, code.length - 1)) / Math.max(1, fonts.mono.widthOfTextAtSize(code, 1)));
  const codeWidth = fonts.mono.widthOfTextAtSize(code, codeSize) + tracking * Math.max(0, code.length - 1);
  let cursor = (PAGE.width - codeWidth) / 2;
  for (const char of code) {
    page.drawText(char, { x: cursor, y: y - (layout.compact ? 36 : 42), size: codeSize, font: fonts.mono, color: paint(INK) });
    cursor += fonts.mono.widthOfTextAtSize(char, codeSize) + tracking;
  }
  y -= (layout.compact ? 56 : CODE_BLOCK) - 2;

  // --- Instrucción ---
  centered(safe('Abre el Pasaporte Digital de Día OV y escanea este código desde la plataforma.', fonts.bold), fonts.bold, 11.5, y - 6, INK);
  centered(safe('Si el escaneo no funciona, captura el código manual en el mismo lugar.', fonts.regular), fonts.regular, 10, y - 22, MUTED);
  y -= layout.compact ? 38 : INSTRUCTION_BLOCK;

  // --- Horarios ---
  if (layout.sessions.length > 0) {
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE.width - MARGIN, y: y + 6 }, thickness: 0.5, color: paint(RULE) });
    page.drawText(safe(`Horarios · el mismo código sirve para todos (${layout.sessions.length})`, fonts.bold), { x: MARGIN, y: y - 8, size: 9, font: fonts.bold, color: paint(MUTED) });
    const columnWidth = CONTENT / layout.columns;
    layout.sessions.forEach((session, index) => {
      const column = Math.floor(index / layout.rows);
      const row = index % layout.rows;
      const text = safe(session.where ? `${session.text} · ${session.where}` : session.text, fonts.regular);
      let shown = text;
      while (shown.length > 1 && fonts.regular.widthOfTextAtSize(shown, layout.sessionSize) > columnWidth - 10) shown = shown.slice(0, -1);
      page.drawText(shown === text ? shown : `${shown.slice(0, -1).trimEnd()}…`, { x: MARGIN + column * columnWidth, y: y - 24 - row * layout.lineHeight, size: layout.sessionSize, font: fonts.regular, color: paint(INK) });
    });
  }

  // --- Pie ---
  page.drawText(safe('Anáhuac Cancún · Día OV 2026', fonts.regular), { x: MARGIN, y: MARGIN - 6, size: 8.5, font: fonts.regular, color: paint(MUTED) });
}
