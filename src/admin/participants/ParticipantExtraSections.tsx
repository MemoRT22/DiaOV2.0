import { formatDateTime } from '../../lib/catalog';

export type EmailHistoryEntry = { email: string; changed_at: string; changed_by: string | null; reason: string | null };
export type FormsExtraEntry = { label: string; value: string };

export function EmailHistory({ entries }: { entries: EmailHistoryEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="card divide-y divide-line">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Correos anteriores</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Solo sirven para reconocer al aspirante en futuras importaciones. No permiten entrar a la plataforma.
        </p>
      </div>
      {entries.map((h) => (
        <div key={h.email} className="grid gap-1 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
          <div className="min-w-0">
            <p className="break-all font-semibold">{h.email}</p>
            {h.reason && <p className="text-xs text-ink-muted">Motivo: {h.reason}</p>}
          </div>
          <p className="text-xs text-ink-muted">
            Reemplazado{h.changed_by ? ` por ${h.changed_by}` : ''} · {formatDateTime(h.changed_at)}
          </p>
        </div>
      ))}
    </section>
  );
}

export function FormsExtra({ entries }: { entries: FormsExtraEntry[] }) {
  return (
    <section className="card divide-y divide-line">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Información adicional de Forms</h2>
        <p className="mt-1 text-xs text-ink-muted">Visible solo para Coordinación. Se incluye en la exportación autorizada.</p>
      </div>
      {entries.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">Este registro no tiene respuestas adicionales.</p>
      ) : (
        entries.map((e) => (
          <div key={e.label} className="grid gap-1 px-5 py-3 sm:grid-cols-[18rem_1fr] sm:gap-4">
            <p className="text-sm text-ink-muted">{e.label}</p>
            <p className="whitespace-pre-line break-words font-semibold">{e.value}</p>
          </div>
        ))
      )}
    </section>
  );
}
