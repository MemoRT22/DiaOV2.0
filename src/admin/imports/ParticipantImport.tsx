import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/adminApi';
import CareerMappingPanel from './CareerMappingPanel';
import ConflictReview from './ConflictReview';
import CsvImport, { type ImportOptions, type ImportResult } from './CsvImport';
import { PARTICIPANT_COLUMNS, PARTICIPANT_TEMPLATE, buildParticipantRow, isDiscardedHeader } from './participantImportMapping';

const careerMap = (options: ImportOptions) => (options.careerMap as Record<string, string> | undefined) ?? {};
const highSchoolMap = (options: ImportOptions) => (options.highSchoolMap as Record<string, string> | undefined) ?? {};
const careerMap2 = (options: ImportOptions) => (options.careerMap2 as Record<string, string> | undefined) ?? {};

export default function ParticipantImport() {
  const [reviewKey, setReviewKey] = useState(0);

  return (
    <div className="space-y-6">
      <Link to=".." relative="path" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Participantes
      </Link>
      <header>
        <h1 className="text-2xl font-extrabold">Importar participantes</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Carga el CSV de Forms y revisa los datos antes de importarlos. Puedes repetir la carga cuando sea necesario.
        </p>
      </header>
      <CsvImport
        columns={PARTICIPANT_COLUMNS}
        template={PARTICIPANT_TEMPLATE}
        templateName="plantilla-participantes.csv"
        intro={
          <ul className="list-disc space-y-1 pl-5">
            <li>Columnas del Forms oficial: Nombre, Apellidos, Correo, Teléfono con WhatsApp, Escuela, Grado, Periodo y Licenciatura. Obligatorias: Nombre y Correo.</li>
            <li>El Aviso de Privacidad y la marca temporal son opcionales. Una columna de aviso con respuesta negativa rechaza esa fila.</li>
            <li>Si el archivo trae una columna de fecha de nacimiento, se ignora: ya no se usa ni se guarda.</li>
            <li>Grado: 1.º, 2.º, 3.º año o Egresado. Periodo: Enero o Agosto de 2027 o 2028. La licenciatura puede ir por nombre o por código.</li>
            <li>Si una carrera o preparatoria no coincide con el catálogo oficial, deberás relacionarla antes de cargar el archivo.</li>
            <li>Un dato vacío en el archivo nunca borra un dato existente.</li>
            <li>Si alguien corrigió un dato a mano, no se reemplaza: queda como registro por revisar y lo resuelves aquí mismo al terminar.</li>
            <li>Si un correo fue corregido, el aspirante se reconoce aunque el archivo traiga el correo anterior. El correo vigente no cambia.</li>
            <li>Las demás preguntas del Forms se conservan como información adicional, visible solo para Coordinación y en la exportación.</li>
          </ul>
        }
        keepExtraColumns
        buildRow={buildParticipantRow}
        discardHeader={isDiscardedHeader}
        preview={(rows, isDemo, options) =>
          rpc<ImportResult>('preview_participant_import', { p_rows: rows, p_is_demo: isDemo, p_career_map: careerMap(options), p_career_map_2: careerMap2(options), p_high_school_map: highSchoolMap(options) })
        }
        commit={(rows, fileName, isDemo, options) =>
          rpc<ImportResult>('commit_participant_import', {
            p_rows: rows,
            p_file_name: fileName,
            p_is_demo: isDemo,
            p_career_map: careerMap(options),
            p_career_map_2: careerMap2(options),
            p_high_school_map: highSchoolMap(options),
          })
        }
        reviewPanel={(ctx) => <CareerMappingPanel {...ctx} />}
        commitBlockedReason={(result) => {
          const pending = (result.unmatched_careers ?? []).filter((u) => !u.target).length
            + (result.unmatched_careers_2 ?? []).filter((u) => !u.target).length;
          const schools = (result.unmatched_high_schools ?? []).filter((u) => !u.target).length;
          if (schools) return `Relaciona ${schools === 1 ? 'la preparatoria no reconocida' : `las ${schools} preparatorias no reconocidas`} antes de importar.`;
          return pending ? `Relaciona ${pending === 1 ? 'la carrera no reconocida' : `las ${pending} carreras no reconocidas`} antes de importar.` : null;
        }}
        confirmLabel="Importar participantes"
        onImported={() => setReviewKey((k) => k + 1)}
      />
      <ConflictReview key={reviewKey} hideWhenEmpty />
    </div>
  );
}
