-- Fixture local/descartable para concurrency_checkin.mjs; no ejecutar en producción.
-- Identidad, participante, taller, sesión y reservación son exclusivamente DEMO.
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  div_id uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  act_id uuid; ses_id uuid; pid uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM participants WHERE email='cc.check@test.invalid')
    OR EXISTS (SELECT 1 FROM activities WHERE title='CC CHK' AND is_demo)
  THEN RAISE EXCEPTION 'CC_CHK_FIXTURE_EXISTS'; END IF;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo)
  VALUES (ed,'cc.check@test.invalid','CC Check-in DEMO','demo',true) RETURNING id INTO pid;
  UPDATE participant_profiles pp SET platform_consent_version=e.privacy_notice_version,platform_consent_at=now()
  FROM editions e WHERE e.id=ed AND pp.participant_id=pid;
  INSERT INTO activities(edition_id,division_id,title,description,location,is_demo)
  VALUES (ed,div_id,'CC CHK','Fixture DEMO de concurrencia','Edificio CC',true) RETURNING id INTO act_id;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
  VALUES (act_id,now()-interval '5 minutes',now()+interval '25 minutes',30,'Edificio CC','activa',true,1)
  RETURNING id INTO ses_id;
  PERFORM rotate_activity_credential(act_id);
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (pid,ses_id,act_id);
  RAISE NOTICE 'CC CHK DEMO listo: participant %, activity %, session %',pid,act_id,ses_id;
END $fx$;
