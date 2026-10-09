-- Retira únicamente el fixture CC CHK del mismo proyecto local/descartable.
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  pid uuid; uid uuid; act_id uuid;
BEGIN
  SELECT id,auth_user_id INTO pid,uid FROM participants
  WHERE edition_id=ed AND email='cc.check@test.invalid' AND is_demo;
  SELECT id INTO act_id FROM activities
  WHERE edition_id=ed AND title='CC CHK' AND is_demo;
  DELETE FROM attendances WHERE participant_id=pid;
  DELETE FROM reservations WHERE participant_id=pid;
  DELETE FROM activity_sessions WHERE activity_id=act_id;
  DELETE FROM activity_credentials WHERE activity_id=act_id;
  DELETE FROM activities WHERE id=act_id;
  DELETE FROM participants WHERE id=pid;
  DELETE FROM auth.users WHERE id=uid;
  RAISE NOTICE 'Fixture DEMO CC CHK retirado';
END $fx$;
