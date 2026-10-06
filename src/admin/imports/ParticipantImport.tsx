import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/adminApi';
import { useEdition } from '../../edition/EditionProvider';
import CareerMappingPanel from './CareerMappingPanel';
import ConflictReview from './ConflictReview';
import CsvImport, { type ImportOptions, type ImportResult } from './CsvImport';
import { PARTICIPANT_COLUMNS, PARTICIPANT_TEMPLATE, buildParticipantRow, isDiscardedHeader } from './participantImportMapping';
import RosterStatus from './RosterStatus';

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
              Corrige datos desde el expediente de cada participante; quien no esté en el padrón puede registrarse desde la pantalla de
              acceso. Solo si es indispensable, Coordinación puede reabrir la importación.
            </p>
          </div>
        </div>
      ) : (
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
            <li>Si una carrera no coincide con el catálogo oficial, deberás relacionarla antes de cargar el archivo.</li>
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
