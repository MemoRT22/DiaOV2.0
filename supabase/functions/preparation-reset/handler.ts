export type AuthResult = { kind: 'ok'; userId: string; editionId: string; mode: string } | { kind: 'unauthorized' | 'forbidden' };
export type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export type CleanupJob = { auth_user_id: string };
export type Deps = {
  authorize: (token: string) => Promise<AuthResult>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  pending: (editionId: string) => Promise<CleanupJob[]>;
  deleteUser: (id: string) => Promise<{ ok: boolean; code?: string }>;
  log: (event: string, code?: string) => void;
};

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const errorCode = (error: { code?: string; message: string }) => {
  const known = ['NOT_AUTHORIZED', 'NO_ACTIVE_EDITION', 'RESET_DISABLED', 'WRONG_PHRASE'];
  return known.find((code) => error.message.includes(code)) ?? 'SERVER_ERROR';
};

async function cleanup(deps: Deps, actor: string, edition: string) {
  let deleted = 0;
  let failed = 0;
  const jobs = await deps.pending(edition);
  // Bounded work keeps an invocation within the Edge Function timeout. A later retry drains the queue.
  for (const job of jobs) {
    let outcome: { ok: boolean; code?: string };
    try { outcome = await deps.deleteUser(job.auth_user_id); }
    catch { outcome = { ok: false, code: 'AUTH_UNAVAILABLE' }; }
    const result = await deps.rpc('preparation_auth_cleanup_result_internal', {
      p_actor: actor, p_auth_user_id: job.auth_user_id, p_success: outcome.ok,
      p_error_code: outcome.ok ? null : outcome.code ?? 'AUTH_ERROR',
    });
    if (result.error) {
      deps.log('cleanup_record_failed', result.error.code);
      failed++;
      continue;
    }
    if (outcome.ok) deleted++;
    else failed++;
  }
  const preview = await deps.rpc('preparation_reset_preview_internal', { p_actor: actor });
  if (preview.error) throw new Error(errorCode(preview.error));
  const pending = (preview.data as { auth_cleanup_pending?: number })?.auth_cleanup_pending ?? 0;
  return { deleted, failed, pending };
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'NOT_AUTHORIZED' }, 401);
  try {
    const caller = await deps.authorize(token);
    if (caller.kind !== 'ok') return json({ error: 'NOT_AUTHORIZED' }, caller.kind === 'forbidden' ? 403 : 401);
    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (!['preview', 'reset', 'retry_auth_cleanup'].includes(action)) return json({ error: 'INVALID_ACTION' }, 400);

    if (action === 'preview') {
      const result = await deps.rpc('preparation_reset_preview_internal', { p_actor: caller.userId });
      if (result.error) {
        const code = errorCode(result.error);
        return json({ error: code }, code === 'SERVER_ERROR' ? 500 : 400);
      }
      return json(result.data);
    }
    if (caller.mode !== 'preparacion') return json({ error: 'RESET_DISABLED' }, 409);
    if (action === 'retry_auth_cleanup') return json({ auth_cleanup: await cleanup(deps, caller.userId, caller.editionId) });
    if (body.phrase !== 'REINICIAR PREPARACIÓN') return json({ error: 'WRONG_PHRASE' }, 400);
    const result = await deps.rpc('reset_preparation_internal', { p_actor: caller.userId, p_phrase: body.phrase });
    if (result.error) {
      const code = errorCode(result.error);
      return json({ error: code }, code === 'RESET_DISABLED' ? 409 : code === 'SERVER_ERROR' ? 500 : 400);
    }
    try {
      return json({ reset: result.data, auth_cleanup: await cleanup(deps, caller.userId, caller.editionId) });
    } catch {
      // The SQL transaction already committed; never imply to the caller that the reset failed.
      deps.log('cleanup_unavailable');
      return json({ reset: result.data, auth_cleanup: { deleted: 0, failed: 0, pending: null } });
    }
  } catch {
    deps.log('request_failed');
    return json({ error: 'SERVER_ERROR' }, 500);
  }
}
