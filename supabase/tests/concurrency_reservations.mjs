// Concurrency test for the reservation engine: N real clients call the reservation RPCs at the same instant.
// Uses only the public anon key; each DEMO client signs in with email + password.
// 1) run concurrency_fixture_setup.sql  2) node supabase/tests/concurrency_reservations.mjs  3) run concurrency_fixture_cleanup.sql
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.CONCURRENCY_TEST_SUPABASE_URL;
const ANON = process.env.CONCURRENCY_TEST_SUPABASE_ANON_KEY;
const PASSWORD = process.env.CONCURRENCY_TEST_PASSWORD;
const N = 30;

if (!URL_ || !ANON || !PASSWORD || !['localhost', '127.0.0.1'].includes(new URL(URL_).hostname)) {
  throw new Error('Configura CONCURRENCY_TEST_SUPABASE_URL (localhost), CONCURRENCY_TEST_SUPABASE_ANON_KEY y CONCURRENCY_TEST_PASSWORD. No se permite apuntar a producción.');
}

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function login(email) {
  const identify = await fetch(`${URL_}/functions/v1/student-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ action: 'identify', email }),
  });
  const state = await identify.json().catch(() => ({}));
  if (!identify.ok || !['password_setup', 'password_login'].includes(state.state)) {
    throw new Error(`identify ${email}: ${identify.status} ${state.error ?? state.state ?? ''}`);
  }
  if (state.state === 'password_setup') {
    const setup = await fetch(`${URL_}/functions/v1/student-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
      body: JSON.stringify({ action: 'setup_password', email, password: PASSWORD }),
    });
    const body = await setup.json().catch(() => ({}));
    if (!setup.ok || !body.ok) throw new Error(`setup ${email}: ${setup.status} ${body.error ?? ''}`);
  }
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`password login ${email}: ${error.message}`);
  return client;
}

async function board(client) {
  const { data, error } = await client.rpc('my_reservation_board');
  if (error) throw error;
  return data;
}

const errCode = (e) => (e ? e.message : 'OK');

// Fires all calls after every promise has been created, so requests leave together.
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
  const emails = Array.from({ length: N }, (_, i) => `cc.${String(i + 1).padStart(2, '0')}@test.invalid`);
  const clients = [];
  for (let i = 0; i < emails.length; i += 5) {
    clients.push(...(await Promise.all(emails.slice(i, i + 5).map(login))));
  }
  const maxClient = await login('cc.max@test.invalid');
  console.log(`Sesiones iniciadas: ${clients.length + 1}`);

  const b0 = await board(clients[0]);
  const byTitle = Object.fromEntries(b0.sessions.filter((s) => s.title.startsWith('CC ')).map((s) => [s.title.slice(3), s]));
  for (const k of ['LAST', 'K5', 'SRC', 'TGT', 'M1']) if (!byTitle[k]) throw new Error(`missing session CC ${k}`);
  check('ventana abierta para la prueba', b0.window === 'open', b0.window);

  await Promise.all(clients.map(board));

  // 1. N clients, one place left
  const r1 = await race(clients.map((c) => () => c.rpc('reserve_session', { p_session: byTitle.LAST.id })));
  const t1 = tally(r1);
  check(`${N} clientes por el último lugar: exactamente 1 gana`, t1.OK === 1, JSON.stringify(t1));
  check('los perdedores reciben SESSION_FULL', (t1.SESSION_FULL ?? 0) === N - 1, JSON.stringify(t1));

  // 2. N clients, K = 5 places
  const r2 = await race(clients.map((c) => () => c.rpc('reserve_session', { p_session: byTitle.K5.id })));
  const t2 = tally(r2);
  check(`${N} clientes por 5 lugares: exactamente 5 ganan`, t2.OK === 5, JSON.stringify(t2));

  // 3. Concurrent change into a single free place; losers must keep their previous reservation
  const held = [];
  for (const c of clients) {
    const { data, error } = await c.rpc('reserve_session', { p_session: byTitle.SRC.id });
    if (error) throw new Error(`setup SRC: ${error.message}`);
    held.push(data.reservation_id);
  }
  const r3 = await race(clients.map((c, i) => () => c.rpc('change_reservation', { p_reservation: held[i], p_session: byTitle.TGT.id })));
  const t3 = tally(r3);
  check(`${N} cambios simultáneos hacia 1 lugar: exactamente 1 gana`, t3.OK === 1, JSON.stringify(t3));
  const boards = await Promise.all(clients.map(board));
  const keptOld = boards.filter((b, i) => r3[i] !== 'OK' && b.reservations.some((r) => r.id === held[i] && r.status === 'vigente')).length;
  check('cada perdedor conserva su reservación anterior intacta', keptOld === N - 1, `${keptOld}/${N - 1}`);
  const winner = boards.find((_, i) => r3[i] === 'OK');
  check('el ganador ya no tiene la anterior y sí la nueva',
    !!winner && !winner.reservations.some((r) => r.session_id === byTitle.SRC.id) && winner.reservations.some((r) => r.session_id === byTitle.TGT.id));

  // 4. One participant, many simultaneous taps on different sessions: the maximum still holds
  const mIds = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'].map((k) => byTitle[k].id);
  const r4 = await race(mIds.map((id) => () => maxClient.rpc('reserve_session', { p_session: id })));
  const t4 = tally(r4);
  check('un aspirante con 8 toques simultáneos no supera el máximo (4)', t4.OK === b0.max_reservations, JSON.stringify(t4));

  // 5. Same participant double-tapping the same session
  const r5 = await race(Array.from({ length: 10 }, () => () => clients[0].rpc('reserve_session', { p_session: byTitle.M8.id })));
  const t5 = tally(r5);
  check('10 toques simultáneos a la misma sesión: 1 sola reservación', t5.OK === 1, JSON.stringify(t5));

  // Final counts as every phone sees them
  const fin = await board(clients[1]);
  const seen = Object.fromEntries(fin.sessions.filter((s) => s.title.startsWith('CC ')).map((s) => [s.title.slice(3), s]));
  for (const k of ['LAST', 'K5', 'TGT', 'SRC']) {
    const s = seen[k];
    check(`conteo final ${k}: ${s.reserved}/${s.capacity}`, s.reserved <= s.capacity);
  }
  check('SRC refleja los que se quedaron', seen.SRC.reserved === N - 1, `${seen.SRC.reserved}`);

  console.log(failures === 0 ? '\nRESULTADO: todo correcto' : `\nRESULTADO: ${failures} fallas`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(2);
});
