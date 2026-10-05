// Concurrency test for the raffle draw engine.
// 1) N simultaneous draws on the same prize — only 1 wins, rest get PENDING_SELECTION.
// 2) Two different prizes, same pool, concurrent — cannot select the same participant.
// 3) After confirm, the winner is excluded from all future pools.
// 4) Idempotency: same key returns the same result.
// 5) Inactive prize cannot be drawn.
// 6) Quantity cannot be lowered below committed inventory.
// 7) Demo/real isolation: sorteo cannot operate cross-environment.
// 8) Helpers revoked from authenticated.
// 9) No-show chain: A no-show -> B selected -> B no-show -> A eligible again.
// Cleanup: self-contained, cleans up after itself.
//
// Run: node supabase/tests/concurrency_sorteo.mjs

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
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

// supabase.rpc() resolves with { data, error } — it does NOT reject on error.
// We must inspect response.error to detect failures.
function errCode(response) {
  if (response.error) return response.error.message;
  return 'OK';
}

async function race(calls) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const pending = calls.map((fn) => gate.then(fn));
  release();
  return Promise.all(pending);
}

function tallyErrors(responses) {
  return responses.reduce((acc, resp) => {
    const code = errCode(resp);
    return { ...acc, [code]: (acc[code] ?? 0) + 1 };
  }, {});
}

async function main() {
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: ed } = await admin.from('editions').select('id, event_date, mode').eq('is_active', true).single();
  if (!ed) throw new Error('No active edition');

  const { data: div } = await admin.from('divisions').select('id').eq('is_demo', true).limit(1).single();
  if (!div) throw new Error('No demo division');

  // Create 5 academic activities
  const actIds = [];
  for (let i = 1; i <= 5; i++) {
    const { data: act } = await admin.from('activities')
      .upsert({ edition_id: ed.id, division_id: div.id, title: `CS Acad ${i}`, is_demo: true, activity_type: 'academica', description: '', location: '' })
      .select('id').single();
    actIds.push(act.id);
  }

  const sessionIds = [];
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
  const pIds = [];
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

  // Create test prizes
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
  check(`${N} sorteos simultaneos mismo premio: exactamente 1 gana`, t1.OK === 1, JSON.stringify(t1));
  check('los perdedores reciben PENDING_SELECTION', (t1.PENDING_SELECTION ?? 0) === N - 1, JSON.stringify(t1));

  // Verify only 1 winner record — query includes participant_id
  const { data: winners1 } = await admin.from('raffle_winners').select('id, participant_id, status').eq('prize_id', prize1.id);
  check('solo 1 registro de ganador', winners1?.length === 1, `${winners1?.length ?? 0}`);
  check('el ganador esta seleccionado', winners1?.[0]?.status === 'seleccionado', winners1?.[0]?.status);
  const winnerPid1 = winners1?.[0]?.participant_id ?? '';
  check('participant_id del ganador es valido', !!winnerPid1, winnerPid1);

  // --- Test 2: Idempotency — same key returns the same result ---
  const r2 = await sorteoClient.rpc('draw_winner', { p_prize_id: prize1.id, p_idempotency_key: keys1[0] });
  check('idempotencia: misma clave devuelve idempotent=true', r2.data?.idempotent === true, `${r2.data?.idempotent}`);
  check('idempotencia: mismo participant_id', r2.data?.participant_id === winnerPid1, `${r2.data?.participant_id} vs ${winnerPid1}`);

  // --- Test 3: Confirm winner1, then prize1 exhausted ---
  const confirmRes = await sorteoClient.rpc('confirm_winner', { p_winner_id: winners1[0].id });
  check('confirmar ganador 1', errCode(confirmRes) === 'OK', errCode(confirmRes));

  const drawRes3 = await sorteoClient.rpc('draw_winner', { p_prize_id: prize1.id, p_idempotency_key: `cs-exhaust-${Date.now()}` });
  check('premio 1 agotado tras confirmar', errCode(drawRes3) === 'PRIZE_EXHAUSTED', errCode(drawRes3));

  // --- Test 4: Two different prizes, concurrent draws — cannot select same participant ---
  const { data: prize3 } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize C', quantity: 1, is_active: true, sort_order: 97, is_demo: true })
    .select('id').single();

  const key2 = `cs-draw2-${Date.now()}`;
  const key3 = `cs-draw3-${Date.now()}`;
  const r5 = await race([
    () => sorteoClient.rpc('draw_winner', { p_prize_id: prize2.id, p_idempotency_key: key2 }),
    () => sorteoClient.rpc('draw_winner', { p_prize_id: prize3.id, p_idempotency_key: key3 }),
  ]);
  const ok5 = r5.filter((resp) => errCode(resp) === 'OK');
  check('dos premios distintos concurrentes: ambos pueden sortear', ok5.length === 2, JSON.stringify(tallyErrors(r5)));

  const { data: w2 } = await admin.from('raffle_winners').select('id, participant_id, status').eq('prize_id', prize2.id).eq('status', 'seleccionado').single();
  const { data: w3 } = await admin.from('raffle_winners').select('id, participant_id, status').eq('prize_id', prize3.id).eq('status', 'seleccionado').single();
  check('dos premios distintos no seleccionan la misma persona', w2?.participant_id !== w3?.participant_id, `${w2?.participant_id} vs ${w3?.participant_id}`);

  // --- Test 5: Confirm both (different people) ---
  if (w2 && w3 && w2.participant_id !== w3.participant_id) {
    const c2 = await sorteoClient.rpc('confirm_winner', { p_winner_id: w2.id });
    check('confirmar primer ganador del test 4', errCode(c2) === 'OK', errCode(c2));
    const c3 = await sorteoClient.rpc('confirm_winner', { p_winner_id: w3.id });
    check('confirmar segundo ganador del test 4 (distinta persona)', errCode(c3) === 'OK', errCode(c3));
  }

  // --- Test 6: Inactive prize cannot be drawn ---
  const { data: prizeInactive } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize Inactive', quantity: 1, is_active: false, sort_order: 96, is_demo: true })
    .select('id').single();
  const drawInactive = await sorteoClient.rpc('draw_winner', { p_prize_id: prizeInactive.id, p_idempotency_key: `cs-inactive-${Date.now()}` });
  check('premio inactivo no se puede sortear', errCode(drawInactive) === 'PRIZE_INACTIVE', errCode(drawInactive));

  // --- Test 7: Quantity cannot be lowered below committed ---
  const qtyRes = await sorteoClient.rpc('save_raffle_prize', { p: { id: prize2.id, category_id: cat.id, name: 'CS Prize B', quantity: 0, is_active: true, sort_order: 99 } });
  check('quantity no baja del comprometido', errCode(qtyRes) === 'QUANTITY_BELOW_COMMITTED', errCode(qtyRes));

  // --- Test 8: Helpers revoked from authenticated ---
  const ticketsRes = await sorteoClient.rpc('participant_tickets', { p_pid: pIds[0] });
  check('helper participant_tickets no ejecutable por authenticated', errCode(ticketsRes) !== 'OK', errCode(ticketsRes));

  const catPidRes = await sorteoClient.rpc('participant_raffle_category', { p_pid: pIds[0] });
  check('helper participant_raffle_category no ejecutable por authenticated', errCode(catPidRes) !== 'OK', errCode(catPidRes));

  const hasWonRes = await sorteoClient.rpc('participant_has_won', { p_pid: pIds[0] });
  check('helper participant_has_won no ejecutable por authenticated', errCode(hasWonRes) !== 'OK', errCode(hasWonRes));

  const pendingRes = await sorteoClient.rpc('get_pending_winner', { p_prize_id: prize1.id });
  check('helper get_pending_winner no ejecutable por authenticated', errCode(pendingRes) !== 'OK', errCode(pendingRes));

  // --- Test 9: No-show chain: A no-show -> B selected -> B no-show -> A eligible again ---
  // Create a new prize with quantity=1 and two participants in pool
  const { data: prizeChain } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize Chain', quantity: 1, is_active: true, sort_order: 95, is_demo: true })
    .select('id').single();

  // Draw — gets participant A
  const drawA = await sorteoClient.rpc('draw_winner', { p_prize_id: prizeChain.id, p_idempotency_key: `cs-chain-a-${Date.now()}` });
  check('cadena: sorteo inicial', errCode(drawA) === 'OK', errCode(drawA));
  const pidA = drawA.data?.participant_id;
  const widA = drawA.data?.winner_id;

  // No-show A
  const noShowA = await sorteoClient.rpc('mark_no_show', { p_winner_id: widA });
  check('cadena: A no presentado', errCode(noShowA) === 'OK', errCode(noShowA));

  // Draw again — gets participant B (A excluded from this round)
  const drawB = await sorteoClient.rpc('draw_winner', { p_prize_id: prizeChain.id, p_idempotency_key: `cs-chain-b-${Date.now()}` });
  check('cadena: segundo sorteo', errCode(drawB) === 'OK', errCode(drawB));
  const pidB = drawB.data?.participant_id;
  const widB = drawB.data?.winner_id;
  check('cadena: B es distinto de A', pidB !== pidA, `${pidB} vs ${pidA}`);

  // No-show B
  const noShowB = await sorteoClient.rpc('mark_no_show', { p_winner_id: widB });
  check('cadena: B no presentado', errCode(noShowB) === 'OK', errCode(noShowB));

  // Draw again — A should be eligible again (only B excluded from this round)
  const drawC = await sorteoClient.rpc('draw_winner', { p_prize_id: prizeChain.id, p_idempotency_key: `cs-chain-c-${Date.now()}` });
  check('cadena: tercer sorteo exitoso', errCode(drawC) === 'OK', errCode(drawC));

  // Verify A is back in the pool (check via pool_count as coordinacion)
  // We need to check if A is eligible. Use service role to check participant_raffle_category.
  const { data: catA } = await admin.rpc('participant_raffle_category', { p_pid: pidA });
  check('cadena: A vuelve a ser elegible (categoria no null)', catA !== null, `${catA}`);

  // --- Test 10: Demo/real isolation ---
  // Get a real prize and try to draw it as sorteo (in demo mode)
  const { data: realCat } = await admin.from('raffle_categories')
    .select('id').eq('edition_id', ed.id).eq('name', 'Baja').eq('is_demo', false).single();
  if (realCat) {
    const { data: realPrize } = await admin.from('raffle_prizes')
      .upsert({ edition_id: ed.id, category_id: realCat.id, name: 'CS Real Prize', quantity: 1, is_active: true, sort_order: 94, is_demo: false })
      .select('id').single();

    // If edition is in preparacion mode, sorteo should be able to draw demo but not real
    if (ed.mode === 'preparacion') {
      const drawReal = await sorteoClient.rpc('draw_winner', { p_prize_id: realPrize.id, p_idempotency_key: `cs-real-${Date.now()}` });
      check('aislamiento: sorteo en demo no sortea premio real', errCode(drawReal) === 'NOT_AUTHORIZED', errCode(drawReal));
    }

    // Cleanup real prize
    await admin.from('raffle_prizes').delete().eq('id', realPrize.id);
  }

  // --- Test 11: Pending selection recovery ---
  // Draw a new prize, then query pending selection
  const { data: prizePending } = await admin.from('raffle_prizes')
    .upsert({ edition_id: ed.id, category_id: cat.id, name: 'CS Prize Pending', quantity: 1, is_active: true, sort_order: 93, is_demo: true })
    .select('id').single();
  const drawPending = await sorteoClient.rpc('draw_winner', { p_prize_id: prizePending.id, p_idempotency_key: `cs-pending-${Date.now()}` });
  check('pending: sorteo inicial', errCode(drawPending) === 'OK', errCode(drawPending));

  const pendingSel = await sorteoClient.rpc('raffle_pending_selection', { p_prize_id: prizePending.id });
  check('pending: recuperacion tras refresh', pendingSel.data?.winner_id !== null && pendingSel.data?.display_name !== undefined, JSON.stringify(pendingSel.data));

  // --- Cleanup ---
  const allPrizeIds = [prize1.id, prize2.id, prize3.id, prizeInactive.id, prizeChain.id, prizePending.id];
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
