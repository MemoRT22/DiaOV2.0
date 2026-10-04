-- Fixture for concurrency_checkin.mjs (cleanup). Safe to run more than once.
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  v_backup jsonb;
  v_pids uuid[];
  v_uids uuid[];
  v_sids uuid[];
BEGIN
  SELECT (description::jsonb)->'fixture_backup' INTO v_backup
  FROM activities WHERE edition_id = ed AND title = 'CC CHK' AND is_demo AND description LIKE '{%'
  LIMIT 1;

  SELECT array_agg(id), array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL)
  INTO v_pids, v_uids
  FROM participants WHERE email LIKE 'cc.%@test.invalid' AND is_demo;

  SELECT array_agg(s.id) INTO v_sids
  FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
  WHERE a.title = 'CC CHK' AND a.is_demo AND s.is_demo;

  DELETE FROM attendances WHERE participant_id = ANY (coalesce(v_pids, '{}')) OR session_id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM reservations WHERE participant_id = ANY (coalesce(v_pids, '{}')) OR session_id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM session_credentials WHERE session_id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM activity_sessions WHERE id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM activities WHERE title = 'CC CHK' AND is_demo;
  DELETE FROM access_attempts WHERE email_hash = encode(sha256(convert_to('cc.check@test.invalid', 'UTF8')), 'hex');
  DELETE FROM participants WHERE id = ANY (coalesce(v_pids, '{}'));
  DELETE FROM auth.users WHERE id = ANY (coalesce(v_uids, '{}'))
     OR email IN (SELECT 'p.' || p || '@participantes.diaov.invalid' FROM unnest(coalesce(v_pids, '{}')) p);

  IF v_backup IS NOT NULL THEN
    UPDATE editions SET
      reservations_open_at = (v_backup->>'reservations_open_at')::timestamptz,
      reservations_close_at = (v_backup->>'reservations_close_at')::timestamptz,
      max_reservations = (v_backup->>'max_reservations')::int,
      travel_buffer_minutes = (v_backup->>'travel_buffer_minutes')::int,
      checkin_open_before_minutes = (v_backup->>'checkin_open_before_minutes')::int,
      checkin_close_after_minutes = (v_backup->>'checkin_close_after_minutes')::int
    WHERE id = ed;
    RAISE NOTICE 'Datos CC CHK eliminados. Configuración restaurada.';
  ELSE
    RAISE NOTICE 'Datos CC CHK eliminados. Sin backup (sin cambios).';
  END IF;
END
$fx$;
