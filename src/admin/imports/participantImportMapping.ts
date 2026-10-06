import { toBool, toIsoTimestamp, type CsvColumn, type CsvExtraCell } from '../../lib/csv';
import { joinFullName, normalizeGrade, normalizePeriod } from '../../lib/participantFields';

/**
 * Columnas del Forms oficial: Nombre, Apellidos, Correo, Teléfono con WhatsApp, Escuela, Grado, Periodo y Licenciatura,
 * más el aviso de privacidad y la marca temporal (opcionales). No hay fecha de nacimiento ni segunda carrera.
 */
export const PARTICIPANT_COLUMNS: CsvColumn[] = [
  { key: 'first_name', label: 'Nombre', aliases: ['nombres', 'nombre s', 'nombre del aspirante', 'nombre completo'], required: true },
  { key: 'last_name', label: 'Apellidos', aliases: ['apellido', 'apellido s', 'apellidos del aspirante'] },
  { key: 'email', label: 'Correo', aliases: ['correo electronico', 'email', 'e mail', 'direccion de correo electronico', 'mail'], required: true },
  { key: 'phone', label: 'Teléfono con WhatsApp', aliases: ['telefono', 'telefono whatsapp', 'whatsapp', 'celular', 'telefono celular', 'numero de celular'] },
  { key: 'high_school', label: 'Escuela', aliases: ['escuela preparatoria', 'escuela o preparatoria', 'preparatoria', 'escuela de procedencia', 'bachillerato', 'prepa'] },
  { key: 'grade', label: 'Grado', aliases: ['grado actual', 'grado escolar', 'grado de preparatoria', 'año que cursas'] },
  { key: 'period', label: 'Periodo', aliases: ['periodo de interes', 'periodo de ingreso', 'periodo en el que te interesa ingresar', 'ciclo'] },
  { key: 'career', label: 'Licenciatura', aliases: ['carrera', 'carrera de interes', 'carrera inicial', 'codigo carrera', 'licenciatura de interes'] },
  {
    key: 'consent',
    label: 'Aviso de privacidad',
    aliases: ['consentimiento', 'acepto aviso de privacidad', 'acepto el aviso de privacidad', 'autorizo', 'privacidad'],
  },
  { key: 'submitted_at', label: 'Marca temporal', aliases: ['fecha de registro', 'timestamp', 'hora de finalizacion', 'hora de inicio'] },
];

export const PARTICIPANT_TEMPLATE =
  'Marca temporal,Nombre,Apellidos,Correo,Teléfono con WhatsApp,Escuela,Grado,Periodo,Licenciatura,Aviso de privacidad\n' +
  '04/10/2026 10:15:00,Ana,López Pérez,ana.lopez@ejemplo.com,9981234567,Colegio Ejemplo,3.º año,Agosto 2027,Psicología,Sí\n';


/**
 * La fecha de nacimiento ya no existe en el producto: si un archivo antiguo trae esa columna, se ignora y no se guarda
 * ni siquiera como información adicional de Forms.
 */
export const isDiscardedHeader = (foldedHeader: string) => /\b(nacimiento|cumpleanos|birth)/.test(foldedHeader);

export function buildParticipantRow(r: Record<string, string>, row: number, extra: CsvExtraCell[]) {
  return {
    row,
    email: r.email ?? '',
    // Solo se guarda el nombre completo: Nombre y Apellidos se unen de forma determinista.
    full_name: joinFullName(r.first_name, r.last_name),
    phone: r.phone ?? '',
    high_school: r.high_school ?? '',
    // Un valor que no se reconoce se envía tal cual: el servidor lo omite y avisa en la vista previa.
    high_school_grade: normalizeGrade(r.grade) ?? (r.grade ?? '').trim(),
    entry_period: normalizePeriod(r.period) ?? (r.period ?? '').trim(),
    career: r.career ?? '',
    // Opcional: sin columna o sin respuesta reconocible es «sin dato»; solo una respuesta negativa rechaza la fila.
    consent: toBool(r.consent ?? ''),
    submitted_at: r.submitted_at ? toIsoTimestamp(r.submitted_at) : '',
    extra,
  };
}
