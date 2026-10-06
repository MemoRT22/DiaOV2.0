import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/adminApi';
import { toBool, toIsoDate, toIsoTimestamp, type CsvColumn } from '../../lib/csv';
import { useEdition } from '../../edition/EditionProvider';
import CareerMappingPanel from './CareerMappingPanel';
import ConflictReview from './ConflictReview';
import CsvImport, { type ImportOptions, type ImportResult } from './CsvImport';
import RosterStatus from './RosterStatus';

const COLUMNS: CsvColumn[] = [
  { key: 'email', label: 'Correo', aliases: ['correo electronico', 'email', 'e mail', 'direccion de correo electronico', 'mail'], required: true },
  { key: 'full_name', label: 'Nombre completo', aliases: ['nombre', 'nombre del aspirante', 'nombre y apellidos'], required: true },
  { key: 'birth_date', label: 'Fecha de nacimiento', aliases: ['nacimiento', 'fecha nacimiento'] },
  { key: 'phone', label: 'Teléfono', aliases: ['telefono', 'celular', 'telefono celular', 'whatsapp', 'numero de celular'] },
  { key: 'high_school', label: 'Preparatoria', aliases: ['escuela de procedencia', 'bachillerato', 'prepa', 'escuela'] },
  { key: 'career', label: 'Carrera de interés', aliases: ['carrera', 'carrera de interes', 'carrera inicial', 'codigo carrera', 'licenciatura'] },
  { key: 'career_2', label: 'Segunda carrera de interés', aliases: ['carrera 2', 'segunda carrera', 'carrera de interes 2', 'segunda licenciatura', 'licenciatura 2'] },
  {
    key: 'consent',
    label: 'Aviso de privacidad',
    aliases: ['consentimiento', 'acepto aviso de privacidad', 'acepto el aviso de privacidad', 'autorizo', 'privacidad'],
    required: true,
  },
  { key: 'submitted_at', label: 'Marca temporal', aliases: ['fecha de registro', 'timestamp', 'hora de finalizacion', 'hora de inicio'] },
];

const TEMPLATE =
  'Marca temporal,Correo,Nombre completo,Fecha de nacimiento,Teléfono,Preparatoria,Carrera de interés,Segunda carrera de interés,Aviso de privacidad\n' +
  '04/10/2026 10:15:00,ana.lopez@ejemplo.com,Ana López Pérez,15/03/2008,9981234567,Colegio Ejemplo,Psicología,Negocios,Sí\n';

const careerMap = (options: ImportOptions) => (options.careerMap as Record<string, string> | undefined) ?? {};
const careerMap2 = (options: ImportOptions) => (options.careerMap2 as Record<string, string> | undefined) ?? {};

export default function ParticipantImport() {
  const { edition } = useEdition();
  const official = edition?.roster_status === 'oficial';
  const [reviewKey, setReviewKey] = useState(0);

  return (
    <div className="space-y-6">
      <Link to=".." relative="path" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Participantes
      </Link>
      <header>
        <h1 className="text-2xl font-extrabold">Importar padrón</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Carga el CSV oficial de Forms al cierre del prerregistro. Puedes repetir la carga mientras validas el padrón.
        </p>
      </header>
      <RosterStatus />
      {official ? (
        <div className="card flex items-start gap-4 p-6">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">La carga de Forms está bloqueada</p>
            <p className="text-ink-muted">
              Corrige datos desde el expediente de cada participante y da de alta a nuevos aspirantes desde Participantes. Solo si es
              indispensable, Coordinación puede reabrir la importación.
            </p>
          </div>
        </div>
      ) : (
      <CsvImport
        columns={COLUMNS}
        template={TEMPLATE}
        templateName="plantilla-participantes.csv"
        intro={
          <ul className="list-disc space-y-1 pl-5">
            <li>Obligatorias: correo, nombre completo y aviso de privacidad.</li>
            <li>Las fechas pueden ir como 15/03/2008 o 2008-03-15. La carrera puede ir por nombre o por código.</li>
            <li>Si una carrera no coincide con el catálogo oficial, deberás relacionarla antes de cargar el archivo.</li>
            <li>Un dato vacío en el archivo nunca borra un dato existente.</li>
            <li>Si alguien corrigió un dato a mano, no se reemplaza: queda como registro por revisar y lo resuelves aquí mismo al terminar.</li>
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
          career_2: r.career_2 ?? '',
          consent: toBool(r.consent ?? '') === true,
          submitted_at: r.submitted_at ? toIsoTimestamp(r.submitted_at) : '',
          extra: extras,
        })}
        preview={(rows, isDemo, options) =>
          rpc<ImportResult>('preview_participant_import', { p_rows: rows, p_is_demo: isDemo, p_career_map: careerMap(options), p_career_map_2: careerMap2(options) })
        }
        commit={(rows, fileName, isDemo, options) =>
          rpc<ImportResult>('commit_participant_import', {
            p_rows: rows,
            p_file_name: fileName,
            p_is_demo: isDemo,
            p_career_map: careerMap(options),
            p_career_map_2: careerMap2(options),
          })
        }
        reviewPanel={(ctx) => <CareerMappingPanel {...ctx} />}
        commitBlockedReason={(result) => {
          const pending = (result.unmatched_careers ?? []).filter((u) => !u.target).length
            + (result.unmatched_careers_2 ?? []).filter((u) => !u.target).length;
          return pending ? `Relaciona ${pending === 1 ? 'la carrera no reconocida' : `las ${pending} carreras no reconocidas`} antes de cargar el padrón.` : null;
        }}
        confirmLabel="Cargar padrón"
        onImported={() => setReviewKey((k) => k + 1)}
      />
      )}
      <ConflictReview key={reviewKey} hideWhenEmpty />
    </div>
  );
}
