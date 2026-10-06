import { Download, FileUp, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button } from '../../components/ui';
import { FIELD_LABELS } from '../../lib/adminApi';
import { mapColumns, parseCsv, type CsvColumn, type CsvExtraCell } from '../../lib/csv';
import { friendlyError } from '../../lib/errors';
import { useEdition } from '../../edition/EditionProvider';

export type ImportRowResult = {
  row: number;
  status: string;
  errors: string[];
  warnings: string[];
  email?: string;
  name?: string;
  label?: string;
  updated_fields?: string[];
  conflict_fields?: string[];
  note?: string | null;
  alert?: string | null;
};
export type UnmatchedCareer = { key: string; value: string; count: number; target: string | null };
export type ImportResult = {
  counts: Record<string, number>;
  rows: ImportRowResult[];
  unmatched_careers?: UnmatchedCareer[];
  unmatched_careers_2?: UnmatchedCareer[];
};
export type ImportOptions = Record<string, unknown>;
export type ReviewPanelContext = {
  result: ImportResult;
  options: ImportOptions;
  isDemo: boolean;
  busy: boolean;
  apply: (options: ImportOptions) => Promise<void>;
};

type Props = {
  columns: CsvColumn[];
  template: string;
  templateName: string;
  buildRow: (record: Record<string, string>, row: number, extras: CsvExtraCell[]) => Record<string, unknown>;
  keepExtraColumns?: boolean;
  preview: (rows: Record<string, unknown>[], isDemo: boolean, options: ImportOptions) => Promise<ImportResult>;
  commit: (rows: Record<string, unknown>[], fileName: string, isDemo: boolean, options: ImportOptions) => Promise<ImportResult>;
  intro: ReactNode;
  reviewPanel?: (ctx: ReviewPanelContext) => ReactNode;
  commitBlockedReason?: (result: ImportResult) => string | null;
  confirmLabel?: string;
  /** Called once the import has been saved, so the page can show what needs review next. */
  onImported?: (result: ImportResult) => void;
};

const STATUS: Record<string, { label: string; tone: 'info' | 'success' | 'warning' | 'error' | 'neutral' }> = {
  new: { label: 'Nuevos', tone: 'success' },
  update: { label: 'Se actualizan', tone: 'info' },
  unchanged: { label: 'Sin cambios', tone: 'neutral' },
  conflict: { label: 'Requieren revisión', tone: 'warning' },
  duplicate: { label: 'Repetidos en el archivo', tone: 'neutral' },
  error: { label: 'Con error (se omiten)', tone: 'error' },
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'reviewing'; fileName: string; rows: Record<string, unknown>[]; result: ImportResult; unknown: string[]; options: ImportOptions }
  | { kind: 'done'; result: ImportResult };

export default function CsvImport({
  columns,
  template,
  templateName,
  buildRow,
  keepExtraColumns = false,
  preview,
  commit,
  intro,
  reviewPanel,
  commitBlockedReason,
  confirmLabel = 'Confirmar importación',
  onImported,
}: Props) {
  const { edition } = useEdition();
  const canDemo = edition?.mode === 'preparacion';
  const [isDemo, setIsDemo] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStage({ kind: 'idle' });
    setError('');
    setFilter('all');
    if (input.current) input.current.value = '';
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      if (file.size > 5_000_000) throw new Error('TOO_MANY_ROWS');
      const text = await file.text().catch(() => {
        throw new Error('CSV_UNREADABLE');
      });
      const mapping = mapColumns(parseCsv(text), columns);
      if (mapping.missing.length) {
        setError(`Faltan columnas obligatorias: ${mapping.missing.map((c) => c.label).join(', ')}.`);
        return;
      }
      if (!mapping.rows.length) throw new Error('CSV_EMPTY');
      const rows = mapping.rows.map((r, i) => buildRow(r, i + 2, mapping.extras[i] ?? []));
      const result = await preview(rows, isDemo, {});
      if (!result || !Array.isArray(result.rows)) throw new Error('SERVER_ERROR');
      setStage({ kind: 'reviewing', fileName: file.name, rows, result, unknown: mapping.unknownHeaders, options: {} });
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyOptions = async (options: ImportOptions) => {
    if (stage.kind !== 'reviewing') return;
    setBusy(true);
    setError('');
    try {
      const result = await preview(stage.rows, isDemo, options);
      if (!result || !Array.isArray(result.rows)) throw new Error('SERVER_ERROR');
      setStage({ ...stage, result, options });
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (stage.kind !== 'reviewing') return;
    setBusy(true);
    setError('');
    try {
      const result = await commit(stage.rows, stage.fileName, isDemo, stage.options);
      if (!result || !result.counts) throw new Error('SERVER_ERROR');
      setStage({ kind: 'done', result });
      onImported?.(result);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + template], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: templateName });
    a.click();
    URL.revokeObjectURL(url);
  };

  const blocked = stage.kind === 'reviewing' ? (commitBlockedReason?.(stage.result) ?? null) : null;

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      {stage.kind === 'idle' && (
        <div className="card space-y-5 p-6">
          <div className="text-sm leading-relaxed text-ink-muted">{intro}</div>
          {canDemo && (
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary-500" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} />
              Marcar estos registros como datos de prueba
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button loading={busy} onClick={() => input.current?.click()}>
              <FileUp className="h-4 w-4" aria-hidden />
              Elegir archivo CSV
            </Button>
            <Button variant="secondary" onClick={downloadTemplate}>
              <Download className="h-4 w-4" aria-hidden />
              Descargar plantilla
            </Button>
          </div>
        </div>
      )}

      {stage.kind === 'reviewing' && (
        <Review
          result={stage.result}
          fileName={stage.fileName}
          unknown={stage.unknown}
          keepExtraColumns={keepExtraColumns}
          isDemo={isDemo}
          filter={filter}
          setFilter={setFilter}
          panel={reviewPanel?.({ result: stage.result, options: stage.options, isDemo, busy, apply: applyOptions })}
          footer={
            <div className="space-y-3">
              {blocked && <Alert tone="warning">{blocked}</Alert>}
              <div className="flex flex-wrap gap-3">
                <Button
                  loading={busy}
                  onClick={confirm}
                  disabled={!!blocked || !stage.result.rows.some((r) => ['new', 'update', 'conflict'].includes(r.status))}
                >
                  {confirmLabel}
                </Button>
                <Button variant="secondary" onClick={reset} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </div>
          }
        />
      )}

      {stage.kind === 'done' && (
        <div className="space-y-4">
          <Alert tone="success">
            <p className="font-semibold">Importación completada</p>
            <p className="mt-1">{importSummary(stage.result.counts)}</p>
          </Alert>
          <Counts counts={stage.result.counts} />
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Importar otro archivo
          </Button>
        </div>
      )}
    </div>
  );
}

const SUMMARY_PARTS: Array<[string, string, string]> = [
  ['update', 'actualizado', 'actualizados'],
  ['new', 'nuevo', 'nuevos'],
  ['conflict', 'requiere revisión', 'requieren revisión'],
  ['error', 'con error', 'con error'],
];

/** "1,842 actualizados · 17 nuevos · 3 requieren revisión" */
export function importSummary(counts: Record<string, number>) {
  const parts = SUMMARY_PARTS.filter(([key]) => (counts[key] ?? 0) > 0).map(
    ([key, one, many]) => `${counts[key].toLocaleString('es-MX')} ${counts[key] === 1 ? one : many}`,
  );
  return parts.length ? parts.join(' · ') : 'No hubo cambios que guardar.';
}

function Counts({ counts, active, onPick }: { counts: Record<string, number>; active?: string; onPick?: (k: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Object.entries(STATUS)
        .filter(([k]) => k in counts)
        .map(([k, s]) => (
          <button
            key={k}
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(active === k ? 'all' : k)}
            className={`card p-4 text-left transition-colors ${active === k ? 'border-secondary-400' : ''} ${onPick ? 'hover:border-secondary-400' : ''}`}
          >
            <p className="text-xs text-ink-muted">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{counts[k] ?? 0}</p>
          </button>
        ))}
    </div>
  );
}

function Review({
  result,
  fileName,
  unknown,
  keepExtraColumns,
  isDemo,
  filter,
  setFilter,
  panel,
  footer,
}: {
  result: ImportResult;
  fileName: string;
  unknown: string[];
  keepExtraColumns: boolean;
  isDemo: boolean;
  filter: string;
  setFilter: (f: string) => void;
  panel?: ReactNode;
  footer: ReactNode;
}) {
  const rows = useMemo(() => result.rows.filter((r) => filter === 'all' || r.status === filter), [result.rows, filter]);
  const fields = (list?: string[]) => (list ?? []).map((f) => FIELD_LABELS[f] ?? f).join(', ');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Vista previa de {fileName}</h2>
        {isDemo && <Badge tone="warning">Datos de prueba</Badge>}
      </div>
      <p className="text-sm text-ink-muted">Aún no se ha guardado nada. Revisa el resumen y confirma para aplicar todos los cambios a la vez.</p>
      {unknown.length > 0 &&
        (keepExtraColumns ? (
          <Alert tone="info">
            Estas columnas se conservarán como información adicional del participante (solo visible para Coordinación y en la
            exportación): {unknown.join(', ')}.
          </Alert>
        ) : (
          <Alert tone="warning">Estas columnas no se reconocieron y no se importarán: {unknown.join(', ')}.</Alert>
        ))}
      <Counts counts={result.counts} active={filter} onPick={setFilter} />
      {panel}

      <div className="card overflow-hidden">
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-raised text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3">Fila</th>
                <th className="px-4 py-3">Registro</th>
                <th className="px-4 py-3">Resultado</th>
                <th className="px-4 py-3">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 500).map((r) => (
                <tr key={`${r.row}-${r.email ?? r.label}`} className="align-top">
                  <td className="px-4 py-3 text-ink-muted">{r.row}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.name || r.label || '—'}</p>
                    {r.email && <p className="text-xs text-ink-muted">{r.email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  </td>
                  <td className="space-y-1 px-4 py-3 text-xs">
                    {r.alert && <p className="rounded-md border border-error-400/60 bg-error-500/15 px-2 py-1 font-semibold text-fg-error">{r.alert}</p>}
                    {r.note && <p className="font-semibold text-fg-info">{r.note}</p>}
                    {r.errors.map((e) => <p key={e} className="text-fg-error">{e}</p>)}
                    {r.warnings.map((w) => <p key={w} className="text-fg-warning">{w}</p>)}
                    {!!r.updated_fields?.length && <p className="text-ink-muted">Actualiza: {fields(r.updated_fields)}</p>}
                    {!!r.conflict_fields?.length && (
                      <p className="text-fg-warning">Corregido a mano, queda para revisión: {fields(r.conflict_fields)}</p>
                    )}
                    {r.status === 'duplicate' && <p className="text-ink-muted">Se usa la última aparición de este correo.</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-center text-sm text-ink-muted">No hay filas en este grupo.</p>}
          {rows.length > 500 && <p className="p-4 text-center text-xs text-ink-muted">Se muestran las primeras 500 filas.</p>}
        </div>
      </div>
      {footer}
    </div>
  );
}
