export type ExportRow = {
  full_name: string;
  email: string;
  previous_emails: string | null;
  phone: string | null;
  birth_date: string | null;
  high_school: string | null;
  initial_career_code: string | null;
  initial_career: string | null;
  initial_division: string | null;
  origin: string;
  is_demo: boolean;
  forms_consent: boolean | null;
  forms_consent_at: string | null;
  manual_consent_at: string | null;
  platform_consent_at: string | null;
  logged_in: boolean;
  interest_1: string | null;
  interest_2: string | null;
  interest_3: string | null;
  attendances: number;
  created_at: string;
  forms_extra: Record<string, string> | null;
};

export type ExtraColumn = { key: string; label: string };

export type ExportPayload = {
  edition: string;
  edition_code: string;
  generated_at: string;
  generated_by: string | null;
  count: number;
  rows: ExportRow[];
  extra_columns: ExtraColumn[];
};

const ORIGIN: Record<string, string> = { forms: 'Forms', manual: 'Alta manual', demo: 'Prueba' };

// Excel has no time zones; shift to Cancún wall-clock (UTC-5) so cells show local time.
function localDate(iso: string | null) {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() - 5 * 3600 * 1000);
}

function birthDate(value: string | null) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const yesNo = (v: boolean | null) => (v === null ? '' : v ? 'Sí' : 'No');

export async function buildWorkbook(payload: ExportPayload, reason: string, includeDemo: boolean) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = payload.generated_by ?? 'Coordinación';
  wb.created = new Date(payload.generated_at);

  const extras = Array.isArray(payload.extra_columns) ? payload.extra_columns : [];
  const ws = wb.addWorksheet('Participantes', { views: [{ state: 'frozen', ySplit: 1 }] });
  const date = 'dd/mm/yyyy';
  const dateTime = 'dd/mm/yyyy hh:mm';
  ws.columns = [
    { header: 'Nombre completo', key: 'full_name', width: 32 },
    { header: 'Correo', key: 'email', width: 32 },
    { header: 'Correos anteriores', key: 'previous_emails', width: 32 },
    { header: 'Teléfono', key: 'phone', width: 16, style: { numFmt: '@' } },
    { header: 'Fecha de nacimiento', key: 'birth_date', width: 18, style: { numFmt: date } },
    { header: 'Preparatoria', key: 'high_school', width: 28 },
    { header: 'Carrera de interés inicial', key: 'initial_career', width: 30 },
    { header: 'Código de carrera inicial', key: 'initial_career_code', width: 14 },
    { header: 'División de carrera inicial', key: 'initial_division', width: 24 },
    { header: 'Interés 1 después del evento', key: 'interest_1', width: 28 },
    { header: 'Interés 2 después del evento', key: 'interest_2', width: 28 },
    { header: 'Interés 3 después del evento', key: 'interest_3', width: 28 },
    { header: 'Talleres asistidos', key: 'attendances', width: 12 },
    { header: 'Entró a la plataforma', key: 'logged_in', width: 12 },
    { header: 'Origen del registro', key: 'origin', width: 14 },
    { header: 'Aceptó aviso en Forms', key: 'forms_consent', width: 12 },
    { header: 'Fecha aviso en Forms', key: 'forms_consent_at', width: 18, style: { numFmt: dateTime } },
    { header: 'Fecha consentimiento en alta manual', key: 'manual_consent_at', width: 18, style: { numFmt: dateTime } },
    { header: 'Fecha aviso en plataforma', key: 'platform_consent_at', width: 18, style: { numFmt: dateTime } },
    { header: 'Fecha de registro', key: 'created_at', width: 18, style: { numFmt: dateTime } },
    ...(includeDemo ? [{ header: 'Dato de prueba', key: 'is_demo', width: 10 }] : []),
    // Synthetic keys keep Forms questions from ever overwriting structured columns.
    ...extras.map((c, i) => ({ header: `Forms: ${c.label}`, key: `forms_extra_${i}`, width: 28 })),
  ];

  for (const r of payload.rows) {
    const { forms_extra: formsExtra, ...base } = r;
    ws.addRow({
      ...base,
      ...Object.fromEntries(extras.map((c, i) => [`forms_extra_${i}`, formsExtra?.[c.key] ?? ''])),
      previous_emails: r.previous_emails ?? '',
      phone: r.phone ?? '',
      birth_date: birthDate(r.birth_date),
      origin: ORIGIN[r.origin] ?? r.origin,
      forms_consent: yesNo(r.forms_consent),
      logged_in: yesNo(r.logged_in),
      is_demo: yesNo(r.is_demo),
      forms_consent_at: localDate(r.forms_consent_at),
      manual_consent_at: localDate(r.manual_consent_at),
      platform_consent_at: localDate(r.platform_consent_at),
      created_at: localDate(r.created_at),
    });
  }

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 32;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const info = wb.addWorksheet('Información');
  info.columns = [
    { key: 'k', width: 24 },
    { key: 'v', width: 60 },
  ];
  info.addRows([
    { k: 'Edición', v: `${payload.edition} (${payload.edition_code})` },
    { k: 'Generado', v: localDate(payload.generated_at) },
    { k: 'Generado por', v: payload.generated_by ?? '' },
    { k: 'Motivo', v: reason },
    { k: 'Total de participantes', v: payload.count },
    { k: 'Incluye datos de prueba', v: includeDemo ? 'Sí' : 'No' },
    { k: 'Uso', v: 'Información personal. Compartir solo con Atención Preuniversitaria conforme al aviso de privacidad.' },
  ]);
  info.getColumn(1).font = { bold: true };
  info.getCell('B2').numFmt = dateTime;
  info.getCell('B5').alignment = { horizontal: 'left' };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
