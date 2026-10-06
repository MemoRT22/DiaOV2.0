import { Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../../components/ui';
import CareersTab from './CareersTab';
import DivisionsTab from './DivisionsTab';

const TABS = [
  { key: 'divisions', label: 'Divisiones' },
  { key: 'careers', label: 'Carreras' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Official academic catalog. It changes rarely, so it lives in Configuración rather than as a product of its own. */
export default function Catalog() {
  const [tab, setTab] = useState<TabKey>('divisions');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Carreras y divisiones</h1>
          <p className="mt-1 text-sm text-ink-muted">Catálogo académico oficial que usan los aspirantes y los talleres.</p>
        </div>
        <Link to="importar" className={buttonClasses('secondary')}>
          <Upload className="h-4 w-4" aria-hidden />
          Importar CSV
        </Link>
      </header>

      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-10 flex-1 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-primary-500 text-on-primary' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'divisions' && <DivisionsTab />}
      {tab === 'careers' && <CareersTab />}
    </div>
  );
}
