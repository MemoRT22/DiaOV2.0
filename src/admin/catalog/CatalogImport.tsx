import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/adminApi';
import { toBool, toTime, type CsvColumn } from '../../lib/csv';
import CsvImport, { type ImportResult } from '../imports/CsvImport';

type Kind = 'careers' | 'workshops';

const CONFIG: Record<
  Kind,
  { label: string; columns: CsvColumn[]; template: string; build: (r: Record<string, string>, row: number) => Record<string, unknown>; notes: string[] }
> = {
  careers: {
    label: 'Carreras',
    columns: [
      { key: 'code', label: 'Código', aliases: ['codigo', 'clave'], required: true },
      { key: 'name', label: 'Nombre', aliases: ['carrera', 'nombre de la carrera', 'licenciatura'], required: true },
      { key: 'division', label: 'División', aliases: ['division', 'escuela', 'facultad'], required: true },
      { key: 'active', label: 'Activa', aliases: ['activo', 'vigente'] },
    ],
    template: 'Código,Nombre,División,Activa\nMED,Médico Cirujano,SALUD,Sí\nARQ,Arquitectura,INGENIERIA,Sí\n',
    build: (r, row) => ({ row, code: r.code ?? '', name: r.name ?? '', division: r.division ?? '', active: r.active ? toBool(r.active) !== false : true }),
    notes: [
      'La división puede ir por nombre o por código (por ejemplo SALUD).',
      'Si el código ya existe, se actualizan su nombre, división y estado.',
      'La columna Activa es opcional; si falta, la carrera queda activa.',
    ],
  },
  workshops: {
    label: 'Talleres y horarios',
    columns: [
      { key: 'division', label: 'División', aliases: ['division', 'escuela'], required: true },
      { key: 'title', label: 'Taller', aliases: ['titulo', 'nombre', 'actividad', 'nombre del taller'], required: true },
      { key: 'description', label: 'Descripción', aliases: ['descripcion', 'detalle'] },
      { key: 'location', label: 'Ubicación', aliases: ['ubicacion', 'lugar', 'aula', 'salon'] },
      { key: 'start', label: 'Inicio', aliases: ['hora inicio', 'hora de inicio', 'inicia'], required: true },
      { key: 'end', label: 'Fin', aliases: ['hora fin', 'hora de fin', 'termina'], required: true },
      { key: 'capacity', label: 'Cupo', aliases: ['capacidad', 'lugares'], required: true },
      { key: 'status', label: 'Estado', aliases: ['estatus', 'estado del horario'] },
    ],
    template:
      'División,Taller,Descripción,Ubicación,Inicio,Fin,Cupo,Estado\n' +
      'SALUD,Simulador clínico,Practica una consulta,Edificio B 204,10:00,10:45,30,Activa\n' +
      'SALUD,Simulador clínico,Practica una consulta,Edificio B 205,11:00,11:45,30,Oculta\n',
    build: (r, row) => ({
      row,
      division: r.division ?? '',
      title: r.title ?? '',
      description: r.description ?? '',
      location: r.location ?? '',
      start: toTime(r.start ?? ''),
      end: toTime(r.end ?? ''),
      capacity: r.capacity ?? '',
      status: r.status ?? '',
    }),
    notes: [
      'Una fila por horario. Repite el taller en otra fila para agregar más horarios.',
      'Las horas van como 10:00 y se registran para el día del evento, en hora de Cancún.',
      'La ubicación es de cada horario. Si el taller es nuevo, la del primer horario también queda como ubicación del taller.',
      'Estado: Activa (visible para aspirantes), Oculta o Cancelada. Si lo dejas vacío se conserva el estado actual (o Activa si el horario es nuevo).',
      'Si el taller y el horario ya existen, se actualizan la descripción, ubicación, fin, cupo y estado del horario.',
    ],
  },
};

export default function CatalogImport() {
  const [kind, setKind] = useState<Kind>('careers');
  const config = CONFIG[kind];

  return (
    <div className="space-y-6">
      <Link to=".." relative="path" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Catálogo
      </Link>
      <header>
        <h1 className="text-2xl font-extrabold">Importar catálogo</h1>
        <p className="mt-1 text-sm text-ink-muted">Carga carreras o talleres desde un CSV. Verás una vista previa antes de guardar.</p>
      </header>
      <div className="flex gap-2">
        {(Object.keys(CONFIG) as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors ${
              kind === k ? 'border-primary-500 bg-primary-500/15 text-primary-200' : 'border-line text-ink-muted hover:text-ink'
            }`}
          >
            {CONFIG[k].label}
          </button>
        ))}
      </div>
      <CsvImport
        key={kind}
        columns={config.columns}
        template={config.template}
        templateName={`plantilla-${kind === 'careers' ? 'carreras' : 'talleres'}.csv`}
        intro={
          <ul className="list-disc space-y-1 pl-5">
            {config.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        }
        buildRow={config.build}
        preview={(rows, isDemo) => rpc<ImportResult>('preview_catalog_import', { p_kind: kind, p_rows: rows, p_is_demo: isDemo })}
        commit={(rows, fileName, isDemo) =>
          rpc<ImportResult>('commit_catalog_import', { p_kind: kind, p_rows: rows, p_file_name: fileName, p_is_demo: isDemo })
        }
      />
    </div>
  );
}
