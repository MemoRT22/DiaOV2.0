-- Regresión: eliminar una actividad publicada desde una propuesta (migración 20261007040000).
-- Se ejecuta completo como UN solo bloque, después de la migración. Fixtures propios; SIEMPRE termina con una excepción
-- (WORKSHOP_DELETE_OK n checks), así que todo se revierte.

CREATE FUNCTION pg_temp.run(who text, q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  IF who IS NOT NULL AND who <> 'postgres' THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
  BEGIN
    IF q ~* '^\s*(select|with)' THEN EXECUTE q INTO v; v := coalesce(nullif(v, ''), 'ok'); ELSE EXECUTE q; v := 'ok'; END IF;
  EXCEPTION WHEN others THEN v := 'ERR:' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END
$f$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  c text := gen_random_uuid()::text;      -- coordinación
  s text := gen_random_uuid()::text;      -- staff
  div uuid; act uuid; act2 uuid; sub uuid; sub2 uuid; v text; n int := 0; rec record;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (c::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wd.coord@test.invalid', '{}', '{}', now(), now()),
         (s::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wd.staff@test.invalid', '{}', '{}', now(), now());
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c::uuid, 'coordinacion', 'WD Coord', true, 'wd.coord@test.invalid'), (s::uuid, 'staff', 'WD Staff', true, 'wd.staff@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c::uuid, 'coordinacion'), (s::uuid, 'staff');

  -- Tras la migración no puede quedar ninguna propuesta publicada sin actividad (ni al revés)
  IF EXISTS (SELECT 1 FROM workshop_submissions WHERE (status = 'published' AND published_activity_id IS NULL)
                OR (status <> 'published' AND published_activity_id IS NOT NULL)) THEN RAISE EXCEPTION 'STATE_INCONSISTENT_AFTER_MIGRATION'; END IF;
  n := n + 1;

  SELECT id INTO div FROM divisions WHERE NOT is_demo ORDER BY name LIMIT 1;
  INSERT INTO activities (edition_id, division_id, title, activity_type) VALUES (ed, div, 'WD actividad publicada', 'academica') RETURNING id INTO act;
  INSERT INTO activities (edition_id, division_id, title, activity_type) VALUES (ed, div, 'WD actividad manual', 'academica') RETURNING id INTO act2;
  INSERT INTO workshop_submissions (edition_id, status, facilitator_name, facilitator_email, activity_type, title, student_pitch, objective,
      takeaway, keywords, session_duration_minutes, capacity_per_session, operating_start_time, operating_end_time, building, room_space,
      submitted_at, published_activity_id, admin_notes)
  VALUES (ed, 'published', 'WD Tallerista', 'wd.tallerista@test.invalid', 'academica', 'WD propuesta', 'pitch', 'objetivo', 'aprendizaje',
      ARRAY['uno', 'dos', 'tres'], 30, 10, '10:00', '12:00', 'Edificio', 'Salón', now(), act, 'Nota previa de Coordinación')
  RETURNING id INTO sub;

  -- Staff no puede eliminar actividades
  IF pg_temp.run(s, format($q$select delete_activity(%L)$q$, act)) NOT LIKE 'ERR:%NOT_AUTHORIZED%' THEN RAISE EXCEPTION 'STAFF_CAN_DELETE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM activities WHERE id = act) THEN RAISE EXCEPTION 'STAFF_DELETE_APPLIED'; END IF;
  n := n + 1;

  -- Coordinación elimina: la propuesta se conserva, vuelve a Aprobada y deja rastro
  v := pg_temp.run(c, format($q$select delete_activity(%L)$q$, act));
  IF v <> 'ok' THEN RAISE EXCEPTION 'DELETE_FAILED[%]', v; END IF;
  IF EXISTS (SELECT 1 FROM activities WHERE id = act) THEN RAISE EXCEPTION 'ACTIVITY_NOT_DELETED'; END IF;
  SELECT * INTO rec FROM workshop_submissions WHERE id = sub;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'SUBMISSION_LOST'; END IF;
  IF rec.status <> 'approved' OR rec.published_activity_id IS NOT NULL THEN RAISE EXCEPTION 'SUBMISSION_STATE[% %]', rec.status, rec.published_activity_id; END IF;
  IF rec.admin_notes NOT LIKE 'Nota previa de Coordinación%' OR rec.admin_notes NOT LIKE '%Actividad eliminada del Programa el %puede publicarse de nuevo.' THEN
    RAISE EXCEPTION 'NOTE_MISSING[%]', rec.admin_notes; END IF;
  IF rec.title <> 'WD propuesta' OR rec.facilitator_email <> 'wd.tallerista@test.invalid' THEN RAISE EXCEPTION 'HISTORY_ALTERED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'catalog.activity_deleted' AND detail = jsonb_build_object('id', act, 'submission_id', sub)) THEN
    RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
  n := n + 4;

  -- Una actividad que no nació de una propuesta se elimina como siempre y no toca otras propuestas
  v := pg_temp.run(c, format($q$select delete_activity(%L)$q$, act2));
  IF v <> 'ok' OR EXISTS (SELECT 1 FROM activities WHERE id = act2) THEN RAISE EXCEPTION 'PLAIN_DELETE_FAILED[%]', v; END IF;
  IF (SELECT status FROM workshop_submissions WHERE id = sub) <> 'approved' THEN RAISE EXCEPTION 'OTHER_SUBMISSION_TOUCHED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'catalog.activity_deleted' AND detail->>'id' = act2::text AND detail->'submission_id' = 'null'::jsonb) THEN
    RAISE EXCEPTION 'PLAIN_AUDIT_MISSING'; END IF;
  n := n + 2;

  -- Una actividad inexistente sigue fallando sin modificar propuestas
  IF pg_temp.run(c, format($q$select delete_activity(%L)$q$, gen_random_uuid())) <> 'ERR:NOT_FOUND' THEN RAISE EXCEPTION 'GHOST_DELETE'; END IF;
  n := n + 1;

  -- La propuesta puede volver a revisarse: el invariante «published ⇔ actividad» se cumple
  IF EXISTS (SELECT 1 FROM workshop_submissions WHERE (status = 'published') <> (published_activity_id IS NOT NULL)) THEN RAISE EXCEPTION 'INVARIANT_BROKEN'; END IF;
  n := n + 1;

  RAISE EXCEPTION 'WORKSHOP_DELETE_OK % checks', n;
END
$test$;
