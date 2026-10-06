import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { LIMITS, fieldId, foldSearch } from '../../lib/workshopForm';
import { describedBy } from './FormFields';

const MAX = LIMITS.keywords.maxCount;
const MIN = LIMITS.keywords.minCount;

/** Palabras clave como chips: Enter o coma agregan; cada chip se puede quitar. Entre 3 y 5, sin repetidas. */
export default function KeywordInput({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const id = fieldId('keywords');
  const hint = `Elige de ${MIN} a ${MAX} palabras que describan el taller. Escribe una y presiona Enter o coma.`;

  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((p) => p.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (parts.length === 0) return;
    let next = [...value];
    let message = '';
    for (const p of parts) {
      if (p.length > LIMITS.keywords.maxLength) {
        message = `Cada palabra clave puede tener hasta ${LIMITS.keywords.maxLength} caracteres.`;
        continue;
      }
      if (next.some((k) => foldSearch(k) === foldSearch(p))) {
        message = `«${p}» ya está en la lista.`;
        continue;
      }
      if (next.length >= MAX) {
        message = `Puedes agregar hasta ${MAX} palabras clave.`;
        break;
      }
      next = [...next, p];
    }
    setNote(message);
    if (next.length !== value.length) onChange(next);
    if (!message) setDraft('');
    else if (next.length !== value.length) setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    }
  };

  const remove = (k: string) => {
    setNote('');
    onChange(value.filter((x) => x !== k));
  };

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-ink">
        Palabras clave <span className="text-xs font-normal text-ink-muted">(obligatorio)</span>
      </label>
      <p id={`${id}-hint`} className="mb-2 text-xs text-ink-muted">
        {hint}
      </p>
      <div className="flex gap-2">
        <input
          id={id}
          name="keywords"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          disabled={value.length >= MAX}
          autoComplete="off"
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={[describedBy('keywords', hint, error), `${id}-count`].filter(Boolean).join(' ')}
          placeholder={value.length >= MAX ? 'Ya tienes el máximo' : 'Por ejemplo: ciberseguridad'}
          className={`h-12 w-full rounded-theme border bg-surface-raised px-4 text-base text-ink placeholder:text-ink-muted/70 focus:outline-none focus-visible:ring-2 disabled:opacity-60 ${
            error ? 'border-error-500 focus-visible:ring-error-500/40' : 'border-line focus:border-secondary-400 focus-visible:ring-secondary-500/40'
          }`}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim() || value.length >= MAX}
          className="inline-flex min-h-12 shrink-0 items-center rounded-full border border-line bg-surface-raised px-5 text-sm font-semibold text-ink hover:border-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Agregar
        </button>
      </div>
      <p id={`${id}-count`} className="mt-2 text-xs text-ink-muted" aria-live="polite">
        {value.length} de {MAX} palabras clave{value.length < MIN ? ` · faltan ${MIN - value.length} como mínimo` : ''}
      </p>
      {value.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Palabras clave agregadas">
          {value.map((k) => (
            <li key={k} className="inline-flex items-center gap-1 rounded-full bg-primary-500/15 py-1 pl-3 pr-1 text-sm font-medium text-ink">
              <span>{k}</span>
              <button
                type="button"
                onClick={() => remove(k)}
                aria-label={`Quitar palabra clave: ${k}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="mt-2 text-sm text-warning-300" role="status">
          {note}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-error-300">
          {error}
        </p>
      )}
    </div>
  );
}
