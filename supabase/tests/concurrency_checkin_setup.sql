-- Fixture for concurrency_checkin.mjs (setup).
-- Creates ONLY identifiable test data: 1 participant cc.check@test.invalid with consent,
-- 1 demo session 'CC CHK' (capacity 30, 1 credit) that already ended (inside check-in window),
-- and a reservation for that session. Saves previous reservation settings inside the activity description.
-- Run: paste into the SQL editor, then node supabase/tests/concurrency_checkin.mjs,
-- then run concurrency_checkin_cleanup.sql.
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_backup jsonb;
  v_act uuid; v_sess uuid; v_pid uuid;
BEGIN
  IF ed IS NULL THEN RAISE EXCEPTION 'No hay edición activa'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE email = 'cc.check@test.invalid')
     OR EXISTS (SELECT 1 FROM activities WHERE title = 'CC CHK' AND is_demo) THEN
    RAISE EXCEPTION 'Ya existen datos CC CHK: ejecuta primero concurrency_checkin_cleanup.sql';
  END IF;

  SELECT jsonb_build_object(
    'reservations_open_at', reservations_open_at,
    'reservations_close_at', reservations_close_at,
    'max_reservations', max_reservations,
    'travel_buffer_minutes', travel_buffer_minutes,
    'checkin_open_before_minutes', checkin_open_before_minutes,
    'checkin_close_after_minutes', checkin_close_after_minutes)
  INTO v_backup FROM editions WHERE id = ed;

  UPDATE editions SET
    reservations_open_at = now() - interval '1 hour',
    reservations_close_at = NULL,
    max_reservations = 4,
    travel_buffer_minutes = 10,
    checkin_open_before_minutes = 5,
    checkin_close_after_minutes = 20
  WHERE id = ed;

  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo)
  VALUES (ed, 'cc.check@test.invalid', 'CC Checkin', '2008-03-03', 'forms', true)
  RETURNING id INTO v_pid;

  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = p.id AND p.email = 'cc.check@test.invalid';

  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'CC CHK', jsonb_build_object('fixture_backup', v_backup)::text, 'Edificio CC', true)
  RETURNING id INTO v_act;

  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() - interval '22 minutes', now() - interval '2 minutes', 30, 'Edificio CC', 'activa', true, 1)
  RETURNING id INTO v_sess;

  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES (v_pid, v_sess, v_act);

  RAISE NOTICE 'Fixture CC CHK listo. Participant: %, Session: %', v_pid, v_sess;
END
$fx$;
