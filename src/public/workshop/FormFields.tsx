import type { InputHTMLAttributes, ReactNode } from 'react';
import { fieldId } from '../../lib/workshopForm';

const INPUT =
  'w-full rounded-theme border bg-surface-raised px-4 text-base text-ink placeholder:text-ink-muted/70 transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-60 [color-scheme:dark]';
const OK = 'border-line focus:border-secondary-400 focus-visible:ring-secondary-500/40';
const BAD = 'border-error-500 focus-visible:ring-error-500/40';

type Common = {
  field: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
};

/** Etiqueta + ayuda + error asociados al control mediante ids (aria-describedby). */
export function describedBy(field: string, hint?: string, error?: string) {
  const id = fieldId(field);
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

function Shell({ field, label, hint, error, required, children }: Common & { children: ReactNode }) {
  const id = fieldId(field);
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-ink">
        {label}
        {required ? <span className="ml-1 text-xs font-normal text-ink-muted">(obligatorio)</span> : <span className="ml-1 text-xs font-normal text-ink-muted">(opcional)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-error-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  field,
  label,
  hint,
  error,
  required,
  value,
  onChange,
  ...rest
}: Common & { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <Shell field={field} label={label} hint={hint} error={error} required={required}>
      <input
        {...rest}
        id={fieldId(field)}
        name={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={undefined}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(field, hint, error)}
        className={`h-12 ${INPUT} ${error ? BAD : OK}`}
      />
    </Shell>
  );
}

export function TextAreaField({
  field,
  label,
  hint,
  error,
  required,
  value,
  onChange,
  max,
  rows = 4,
  placeholder,
}: Common & { value: string; onChange: (v: string) => void; max: number; rows?: number; placeholder?: string }) {
  return (
    <Shell field={field} label={label} hint={hint} error={error} required={required}>
      <textarea
        id={fieldId(field)}
        name={field}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(field, hint, error)}
        className={`min-h-28 py-3 ${INPUT} ${error ? BAD : OK}`}
      />
      <p className="mt-1 text-right text-xs text-ink-muted" aria-hidden>
        {value.length} / {max}
      </p>
    </Shell>
  );
}

export function RadioCards<T extends string>({
  field,
  legend,
  hint,
  error,
  required,
  value,
  onChange,
  options,
}: {
  field: string;
  legend: string;
  hint?: string;
  error?: string;
  required?: boolean;
  value: T | '';
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; description?: string }[];
}) {
  const id = fieldId(field);
  return (
    <fieldset id={id} tabIndex={-1} aria-describedby={describedBy(field, hint, error)} aria-required={required || undefined} aria-invalid={error ? true : undefined} className="focus:outline-none">
      <legend className="mb-2 text-sm font-semibold text-ink">
        {legend} {required && <span className="text-xs font-normal text-ink-muted">(obligatorio)</span>}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-theme border p-4 transition-colors focus-within:ring-2 focus-within:ring-secondary-500/50 ${
              value === o.value ? 'border-primary-500 bg-primary-500/10' : error ? 'border-error-500' : 'border-line bg-surface-raised hover:border-secondary-400'
            }`}
          >
            <input
              type="radio"
              name={field}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-1 h-4 w-4 accent-primary-500"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">{o.label}</span>
              {o.description && <span className="mt-0.5 block text-xs text-ink-muted">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-error-300">
          {error}
        </p>
      )}
    </fieldset>
  );
}
