// Concurrency test for the raffle draw engine.
// 1) N simultaneous draws on the same prize — only 1 wins, rest get PENDING_SELECTION.
// 2) Two different prizes, same pool, concurrent — cannot select the same participant.
// 3) After confirm, the winner is excluded from all future pools.
// 4) Idempotency: same key returns the same result.
// Cleanup: run node supabase/tests/concurrency_sorteo.mjs (self-contained, cleans up after itself).

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
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

const errCode = (e: { message: string } | null) => (e ? e.message : 'OK');

async function race<T>(calls: (() => Promise<T>)[]): Promise<{ result: T; error: { message: string } | null }[]> {
  let release: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const pending = calls.map((fn) => gate.then(fn));
  release!();
  return Promise.all(pending.map(async (p) => { try { return { result: await p, error: null }; } catch (e: any) { return { result: null as T, error: e }; } }));
}

function tallyErrors(results: { error: { message: string } | null }[]) {
  return results.reduce((acc, r) => { const code = errCode(r.error); return { ...acc, [code]: (acc[code] ?? 0) + 1 }; }, {} as Record<string, number>);
}

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: ed } = await admin.from('editions').select('id, event_date').eq('is_active', true).single();
  if (!ed) throw new Error('No active edition');

  const { data: div } = await admin.from('divisions').select('id').eq('is_demo', true).limit(1).single();
  if (!div) throw new Error('No demo division');

  // Create 5 academic activities
  const actIds: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const { data: act } = await admin.from('activities')
      .upsert({ edition_id: ed.id, division_id: div.id, title: `CS Acad ${i}`, is_demo: true, activity_type: 'academica', description: '', location: '' })
      .select('id').single();
    actIds.push(act.id);
  }

  const sessionIds: string[] = [];
  for (let i = 0; i < actIds.length; i++) {
    const start = `${ed.event_date}T${10 + i}:00:00-05:00`;
    const end = `${ed.event_date}T${10 + i}:45:00-05:00`;
    const { data: ses } = await admin.from('activity_sessions')
      .upsert({ activity_id: actIds[i], starts_at: start, ends_at: end, capacity: 100, is_demo: true, status: 'activa', credits: 1 })
      .select('id').single();
    sessionIds.push(ses.id);
  }

  // Create 20 demo participants with 3 academic attendances each
  const emails = Array.from({ length: 20 }, (_, i) => `cs.${String(i + 1).padStart(2, '0')}@test.invalid`);
  const pIds: string[] = [];
  for (const email of emails) {
    const { data: p } = await admin.from('participants')
      .upsert({ edition_id: ed.id, email, full_name: `CS ${email}`, birth_date: '2008-01-01', origin: 'manual', is_demo: true })
      .select('id').single();
    pIds.push(p.id);
    await admin.from('participant_profiles').upsert({ participant_id: p.id, display_name: `CS ${email}` });
    for (let j = 0; j < 3; j++) {
      await admin.from('attendances').upsert({ participant_id: p.id, session_id: sessionIds[j], activity_id: actIds[j], credits_granted: 1, method: 'qr' });
    }
  }

  const { data: cat } = await admin.from('raffle_categories')
    .select('id').eq('edition_id', ed.id).eq('name', 'Baja').eq('is_demo', true).single();
  if (!cat) throw new Error('No demo Baja category');

  // Create two test prizes with quantity=1 each
  const { data: prize1 } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize A', quantity: 1, is_active: true, sort_order: 98, is_demo: true })
    .select('id').single();
  const { data: prize2 } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize B', quantity: 1, is_active: true, sort_order: 99, is_demo: true })
    .select('id').single();

  console.log(`Setup: ${pIds.length} participantes, 2 premios (A=${prize1.id}, B=${prize2.id})`);

  // Create a temp sorteo operator account
  const tempEmail = 'cs.sorteo@test.invalid';
  const tempPass = 'test-password-123';
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({ email: tempEmail, password: tempPass, email_confirm: true });
  if (authErr) throw new Error(`Failed to create temp user: ${authErr.message}`);
  const tempUid = authData.user.id;

  await admin.from('staff_members').upsert({ user_id: tempUid, role: 'sorteo', full_name: 'CS Sorteo', is_active: true, email: tempEmail, is_demo: true });
  await admin.from('staff_roles').upsert({ user_id: tempUid, role: 'sorteo' });

  const sorteoClient = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInErr } = await sorteoClient.auth.signInWithPassword({ email: tempEmail, password: tempPass });
  if (signInErr) throw new Error(`Failed to sign in as sorteo: ${signInErr.message}`);

  // --- Test 1: N simultaneous draws on the same prize (quantity=1) ---
  const N = 10;
  const keys1 = Array.from({ length: N }, (_, i) => `cs-draw1-${i}-${Date.now()}`);
  const r1 = await race(keys1.map((key) => () => sorteoClient.rpc('draw_winner', { p_prize_id: prize1.id, p_idempotency_key: key })));
  const t1 = tallyErrors(r1);
  check(`${N} sorteos simultáneos mismo premio: exactamente 1 gana`, t1.OK === 1, JSON.stringify(t1));
  check('los perdedores reciben PENDING_SELECTION', (t1.PENDING_SELECTION ?? 0) === N - 1, JSON.stringify(t1));

  // Verify only 1 winner record — query includes participant_id
  const { data: winners1 } = await admin.from('raffle_winners').select('id, participant_id, status').eq('prize_id', prize1.id);
  check('solo 1 registro de ganador', winners1?.length === 1, `${winners1?.length ?? 0}`);
  check('el ganador está seleccionado', winners1?.[0]?.status === 'seleccionado', winners1?.[0]?.status);
  const winnerPid1 = winners1?.[0]?.participant_id ?? '';
  check('participant_id del ganador es válido', !!winnerPid1, winnerPid1);

  // --- Test 2: Idempotency — same key returns the same result ---
  const { data: r2, error: e2 } = await sorteoClient.rpc('draw_winner', { p_prize_id: prize1.id, p_idempotency_key: keys1[0] });
  check('idempotencia: misma clave devuelve idempotent=true', r2?.idempotent === true, `${r2?.idempotent}`);
  check('idempotencia: mismo participant_id', r2?.participant_id === winnerPid1, `${r2?.participant_id} vs ${winnerPid1}`);

  // --- Test 3: Confirm winner1, then prize1 exhausted ---
  const { error: confirmErr } = await sorteoClient.rpc('confirm_winner', { p_winner_id: winners1[0].id });
  check('confirmar ganador 1', errCode(confirmErr) === 'OK', errCode(confirmErr));

  const { error: drawErr3 } = await sorteoClient.rpc('draw_winner', { p_prize_id: prize1.id, p_idempotency_key: `cs-exhaust-${Date.now()}` });
  check('premio 1 agotado tras confirmar', errCode(drawErr3) === 'PRIZE_EXHAUSTED', errCode(drawErr3));

  // --- Test 4: Confirmed winner excluded from all future pools ---
  const { data: catCheck, error: catErr } = await admin.rpc('participant_raffle_category', { p_pid: winnerPid1 });
  check('ganador confirmado excluido de todos los pools', catCheck === null, `${catCheck} ${catErr?.message ?? ''}`);

  // --- Test 5: Two different prizes, concurrent draws — cannot select the same participant ---
  // First, no_show the winner1 so they're not blocking. Then draw both prizes concurrently.
  // Actually, winner1 is confirmed, so they're excluded from the pool.
  // Draw prize2 and a new prize3 concurrently.
  const { data: prize3 } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize C', quantity: 1, is_active: true, sort_order: 97, is_demo: true })
    .select('id').single();

  const key2 = `cs-draw2-${Date.now()}`;
  const key3 = `cs-draw3-${Date.now()}`;
  const r5 = await race([
    () => sorteoClient.rpc('draw_winner', { p_prize_id: prize2.id, p_idempotency_key: key2 }),
    () => sorteoClient.rpc('draw_winner', { p_prize_id: prize3.id, p_idempotency_key: key3 }),
  ]);

  const ok5 = r5.filter((r) => errCode(r.error) === 'OK');
  check('dos premios distintos concurrentes: ambos pueden sortear', ok5.length === 2, JSON.stringify(tallyErrors(r5)));

  const { data: w2 } = await admin.from('raffle_winners').select('id, participant_id, status').eq('prize_id', prize2.id).eq('status', 'seleccionado').single();
  const { data: w3 } = await admin.from('raffle_winners').select('id, participant_id, status').eq('prize_id', prize3.id).eq('status', 'seleccionado').single();
  check('dos premios distintos no seleccionan la misma persona', w2?.participant_id !== w3?.participant_id, `${w2?.participant_id} vs ${w3?.participant_id}`);

  // --- Test 6: Confirm one, the other must not be confirmable if it's the same person ---
  // (If they're different people, both can be confirmed. The DB constraint prevents two confirmados.)
  if (w2 && w3 && w2.participant_id !== w3.participant_id) {
    const { error: c2err } = await sorteoClient.rpc('confirm_winner', { p_winner_id: w2.id });
    check('confirmar primer ganador del test 5', errCode(c2err) === 'OK', errCode(c2err));
    const { error: c3err } = await sorteoClient.rpc('confirm_winner', { p_winner_id: w3.id });
    check('confirmar segundo ganador del test 5 (distinta persona)', errCode(c3err) === 'OK', errCode(c3err));
  }

  // --- Test 7: Inactive prize cannot be drawn ---
  const { data: prizeInactive } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize Inactive', quantity: 1, is_active: false, sort_order: 96, is_demo: true })
    .select('id').single();
  const { error: drawInactive } = await sorteoClient.rpc('draw_winner', { p_prize_id: prizeInactive.id, p_idempotency_key: `cs-inactive-${Date.now()}` });
  check('premio inactivo no se puede sortear', errCode(drawInactive) === 'PRIZE_INACTIVE', errCode(drawInactive));

  // --- Test 8: quantity cannot be lowered below committed ---
  // prize2 has 1 seleccionado (or confirmado). Try lowering to 0.
  const { error: qtyErr } = await sorteoClient.rpc('save_raffle_prize', { p: { id: prize2.id, category_id: cat.id, name: 'CS Prize B', quantity: 0, is_active: true, sort_order: 99 } });
  check('quantity no baja del comprometido', errCode(qtyErr) === 'QUANTITY_BELOW_COMMITTED', errCode(qtyErr));

  // --- Test 9: Demo/real isolation on prize category move ---
  const { data: realCat } = await admin.from('raffle_categories')
    .select('id').eq('edition_id', ed.id).eq('name', 'Baja').eq('is_demo', false).single();
  if (realCat) {
    const { error: moveErr } = await sorteoClient.rpc('save_raffle_prize', { p: { id: prize2.id, category_id: realCat.id, name: 'CS Prize B', quantity: 1, is_active: true, sort_order: 99 } });
    check('premio demo no se mueve a categoria real', errCode(moveErr) === 'DEMO_REAL_MISMATCH', errCode(moveErr));
  }

  // --- Test 10: Student cannot call internal helpers ---
  // participant_tickets, participant_raffle_category, participant_has_won, get_pending_winner
  // These are revoked from authenticated. A student session should get an error.
  // We'll test with the sorteo client — these functions are revoked from authenticated entirely.
  const { error: ticketsErr } = await sorteoClient.rpc('participant_tickets', { p_pid: pIds[0] });
  check('helper participant_tickets no ejecutable por authenticated', errCode(ticketsErr) !== 'OK', errCode(ticketsErr));

  const { error: catPidErr } = await sorteoClient.rpc('participant_raffle_category', { p_pid: pIds[0] });
  check('helper participant_raffle_category no ejecutable por authenticated', errCode(catPidErr) !== 'OK', errCode(catPidErr));

  const { error: hasWonErr } = await sorteoClient.rpc('participant_has_won', { p_pid: pIds[0] });
  check('helper participant_has_won no ejecutable por authenticated', errCode(hasWonErr) !== 'OK', errCode(hasWonErr));

  const { error: pendingErr } = await sorteoClient.rpc('get_pending_winner', { p_prize_id: prize1.id });
  check('helper get_pending_winner no ejecutable por authenticated', errCode(pendingErr) !== 'OK', errCode(pendingErr));

  // --- Cleanup ---
  const allPrizeIds = [prize1.id, prize2.id, prize3.id, prizeInactive.id];
  await admin.from('raffle_winners').delete().in('prize_id', allPrizeIds);
  await admin.from('raffle_prizes').delete().in('id', allPrizeIds);
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
