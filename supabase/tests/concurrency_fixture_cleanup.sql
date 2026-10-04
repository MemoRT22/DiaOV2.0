-- Fixture for concurrency_reservations.mjs (cleanup). Safe to run more than once.
-- Removes ONLY the data created by concurrency_fixture_setup.sql (participants cc.*@test.invalid,
-- their login users and access attempts, demo activities/sessions 'CC ...' and their reservations)
-- and restores the reservation settings saved by the setup.
-- Run: paste the whole file into the SQL editor (runs as postgres).
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  v_backup jsonb;
  v_pids uuid[];
  v_uids uuid[];
  v_emails text[];
  v_sids uuid[];
BEGIN
  SELECT (description::jsonb)->'fixture_backup' INTO v_backup
  FROM activities WHERE edition_id = ed AND title = 'CC LAST' AND is_demo AND description LIKE '{%'
  LIMIT 1;

  SELECT array_agg(id), array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL), array_agg(email)
  INTO v_pids, v_uids, v_emails
  FROM participants WHERE email LIKE 'cc.%@test.invalid';

  SELECT array_agg(s.id) INTO v_sids
  FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
  WHERE a.title LIKE 'CC %' AND a.is_demo AND s.is_demo;

  UPDATE reservations SET replaced_by = NULL
  WHERE participant_id = ANY (coalesce(v_pids, '{}')) OR session_id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM reservations
  WHERE participant_id = ANY (coalesce(v_pids, '{}')) OR session_id = ANY (coalesce(v_sids, '{}'));

  DELETE FROM activity_sessions WHERE id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM activities WHERE title LIKE 'CC %' AND is_demo
    AND NOT EXISTS (SELECT 1 FROM activity_sessions s WHERE s.activity_id = activities.id);

  DELETE FROM access_attempts WHERE email_hash IN (
    SELECT encode(sha256(convert_to(e, 'UTF8')), 'hex') FROM unnest(coalesce(v_emails, '{}')) e);

  DELETE FROM participants WHERE id = ANY (coalesce(v_pids, '{}'));
  DELETE FROM auth.users
  WHERE id = ANY (coalesce(v_uids, '{}'))
     OR email IN (SELECT 'p.' || p || '@participantes.diaov.invalid' FROM unnest(coalesce(v_pids, '{}')) p);

  IF v_backup IS NOT NULL THEN
    UPDATE editions SET
      reservations_open_at = (v_backup->>'reservations_open_at')::timestamptz,
      reservations_close_at = (v_backup->>'reservations_close_at')::timestamptz,
      max_reservations = (v_backup->>'max_reservations')::int,
      travel_buffer_minutes = (v_backup->>'travel_buffer_minutes')::int
    WHERE id = ed;
    RAISE NOTICE 'Datos CC eliminados. Configuración restaurada: %', v_backup;
  ELSE
    RAISE NOTICE 'Datos CC eliminados. No había configuración guardada (sin cambios en la edición).';
  END IF;
END
$fx$;
