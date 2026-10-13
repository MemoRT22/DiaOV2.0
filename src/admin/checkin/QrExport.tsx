import { ArrowLeft, Download, FileSpreadsheet, FileText, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, LoadError, Modal, PageSkeleton } from '../../components/ui';
import {
  applyFilters, buildPlan, controlCsv, controlRows, DEFAULT_FILTERS, EXCLUSION_TEXT, exclusionOf, fetchExportMetadata, filterOptions, filtersActive,
  FORMAT_LABEL, KIND_LABEL, normalizeWorkshops, type ExportFilters, type ExportFormat, type ExportKind, type ExportWorkshop, type Option,
} from '../../lib/checkinExport';
import {
  ExportAborted, exportSingleWorkshop, runExport, saveFile, type Failure, type Held, type RunProgress,
} from '../../lib/checkinExportRun';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { DataPanel, EmptyState, PageHeader, SearchField, SectionHeading } from '../design/Primitives';
import './qrExport.css';

type RunState =
  | { state: 'idle' }
  | { state: 'running'; progress: RunProgress | null }
  | { state: 'incomplete'; failures: Failure[]; included: number; total: number }
  | { state: 'done'; fileName: string; workshops: number; pages: number; documents: number; missing: Failure[]; excluded: number }
  | { state: 'error'; message: string };

const FORMATS: { value: ExportFormat; title: string; detail: string }[] = [
  { value: 'tallerista', title: 'Por tallerista', detail: 'Un ZIP con un PDF por responsable; si tiene varios talleres, una página por taller. Es el recomendado para enviar por correo.' },
  { value: 'division', title: 'Por división', detail: 'Un ZIP con un PDF por división. Un taller de varias divisiones aparece en cada una con el mismo QR.' },
  { value: 'general', title: 'Concentrado general', detail: 'Un solo PDF con un QR por taller, sin repetir, ordenado por área.' },
];

const PHASE_TEXT: Record<RunProgress['phase'], string> = {
  preparando: 'Revisando la información más reciente',
  credenciales: 'Obteniendo las credenciales vigentes',
  documentos: 'Generando los PDF',
  comprimiendo: 'Comprimiendo el archivo',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lista de opciones con búsqueda y casillas; vacía = «todas». */
function MultiSelect({ label, options, value, onChange, allLabel }: { label: string; options: Option[]; value: string[]; onChange: (next: string[]) => void; allLabel: string }) {
  const [query, setQuery] = useState('');
  const shown = options.filter((option) => option.label.toLocaleLowerCase('es-MX').includes(query.trim().toLocaleLowerCase('es-MX')));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  return (
    <details className="qx-picker">
      <summary aria-label={label}><span className="qx-picker-label">{label}</span><span className="qx-picker-value">{value.length === 0 ? allLabel : `${value.length} seleccionad${value.length === 1 ? 'o' : 'os'}`}</span></summary>
      <div className="qx-picker-body">
        {options.length > 8 && <input type="search" className="qx-picker-search" aria-label={`Buscar en ${label}`} placeholder="Buscar…" value={query} onChange={(event) => setQuery(event.target.value)} />}
        <ul role="group" aria-label={label}>
          {shown.map((option) => (
            <li key={option.value}>
              <label><input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)} /><span>{option.label}</span><em>{option.count}</em></label>
            </li>
          ))}
          {shown.length === 0 && <li className="qx-picker-empty">Sin coincidencias</li>}
        </ul>
        {value.length > 0 && <button type="button" className="qx-link" onClick={() => onChange([])}>Quitar selección</button>}
      </div>
    </details>
  );
}

export default function QrExport() {
  const { data, error, loading, reload } = useLoad(() => fetchExportMetadata(), []);
  const [filters, setFilters] = useState<ExportFilters>(DEFAULT_FILTERS);
  const [format, setFormat] = useState<ExportFormat>('tallerista');
  const [includeControl, setIncludeControl] = useState(true);
  const [run, setRun] = useState<RunState>({ state: 'idle' });
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [single, setSingle] = useState<{ id: string | null; error: string | null }>({ id: null, error: null });
  // Las credenciales de un intento fallido viven solo aquí, en memoria, para reintentar únicamente lo que faltó.
  const held = useRef<Map<string, Held> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastFailures = useRef<Failure[]>([]);
  const mounted = useRef(true);

  // StrictMode monta, desmonta y vuelve a montar: la marca debe volver a encenderse al montar.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); held.current = null; }; }, []);

  const workshops = useMemo(() => (data ? normalizeWorkshops(data) : []), [data]);
  const options = useMemo(() => filterOptions(workshops, filters.includeDemo), [workshops, filters.includeDemo]);
  const selected = useMemo(() => applyFilters(workshops, filters), [workshops, filters]);
  const plan = useMemo(() => buildPlan(selected, format), [selected, format]);
  const busy = run.state === 'running';
  const realCount = workshops.filter((workshop) => !workshop.isDemo).length;
  const demoCount = workshops.length - realCount;

  const change = (patch: Partial<ExportFilters>) => {
    held.current = null;
    setRun({ state: 'idle' });
    setFilters((current) => ({ ...current, ...patch }));
  };
  const changeFormat = (next: ExportFormat) => { held.current = null; setRun({ state: 'idle' }); setFormat(next); };

  const start = async (allowPartial = false) => {
    const controller = new AbortController();
    abort.current = controller;
    setConfirmPartial(false);
    setRun({ state: 'running', progress: null });
    try {
      const result = await runExport({
        workshopIds: selected.map((workshop) => workshop.id), format, includeControl, held: held.current ?? undefined, allowPartial, signal: controller.signal,
        onProgress: (progress) => { if (mounted.current) setRun({ state: 'running', progress }); },
      });
      if (!mounted.current) return;
      if (result.kind === 'incomplete') {
        held.current = result.held;
        lastFailures.current = result.failures;
        setRun({ state: 'incomplete', failures: result.failures, included: result.plan.workshops.length - result.failures.length, total: result.plan.workshops.length });
        return;
      }
      held.current = null;
      saveFile(result.file);
      void reload(); // las fechas de emisión de la lista quedan al día
      setRun({ state: 'done', fileName: result.file.name, workshops: result.included.length, pages: result.pages, documents: result.documents, missing: result.missing, excluded: result.plan.excluded.length });
    } catch (cause) {
      if (!mounted.current) return;
      setRun(cause instanceof ExportAborted ? { state: 'idle' } : { state: 'error', message: friendlyError(cause) });
    } finally {
      abort.current = null;
    }
  };

  const downloadControl = () => {
    const blob = new Blob([controlCsv(controlRows(plan))], { type: 'text/csv;charset=utf-8' });
    saveFile({ name: 'DiaOV2026_QR_Lista-de-control.csv', blob, mime: 'text/csv' });
  };

  const downloadOne = async (workshop: ExportWorkshop) => {
    setSingle({ id: workshop.id, error: null });
    try {
      saveFile(await exportSingleWorkshop(workshop));
      setSingle({ id: null, error: null });
    } catch (cause) {
      setSingle({ id: null, error: `${workshop.title}: ${friendlyError(cause)}` });
    }
  };

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const { summary } = plan;
  const outputKind = format === 'general' && !includeControl ? 'PDF' : 'ZIP';
  const progress = run.state === 'running' ? run.progress : null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="ad-page qx">
      <PageHeader eyebrow="Operación / Check-in" title="Descargar QR de talleres"
        description="Reúne los QR de asistencia vigentes en PDF listos para imprimir o enviar a cada tallerista. Se usa el QR que ya tiene cada taller, válido para todos sus horarios: aquí no se genera ni se cambia ninguno."
        action={<Link to="/coordinacion/checkin" className="btn btn-secondary inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold"><ArrowLeft aria-hidden size={16} />Volver a Check-in</Link>} />

      <Alert tone="warning">
        <strong>Antes de compartir:</strong> si después regeneras la credencial de un taller, los PDF que ya descargaste de ese taller dejan de funcionar y habrá que enviar uno nuevo.
        Esta pantalla nunca regenera credenciales.
      </Alert>

      <section aria-labelledby="qx-filters">
        <SectionHeading title="Qué talleres incluir" detail={`${realCount} ${realCount === 1 ? 'taller real' : 'talleres reales'} en la edición${demoCount > 0 ? ` y ${demoCount} DEMO (de prueba, fuera por defecto)` : ''}.`}
          action={filtersActive(filters) ? <Button variant="ghost" onClick={() => change(DEFAULT_FILTERS)}><RotateCcw aria-hidden size={16} />Limpiar filtros</Button> : undefined} />
        <DataPanel className="qx-filters">
          <div id="qx-filters" className="qx-filter-grid">
            <SearchField label="Buscar" value={filters.search} onChange={(search) => change({ search })} placeholder="Taller, responsable, correo o lugar" />
            <fieldset className="qx-checks">
              <legend>Tipo de actividad</legend>
              {(['academica', 'vida_universitaria'] as ExportKind[]).map((kind) => (
                <label key={kind}><input type="checkbox" checked={filters.kinds.includes(kind)}
                  onChange={() => change({ kinds: filters.kinds.includes(kind) ? filters.kinds.filter((item) => item !== kind) : [...filters.kinds, kind] })} />{KIND_LABEL[kind]}</label>
              ))}
            </fieldset>
            <MultiSelect label="División académica" allLabel="Todas" options={options.divisions} value={filters.divisionIds} onChange={(divisionIds) => change({ divisionIds })} />
            <MultiSelect label="Carrera o área" allLabel="Todas" options={options.careers} value={filters.careerIds} onChange={(careerIds) => change({ careerIds })} />
            <MultiSelect label="Tallerista o responsable" allLabel="Todos" options={options.responsibles} value={filters.responsibleKeys} onChange={(responsibleKeys) => change({ responsibleKeys })} />
            <MultiSelect label="Talleres" allLabel="Todos"
              options={workshops.filter((workshop) => filters.includeDemo || !workshop.isDemo).map((workshop) => ({ value: workshop.id, label: workshop.title, count: workshop.sessions.length })).sort((a, b) => a.label.localeCompare(b.label, 'es-MX'))}
              value={filters.workshopIds} onChange={(workshopIds) => change({ workshopIds })} />
            {options.buildings.length > 0 && <MultiSelect label="Edificio" allLabel="Todos" options={options.buildings} value={filters.buildings} onChange={(buildings) => change({ buildings })} />}
          </div>
          {demoCount > 0 && (
            <label className="qx-demo">
              <input type="checkbox" checked={filters.includeDemo} onChange={(event) => change({ includeDemo: event.target.checked })} />
              <span><strong>Incluir talleres DEMO ({demoCount})</strong><small>Son de prueba y no deben llegar a talleristas. Apagado por defecto: solo se exportan talleres reales publicados.</small></span>
            </label>
          )}
        </DataPanel>
      </section>

      <section aria-labelledby="qx-format">
        <SectionHeading title="Cómo agruparlos" />
        <div id="qx-format" className="qx-formats" role="radiogroup" aria-label="Formato de descarga">
          {FORMATS.map((item) => (
            <label key={item.value} className="qx-format" data-selected={format === item.value || undefined}>
              <input type="radio" name="qx-format" value={item.value} checked={format === item.value} onChange={() => changeFormat(item.value)} />
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
            </label>
          ))}
        </div>
      </section>

      <section aria-labelledby="qx-summary">
        <SectionHeading title="Antes de descargar" detail={FORMAT_LABEL[format]} />
        <DataPanel className="qx-summary">
          <dl id="qx-summary" className="qx-counts">
            <div><dt>Talleres seleccionados</dt><dd>{summary.matching}</dd></div>
            <div><dt>QR a incluir</dt><dd>{summary.qrCount}</dd></div>
            {format === 'tallerista' && <div><dt>Responsables</dt><dd>{summary.recipients}</dd></div>}
            {format === 'division' && <div><dt>Divisiones o grupos</dt><dd>{summary.groups}</dd></div>}
            <div><dt>Documentos PDF</dt><dd>{summary.documents}</dd></div>
            <div><dt>Páginas</dt><dd>{summary.pages}</dd></div>
          </dl>
          {summary.pages > summary.workshops && <p className="ad-context-help">Hay {summary.pages - summary.workshops} páginas repetidas porque algunos talleres pertenecen a varias divisiones; usan el mismo QR.</p>}
          <ul className="qx-warnings" aria-label="Avisos de la selección">
            {summary.demo > 0 && <li data-tone="warning"><Badge tone="warning">DEMO</Badge> {plural(summary.demo, 'taller de prueba incluido', 'talleres de prueba incluidos')}. No los envíes a talleristas.</li>}
            {summary.withoutResponsible > 0 && <li><Badge tone="warning">Sin responsable</Badge> {plural(summary.withoutResponsible, 'taller', 'talleres')}{format === 'tallerista' ? ': se genera un PDF aparte por cada uno en la carpeta «Sin responsable»' : ''}.</li>}
            {summary.withoutEmail > 0 && <li><Badge tone="warning">Sin correo</Badge> {plural(summary.withoutEmail, 'taller tiene responsable sin correo', 'talleres tienen responsable sin correo')}: no podrás enviarlo hasta capturarlo.</li>}
            {summary.withoutDivision > 0 && <li><Badge tone="info">Sin división</Badge> {plural(summary.withoutDivision, 'taller académico', 'talleres académicos')} sin división asignada{format === 'division' ? ': van al grupo «Sin división asignada»' : ''}.</li>}
            {summary.withoutSessions > 0 && <li data-tone="error"><Badge tone="error">Sin horarios</Badge> {plural(summary.withoutSessions, 'taller', 'talleres')} sin horarios vigentes (cancelados u ocultos): no se exportan.</li>}
            {summary.withoutCredential > 0 && <li data-tone="error"><Badge tone="error">Sin credencial</Badge> {plural(summary.withoutCredential, 'taller', 'talleres')} sin credencial: no se exportan. Esta pantalla no las genera.</li>}
          </ul>
          {plan.excluded.length > 0 && (
            <details className="qx-excluded"><summary>Ver los {plan.excluded.length} que no se exportarán</summary>
              <ul>{plan.excluded.map((entry) => <li key={entry.workshop.id}><strong>{entry.workshop.title}</strong> — {EXCLUSION_TEXT[entry.reason]}</li>)}</ul>
            </details>
          )}
          <label className="qx-control">
            <input type="checkbox" checked={includeControl} onChange={(event) => setIncludeControl(event.target.checked)} />
            <span>Incluir la lista de control{format === 'tallerista' ? ' y la lista de destinatarios' : ''} (CSV, sin QR ni códigos) dentro del ZIP
              {format === 'general' && <small>Con el concentrado general, marcarla convierte la descarga en un ZIP.</small>}</span>
          </label>

          {run.state === 'running' && (
            <div className="qx-progress" role="status" aria-live="polite">
              <div className="qx-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Avance de la descarga"><i style={{ width: `${percent}%` }} /></div>
              <p>{progress ? `${PHASE_TEXT[progress.phase]}${progress.phase === 'comprimiendo' ? ` · ${progress.done} %` : ` · ${progress.done} de ${progress.total}`}` : 'Preparando…'}</p>
              <Button variant="secondary" onClick={() => abort.current?.abort()}><X aria-hidden size={16} />Cancelar</Button>
            </div>
          )}

          {run.state === 'error' && <Alert tone="error">{run.message} No se descargó ningún archivo.</Alert>}

          {run.state === 'incomplete' && (
            <div className="qx-failure" role="alert">
              <h3>No se pudo obtener el QR de {plural(run.failures.length, 'taller', 'talleres')}</h3>
              <p>No se descargó nada para no entregarte un archivo incompleto. {run.included} de {run.total} QR sí se obtuvieron.</p>
              <ul>{run.failures.map((failure) => <li key={failure.workshopId}><strong>{failure.title}</strong> — {failure.reason}</li>)}</ul>
              <div className="qx-actions">
                <Button onClick={() => void start(false)}><RotateCcw aria-hidden size={16} />Reintentar los que faltan</Button>
                {run.included > 0 && <Button variant="secondary" onClick={() => setConfirmPartial(true)}>Descargar sin esos {run.failures.length}…</Button>}
              </div>
            </div>
          )}

          {run.state === 'done' && (
            <div className="qx-done" role="status">
              <h3>Descarga lista: {run.fileName}</h3>
              <p>Incluye {plural(run.workshops, 'taller', 'talleres')} en {plural(run.documents, 'documento', 'documentos')} ({plural(run.pages, 'página', 'páginas')}).
                {run.excluded > 0 ? ` No incluye ${run.excluded} por no tener horarios vigentes o credencial; están en la lista de control.` : ''}</p>
              {run.missing.length > 0 && <Alert tone="warning">Archivo INCOMPLETO: faltan {run.missing.map((failure) => failure.title).join(', ')}. Vuelve a descargar cuando se resuelva.</Alert>}
              <p className="ad-context-help">Cada tallerista debe recibir solo su documento. No se envió ningún correo.</p>
            </div>
          )}

          <div className="qx-actions">
            <Button onClick={() => void start(false)} disabled={busy || summary.qrCount === 0} loading={busy}>
              <Download aria-hidden size={16} />Descargar {summary.qrCount === 0 ? '' : `${outputKind} · ${plural(summary.qrCount, 'QR', 'QR')}`}
            </Button>
            <Button variant="secondary" onClick={downloadControl} disabled={busy || selected.length === 0}><FileSpreadsheet aria-hidden size={16} />Descargar solo la lista de control</Button>
          </div>
          {summary.qrCount === 0 && <p className="ad-context-help">Ningún taller cumple los filtros con horarios vigentes y credencial.</p>}
        </DataPanel>
      </section>

      <section aria-labelledby="qx-list">
        <SectionHeading title={`Talleres seleccionados (${selected.length})`} detail="Puedes bajar el PDF de un solo taller con su botón." />
        {single.error && <Alert tone="error">{single.error}</Alert>}
        <DataPanel>
          {selected.length === 0 ? <EmptyState title="Ningún taller coincide." description="Cambia o limpia los filtros." /> : (
            <ul id="qx-list" className="qx-list">
              {selected.map((workshop) => {
                const blocked = exclusionOf(workshop);
                return (
                  <li key={workshop.id}>
                    <div>
                      <span className="ad-row-title">{workshop.title}</span>
                      <span className="ad-row-meta">
                        {workshop.responsible?.name ?? 'Sin responsable'}{workshop.responsible && !workshop.responsible.email ? ' (sin correo)' : ''} · {plural(workshop.sessions.length, 'horario', 'horarios')}
                        {workshop.place ? ` · ${workshop.place}` : ''}
                      </span>
                    </div>
                    <div className="qx-badges">
                      {workshop.isDemo && <Badge tone="warning">DEMO</Badge>}
                      {blocked && <Badge tone="error">{blocked === 'sin-horarios' ? 'Sin horarios' : 'Sin credencial'}</Badge>}
                      <Button variant="ghost" disabled={busy || !!blocked || single.id !== null} loading={single.id === workshop.id} onClick={() => void downloadOne(workshop)} aria-label={`Descargar PDF de ${workshop.title}`}>
                        <FileText aria-hidden size={16} />PDF
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DataPanel>
      </section>

      {confirmPartial && run.state === 'incomplete' && (
        <Modal title="Descargar archivo incompleto" onClose={() => setConfirmPartial(false)}>
          <div className="ad-modal-form">
            <p>Se descargarán {plural(run.included, 'taller', 'talleres')}. <strong>No se incluirán</strong> estos {run.failures.length}:</p>
            <ul className="qx-modal-list">{lastFailures.current.map((failure) => <li key={failure.workshopId}>{failure.title}</li>)}</ul>
            <p className="ad-context-help">El ZIP llevará un archivo FALTANTES.txt y la lista de control marcará esos talleres como «Requiere revisión». Si un tallerista tiene varios talleres, su PDF tendrá menos páginas.</p>
            <div className="ad-modal-actions">
              <Button variant="secondary" onClick={() => setConfirmPartial(false)}>Volver</Button>
              <Button onClick={() => void start(true)}>Descargar incompleto</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
