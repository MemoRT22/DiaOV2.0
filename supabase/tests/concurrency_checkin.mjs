// Concurrency test for check-in: 20 simultaneous requests from the same participant
// mixing QR token and manual code. Expected: 1 attendance, credits granted exactly once,
// all other responses idempotent, and the stored method = the request that won the race.
// 1) run concurrency_checkin_setup.sql
// 2) Get the credential token and code from the DB:
//    select pgp_sym_decrypt(qr_token_encrypted, credential_encryption_key()) as token,
//           pgp_sym_decrypt(manual_code_encrypted, credential_encryption_key()) as code
//    from session_credentials sc join activity_sessions s on s.id=sc.session_id
//    join activities a on a.id=s.activity_id where a.title='CC CHK' and a.is_demo;
// 3) QR_TOKEN=... MANUAL_CODE=... node supabase/tests/concurrency_checkin.mjs
// 4) Verify in the DB (WINNER_METHOD printed by this script):
//    select count(*), min(method), sum(credits_granted) from attendances at
//    join participants p on p.id = at.participant_id where p.email = 'cc.check@test.invalid';
// 5) run concurrency_checkin_cleanup.sql
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const BIRTH = '2008-03-03';
const N = 20;
const QR_TOKEN = process.env.QR_TOKEN;
const MANUAL_CODE = process.env.MANUAL_CODE;

if (!QR_TOKEN || !MANUAL_CODE) {
  console.error('Falta QR_TOKEN o MANUAL_CODE. Obtenlos de la BD con la query del header.');
  process.exit(1);
}

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function login() {
  const res = await fetch(`${URL_}/functions/v1/student-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ email: 'cc.check@test.invalid', birth_date: BIRTH }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`login: ${res.status} ${body.error ?? ''}`);
  return body.access_token;
}

async function main() {
  const token = await login();
  const supabase = createClient(URL_, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

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
