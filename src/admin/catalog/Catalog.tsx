import { Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buttonClasses } from '../../components/ui';
import CareersTab from './CareersTab';
import DivisionsTab from './DivisionsTab';
import HighSchoolsTab from './HighSchoolsTab';

const TABS = [
  { key: 'divisions', label: 'Divisiones' },
  { key: 'careers', label: 'Carreras' },
  { key: 'high_schools', label: 'Preparatorias' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Official academic catalog. It changes rarely, so it lives in Configuración rather than as a product of its own. */
export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() => TABS.find((item) => item.key === params.get('tab'))?.key ?? 'divisions');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Catálogos académicos</h1>
          <p className="mt-1 text-sm text-ink-muted">Administra divisiones, carreras y preparatorias oficiales que usan los aspirantes.</p>
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
            onClick={() => { setTab(t.key); setParams({ tab: t.key }); }}
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
      {tab === 'high_schools' && <HighSchoolsTab />}
    </div>
  );
}
