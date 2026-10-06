import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fold } from '../lib/csv';

export type HighSchoolOption = { id: string; name: string; is_active?: boolean };

type Props = {
  options: HighSchoolOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  required?: boolean;
  legacyName?: string;
  disabled?: boolean;
};

/** A single-choice catalog picker. The search text is never submitted as a value. */
export default function HighSchoolPicker({ options, value, onChange, label = 'Escuela / preparatoria', required, legacyName, disabled }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find((item) => item.id === value);
  const matches = useMemo(() => options.filter((item) => item.is_active !== false && fold(item.name).includes(fold(query))), [options, query]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  return (
    <div ref={root} className="relative space-y-1">
      <label className="block text-sm font-semibold">{label}{required && <span aria-hidden="true"> *</span>}</label>
      <button type="button" role="combobox" aria-label={label} aria-required={required} aria-expanded={open} aria-controls={listId} disabled={disabled}
        onClick={() => { setQuery(''); setOpen((wasOpen) => !wasOpen); }}
        className="w-full rounded-theme border border-line bg-surface px-3 py-2.5 text-left text-sm focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30 disabled:opacity-60">
        {selected?.name ?? (legacyName ? `${legacyName} (valor anterior)` : 'Elige una preparatoria…')}
        {selected?.is_active === false && <span className="ml-2 text-xs text-ink-muted">Inactiva</span>}
      </button>
      {open && (
        <div id={listId} className="absolute z-30 mt-1 w-full rounded-theme border border-line bg-surface p-2 shadow-xl">
          <input ref={input} aria-label="Buscar preparatoria" value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
            placeholder="Buscar por nombre…" className="w-full rounded-theme border border-line bg-surface-raised px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500/30" />
          <ul role="listbox" aria-label="Preparatorias" className="mt-2 max-h-64 overflow-y-auto">
            {matches.map((item) => <li key={item.id} role="option" aria-selected={item.id === value}>
              <button type="button" onClick={() => { onChange(item.id); setOpen(false); setQuery(''); }}
                className="w-full rounded-theme px-3 py-2 text-left text-sm hover:bg-surface-raised focus:bg-surface-raised focus:outline-none">
                {item.name}
              </button>
            </li>)}
            {!matches.length && <li className="px-3 py-2 text-sm text-ink-muted">Sin coincidencias</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
