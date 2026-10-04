import { rpc } from '../../lib/adminApi';
import { toBool, toIsoDate, toIsoTimestamp, type CsvColumn } from '../../lib/csv';
import CsvImport, { type ImportResult } from './CsvImport';

const COLUMNS: CsvColumn[] = [
  { key: 'email', label: 'Correo', aliases: ['correo electronico', 'email', 'e mail', 'direccion de correo electronico', 'mail'], required: true },
  { key: 'full_name', label: 'Nombre completo', aliases: ['nombre', 'nombre del aspirante', 'nombre y apellidos'], required: true },
  { key: 'birth_date', label: 'Fecha de nacimiento', aliases: ['nacimiento', 'fecha nacimiento'] },
  { key: 'phone', label: 'Teléfono', aliases: ['telefono', 'celular', 'telefono celular', 'whatsapp', 'numero de celular'] },
  { key: 'high_school', label: 'Preparatoria', aliases: ['escuela de procedencia', 'bachillerato', 'prepa', 'escuela'] },
  { key: 'career', label: 'Carrera de interés', aliases: ['carrera', 'carrera de interes', 'carrera inicial', 'codigo carrera', 'licenciatura'] },
  {
    key: 'consent',
    label: 'Aviso de privacidad',
    aliases: ['consentimiento', 'acepto aviso de privacidad', 'acepto el aviso de privacidad', 'autorizo', 'privacidad'],
    required: true,
  },
  { key: 'submitted_at', label: 'Marca temporal', aliases: ['fecha de registro', 'timestamp', 'hora de finalizacion', 'hora de inicio'] },
];

const TEMPLATE =
  'Marca temporal,Correo,Nombre completo,Fecha de nacimiento,Teléfono,Preparatoria,Carrera de interés,Aviso de privacidad\n' +
  '04/10/2026 10:15:00,ana.lopez@ejemplo.com,Ana López Pérez,15/03/2008,9981234567,Colegio Ejemplo,Psicología,Sí\n';

export default function ParticipantImport() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Importar participantes</h1>
        <p className="mt-1 text-sm text-ink-muted">Carga el CSV exportado de Forms. Puedes repetir la importación cuando lleguen más registros.</p>
      </header>
      <CsvImport
        columns={COLUMNS}
        template={TEMPLATE}
        templateName="plantilla-participantes.csv"
        intro={
          <ul className="list-disc space-y-1 pl-5">
            <li>Obligatorias: correo, nombre completo y aviso de privacidad.</li>
            <li>Las fechas pueden ir como 15/03/2008 o 2008-03-15. La carrera puede ir por nombre o por código.</li>
            <li>Un dato vacío en el archivo nunca borra un dato existente.</li>
            <li>Si staff corrigió un dato a mano, no se reemplaza: queda como conflicto para que lo decidas.</li>
            <li>Si un correo fue corregido, el aspirante se reconoce aunque el archivo traiga el correo anterior. El correo vigente no cambia.</li>
            <li>Las demás preguntas del Forms se conservan como información adicional, visible solo para Coordinación y en la exportación.</li>
          </ul>
        }
        keepExtraColumns
        buildRow={(r, row, extras) => ({
          row,
          email: r.email ?? '',
          full_name: r.full_name ?? '',
          birth_date: r.birth_date ? (toIsoDate(r.birth_date) ?? r.birth_date) : '',
          phone: r.phone ?? '',
          high_school: r.high_school ?? '',
          career: r.career ?? '',
          consent: toBool(r.consent ?? '') === true,
          submitted_at: r.submitted_at ? toIsoTimestamp(r.submitted_at) : '',
          extra: extras,
        })}
        preview={(rows, isDemo) => rpc<ImportResult>('preview_participant_import', { p_rows: rows, p_is_demo: isDemo })}
        commit={(rows, fileName, isDemo) =>
          rpc<ImportResult>('commit_participant_import', { p_rows: rows, p_file_name: fileName, p_is_demo: isDemo })
        }
      />
    </div>
  );
}
