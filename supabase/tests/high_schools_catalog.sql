-- Run after the migration with psql -v ON_ERROR_STOP=1. All fixtures and imported participants roll back.
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.high_schools) <> 195
    OR (SELECT count(*) FROM public.high_schools WHERE is_active) <> 195
    OR (SELECT count(DISTINCT public.fold_text(name)) FROM public.high_schools) <> 195 THEN
    RAISE EXCEPTION 'initial high school seed must contain exactly 195 active, normalized-unique names';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('Colegio Boston (Cancún)'),
      ('Colegio Álamos Norte Quintana Roo (Cancún)'),
      ('Cbtis No. 111 Leona Vicario (Cancún)'),
      ('C. Bachilleres Cozumel (Cozumel)'),
      ('Colegio Álamos Sur Quintana Roo (Cancún)'),
      ('Otra escuela')
    ) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM public.high_schools h WHERE h.name = expected.name AND h.is_active)
  ) THEN RAISE EXCEPTION 'representative high school missing from initial seed'; END IF;
END $$;
INSERT INTO auth.users(id, email, aud, role) VALUES ('a2111111-1111-4111-8111-111111111111', 'high-schools-test@example.invalid', 'authenticated', 'authenticated');
INSERT INTO public.staff_members(user_id, role, full_name, email)
VALUES ('a2111111-1111-4111-8111-111111111111', 'coordinacion', 'Coordinación fixture', 'high-schools-test@example.invalid');
INSERT INTO public.staff_roles(user_id, role) VALUES ('a2111111-1111-4111-8111-111111111111', 'coordinacion');
SELECT set_config('request.jwt.claim.sub', 'a2111111-1111-4111-8111-111111111111', true);

DO $$
DECLARE
  v_boston uuid;
  v_alamos uuid;
  v_other uuid;
  v_created uuid;
  v_registered uuid;
  v_preview jsonb;
  v_committed jsonb;
  v_rows jsonb;
  v_career text;
  v_unknown text := 'Preparatoria Prueba Día OV';
BEGIN
  SELECT id INTO v_boston FROM public.high_schools WHERE public.fold_text(name) = public.fold_text('Colegio Boston (Cancún)');
  SELECT id INTO v_alamos FROM public.high_schools WHERE public.fold_text(name) = public.fold_text('Colegio Álamos Norte Quintana Roo (Cancún)');
  SELECT id INTO v_other FROM public.high_schools WHERE name = 'Otra escuela';
  IF v_boston IS NULL OR v_alamos IS NULL OR v_other IS NULL THEN RAISE EXCEPTION 'initial seed absent'; END IF;
  IF EXISTS (SELECT 1 FROM public.high_schools GROUP BY public.fold_text(name) HAVING count(*) > 1) THEN RAISE EXCEPTION 'normalized duplicate'; END IF;

  v_created := public.save_high_school('{"name":"Colegio de Prueba","is_active":true}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM public.high_schools WHERE id = v_created AND is_active) THEN RAISE EXCEPTION 'create failed'; END IF;
  INSERT INTO public.participants(edition_id,email,full_name,origin,is_demo,high_school_id)
  VALUES (public.active_edition_id(),'historic-school@example.invalid','Alumno Histórico','manual',false,v_created);
  BEGIN
    PERFORM public.save_high_school('{"name":"colegio  de prueba"}'::jsonb);
    RAISE EXCEPTION 'duplicate accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'HIGH_SCHOOL_EXISTS' THEN RAISE; END IF;
  END;
  PERFORM public.save_high_school(jsonb_build_object('id',v_created,'name','Colegio de Prueba Editado','is_active',false));
  IF EXISTS (SELECT 1 FROM public.high_schools WHERE id = v_created AND is_active) THEN RAISE EXCEPTION 'deactivate failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.high_schools WHERE id = v_created AND is_active) THEN RAISE EXCEPTION 'inactive still public'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.participants WHERE email='historic-school@example.invalid' AND high_school_id=v_created
    AND high_school='Colegio de Prueba Editado') THEN RAISE EXCEPTION 'inactive historical value lost'; END IF;

  BEGIN
    PERFORM public.register_self_service_internal(jsonb_build_object('email','invalid-school@example.invalid','first_name','Ana','last_name','López',
      'phone','9981234567','high_school_id','ffffffff-ffff-4fff-8fff-ffffffffffff','high_school_grade','3',
      'entry_period','2027-08','initial_career_id',(SELECT id FROM public.careers WHERE is_active AND NOT is_demo LIMIT 1), 'consent_accepted',true));
    RAISE EXCEPTION 'unknown school accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVALID_HIGH_SCHOOL' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.register_self_service_internal(jsonb_build_object('email','inactive-school@example.invalid','first_name','Ana','last_name','López',
      'phone','9981234567','high_school_id',v_created,'high_school_grade','3',
      'entry_period','2027-08','initial_career_id',(SELECT id FROM public.careers WHERE is_active AND NOT is_demo LIMIT 1), 'consent_accepted',true));
    RAISE EXCEPTION 'inactive school accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVALID_HIGH_SCHOOL' THEN RAISE; END IF; END;

  v_registered := public.register_self_service_internal(jsonb_build_object('email','registered-school@example.invalid',
    'first_name','Alumno','last_name','Registrado','phone','9981234567','high_school_id',v_other,
    'high_school','texto arbitrario ignorado','high_school_grade','3','entry_period','2027-08',
    'initial_career_id',(SELECT id FROM public.careers WHERE is_active AND NOT is_demo LIMIT 1),'consent_accepted',true));
  IF NOT EXISTS (SELECT 1 FROM public.participants WHERE id=v_registered AND high_school_id=v_other AND high_school='Otra escuela') THEN
    RAISE EXCEPTION 'self registration did not save canonical school';
  END IF;
  PERFORM public.update_participant(v_registered, jsonb_build_object('high_school_id',v_boston));
  IF NOT EXISTS (SELECT 1 FROM public.participants WHERE id=v_registered AND high_school_id=v_boston
    AND high_school='Colegio Boston (Cancún)' AND manual_overrides ? 'high_school') THEN
    RAISE EXCEPTION 'admin correction did not preserve audit/override path';
  END IF;
  BEGIN
    PERFORM public.update_participant(v_registered, '{"high_school":"Inventada"}'::jsonb);
    RAISE EXCEPTION 'free text correction accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVALID_HIGH_SCHOOL' THEN RAISE; END IF; END;

  SELECT code INTO v_career FROM public.careers WHERE is_active AND NOT is_demo LIMIT 1;
  v_rows := jsonb_build_array(
    jsonb_build_object('row',2,'email','school-a@example.invalid','full_name','Alumno A','high_school','Colegio Boston (Cancún)','career',v_career),
    jsonb_build_object('row',3,'email','school-b@example.invalid','full_name','Alumno B','high_school','  COLEGIO   ALAMOS NORTE QUINTANA ROO (CANCUN)  ','career',v_career),
    jsonb_build_object('row',4,'email','school-c@example.invalid','full_name','Alumno C','high_school',v_unknown,'career',v_career)
  );
  v_preview := public.preview_participant_import(v_rows,false,'{}','{}','{}');
  IF jsonb_array_length(v_preview->'unmatched_high_schools') <> 1 OR
     (v_preview->'unmatched_high_schools'->0->>'count')::int <> 1 OR
     (v_preview->'unmatched_high_schools'->0->>'rows')::int <> 1 OR
     v_preview->'unmatched_high_schools'->0->>'value' <> v_unknown THEN
    RAISE EXCEPTION 'unknown school preview mismatch: %', v_preview->'unmatched_high_schools';
  END IF;
  BEGIN
    PERFORM public.commit_participant_import(v_rows,'high-schools-test.csv',false,'{}','{}','{}');
    RAISE EXCEPTION 'unresolved import accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'UNRESOLVED_HIGH_SCHOOLS' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.participants WHERE email LIKE 'school-%@example.invalid') THEN RAISE EXCEPTION 'failed commit leaked data'; END IF;

  PERFORM public.save_high_school(jsonb_build_object('name',v_unknown,'is_active',true));
  v_preview := public.preview_participant_import(v_rows,false,'{}','{}','{}');
  IF jsonb_array_length(v_preview->'unmatched_high_schools') <> 0 THEN RAISE EXCEPTION 'catalog addition not recognized'; END IF;
  v_committed := public.commit_participant_import(v_rows,'high-schools-test.csv',false,'{}','{}','{}');
  IF (v_committed->'counts'->>'new')::int <> 3 THEN RAISE EXCEPTION 'unexpected import counts: %',v_committed->'counts'; END IF;
  IF (SELECT count(*) FROM public.participants WHERE email LIKE 'school-%@example.invalid' AND high_school_id IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'missing school IDs after commit';
  END IF;
  IF EXISTS (SELECT 1 FROM public.participants p JOIN public.high_schools h ON h.id=p.high_school_id
    WHERE p.email LIKE 'school-%@example.invalid' AND p.high_school IS DISTINCT FROM h.name) THEN RAISE EXCEPTION 'noncanonical school snapshot'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.participants WHERE email='school-a@example.invalid'
    AND high_school_id=v_boston AND high_school='Colegio Boston (Cancún)') THEN
    RAISE EXCEPTION 'exact import did not resolve Boston from initial seed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.participants WHERE email='school-b@example.invalid'
    AND high_school_id=v_alamos AND high_school='Colegio Álamos Norte Quintana Roo (Cancún)') THEN
    RAISE EXCEPTION 'normalized import did not resolve Álamos from initial seed';
  END IF;
  IF has_table_privilege('anon','public.high_schools','SELECT') OR has_table_privilege('authenticated','public.high_schools','INSERT')
    OR has_function_privilege('anon','public.save_high_school(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'catalog grants too broad'; END IF;
  IF (SELECT prosrc ~* '(DELETE[[:space:]]+FROM|TRUNCATE[[:space:]]+)(public\.)?high_schools'
      FROM pg_proc WHERE oid = 'public.reset_preparation_internal(uuid,text)'::regprocedure) THEN
    RAISE EXCEPTION 'preparation reset touches academic catalog';
  END IF;
  RAISE NOTICE 'high school catalog and import transaction checks passed';
END $$;
ROLLBACK;
