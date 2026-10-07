-- Regresión: migración 20261007220000_workshops_single_flow_fixes (ubicación heredada y division_ids del tablero).
-- Ejecutar como UN solo bloque, DESPUÉS de la migración. Fixtures demo propios; SIEMPRE termina con una excepción
-- (FIXES_OK n checks), así que todo se revierte. Falla rápido: FIXES_FAIL[nombre].

CREATE FUNCTION pg_temp.run(who text, q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  IF who IS NOT NULL AND who <> 'postgres' THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
  BEGIN
    EXECUTE q INTO v; v := coalesce(nullif(v, ''), 'ok');
  EXCEPTION WHEN others THEN v := 'ERR:' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END
$f$;

CREATE FUNCTION pg_temp.mkp(p_n int) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); pid uuid; v_career uuid := (SELECT id FROM careers WHERE is_demo ORDER BY name LIMIT 1);
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sf.' || p_n || '@test.invalid', '{}', '{}', now(), now());
  INSERT INTO participants (edition_id, email, full_name, phone, high_school, initial_career_id, origin, is_demo, auth_user_id, forms_consent, forms_consent_at, forms_consent_version)
  VALUES (active_edition_id(), 'sf.' || p_n || '@test.invalid', 'SF Alumno ' || p_n, '9980000000', 'Otra escuela', v_career, 'demo', true, u, true, now(), 'v1')
  RETURNING id INTO pid;
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE pp.participant_id = pid AND e.id = active_edition_id();
  RETURN u::text;
END
$f$;

-- Actividad demo con división legacy (p_legacy) y filas en activity_divisions (p_divs); sesión con la ubicación indicada.
CREATE FUNCTION pg_temp.mkact(p_title text, p_legacy uuid, p_divs uuid[], p_session_location text) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE v_act uuid; v_ses uuid; d uuid;
BEGIN
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type)
  VALUES (active_edition_id(), p_legacy, 'SF ' || p_title, 'Descripción', 'Salón del taller', true, 'academica') RETURNING id INTO v_act;
  FOREACH d IN ARRAY coalesce(p_divs, '{}') LOOP INSERT INTO activity_divisions (activity_id, division_id) VALUES (v_act, d); END LOOP;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '2 hours', now() + interval '3 hours', 30, p_session_location, 'activa', true, 1) RETURNING id INTO v_ses;
  RETURN jsonb_build_object('act', v_act, 'ses', v_ses);
END
$f$;

CREATE FUNCTION pg_temp.row_of(p_board jsonb, p_title text) RETURNS jsonb
LANGUAGE sql AS $f$ SELECT s FROM jsonb_array_elements(p_board->'sessions') s WHERE s->>'title' = 'SF ' || p_title $f$;

CREATE FUNCTION pg_temp.fail(p text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'FIXES_FAIL[%]', p; END $f$;

DO $test$
DECLARE
  d1 uuid; d2 uuid; d3 uuid; d4 uuid;
  who text; board jsonb; r jsonb; got text; n int := 0;
  a_single jsonb; a_multi jsonb; a_legacy jsonb; a_both jsonb; a_none jsonb; a_loc jsonb; a_override jsonb;
  v_sub uuid; v_detail jsonb;
BEGIN
  SELECT (array_agg(id ORDER BY name))[1], (array_agg(id ORDER BY name))[2], (array_agg(id ORDER BY name))[3], (array_agg(id ORDER BY name))[4]
    INTO d1, d2, d3, d4 FROM divisions;  -- los fixtures solo referencian divisiones; no se modifican
  IF d4 IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_4_DEMO_DIVISIONS'; END IF;

  a_single   := pg_temp.mkact('Una división',      d1,   ARRAY[d1],      'Salón sesión');
  a_multi    := pg_temp.mkact('Varias divisiones', NULL, ARRAY[d1, d2],  'Salón sesión');
  a_legacy   := pg_temp.mkact('Solo legacy',       d3,   NULL,           'Salón sesión');
  a_both     := pg_temp.mkact('Legacy y relación', d4,   ARRAY[d4],      'Salón sesión');
  a_none     := pg_temp.mkact('Sin división',      NULL, NULL,           'Salón sesión');
  a_loc      := pg_temp.mkact('Hereda ubicación',  d1,   ARRAY[d1],      '');
  a_override := pg_temp.mkact('Ubicación propia',  d1,   ARRAY[d1],      'Aula especial');

  who := pg_temp.mkp(1);
  got := pg_temp.run(who, 'select my_reservation_board()::text');
  IF got LIKE 'ERR:%' THEN RAISE EXCEPTION 'FIXES_FAIL[board rpc: %]', got; END IF;
  board := got::jsonb;

  -- una división
  r := pg_temp.row_of(board, 'Una división');
  IF r->'division_ids' <> jsonb_build_array(d1) THEN PERFORM pg_temp.fail('una división: division_ids'); END IF;
  IF (r->>'division_id')::uuid <> d1 THEN PERFORM pg_temp.fail('una división: division_id legacy se conserva'); END IF;
  n := n + 2;

  -- varias divisiones: division_id sigue NULL (no se elige una arbitraria) y division_ids trae todas
  r := pg_temp.row_of(board, 'Varias divisiones');
  IF r->'division_id' <> 'null'::jsonb THEN PERFORM pg_temp.fail('multi: division_id debe seguir NULL'); END IF;
  IF (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(r->'division_ids') x) IS DISTINCT FROM (SELECT array_agg(x::text ORDER BY x::text) FROM unnest(ARRAY[d1, d2]) x)
    THEN PERFORM pg_temp.fail('multi: division_ids con ambas'); END IF;
  n := n + 2;

  -- legacy: solo division_id, sin filas en activity_divisions
  r := pg_temp.row_of(board, 'Solo legacy');
  IF r->'division_ids' <> jsonb_build_array(d3) THEN PERFORM pg_temp.fail('legacy: division_ids incluye la división legacy'); END IF;
  n := n + 1;

  -- legacy + relación con la misma división: sin duplicados
  r := pg_temp.row_of(board, 'Legacy y relación');
  IF r->'division_ids' <> jsonb_build_array(d4) THEN PERFORM pg_temp.fail('sin duplicados'); END IF;
  n := n + 1;

  -- sin ninguna división
  r := pg_temp.row_of(board, 'Sin división');
  IF r->'division_ids' <> '[]'::jsonb THEN PERFORM pg_temp.fail('sin división: arreglo vacío'); END IF;
  n := n + 1;

  -- el tablero conserva sus campos y su semántica (ubicación heredada también aquí)
  r := pg_temp.row_of(board, 'Hereda ubicación');
  IF r->>'location' <> 'Salón del taller' THEN PERFORM pg_temp.fail('tablero: ubicación heredada'); END IF;
  r := pg_temp.row_of(board, 'Ubicación propia');
  IF r->>'location' <> 'Aula especial' THEN PERFORM pg_temp.fail('tablero: ubicación propia'); END IF;
  IF NOT (r ? 'remaining' AND r ? 'conflicts_with' AND r ? 'tight_transfer_with' AND r ? 'in_progress' AND r ? 'my_reservation_id')
    THEN PERFORM pg_temp.fail('tablero: contrato existente intacto'); END IF;
  IF (r->>'remaining')::int <> 30 THEN PERFORM pg_temp.fail('tablero: disponibilidad intacta'); END IF;
  n := n + 4;

  -- lectura operacional del taller publicado: la sesión sin override ('') hereda la ubicación de la activity
  INSERT INTO workshop_submissions (edition_id, facilitator_name, facilitator_email, activity_type, title, student_pitch, takeaway, keywords,
                                    session_duration_minutes, capacity_per_session, building, room_space, status, published_activity_id, objective, submitted_at)
  VALUES (active_edition_id(), 'Facilitador SF', 'sf.fac@test.invalid', 'academica', 'SF Publicado', 'Pitch', 'Takeaway', ARRAY['uno','dos','tres'],
          60, 30, 'Edificio', 'Sala', 'published', (a_loc->>'act')::uuid, 'Objetivo', now()) RETURNING id INTO v_sub;
  v_detail := public.workshop_admin_get_internal(v_sub);
  IF v_detail->'sessions'->0->>'location' <> 'Salón del taller' THEN PERFORM pg_temp.fail('detalle: ubicación vacía hereda la del taller'); END IF;
  n := n + 1;

  UPDATE workshop_submissions SET published_activity_id = (a_override->>'act')::uuid WHERE id = v_sub;
  v_detail := public.workshop_admin_get_internal(v_sub);
  IF v_detail->'sessions'->0->>'location' <> 'Aula especial' THEN PERFORM pg_temp.fail('detalle: el override de la sesión se respeta'); END IF;
  n := n + 1;

  -- no se tocó ningún dato: la sesión sigue con '' en la tabla
  IF (SELECT location FROM activity_sessions WHERE id = (a_loc->>'ses')::uuid) <> '' THEN PERFORM pg_temp.fail('no se rellena activity_sessions.location'); END IF;
  n := n + 1;

  -- permisos intactos: el detalle sigue siendo solo de service_role; el tablero, de authenticated
  IF has_function_privilege('authenticated', 'public.workshop_admin_get_internal(uuid)', 'EXECUTE') THEN PERFORM pg_temp.fail('permisos: get_internal no es público'); END IF;
  IF NOT has_function_privilege('authenticated', 'public.my_reservation_board()', 'EXECUTE') THEN PERFORM pg_temp.fail('permisos: board para authenticated'); END IF;
  IF has_function_privilege('anon', 'public.my_reservation_board()', 'EXECUTE') THEN PERFORM pg_temp.fail('permisos: board no es anon'); END IF;
  n := n + 3;

  RAISE EXCEPTION 'FIXES_OK % checks', n;
END
$test$;
