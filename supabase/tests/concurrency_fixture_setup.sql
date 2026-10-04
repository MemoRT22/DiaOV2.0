-- Fixture for concurrency_reservations.mjs (setup).
-- Creates ONLY identifiable test data in the active edition:
--   participants cc.01..cc.30@test.invalid + cc.max@test.invalid (is_demo, Aviso accepted, birth 2008-03-03)
--   demo activities/sessions titled 'CC <code>' located in 'Edificio CC'
-- Saves the current reservation settings inside the 'CC LAST' activity description,
-- then opens the reservation window (max 4, buffer 10). Run concurrency_fixture_cleanup.sql afterwards.
-- Run: paste the whole file into the SQL editor (runs as postgres).
DO $fx$
DECLARE
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  t0 timestamptz := date_trunc('hour', now()) + interval '3 days';
  v_backup jsonb;
  v_act uuid;
  k record;
BEGIN
  IF ed IS NULL THEN RAISE EXCEPTION 'No hay edición activa'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE email LIKE 'cc.%@test.invalid')
     OR EXISTS (SELECT 1 FROM activities WHERE title LIKE 'CC %' AND is_demo) THEN
    RAISE EXCEPTION 'Ya existen datos CC: ejecuta primero concurrency_fixture_cleanup.sql';
  END IF;

  SELECT jsonb_build_object(
    'reservations_open_at', reservations_open_at,
    'reservations_close_at', reservations_close_at,
    'max_reservations', max_reservations,
    'travel_buffer_minutes', travel_buffer_minutes)
  INTO v_backup FROM editions WHERE id = ed;

  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL,
    max_reservations = 4, travel_buffer_minutes = 10
  WHERE id = ed;

  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo)
  SELECT ed, e, 'CC Concurrencia ' || split_part(split_part(e, '@', 1), '.', 2), '2008-03-03', 'forms', true
  FROM (SELECT 'cc.' || lpad(i::text, 2, '0') || '@test.invalid' e FROM generate_series(1, 30) i
        UNION ALL SELECT 'cc.max@test.invalid') x;

  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = p.id AND p.email LIKE 'cc.%@test.invalid';

  FOR k IN SELECT * FROM (VALUES
    ('LAST', 0, 1), ('K5', 60, 5), ('SRC', 120, 40), ('TGT', 180, 1),
    ('M1', 240, 30), ('M2', 300, 30), ('M3', 360, 30), ('M4', 420, 30),
    ('M5', 480, 30), ('M6', 540, 30), ('M7', 600, 30), ('M8', 660, 30)
  ) AS x(code, m, cap) LOOP
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (ed, v_div, 'CC ' || k.code,
            CASE WHEN k.code = 'LAST' THEN jsonb_build_object('fixture_backup', v_backup)::text ELSE '' END,
            'Edificio CC', true)
    RETURNING id INTO v_act;
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo)
    VALUES (v_act, t0 + make_interval(mins => k.m), t0 + make_interval(mins => k.m + 40), k.cap, 'Edificio CC', 'activa', true);
  END LOOP;

  RAISE NOTICE 'Fixture CC listo. Configuración previa guardada: %', v_backup;
END
$fx$;
