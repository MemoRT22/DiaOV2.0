import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/adminApi';
import { toBool, type CsvColumn } from '../../lib/csv';
import CsvImport, { type ImportResult } from '../imports/CsvImport';

const columns: CsvColumn[] = [
  { key: 'code', label: 'Código', aliases: ['codigo', 'clave'], required: true },
  { key: 'name', label: 'Nombre', aliases: ['carrera', 'nombre de la carrera', 'licenciatura'], required: true },
  { key: 'division', label: 'División', aliases: ['division', 'escuela', 'facultad'], required: true },
  { key: 'active', label: 'Activa', aliases: ['activo', 'vigente'] },
];
const template = 'Código,Nombre,División,Activa\nMED,Médico Cirujano,SALUD,Sí\nARQ,Arquitectura,INGENIERIA,Sí\n';
const notes = [
  'La división puede ir por nombre o por código (por ejemplo SALUD).',
  'Si el código ya existe, se actualizan su nombre, división y estado.',
  'La columna Activa es opcional; si falta, la carrera queda activa.',
];

export default function CatalogImport() {
  return <div className="space-y-6">
    <Link to=".." relative="path" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
      <ArrowLeft className="h-4 w-4" aria-hidden />Carreras y divisiones
    </Link>
    <header><h1 className="text-2xl font-extrabold">Importar carreras</h1>
      <p className="mt-1 text-sm text-ink-muted">Carga carreras desde un CSV. Verás una vista previa antes de guardar.</p>
    </header>
    <CsvImport columns={columns} template={template} templateName="plantilla-carreras.csv"
      intro={<ul className="list-disc space-y-1 pl-5">{notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      buildRow={(row, index) => ({ row: index, code: row.code ?? '', name: row.name ?? '',
        division: row.division ?? '', active: row.active ? toBool(row.active) !== false : true })}
      preview={(rows, isDemo) => rpc<ImportResult>('preview_catalog_import', { p_kind: 'careers', p_rows: rows, p_is_demo: isDemo })}
      commit={(rows, fileName, isDemo) => rpc<ImportResult>('commit_catalog_import', {
        p_kind: 'careers', p_rows: rows, p_file_name: fileName, p_is_demo: isDemo,
      })} />
  </div>;
}
