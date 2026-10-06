import { Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../../components/ui';
import WorkshopsTab from '../catalog/WorkshopsTab';

/** Published workshops and their sessions: the program the participants can reserve from. */
export default function WorkshopProgram() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Programa de talleres</h1>
          <p className="mt-1 text-sm text-ink-muted">Talleres publicados, horarios, ubicaciones y carreras relacionadas.</p>
        </div>
        <Link to="importar" className={buttonClasses('secondary')}>
          <Upload className="h-4 w-4" aria-hidden />
          Importar CSV
        </Link>
      </header>
      <WorkshopsTab />
    </div>
  );
}
