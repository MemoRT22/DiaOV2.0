// Concurrency test for the raffle draw engine: N simultaneous draws on the same prize.
// Uses the service role key to simulate N sorteo operators drawing at the same instant.
// The draw_winner RPC uses FOR UPDATE row-level locking on the prize, so only one draw
// can proceed at a time; the others must get PENDING_SELECTION.
// 1) node supabase/tests/concurrency_sorteo.mjs  (uses the live database; cleans up after itself)

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

const errCode = (e) => (e ? e.message : 'OK');

async function race(calls) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const pending = calls.map((fn) => gate.then(fn));
  release();
  return Promise.all(pending.map((p) => p.then((r) => errCode(r.error))));
}

function tally(results) {
  return results.reduce((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
}

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  // Get the active edition
  const { data: ed } = await admin.from('editions').select('id, event_date, timezone').eq('is_active', true).single();
  if (!ed) throw new Error('No active edition');

  // Get a demo division
  const { data: div } = await admin.from('divisions').select('id').eq('is_demo', true).limit(1).single();
  if (!div) throw new Error('No demo division');

  // Create 10 demo academic activities (so participants can get 3+ tickets for Baja)
  const actIds = [];
  for (let i = 1; i <= 5; i++) {
    const { data: act } = await admin.from('activities')
      .upsert({ edition_id: ed.id, division_id: div.id, title: `CS Acad ${i}`, is_demo: true, activity_type: 'academica', description: '', location: '' })
      .select('id').single();
    actIds.push(act.id);
  }

  // Create sessions for each activity
  const sessionIds = [];
  for (let i = 0; i < actIds.length; i++) {
    const start = `${ed.event_date}T${10 + i}:00:00-05:00`;
    const end = `${ed.event_date}T${10 + i}:45:00-05:00`;
    const { data: ses } = await admin.from('activity_sessions')
      .upsert({ activity_id: actIds[i], starts_at: start, ends_at: end, capacity: 100, is_demo: true, status: 'activa', credits: 1 })
      .select('id').single();
    sessionIds.push(ses.id);
  }

  // Create 20 demo participants with 3 academic attendances each (so they qualify for Baja)
  const emails = Array.from({ length: 20 }, (_, i) => `cs.${String(i + 1).padStart(2, '0')}@test.invalid`);
  const pIds = [];
  for (const email of emails) {
    const { data: p } = await admin.from('participants')
      .upsert({ edition_id: ed.id, email, full_name: `CS ${email}`, birth_date: '2008-01-01', origin: 'manual', is_demo: true })
      .select('id').single();
    pIds.push(p.id);
    // Insert profile
    await admin.from('participant_profiles').upsert({ participant_id: p.id, display_name: `CS ${email}` });
    // Insert 3 attendances
    for (let j = 0; j < 3; j++) {
      await admin.from('attendances').upsert({ participant_id: p.id, session_id: sessionIds[j], activity_id: actIds[j], credits_granted: 1, method: 'qr' });
    }
  }

  // Get demo Baja category
  const { data: cat } = await admin.from('raffle_categories')
    .select('id').eq('edition_id', ed.id).eq('name', 'Baja').eq('is_demo', true).single();
  if (!cat) throw new Error('No demo Baja category');

  // Create a test prize with quantity=1
  const { data: prize } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Test Prize', quantity: 1, is_active: true, sort_order: 99, is_demo: true })
    .select('id').single();

  console.log(`Setup: ${pIds.length} participantes en pool Baja, premio quantity=1`);

  // Create N sorteo-operator auth sessions by using the service role client
  // Since we can't easily create sorteo staff accounts, we'll use the service role
  // to call draw_winner directly — the service role bypasses RLS.
  // But draw_winner checks has_staff_role('sorteo') which requires auth.uid().
  // Instead, we'll test concurrency by calling the RPC directly through REST.

  // Actually, let's use the anon key with a staff session.
  // For simplicity, we'll create a temp staff account with sorteo role.

  // Create a temp auth user with sorteo role
  const tempEmail = 'cs.sorteo@test.invalid';
  const tempPass = 'test-password-123';

  // Sign up
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: tempEmail, password: tempPass, email_confirm: true,
  });
  if (authErr) throw new Error(`Failed to create temp user: ${authErr.message}`);
  const tempUid = authData.user.id;

  // Add as staff with sorteo role
  await admin.from('staff_members').upsert({ user_id: tempUid, role: 'sorteo', full_name: 'CS Sorteo', is_active: true, email: tempEmail, is_demo: true });
  await admin.from('staff_roles').upsert({ user_id: tempUid, role: 'sorteo' });

  // Sign in with anon client
  const sorteoClient = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInErr } = await sorteoClient.auth.signInWithPassword({ email: tempEmail, password: tempPass });
  if (signInErr) throw new Error(`Failed to sign in as sorteo: ${signInErr.message}`);

  console.log('Sorteo operator session created');

  // Test 1: N simultaneous draws on the same prize (quantity=1)
  // Only one should succeed; the rest should get PENDING_SELECTION
  const N = 10;
  const keys = Array.from({ length: N }, (_, i) => `cs-draw-${i}-${Date.now()}`);
  const r1 = await race(keys.map((key) => () => sorteoClient.rpc('draw_winner', { p_prize_id: prize.id, p_idempotency_key: key })));
  const t1 = tally(r1);
  check(`${N} sorteos simultáneos: exactamente 1 gana`, t1.OK === 1, JSON.stringify(t1));
  check('los perdedores reciben PENDING_SELECTION', (t1.PENDING_SELECTION ?? 0) === N - 1, JSON.stringify(t1));

  // Verify only 1 winner record was created
  const { data: winners } = await admin.from('raffle_winners').select('id, status').eq('prize_id', prize.id);
  check('solo 1 registro de ganador', winners?.length === 1, `${winners?.length ?? 0}`);
  check('el ganador está seleccionado', winners?.[0]?.status === 'seleccionado', winners?.[0]?.status);

  // Test 2: Idempotency — same key returns the same result
  const { data: r2, error: e2 } = await sorteoClient.rpc('draw_winner', { p_prize_id: prize.id, p_idempotency_key: keys[0] });
  check('idempotencia: misma clave devuelve idempotent=true', r2?.idempotent === true, `${r2?.idempotent}`);

  // Test 3: Confirm the winner, then prize should be exhausted
  const { data: confirmRes, error: confirmErr } = await sorteoClient.rpc('confirm_winner', { p_winner_id: winners[0].id });
  check('confirmar ganador', errCode(confirmErr) === 'OK', errCode(confirmErr));

  // Now draw again — should get PRIZE_EXHAUSTED
  const { error: drawErr3 } = await sorteoClient.rpc('draw_winner', { p_prize_id: prize.id, p_idempotency_key: `cs-exhaust-${Date.now()}` });
  check('premio agotado tras confirmar', errCode(drawErr3) === 'PRIZE_EXHAUSTED', errCode(drawErr3));

  // Test 4: The confirmed winner is excluded from all future pools
  const winnerPid = winners[0].participant_id;
  const { data: catCheck } = await admin.rpc('participant_raffle_category', { p_pid: winnerPid });
  check('ganador confirmado excluido de todos los pools', catCheck === null, `${catCheck}`);

  // Cleanup
  await admin.from('raffle_winners').delete().eq('prize_id', prize.id);
  await admin.from('raffle_prizes').delete().eq('id', prize.id);
  await admin.from('attendances').delete().in('participant_id', pIds);
  await admin.from('participant_profiles').delete().in('participant_id', pIds);
  await admin.from('participants').delete().in('id', pIds);
  await admin.from('activity_sessions').delete().in('activity_id', actIds);
  await admin.from('activities').delete().in('id', actIds);
  await admin.from('staff_roles').delete().eq('user_id', tempUid);
  await admin.from('staff_members').delete().eq('user_id', tempUid);
  await admin.auth.admin.deleteUser(tempUid);

  console.log('Limpieza completada');
  console.log(failures === 0 ? '\nRESULTADO: todo correcto' : `\nRESULTADO: ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(2);
});
