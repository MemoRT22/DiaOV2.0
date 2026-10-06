import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { IntakeCatalog } from '../../lib/workshopIntakeApi';
import { fieldId, foldSearch } from '../../lib/workshopForm';

/**
 * Selección múltiple de carreras relacionadas, sin límite. Con ~35 carreras: búsqueda sin acentos y
 * agrupación por escuela/división. La división ya no es una respuesta del formulario: un taller académico
 * puede ser multidisciplinario y relacionarse con carreras de varias escuelas.
 */
export default function CareerPicker({
  catalog,
  value,
  onChange,
  error,
}: {
  catalog: IntakeCatalog;
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const id = fieldId('career_ids');
  const selected = useMemo(() => new Set(value), [value]);
  const nameById = useMemo(() => new Map(catalog.careers.map((c) => [c.career_id, c.career_name])), [catalog.careers]);

  const groups = useMemo(() => {
    const q = foldSearch(query);
    return catalog.divisions
      .map((d) => ({
        division: d,
        careers: catalog.careers
          .filter((c) => c.division_id === d.division_id && (!q || foldSearch(c.career_name).includes(q)))
          .sort((a, b) => a.career_name.localeCompare(b.career_name, 'es')),
      }))
      .filter((g) => g.careers.length > 0);
  }, [catalog.divisions, catalog.careers, query]);

  const toggle = (careerId: string) =>
    onChange(selected.has(careerId) ? value.filter((x) => x !== careerId) : [...value, careerId]);

  return (
    <div id={id} tabIndex={-1} className="focus:outline-none" aria-describedby={error ? `${id}-error` : undefined}>
      <label htmlFor={`${id}-search`} className="mb-2 block text-sm font-semibold text-ink">
        Buscar carrera
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escribe parte del nombre"
          autoComplete="off"
          className="h-12 w-full rounded-full border border-line bg-surface-raised pl-11 pr-4 text-base text-ink placeholder:text-ink-muted/70 focus:border-secondary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/40"
        />
      </div>

      <p className="mt-3 text-sm text-ink-muted" aria-live="polite">
        {value.length === 0 ? 'Aún no has elegido carreras.' : `${value.length} ${value.length === 1 ? 'carrera seleccionada' : 'carreras seleccionadas'}`}
      </p>

      {value.length > 0 && (
        <div className="mt-2">
          <ul className="flex flex-wrap gap-2" aria-label="Carreras seleccionadas">
            {value.map((cid) => (
              <li key={cid} className="inline-flex items-center gap-1 rounded-full bg-primary-500/15 py-1 pl-3 pr-1 text-sm font-medium text-ink">
                <span>{nameById.get(cid) ?? 'Carrera no disponible'}</span>
                <button
                  type="button"
                  onClick={() => toggle(cid)}
                  aria-label={`Quitar carrera: ${nameById.get(cid) ?? 'no disponible'}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-2 text-sm text-ink-muted underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50"
          >
            Quitar todas
          </button>
        </div>
      )}

      <div className="mt-4 space-y-5">
        {groups.length === 0 && <p className="text-sm text-ink-muted">No encontramos carreras con ese nombre.</p>}
        {groups.map(({ division, careers }) => (
          <fieldset key={division.division_id}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{division.division_name}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {careers.map((c) => (
                <label
                  key={c.career_id}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-theme border px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-secondary-500/50 ${
                    selected.has(c.career_id) ? 'border-primary-500 bg-primary-500/10 font-semibold text-ink' : 'border-line bg-surface-raised text-ink hover:border-secondary-400'
                  }`}
                >
                  <input type="checkbox" checked={selected.has(c.career_id)} onChange={() => toggle(c.career_id)} className="h-4 w-4 shrink-0 accent-primary-500" />
                  <span>{c.career_name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {error && (
        <p id={`${id}-error`} className="mt-3 text-sm font-medium text-error-300">
          {error}
        </p>
      )}
    </div>
  );
}
