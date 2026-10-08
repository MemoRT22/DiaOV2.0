// Frontera HTTP de revisión. Las dependencias con service_role viven solo en index.ts.
import { validateSubmission } from '../workshop-intake/validation.ts';
export type DbError = { code?: string; message?: string };
export type AuthResult = { kind: 'ok'; userId: string } | { kind: 'unauthorized' | 'forbidden' };
export type Deps = {
  authorize: (token: string) => Promise<AuthResult>;
  rpc: (name: 'workshop_admin_list_internal' | 'workshop_admin_get_internal' | 'workshop_admin_edit_internal' | 'workshop_review_transition_internal' | 'publish_workshop_submission_internal', args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError | null }>;
  log?: (event: string, code?: string) => void;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['pending', 'submitted', 'in_review', 'changes_requested', 'approved', 'published', 'archived']);
const TYPES = new Set(['academica', 'vida_universitaria']);
const MUTATIONS = new Set(['start_review', 'save_notes', 'request_changes', 'resume_review', 'archive', 'approve', 'publish', 'edit', 'approve_publish']);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

function dbFailure(error: DbError, deps: Deps): Response {
  const message = error.message ?? '';
  if (message.includes('NOT_FOUND')) return json({ error: 'NOT_FOUND' }, 404);
  if (message.includes('NOT_AUTHORIZED')) return json({ error: 'NOT_AUTHORIZED' }, 403);
  if (message.includes('INVALID_TRANSITION')) return json({ error: 'INVALID_TRANSITION' }, 409);
  if (message.includes('PUBLISH_STATE_INCONSISTENT')) return json({ error: 'PUBLISH_STATE_INCONSISTENT' }, 409);
  for (const code of ['SESSION_SCHEDULE_LOCKED', 'CAPACITY_BELOW_RESERVED']) {
    if (message.includes(code)) return json({ error: code }, 409);
  }
  if (message.includes('NO_ACTIVE_EDITION')) return json({ error: 'NO_ACTIVE_EDITION' }, 503);
  for (const code of ['INVALID_FILTER', 'INVALID_ACTION', 'NOTES_REQUIRED', 'FEEDBACK_REQUIRED', 'INVALID_PAYLOAD', 'INVALID_DURATION', 'INVALID_CAREER', 'DUPLICATE_CAREER', 'CAREERS_REQUIRED', 'TEXT_TOO_LONG']) {
    if (message.includes(code)) return json({ error: code }, 422);
  }
  deps.log?.('db_error', error.code);
  return json({ error: 'INTERNAL_ERROR' }, 500);
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const optionalFilter = (x: unknown, accepted: Set<string>): string | null | undefined =>
  x === undefined || x === null || x === '' ? null : typeof x === 'string' && accepted.has(x) ? x : undefined;

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!bearer) return json({ error: 'NOT_AUTHORIZED' }, 401);

  try {
    const caller = await deps.authorize(bearer[1]);
    if (caller.kind !== 'ok') return json({ error: 'NOT_AUTHORIZED' }, caller.kind === 'forbidden' ? 403 : 401);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get('Content-Type') ?? '')) {
      return json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    }
    if (Number(req.headers.get('Content-Length')) > 16000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 16000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: 'INVALID_JSON' }, 400); }
    if (!isRecord(body) || typeof body.action !== 'string') return json({ error: 'INVALID_INPUT' }, 400);

    if (body.action === 'list') {
      const status = optionalFilter(body.status, STATUSES);
      const type = optionalFilter(body.type, TYPES);
      const search = body.search === undefined || body.search === null ? '' : body.search;
      const page = body.page === undefined ? 1 : body.page;
      if (status === undefined || type === undefined || typeof search !== 'string' || search.trim().length > 120
        || !Number.isInteger(page) || (page as number) < 1 || (page as number) > 100000) {
        return json({ error: 'INVALID_FILTER' }, 400);
      }
      const { data, error } = await deps.rpc('workshop_admin_list_internal', {
        p_status: status, p_type: type, p_search: search.trim(), p_page: page,
      });
      return error ? dbFailure(error, deps) : json(data);
    }

    const id = body.submission_id;
    if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'INVALID_INPUT' }, 400);
    if (body.action === 'get') {
      const { data, error } = await deps.rpc('workshop_admin_get_internal', { p_submission_id: id });
      if (error) return dbFailure(error, deps);
      return data ? json({ submission: data }) : json({ error: 'NOT_FOUND' }, 404);
    }
    if (!MUTATIONS.has(body.action)) return json({ error: 'INVALID_ACTION' }, 400);
    if (body.action === 'edit') {
      const checked = validateSubmission(body.payload);
      if (!checked.ok) return json({ error: 'VALIDATION_FAILED', errors: checked.kind === 'invalid' ? checked.errors : [] }, 422);
      const { data, error } = await deps.rpc('workshop_admin_edit_internal', {
        p_actor: caller.userId, p_submission_id: id, p_payload: checked.value,
      });
      return error ? dbFailure(error, deps) : json({ submission: data });
    }
    if (body.action === 'approve_publish' || body.action === 'publish') {
      const { data, error } = await deps.rpc('publish_workshop_submission_internal', {
        p_actor: caller.userId, p_submission_id: id
      });
      return error ? dbFailure(error, deps) : json(data);
    }
    const notes = body.admin_notes;
    const feedback = body.review_feedback;
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)
      || feedback !== undefined && (typeof feedback !== 'string' || feedback.length > 5000)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }
    if (body.action === 'save_notes' && typeof notes !== 'string') return json({ error: 'NOTES_REQUIRED' }, 422);
    if (body.action === 'request_changes' && (typeof feedback !== 'string' || !feedback.trim())) {
      return json({ error: 'FEEDBACK_REQUIRED' }, 422);
    }
    const { data, error } = await deps.rpc('workshop_review_transition_internal', {
      p_actor: caller.userId, p_submission_id: id, p_action: body.action,
      p_admin_notes: notes ?? null, p_review_feedback: feedback ?? null,
    });
    return error ? dbFailure(error, deps) : json({ submission: data });
  } catch (cause) {
    deps.log?.('unhandled', cause instanceof Error ? cause.name : typeof cause);
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
}
