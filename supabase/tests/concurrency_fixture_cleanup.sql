-- Fixture for concurrency_reservations.mjs (cleanup). Safe to run more than once.
-- Removes ONLY the data created by concurrency_fixture_setup.sql (participants cc.01..cc.30
-- and cc.max@test.invalid, their login users, demo activities/sessions and reservations)
-- and restores the reservation settings saved by the setup.
-- Run ONLY against the same disposable/local Supabase project as setup.
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  v_backup jsonb;
  v_pids uuid[];
  v_uids uuid[];
  v_sids uuid[];
BEGIN
  SELECT (description::jsonb)->'fixture_backup' INTO v_backup
  FROM activities WHERE edition_id = ed AND title = 'CC LAST' AND is_demo AND description LIKE '{%'
  LIMIT 1;

  SELECT array_agg(id), array_agg(auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL)
  INTO v_pids, v_uids
  FROM participants WHERE edition_id = ed AND is_demo AND email IN (
    SELECT 'cc.' || lpad(i::text, 2, '0') || '@test.invalid' FROM generate_series(1, 30) i
    UNION ALL SELECT 'cc.max@test.invalid');

  SELECT array_agg(s.id) INTO v_sids
  FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
  WHERE a.title IN ('CC LAST','CC K5','CC SRC','CC TGT',
    'CC M1','CC M2','CC M3','CC M4','CC M5','CC M6','CC M7','CC M8')
    AND a.edition_id = ed AND a.is_demo AND s.is_demo;

  UPDATE reservations SET replaced_by = NULL
  WHERE participant_id = ANY (coalesce(v_pids, '{}')) OR session_id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM reservations
  WHERE participant_id = ANY (coalesce(v_pids, '{}')) OR session_id = ANY (coalesce(v_sids, '{}'));

  DELETE FROM activity_sessions WHERE id = ANY (coalesce(v_sids, '{}'));
  DELETE FROM activities WHERE title IN ('CC LAST','CC K5','CC SRC','CC TGT',
    'CC M1','CC M2','CC M3','CC M4','CC M5','CC M6','CC M7','CC M8')
    AND edition_id = ed AND is_demo
    AND NOT EXISTS (SELECT 1 FROM activity_sessions s WHERE s.activity_id = activities.id);

  DELETE FROM participants WHERE id = ANY (coalesce(v_pids, '{}'));
  DELETE FROM auth.users
  WHERE id = ANY (coalesce(v_uids, '{}'));

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
