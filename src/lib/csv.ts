export type CsvColumn = { key: string; label: string; aliases: string[]; required?: boolean };

export type CsvExtraCell = { col: number; header: string; value: string };

export type CsvMapping = {
  rows: Record<string, string>[];
  extras: CsvExtraCell[][];
  missing: CsvColumn[];
  unknownHeaders: string[];
  matched: { column: CsvColumn; header: string; index: number }[];
};

export function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\uFEFF/, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function detectDelimiter(firstLine: string) {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(clean.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** `discard` recibe el encabezado normalizado: las columnas que devuelva true no se leen ni se conservan como información adicional. */
export function mapColumns(table: string[][], columns: CsvColumn[], discard?: (foldedHeader: string) => boolean): CsvMapping {
  const [header = [], ...body] = table;
  const folded = header.map(fold);
  const matched: CsvMapping['matched'] = [];
  const used = new Set<number>();
  for (const column of columns) {
    const names = [column.label, ...column.aliases].map(fold);
    let index = folded.findIndex((h, i) => !used.has(i) && names.includes(h));
    if (index < 0) index = folded.findIndex((h, i) => !used.has(i) && names.some((n) => n.length > 3 && h.startsWith(n)));
    if (index >= 0) {
      used.add(index);
      matched.push({ column, header: header[index], index });
    }
  }
  const indexOf = new Map(matched.map((m) => [m.column.key, m.index]));
  const width = Math.max(header.length, ...body.map((cells) => cells.length));
  const extraCols = Array.from({ length: width }, (_, i) => i).filter(
    (i) => !used.has(i) && !discard?.(folded[i] ?? '') && ((header[i] ?? '').trim() !== '' || body.some((cells) => (cells[i] ?? '').trim() !== '')),
  );
  const rows = body.map((cells) => {
    const out: Record<string, string> = {};
    for (const [key, i] of indexOf) out[key] = (cells[i] ?? '').trim();
    return out;
  });
  // Every row carries the full extra-column schema (empty values included) so the server
  // numbers duplicate headers the same way for every row.
  const extras = body.map((cells) =>
    extraCols.map((i) => ({ col: i + 1, header: (header[i] ?? '').replace(/^\uFEFF/, ''), value: (cells[i] ?? '').trim() })),
  );
  return {
    rows,
    extras,
    matched,
    missing: columns.filter((c) => c.required && !indexOf.has(c.key)),
    unknownHeaders: extraCols.map((i) => (header[i] ?? '').trim() || `Columna sin título ${i + 1}`),
  };
}

export function toIsoDate(value: string): string | null {
  const v = value.trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return pad(m[1], m[2], m[3]);
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return pad(m[3], m[2], m[1]);
  return null;
}

function pad(y: string, mo: string, d: string) {
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

export function toIsoTimestamp(value: string): string {
  const v = value.trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}-05:00`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function toBool(value: string): boolean | null {
  const v = fold(value);
  if (!v) return null;
  if (/^(si|s|yes|y|true|verdadero|1|acepto|x)\b/.test(v) || v.includes('acepto') || v.includes('autorizo')) return true;
  if (/^(no|n|false|falso|0)\b/.test(v)) return false;
  return null;
}

export function toTime(value: string): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : value.trim();
}
