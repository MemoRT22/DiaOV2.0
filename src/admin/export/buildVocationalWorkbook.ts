export interface VocationalExportRow {
  participant_id: string;
  full_name: string;
  is_demo: boolean;
  initial_career_code: string;
  initial_career: string;
  initial_division: string;
  interest_1: string;
  interest_2: string;
  interest_3: string;
  attended_count: number;
  divisions_visited: string;
  attended_workshops: string;
}

export interface VocationalExportPayload {
  edition: string;
  edition_code: string;
  generated_at: string;
  generated_by: string;
  count: number;
  rows: VocationalExportRow[];
}

export async function buildVocationalWorkbook(payload: VocationalExportPayload): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Día OV';
  wb.created = new Date();

  const ws = wb.addWorksheet('Intereses y asistencias');
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const headers = [
    'ID',
    'Nombre',
    'Interés inicial',
    'División inicial',
    'Opción 1',
    'Opción 2',
    'Opción 3',
    'Talleres asistidos',
    'Divisiones visitadas',
    'Talleres (detalle)',
  ];

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2A4A' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 24;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  for (const row of payload.rows) {
    ws.addRow([
      row.participant_id ?? '',
      row.full_name ?? '',
      row.initial_career ?? '',
      row.initial_division ?? '',
      row.interest_1 ?? '',
      row.interest_2 ?? '',
      row.interest_3 ?? '',
      row.attended_count ?? 0,
      row.divisions_visited ?? '',
      row.attended_workshops ?? '',
    ]);
  }

  for (let i = 1; i <= headers.length; i++) {
    ws.getColumn(i).width = 28;
  }
  ws.getColumn(10).width = 60;
  ws.getColumn(1).width = 36;

  const info = wb.addWorksheet('Información');
  info.addRow(['Edición', payload.edition]);
  info.addRow(['Código', payload.edition_code]);
  info.addRow(['Generado', new Date(payload.generated_at).toLocaleString('es-MX')]);
  info.addRow(['Generado por', payload.generated_by]);
  info.addRow(['Participantes', payload.count]);
  info.addRow(['Uso', 'Archivo con intereses y asistencias para Atención Preuniversitaria.']);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
