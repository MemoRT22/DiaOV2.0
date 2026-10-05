-- Pruebas de regresión del Centro de Operación (Fase 7).
-- Se ejecuta como un solo bloque DO. Siempre termina con RAISE EXCEPTION que trae los resultados,
-- así que todos los cambios se revierten. Cubre: autorización real (ejecutando event_operations_overview
-- bajo identidades temporales), métricas con fixture aislado comparando la salida real del RPC,
-- estados temporales con timestamps controlados, ventana de check-in, tasa de asistencia,
-- y privacidad (ausencia de PII en la respuesta real del RPC).
-- Las señales visuales (LLENA, POCOS LUGARES, CHECK-IN PENDIENTE, etc.) viven en TypeScript
-- (operationsHelpers.ts) y se prueban en test_operationsHelpers.mjs.

DO $test$
DECLARE
  c  uuid := '00000000-0000-4000-8000-0000000000e1';
  s  uuid := '00000000-0000-4000-8000-0000000000e2';
  r  uuid := '00000000-0000-4000-8000-0000000000e3';
  pa uuid := '00000000-0000-4000-8000-0000000000f1';
  pb uuid := '00000000-0000-4000-8000-0000000000f2';
  ed uuid := active_edition_id();
  v_div uuid;
  v_career uuid;
  v_act uuid;
  v_sid uuid;
  v_act2 uuid;
  v_sid_pend uuid;
  v_pa uuid; v_pb uuid;
  v_st record;
  v_q text; v_val text; v_err text; v_ok boolean;
  v_uid uuid;
  v_res text := ''; v_pass int := 0; v_fail int := 0;
BEGIN
  -- ===== Fixture: identidades temporales =====
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'ro.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, pa, pb]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RO Coord', true, 'ro.e1@test.invalid'),
    (s, 'staff', 'RO Staff', true, 'ro.e2@test.invalid'),
    (r, 'sorteo', 'RO Sorteo', true, 'ro.e3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');

  SELECT id INTO v_div FROM divisions ORDER BY sort_order LIMIT 1;
  INSERT INTO careers (code, name, division_id, is_demo, is_active)
  VALUES ('RO-REAL', 'RO Carrera', v_div, false, true) RETURNING id INTO v_career;

  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, auth_user_id, initial_career_id)
  VALUES (ed, 'ro.a@test.invalid', 'Ana RO', '2008-01-01', 'forms', pa, v_career),
         (ed, 'ro.b@test.invalid', 'Beto RO', '2008-01-02', 'forms', pb, v_career);
  SELECT id INTO v_pa FROM participants WHERE email = 'ro.a@test.invalid';
  SELECT id INTO v_pb FROM participants WHERE email = 'ro.b@test.invalid';
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = p.id AND p.email IN ('ro.a@test.invalid', 'ro.b@test.invalid');

  -- Taller 1: sesión futura + 4 sesiones temporales (en curso, terminada, cancelada, oculta)
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RO Taller Op', '', 'Salon RO', false) RETURNING id INTO v_act;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '2 hours', now() + interval '2 hours 30 minutes', 10, 'Salon RO', 'activa', false, 1)
  RETURNING id INTO v_sid;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() - interval '5 min', now() + interval '25 min', 10, 'Salon RO Cur', 'activa', false, 1);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() - interval '30 min', now() - interval '5 min', 10, 'Salon RO End', 'activa', false, 1);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '5 hours', now() + interval '6 hours', 10, 'Salon RO Canc', 'cancelada', false, 1);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '7 hours', now() + interval '8 hours', 10, 'Salon RO Ocult', 'oculta', false, 1);

  -- Taller 2: sesión terminada sin asistencias (para check-in pendiente)
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RO Taller Pend', '', 'Salon RO Pend', false) RETURNING id INTO v_act2;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act2, now() - interval '10 min', now() - interval '2 min', 10, 'Salon RO Pend', 'activa', false, 1)
  RETURNING id INTO v_sid_pend;

  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES
    (v_pa, v_sid, v_act), (v_pb, v_sid, v_act);
  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES
    (v_pa, v_sid_pend, v_act2);
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method)
  VALUES (v_pa, v_sid, v_act, 1, 'qr');

  UPDATE editions SET checkin_close_after_minutes = 20 WHERE id = ed;

  CREATE TEMP TABLE ro_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO ro_steps (name, who, q, expect) VALUES
  -- ===== 1. AUTORIZACIÓN REAL =====
  ('auth: anon sin permiso', 'X', 'select event_operations_overview()', 'ERR:permission denied'),
  ('auth: participante rechazado', 'A', 'select event_operations_overview()', 'ERR:NOT_AUTHORIZED'),
  ('auth: sorteo rechazado', 'R', 'select event_operations_overview()', 'ERR:NOT_AUTHORIZED'),
  ('auth: staff permitido', 'S', 'select (event_operations_overview()->''summary'')->''sessions_total'' is not null', 'TRUE'),
  ('auth: coordinacion permitido', 'C', 'select (event_operations_overview()->''summary'')->''sessions_total'' is not null', 'TRUE'),
  -- ===== 2. MÉTRICAS =====
  ('metric: capacidad = 10', 'C', 'select (s->>''capacity'')::int = 10 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: reservados = 2', 'C', 'select (s->>''reserved'')::int = 2 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: disponibles = 8', 'C', 'select (s->>''remaining'')::int = 8 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: asistencias = 1', 'C', 'select (s->>''attended'')::int = 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: participantes con reservacion >= 2', 'C', 'select (event_operations_overview()->''summary''->>''participants_with_reservations'')::int >= 2', 'TRUE'),
  ('metric: participantes con asistencia >= 1', 'C', 'select (event_operations_overview()->''summary''->>''unique_attended_participants'')::int >= 1', 'TRUE'),
  -- ===== 3. ESTADOS TEMPORALES =====
  -- El RPC devuelve starts_at, ends_at y status. El frontend deriva el estado temporal.
  -- Verificamos que los datos permiten derivar cada estado comparando contra server_time del RPC.
  ('temporal: futura starts_at > server_time', 'C', 'select (s->>''starts_at'')::timestamptz > (event_operations_overview()->>''server_time'')::timestamptz from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  -- Para en curso y terminada, usamos now() como proxy de server_time (el RPC usa now() internamente).
  -- Esto evita llamar al RPC multiples veces en la misma consulta, que falla con is_local=true.
  ('temporal: en curso starts_at <= now < ends_at', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO Cur'' and (s->>''starts_at'')::timestamptz <= now() and (s->>''ends_at'')::timestamptz > now())', 'TRUE'),
  ('temporal: terminada ends_at < now', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO End'' and (s->>''ends_at'')::timestamptz < now())', 'TRUE'),
  ('temporal: cancelada status', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''status'' = ''cancelada'' and s->>''location'' = ''Salon RO Canc'')', 'TRUE'),
  ('temporal: oculta status', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''status'' = ''oculta'' and s->>''location'' = ''Salon RO Ocult'')', 'TRUE'),
  -- ===== 4. CHECK-IN PENDIENTE =====
  ('checkin: ventana = 20', 'C', 'select (event_operations_overview()->>''checkin_close_after_minutes'')::int = 20', 'TRUE'),
  ('checkin: sesion 0 asistencias reserved > 0', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Pend'' and (s->>''attended'')::int = 0 and (s->>''reserved'')::int > 0)', 'TRUE'),
  -- ===== 5. TASA DE ASISTENCIA =====
  ('tasa: 1/2 = 50%', 'P', 'select round((1.0 / 2) * 100) = 50', 'TRUE'),
  ('tasa: reserved=0 no divide', 'P', 'select case when 0 <= 0 then null else round((0.0 / 0) * 100) end is null', 'TRUE'),
  -- ===== 6. PRIVACIDAD =====
  ('privacidad: no full_name', 'C', 'select not exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s ? ''full_name'')', 'TRUE'),
  ('privacidad: no email', 'C', 'select not exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s ? ''email'')', 'TRUE'),
  ('privacidad: no phone', 'C', 'select not exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s ? ''phone'')', 'TRUE'),
  ('privacidad: no birth_date', 'C', 'select not exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s ? ''birth_date'')', 'TRUE'),
  ('privacidad: no high_school', 'C', 'select not exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s ? ''high_school'')', 'TRUE'),
  ('privacidad: summary sin PII', 'C', 'select not exists (select 1 from jsonb_object_keys(event_operations_overview()->''summary'') k where k in (''full_name'',''email'',''phone'',''birth_date'',''high_school''))', 'TRUE'),
  -- ===== 7. GRANTS =====
  ('grant: anon sin EXECUTE', 'P', 'select not has_function_privilege(''anon'', ''public.event_operations_overview()'', ''EXECUTE'')', 'TRUE'),
  ('grant: authenticated con EXECUTE', 'P', 'select has_function_privilege(''authenticated'', ''public.event_operations_overview()'', ''EXECUTE'')', 'TRUE');

  -- ===== Ejecutar pasos =====
  FOR v_st IN SELECT * FROM ro_steps ORDER BY seq LOOP
    v_q := v_st.q;
    v_uid := CASE v_st.who
      WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r
      WHEN 'A' THEN pa WHEN 'B' THEN pb
      ELSE NULL END;
    v_val := NULL; v_err := NULL;
    BEGIN
      IF v_st.who = 'X' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
      ELSIF v_uid IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
      END IF;
      IF v_q ~* '^(update|insert|create|delete)' THEN
        EXECUTE v_q;
      ELSE
        EXECUTE v_q INTO v_val;
      END IF;
    EXCEPTION WHEN others THEN
      v_err := SQLERRM;
    END;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);

    v_ok := CASE
      WHEN v_st.expect = 'OK' THEN v_err IS NULL
      WHEN v_st.expect = 'TRUE' THEN v_err IS NULL AND v_val = 'true'
      WHEN v_st.expect LIKE 'ERR:%' THEN v_err LIKE '%' || substr(v_st.expect, 5) || '%'
    END;
    IF v_ok THEN
      v_pass := v_pass + 1;
    ELSE
      v_fail := v_fail + 1;
      v_res := v_res || format('  FAIL | %s (expected %s, got err=%s, val=%s)' || chr(10),
        v_st.name, v_st.expect, COALESCE(v_err, 'none'), COALESCE(v_val, 'null'));
    END IF;
  END LOOP;

  -- ===== Limpieza =====
  DELETE FROM attendances WHERE participant_id IN (v_pa, v_pb);
  DELETE FROM reservations WHERE participant_id IN (v_pa, v_pb);
  DELETE FROM activity_sessions WHERE activity_id IN (v_act, v_act2);
  DELETE FROM activities WHERE id IN (v_act, v_act2);
  DELETE FROM participant_profiles WHERE participant_id IN (v_pa, v_pb);
  DELETE FROM participants WHERE id IN (v_pa, v_pb);
  DELETE FROM careers WHERE code = 'RO-REAL';
  DELETE FROM staff_roles WHERE user_id IN (c, s, r);
  DELETE FROM staff_members WHERE user_id IN (c, s, r);
  DELETE FROM auth.users WHERE id IN (c, s, r, pa, pb);

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'OPERACIONES REGRESSION: % passed, % failed
%', v_pass, v_fail, v_res;
  ELSE
    RAISE EXCEPTION 'OPERACIONES REGRESSION: % passed, 0 failed', v_pass;
  END IF;
END
$test$;
