import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleRequest } from './handler.ts';

const UID = '33333333-3333-4333-8333-333333333333';
const request = (action: string) => new Request('https://example.test/staff-accounts', { method: 'POST', headers: { authorization: 'Bearer fixture' },
  body: JSON.stringify({ action, email: 'fixture@example.test', full_name: 'Fixture Staff', roles: ['staff'], password: 'Fixture-only-123', user_id: UID }) });
function fixture(memberStatus = 201, auditStatus = 201, authStatus?: number) {
  const calls: string[] = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: authStatus ? { status: authStatus } : null }),
      admin: { createUser: async () => { calls.push('create'); return { data: { user: { id: UID } }, error: null }; },
        deleteUser: async () => { calls.push('delete'); return { error: null }; },
        updateUserById: async () => { calls.push('password'); return { error: null }; } } },
    rpc: async () => ({ data: 'edition', error: null }),
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { user_id: UID, is_active: true, staff_roles: [{ role: 'coordinacion' }] }, error: null }),
        insert: async () => { calls.push(`insert:${table}`); const status = table === 'audit_log' ? auditStatus : table === 'staff_members' ? memberStatus : 201;
          return { data: null, error: status >= 400 ? { message: 'upstream error', code: 'P0001' } : null, status }; } };
      return q;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}
test('staff create success keeps the account and audit; temporary member INSERT never deletes it', async () => {
  const good = fixture();
  assert.equal((await handleRequest(request('create'), good.admin)).status, 200);
  assert.ok(good.calls.includes('insert:audit_log'));
  for (const status of [429, 503, 504]) {
    const f = fixture(status);
    const res = await handleRequest(request('create'), f.admin);
    assert.equal(res.status, status === 429 ? 429 : 503);
    assert.ok(!f.calls.includes('delete'));
    assert.ok(!f.calls.includes('insert:staff_roles'));
  }
});
test('Auth temporary errors are not authorization failures; failed audit never reports success', async () => {
  const down = fixture(201, 201, 429);
  assert.equal((await handleRequest(request('create'), down.admin)).status, 429);
  assert.deepEqual(down.calls, []);
  const audit = fixture(201, 503);
  assert.equal((await handleRequest(request('reset_password'), audit.admin)).status, 503);
  assert.ok(audit.calls.includes('password'));
});
