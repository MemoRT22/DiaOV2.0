// Frontera HTTP pública de `workshop-intake`. Solo APIs web estándar (Request/Response): no depende de Deno,
// así que se prueba con Node. Las credenciales server-side viven únicamente en index.ts (runtime de la función).
import { ACTIVITY_TYPES, ADMIN_FIELDS, LIMITS, validateSubmission } from './validation.ts';

export type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

export type Deps = {
  /** Llamada RPC con credenciales server-side. Solo se usan las dos primitivas internas. */
  rpc: (fn: 'workshop_intake_catalog_internal' | 'create_workshop_submission_internal', args?: Record<string, unknown>) => Promise<RpcResult>;
  /**
   * Punto de extensión antiabuso (CAPTCHA / token de verificación / honeypot). Se ejecuta antes de validar y de
   * escribir. Hoy no hay implementación; devolver `{ ok: false, status, error }` para rechazar.
   */
  antiAbuse?: (ctx: { req: Request; body: Record<string, unknown> }) => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  /** Log solo de códigos técnicos: jamás el body, correos, teléfonos ni credenciales. */
  log?: (event: string, info?: Record<string, unknown>) => void;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Códigos de negocio que la primitiva SQL puede levantar (RAISE EXCEPTION 'CODE'). */
const BUSINESS_CODES = new Set([
  'INVALID_PAYLOAD',
  'INVALID_DIVISION',
  'INVALID_CAREER',
  'DUPLICATE_CAREER',
  'CAREERS_REQUIRED',
  'CATALOG_MISMATCH',
]);

function mapDbError(error: { code?: string; message?: string }): Response | null {
  const message = String(error.message ?? '');
  if (message.includes('NO_ACTIVE_EDITION')) return json({ error: 'NO_ACTIVE_EDITION' }, 503);
  const code = [...BUSINESS_CODES].find((c) => message.includes(c));
  if (code) return json({ error: code }, 422);
  // Violaciones de constraint (23xxx) o datos con formato inválido (22xxx): la base protegió un invariante.
  if (typeof error.code === 'string' && /^(22|23)/.test(error.code)) return json({ error: 'VALIDATION_FAILED' }, 422);
  return null;
}

/** Lee el body con tope duro de bytes (no confía solo en Content-Length). */
async function readBody(req: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' };
  if (!req.body) return { ok: true, text: '' };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(merged) };
  } catch {
    return { ok: false, status: 400, error: 'INVALID_ENCODING' };
  }
}

async function handleGet(deps: Deps): Promise<Response> {
  const { data, error } = await deps.rpc('workshop_intake_catalog_internal');
  if (error) {
    const mapped = mapDbError(error);
    if (mapped) return mapped;
    deps.log?.('catalog_failed', { code: error.code });
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
  const catalog = (data ?? {}) as { edition?: unknown; divisions?: unknown; careers?: unknown };
  // Solo lo necesario para construir el formulario; nada de participantes, Staff, reservaciones, QR ni auditoría.
  return json(
    {
      edition: catalog.edition ?? null,
      divisions: catalog.divisions ?? [],
      careers: catalog.careers ?? [],
      activity_types: ACTIVITY_TYPES,
      limits: LIMITS,
    },
    200,
    { 'Cache-Control': 'public, max-age=60' },
  );
}

async function handlePost(req: Request, deps: Deps): Promise<Response> {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(contentType)) return json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, 415);

  const body = await readBody(req, LIMITS.bodyMaxBytes);
  if (!body.ok) return json({ error: body.error }, body.status);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return json({ error: 'INVALID_PAYLOAD' }, 400);

  if (deps.antiAbuse) {
    const verdict = await deps.antiAbuse({ req, body: parsed as Record<string, unknown> });
    if (!verdict.ok) return json({ error: verdict.error }, verdict.status);
  }

  const result = validateSubmission(parsed);
  if (!result.ok) {
    if (result.kind === 'unknown_fields') {
      // Política: propiedades no permitidas (incluidas las administrativas) rechazan todo el request.
      const adminFields = result.fields.filter((f) => (ADMIN_FIELDS as readonly string[]).includes(f));
      return json({ error: 'UNKNOWN_FIELDS', fields: result.fields.slice(0, 20).map((f) => f.slice(0, 60)), admin_fields_forbidden: adminFields.length > 0 }, 400);
    }
    return json({ error: 'VALIDATION_FAILED', errors: result.errors }, 422);
  }

  const { data, error } = await deps.rpc('create_workshop_submission_internal', { p_payload: result.value });
  if (error) {
    const mapped = mapDbError(error);
    if (mapped) return mapped;
    deps.log?.('submission_failed', { code: error.code });
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
  const created = (data ?? {}) as { submission_id?: string; status?: string; submitted_at?: string };
  if (!created.submission_id) {
    deps.log?.('submission_missing_id');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
  // Respuesta mínima: nada administrativo.
  return json({ submission_id: created.submission_id, status: created.status, submitted_at: created.submitted_at }, 201);
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method === 'GET') return await handleGet(deps);
    if (req.method === 'POST') return await handlePost(req, deps);
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, OPTIONS' });
  } catch (cause) {
    deps.log?.('unhandled', { name: cause instanceof Error ? cause.name : typeof cause });
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
}
