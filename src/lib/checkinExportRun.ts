import { fetchActivityCredentialDisplay } from './checkin';
import {
  buildPlan, controlCsv, EXCLUSION_TEXT, singleWorkshopDocument, controlRows, fetchExportMetadata, normalizeWorkshops, recipientsCsv,
  type ExportFormat, type ExportMeta, type ExportPlan, type ExportWorkshop,
} from './checkinExport';
import { buildDocumentPdf, type ExportCredential } from './checkinPdf';
import { friendlyError } from './errors';

/*
 * Producción del archivo: pide las credenciales VIGENTES (nunca las regenera), arma los PDF y entrega un único archivo.
 *
 * Seguridad: los tokens solo existen en memoria durante la exportación. No se escriben en almacenamiento, URL, consola ni
 * telemetría, y los PDF no se suben a ningún lado. Cada credencial se lee con `activity_credential_display`, que ya audita la consulta.
 */

export type RunPhase = 'preparando' | 'credenciales' | 'documentos' | 'comprimiendo';
export type RunProgress = { phase: RunPhase; done: number; total: number };

export type Failure = { workshopId: string; title: string; reason: string };

/** Credencial retenida de un intento anterior, con la fecha de emisión que tenía el servidor para poder descartarla si cambió. */
export type Held = { credential: ExportCredential; rotatedAt: string | null };

export type RunDeps = {
  fetchMetadata: () => Promise<ExportMeta[]>;
  fetchCredential: (activityId: string) => Promise<{ activity_id?: string; qr_token?: string; manual_code?: string }>;
  loadLogo: () => Promise<Uint8Array | null>;
  now: () => Date;
};

export const LOGO_URL = '/assets/images/Logo_Anahuac_NRA_Licenciaturas.png';

export const defaultDeps: RunDeps = {
  fetchMetadata: fetchExportMetadata,
  fetchCredential: fetchActivityCredentialDisplay,
  loadLogo: async () => {
    try {
      const response = await fetch(LOGO_URL);
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    } catch {
      return null;
    }
  },
  now: () => new Date(),
};

export class ExportAborted extends Error {
  constructor() { super('EXPORT_ABORTED'); this.name = 'ExportAborted'; }
}

const throwIfAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new ExportAborted(); };

export type RunOptions = {
  /** Talleres confirmados por Coordinación en la pantalla (ids). Se vuelven a leer del servidor antes de producir nada. */
  workshopIds: string[];
  format: ExportFormat;
  includeControl: boolean;
  /** Credenciales de un intento anterior (para reintentar solo lo que faltó). */
  held?: ReadonlyMap<string, Held>;
  /** Producir el archivo sin los talleres cuyo QR no se pudo obtener (solo tras confirmarlo en la pantalla). */
  allowPartial?: boolean;
  concurrency?: number;
  attempts?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
  deps?: Partial<RunDeps>;
};

export type ExportFile = { name: string; blob: Blob; mime: string };

export type RunResult =
  | { kind: 'done'; file: ExportFile; plan: ExportPlan; included: ExportWorkshop[]; missing: Failure[]; pages: number; documents: number }
  | { kind: 'incomplete'; plan: ExportPlan; failures: Failure[]; held: Map<string, Held> };

const isComplete = (value: { qr_token?: string; manual_code?: string }): value is ExportCredential =>
  typeof value.qr_token === 'string' && value.qr_token.trim() !== '' && typeof value.manual_code === 'string' && value.manual_code.trim() !== '';

async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      throwIfAborted(signal);
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(runners);
}

/** Pide las credenciales que faltan. Cada una se intenta `attempts` veces; las que no se obtienen se devuelven como fallas, con nombre. */
export async function collectCredentials(
  workshops: ExportWorkshop[],
  held: ReadonlyMap<string, Held>,
  options: { deps: RunDeps; concurrency: number; attempts: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<{ held: Map<string, Held>; failures: Failure[] }> {
  const result = new Map<string, Held>();
  const failures: Failure[] = [];
  const pending: ExportWorkshop[] = [];
  for (const workshop of workshops) {
    const previous = held.get(workshop.id);
    // Una credencial retenida solo sirve si el servidor la sigue teniendo con la misma fecha de emisión.
    if (previous && previous.rotatedAt === workshop.credentialRotatedAt) result.set(workshop.id, previous);
    else pending.push(workshop);
  }
  let done = workshops.length - pending.length;
  options.onProgress?.(done, workshops.length);
  await pool(pending, options.concurrency, async (workshop) => {
    let reason = '';
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      throwIfAborted(options.signal);
      try {
        const display = await options.deps.fetchCredential(workshop.id);
        if (display.activity_id && display.activity_id !== workshop.id) throw new Error('CREDENTIAL_MISMATCH');
        if (!isComplete(display)) throw new Error('INCOMPLETE_CREDENTIAL');
        result.set(workshop.id, { credential: { qr_token: display.qr_token, manual_code: display.manual_code }, rotatedAt: workshop.credentialRotatedAt });
        reason = '';
        break;
      } catch (cause) {
        if (cause instanceof ExportAborted) throw cause;
        reason = cause instanceof Error && cause.message === 'INCOMPLETE_CREDENTIAL' ? 'El servidor devolvió una credencial incompleta.' : friendlyError(cause);
      }
    }
    if (reason) failures.push({ workshopId: workshop.id, title: workshop.title, reason });
    done += 1;
    options.onProgress?.(done, workshops.length);
  }, options.signal);
  return { held: result, failures: failures.sort((a, b) => a.title.localeCompare(b.title, 'es-MX')) };
}

const slugDate = (date: Date) => {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}`;
};

/** Arma el archivo final: un PDF (concentrado) o un ZIP con los PDF y, si se pidió, la lista de control. */
export async function runExport(options: RunOptions): Promise<RunResult> {
  const deps: RunDeps = { ...defaultDeps, ...options.deps };
  const { signal, onProgress } = options;
  const report = (phase: RunPhase, done: number, total: number) => onProgress?.({ phase, done, total });

  // 1. Datos frescos: horarios, estado y emisión de credenciales tal como están ahora, no como estaban al abrir la pantalla.
  report('preparando', 0, 1);
  const ids = new Set(options.workshopIds);
  const fresh = normalizeWorkshops(await deps.fetchMetadata()).filter((workshop) => ids.has(workshop.id));
  throwIfAborted(signal);
  const fullPlan = buildPlan(fresh, options.format);
  report('preparando', 1, 1);
  // Un taller confirmado que ya no está en la edición se informa; no se omite en silencio.
  const gone: Failure[] = options.workshopIds.filter((id) => !fresh.some((workshop) => workshop.id === id))
    .map((id) => ({ workshopId: id, title: 'Taller que ya no está en la edición', reason: 'Ya no existe o dejó de estar disponible. Actualiza la lista.' }));

  // 2. Credenciales vigentes (solo lectura).
  const collected = await collectCredentials(fullPlan.workshops, options.held ?? new Map(), {
    deps, concurrency: options.concurrency ?? 4, attempts: options.attempts ?? 2, signal,
    onProgress: (done, total) => report('credenciales', done, total),
  });
  let held = collected.held;
  const failures = [...gone, ...collected.failures];

  // 3. Que ninguna credencial haya cambiado mientras se descargaba: si Coordinación (u otra persona) regeneró una, la obtenida puede ser vieja.
  if (held.size > 0) {
    const after = new Map(normalizeWorkshops(await deps.fetchMetadata()).map((workshop) => [workshop.id, workshop]));
    for (const workshop of fullPlan.workshops) {
      if (!held.has(workshop.id)) continue;
      const current = after.get(workshop.id);
      if (!current || current.credentialRotatedAt !== workshop.credentialRotatedAt) {
        held = new Map(held);
        held.delete(workshop.id);
        failures.push({ workshopId: workshop.id, title: workshop.title, reason: 'Su credencial se regeneró mientras se preparaba la descarga. Reintenta para usar la vigente.' });
      }
    }
  }
  throwIfAborted(signal);

  if (failures.length > 0 && !options.allowPartial) return { kind: 'incomplete', plan: fullPlan, failures, held };

  // 4. Documentos. Si se aceptó una descarga parcial, los talleres sin QR se quitan y quedan listados.
  const missingIds = new Set(failures.map((failure) => failure.workshopId));
  const documents = fullPlan.documents
    .map((document) => ({ ...document, workshops: document.workshops.filter((workshop) => !missingIds.has(workshop.id)) }))
    .filter((document) => document.workshops.length > 0);
  if (documents.length === 0) return { kind: 'incomplete', plan: fullPlan, failures, held };

  const credentials = new Map([...held].map(([id, value]) => [id, value.credential]));
  const logo = await deps.loadLogo();
  const now = deps.now();
  const built: { name: string; folder: string | null; bytes: Uint8Array }[] = [];
  report('documentos', 0, documents.length);
  for (const document of documents) {
    throwIfAborted(signal);
    const pdf = await buildDocumentPdf(document, credentials, { logo, now });
    built.push({ name: document.fileName, folder: document.folder, bytes: pdf.bytes });
    report('documentos', built.length, documents.length);
    await new Promise((resolve) => setTimeout(resolve, 0)); // cede el hilo: la barra de progreso se pinta entre documentos
  }
  const included = fullPlan.workshops.filter((workshop) => !missingIds.has(workshop.id));
  const missing = failures;
  const pages = documents.reduce((total, document) => total + document.workshops.length, 0);

  // 5. Un solo archivo.
  const stamp = slugDate(now);
  if (options.format === 'general' && !options.includeControl && missing.length === 0 && built.length === 1) {
    const only = built[0];
    return { kind: 'done', file: { name: only.name, blob: new Blob([only.bytes], { type: 'application/pdf' }), mime: 'application/pdf' }, plan: fullPlan, included, missing, pages, documents: 1 };
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const entry of built) zip.file(entry.folder ? `${entry.folder}/${entry.name}` : entry.name, entry.bytes);
  if (options.includeControl) {
    const missingSet = new Set(missing.map((failure) => failure.workshopId));
    zip.file('Lista-de-control.csv', controlCsv(controlRows(fullPlan, missingSet)));
    if (options.format === 'tallerista') zip.file('Destinatarios.csv', recipientsCsv(fullPlan, missingSet));
  }
  if (missing.length > 0) {
    zip.file('FALTANTES.txt', [
      'Este archivo NO está completo. No se pudo obtener el QR de estos talleres, por lo que no se incluyeron:',
      '', ...missing.map((failure) => `- ${failure.title}: ${failure.reason}`),
      '', 'Vuelve a descargar desde Check-in → Descargar QR de talleres cuando se resuelva.',
    ].join('\r\n'));
  }
  report('comprimiendo', 0, 100);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (metadata) => {
    throwIfAborted(signal);
    report('comprimiendo', Math.round(metadata.percent), 100);
  });
  const label = options.format === 'tallerista' ? 'Talleristas' : options.format === 'division' ? 'Divisiones' : 'Concentrado';
  return {
    kind: 'done',
    file: { name: `DiaOV2026_QR_${label}${missing.length > 0 ? '_INCOMPLETO' : ''}_${stamp}.zip`, blob: new Blob([bytes], { type: 'application/zip' }), mime: 'application/zip' },
    plan: fullPlan, included, missing, pages, documents: built.length,
  };
}

/** Un solo taller: pide su credencial vigente y entrega su PDF. */
export async function exportSingleWorkshop(workshop: ExportWorkshop, deps: Partial<RunDeps> = {}): Promise<ExportFile> {
  const run = await runExport({ workshopIds: [workshop.id], format: 'general', includeControl: false, deps });
  if (run.kind === 'incomplete') {
    const blocked = run.plan.excluded[0];
    throw new Error(blocked ? EXCLUSION_TEXT[blocked.reason] : run.failures[0]?.reason ?? 'No se pudo obtener el QR de este taller.');
  }
  return { ...run.file, name: singleWorkshopDocument(workshop).fileName };
}

/** Una sola descarga en el navegador. La URL temporal se libera enseguida; el archivo no se guarda en ningún servidor. */
export function saveFile(file: ExportFile) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
