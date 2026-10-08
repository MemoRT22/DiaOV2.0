-- Fase 6B. Ejecutar después de allow_official_participant_import en una base de pruebas.
-- BEGIN/ROLLBACK protege la edición y todos los fixtures, incluso cuando falla una aserción.
BEGIN;

CREATE FUNCTION pg_temp.import_as(p_uid uuid, p_query text) RETURNS text
LANGUAGE plpgsql AS $test$
DECLARE result text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    EXECUTE p_query INTO result;
  EXCEPTION WHEN others THEN
    result := 'ERR:' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN result;
END
$test$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  coordinator uuid := gen_random_uuid();
  staff uuid := gen_random_uuid();
  div_id uuid;
  career1 uuid;
  career2 uuid;
  school_id uuid;
  v_participant_id uuid;
  rows_pre jsonb;
  rows_official jsonb;
  career_map jsonb;
  school_map jsonb;
  preview jsonb;
  committed jsonb;
  result text;
BEGIN
  UPDATE editions SET roster_status='preparacion' WHERE id=ed;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (coordinator, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sixb.coord@test.invalid', '{}', '{}', now(), now()),
    (staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sixb.staff@test.invalid', '{}', '{}', now(), now());
  INSERT INTO staff_members(user_id, role, full_name, is_active, email) VALUES
    (coordinator, 'coordinacion', '6B Coordinación DEMO', true, 'sixb.coord@test.invalid'),
    (staff, 'staff', '6B Staff DEMO', true, 'sixb.staff@test.invalid');
  INSERT INTO staff_roles(user_id, role) VALUES (coordinator, 'coordinacion'), (staff, 'staff');
  INSERT INTO divisions(code,name,sort_order,is_demo)
  VALUES ('sixb-demo', '6B División DEMO', 9999, true) RETURNING id INTO div_id;
  INSERT INTO careers(code,name,division_id,is_demo,is_active) VALUES
    ('SIXB-C1', '6B Carrera uno', div_id, true, true) RETURNING id INTO career1;
  INSERT INTO careers(code,name,division_id,is_demo,is_active) VALUES
    ('SIXB-C2', '6B Carrera dos', div_id, true, true) RETURNING id INTO career2;
  SELECT id INTO school_id FROM high_schools WHERE name='Otra escuela' AND is_active;
  IF school_id IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_OTHER_SCHOOL'; END IF;

  career_map := jsonb_build_object(fold_text('Carrera Forms desconocida'), career1);
  school_map := jsonb_build_object(fold_text('Prepa Forms desconocida'), school_id);
  rows_pre := jsonb_build_array(jsonb_build_object(
    'row', 2, 'email', 'sixb.alumno@test.invalid', 'full_name', 'Nombre Forms Original',
    'phone', '9981234567', 'high_school', 'Prepa Forms desconocida',
    'career', 'Carrera Forms desconocida', 'career_2', '6B Carrera dos', 'consent', true));

  result := pg_temp.import_as(coordinator, format(
    'select preview_participant_import(%L::jsonb,true,%L::jsonb,%L::jsonb,%L::jsonb)',
    rows_pre, career_map, '{}'::jsonb, school_map));
  IF result LIKE 'ERR:%' THEN RAISE EXCEPTION 'PREPARACION_PREVIEW[%]', result; END IF;
  preview := result::jsonb;
  IF (preview->'counts'->>'new')::int <> 1 THEN RAISE EXCEPTION 'PREPARACION_PREVIEW_COUNTS[%]', preview; END IF;
  result := pg_temp.import_as(coordinator, format(
    'select commit_participant_import(%L::jsonb,%L,true,%L::jsonb,%L::jsonb,%L::jsonb)',
    rows_pre, 'sixb-preparacion.csv', career_map, '{}'::jsonb, school_map));
  IF result LIKE 'ERR:%' THEN RAISE EXCEPTION 'PREPARACION_COMMIT[%]', result; END IF;
  committed := result::jsonb;
  IF (committed->'counts'->>'new')::int <> 1 THEN RAISE EXCEPTION 'PREPARACION_COMMIT_COUNTS[%]', committed; END IF;
  SELECT id INTO v_participant_id FROM participants WHERE email='sixb.alumno@test.invalid';
  IF v_participant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM participants WHERE id=v_participant_id AND is_demo AND high_school_id=school_id
      AND initial_career_id=career1 AND forms_consent
  ) THEN RAISE EXCEPTION 'PREPARACION_FIELDS'; END IF;
  IF (SELECT count(*) FROM initial_interests WHERE participant_id=v_participant_id) <> 2
    OR NOT EXISTS (SELECT 1 FROM initial_interests WHERE participant_id=v_participant_id AND preference=1 AND career_id=career1)
    OR NOT EXISTS (SELECT 1 FROM initial_interests WHERE participant_id=v_participant_id AND preference=2 AND career_id=career2)
  THEN RAISE EXCEPTION 'PREPARACION_INTERESTS'; END IF;

  -- El correo antiguo debe reconocer al mismo participante y el override manual debe generar conflicto.
  INSERT INTO participant_email_history(participant_id, edition_id, email, changed_by, reason)
  VALUES (v_participant_id, ed, 'sixb.alias@test.invalid', coordinator, 'fixture DEMO 6B');
  UPDATE participants SET full_name='Nombre corregido manualmente', manual_overrides='{"full_name":true}'::jsonb
  WHERE id=v_participant_id;
  UPDATE editions SET roster_status='oficial' WHERE id=ed;
  rows_official := jsonb_build_array(
    jsonb_build_object('row',2,'email','sixb.alias@test.invalid','full_name','Nombre Forms Nuevo',
      'high_school','Prepa Forms desconocida','career','Carrera Forms desconocida',
      'career_2','6B Carrera dos','consent',true),
    jsonb_build_object('row',3,'email','sixb.nuevo@test.invalid','full_name','Segundo Alumno DEMO',
      'high_school','Otra escuela','career','6B Carrera uno','consent',true));
  result := pg_temp.import_as(coordinator, format(
    'select preview_participant_import(%L::jsonb,true,%L::jsonb,%L::jsonb,%L::jsonb)',
    rows_official, career_map, '{}'::jsonb, school_map));
  IF result LIKE 'ERR:%' THEN RAISE EXCEPTION 'OFICIAL_PREVIEW[%]', result; END IF;
  preview := result::jsonb;
  IF (preview->'counts'->>'conflict')::int <> 1 OR (preview->'counts'->>'new')::int <> 1
    OR coalesce(preview->'rows'->0->>'note','') NOT LIKE 'Reconocido por correo anterior:%'
  THEN RAISE EXCEPTION 'OFICIAL_PREVIEW_CONCILIATION[%]', preview; END IF;
  result := pg_temp.import_as(coordinator, format(
    'select commit_participant_import(%L::jsonb,%L,true,%L::jsonb,%L::jsonb,%L::jsonb)',
    rows_official, 'sixb-oficial.csv', career_map, '{}'::jsonb, school_map));
  IF result LIKE 'ERR:%' THEN RAISE EXCEPTION 'OFICIAL_COMMIT[%]', result; END IF;
  committed := result::jsonb;
  IF (committed->'counts'->>'conflict')::int <> 1 OR (committed->'counts'->>'new')::int <> 1
  THEN RAISE EXCEPTION 'OFICIAL_COMMIT_COUNTS[%]', committed; END IF;
  IF (SELECT count(*) FROM participants WHERE email LIKE 'sixb.%@test.invalid') <> 2
    OR (SELECT full_name FROM participants WHERE id=v_participant_id) <> 'Nombre corregido manualmente'
    OR NOT EXISTS (SELECT 1 FROM participant_import_conflicts
      WHERE participant_id=v_participant_id AND field='full_name' AND status='pending' AND imported_value='Nombre Forms Nuevo')
    OR (SELECT count(*) FROM initial_interests WHERE participant_id=v_participant_id) <> 2
    OR NOT EXISTS (SELECT 1 FROM initial_interests i JOIN participants p ON p.id=i.participant_id
      WHERE p.email='sixb.nuevo@test.invalid' AND i.preference=1 AND i.career_id=career1)
  THEN RAISE EXCEPTION 'OFICIAL_CONCILIATION_OR_INTERESTS'; END IF;

  -- Reimportar el mismo CSV no debe duplicar personas ni intereses.
  result := pg_temp.import_as(coordinator, format(
    'select commit_participant_import(%L::jsonb,%L,true,%L::jsonb,%L::jsonb,%L::jsonb)',
    rows_official, 'sixb-repeat.csv', career_map, '{}'::jsonb, school_map));
  IF result LIKE 'ERR:%' OR (SELECT count(*) FROM participants WHERE email LIKE 'sixb.%@test.invalid') <> 2
    OR (SELECT count(*) FROM initial_interests WHERE participant_id=v_participant_id) <> 2
  THEN RAISE EXCEPTION 'OFICIAL_REPEAT[%]', result; END IF;

  IF pg_temp.import_as(staff, format('select preview_participant_import(%L::jsonb,true)', rows_pre)) <> 'ERR:NOT_AUTHORIZED'
    OR pg_temp.import_as(staff, format('select commit_participant_import(%L::jsonb,%L,true)', rows_pre, 'sixb-staff.csv')) <> 'ERR:NOT_AUTHORIZED'
  THEN RAISE EXCEPTION 'NON_COORDINACION_ALLOWED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action='participants.imported' AND detail->>'file_name'='sixb-oficial.csv')
  THEN RAISE EXCEPTION 'IMPORT_AUDIT_MISSING'; END IF;
  RAISE NOTICE 'OFFICIAL_IMPORT_OK: preparacion/oficial preview+commit, alias, overrides, interests, permissions';
END
$test$;

ROLLBACK;
