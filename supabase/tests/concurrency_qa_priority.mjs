// Real PostgreSQL concurrency. Only a Docker-local disposable database is accepted.
import { spawn } from 'node:child_process';

const container = process.env.QA_DOCKER_CONTAINER ?? 'diaov-credits-test-db';
const database = process.env.QA_DATABASE ?? 'diaov_priority_qa';
if (!/^[a-zA-Z0-9_-]+$/.test(container) || !/^diaov_priority_qa(?:_[a-z0-9]+)?$/.test(database)) {
  throw new Error('Use a Docker-local disposable diaov_priority_qa database.');
}
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1']);
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(query);
  });
}
const setup = await sql(`
DO $fixture$
DECLARE ed uuid := public.active_edition_id(); uid uuid := gen_random_uuid(); pid uuid; act uuid; sid uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    uid||'@test.invalid','{}','{}',now(),now());
  INSERT INTO public.participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
  VALUES(ed,uid||'@test.invalid','Priority concurrent QA','demo',true,uid) RETURNING id INTO pid;
  UPDATE public.participant_profiles SET platform_consent_at=now(),
    platform_consent_version=(SELECT privacy_notice_version FROM public.editions WHERE id=ed) WHERE participant_id=pid;
  INSERT INTO public.activities(edition_id,title,is_demo,activity_type)
  VALUES(ed,'Priority concurrent QA '||uid,true,'academica') RETURNING id INTO act;
  INSERT INTO public.activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo)
  VALUES(act,now()-interval '1 minute',now()+interval '59 minutes',30,'activa',true) RETURNING id INTO sid;
  INSERT INTO public.reservations(participant_id,session_id,activity_id) VALUES(pid,sid,act);
END $fixture$;
SELECT jsonb_build_object('uid',p.auth_user_id,'pid',p.id,'act',a.id,
  'qr',extensions.pgp_sym_decrypt(c.qr_token_encrypted,public.credential_encryption_key()),
  'manual',extensions.pgp_sym_decrypt(c.manual_code_encrypted,public.credential_encryption_key()))
FROM public.participants p JOIN public.reservations r ON r.participant_id=p.id
JOIN public.activities a ON a.id=r.activity_id JOIN public.activity_credentials c ON c.activity_id=a.id
WHERE p.full_name='Priority concurrent QA' ORDER BY p.created_at DESC LIMIT 1;
`);
const fixture = JSON.parse(setup.split('\n').at(-1));
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const run = credential => sql(`
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = ${quote(fixture.uid)};
SELECT public.check_in(${quote(credential)});
COMMIT;`);
const results = await Promise.all(Array.from({ length: 20 }, (_, i) => run(i % 2 ? fixture.manual : fixture.qr)));
const responses = results.map(value => JSON.parse(value.split('\n').find(line => line.startsWith('{'))));
const count = JSON.parse(await sql(`SELECT jsonb_build_object('rows',count(*),'stamps',sum(credits_granted)) FROM public.attendances WHERE participant_id=${quote(fixture.pid)};`));
if (responses.filter(r => !r.already_registered).length !== 1 ||
    responses.filter(r => r.already_registered).length !== 19 ||
    new Set(responses.map(r => r.attendance_id)).size !== 1 ||
    responses.some(r => r.stamps !== 2 || r.credits_granted !== 2) ||
    count.rows !== 1 || count.stamps !== 2) throw new Error('Concurrent attendance invariant failed');
console.log(JSON.stringify({ requests:20,new_attendances:1,idempotent_responses:19,stored_rows:count.rows,stored_stamps:count.stamps,passed:true }));
// Remove only this run's local fixture so raffle pool assertions remain reproducible.
await sql(`
BEGIN;
DELETE FROM public.attendances WHERE participant_id=${quote(fixture.pid)};
DELETE FROM public.reservations WHERE participant_id=${quote(fixture.pid)};
DELETE FROM public.activity_credentials WHERE activity_id=${quote(fixture.act)};
DELETE FROM public.activity_sessions WHERE activity_id=${quote(fixture.act)};
DELETE FROM public.activities WHERE id=${quote(fixture.act)};
DELETE FROM public.participants WHERE id=${quote(fixture.pid)};
DELETE FROM auth.users WHERE id=${quote(fixture.uid)};
COMMIT;
`);

