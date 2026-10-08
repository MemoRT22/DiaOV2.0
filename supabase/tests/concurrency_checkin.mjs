// Concurrency test for check-in: 20 simultaneous requests from the same participant
// mixing QR token and manual code. Expected: 1 attendance, credits granted exactly once,
// all other responses idempotent, and the stored method = the request that won the race.
// 1) run concurrency_checkin_setup.sql
// 2) Get the activity credential token and code from the local DB:
//    select pgp_sym_decrypt(qr_token_encrypted, credential_encryption_key()) as token,
//           pgp_sym_decrypt(manual_code_encrypted, credential_encryption_key()) as code
//    from activity_credentials ac join activities a on a.id=ac.activity_id
//    where a.title='CC CHK' and a.is_demo;
// 3) CONCURRENCY_TEST_SUPABASE_URL=http://127.0.0.1:54321 CONCURRENCY_TEST_SUPABASE_ANON_KEY=...
//    CONCURRENCY_TEST_PASSWORD=... QR_TOKEN=... MANUAL_CODE=... node supabase/tests/concurrency_checkin.mjs
// 4) Verify in the DB (WINNER_METHOD printed by this script):
//    select count(*), min(method), sum(credits_granted) from attendances at
//    join participants p on p.id = at.participant_id where p.email = 'cc.check@test.invalid';
// 5) run concurrency_checkin_cleanup.sql
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.CONCURRENCY_TEST_SUPABASE_URL;
const ANON = process.env.CONCURRENCY_TEST_SUPABASE_ANON_KEY;
const PASSWORD = process.env.CONCURRENCY_TEST_PASSWORD;
const N = 20;
const QR_TOKEN = process.env.QR_TOKEN;
const MANUAL_CODE = process.env.MANUAL_CODE;

if (!URL_ || !ANON || !PASSWORD || !['localhost', '127.0.0.1'].includes(new URL(URL_).hostname)
  || !QR_TOKEN || !MANUAL_CODE) {
  console.error('Configura URL local, anon key, contraseña DEMO, QR_TOKEN y MANUAL_CODE; producción está bloqueada.');
  process.exit(1);
}

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function login() {
  const email = 'cc.check@test.invalid';
  const identify = await fetch(`${URL_}/functions/v1/student-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ action: 'identify', email }),
  });
  const state = await identify.json().catch(() => ({}));
  if (!identify.ok || !['password_setup', 'password_login'].includes(state.state)) {
    throw new Error(`identify: ${identify.status} ${state.error ?? state.state ?? ''}`);
  }
  if (state.state === 'password_setup') {
    const setup = await fetch(`${URL_}/functions/v1/student-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
      body: JSON.stringify({ action: 'setup_password', email, password: PASSWORD }),
    });
    const body = await setup.json().catch(() => ({}));
    if (!setup.ok || !body.ok) throw new Error(`setup: ${setup.status} ${body.error ?? ''}`);
  }
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function main() {
  const supabase = await login();

  console.log(`Lanzando ${N} requests simultaneos (mezcla QR y codigo)...`);

  const sent = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'qr' : 'codigo_manual'));
  const gate = new Promise((resolve) => setTimeout(resolve, 0));
  const results = await Promise.all(
    sent.map((kind) =>
      gate.then(() =>
        supabase.rpc('check_in', { p_credential: kind === 'qr' ? QR_TOKEN : MANUAL_CODE }),
      ),
    ),
  );

  let okCount = 0;
  let alreadyCount = 0;
  let errorCount = 0;
  let winnerKind = null;
  let winnerMethod = null;
  const counts = {};
  results.forEach((r, i) => {
    if (r.error) {
      errorCount++;
      const code = r.error.message || 'unknown';
      counts[code] = (counts[code] || 0) + 1;
    } else if (r.data && r.data.already_registered) {
      alreadyCount++;
    } else {
      okCount++;
      winnerKind = sent[i];
      winnerMethod = r.data?.method;
    }
  });
  const ok = results.filter((r) => !r.error).map((r) => r.data);

  console.log(`Resultados: ${okCount} nuevas, ${alreadyCount} ya registradas, ${errorCount} errores`);
  if (errorCount > 0) console.log('Errores:', JSON.stringify(counts));

  check('exactamente 1 asistencia nueva', okCount === 1, `${okCount}`);
  check('19 respuestas de ya registrada', alreadyCount === N - 1, `${alreadyCount}`);
  check('sin errores inesperados', errorCount === 0, JSON.stringify(counts));
  check('metodo del ganador = credencial enviada', winnerMethod === winnerKind, `${winnerKind} -> ${winnerMethod}`);
  check('todas reportan el metodo del ganador', ok.every((d) => d.method === winnerMethod));
  check('creditos una sola vez (sellos = 1 en todas)', ok.every((d) => d.stamps === 1 && d.credits_granted === 1));
  check('misma asistencia en todas', new Set(ok.map((d) => d.attendance_id)).size === 1);
  console.log(`WINNER_METHOD=${winnerMethod}`);

  if (failures === 0) console.log('\nRESULTADO: todo correcto');
  else console.log(`\nRESULTADO: ${failures} falla(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
