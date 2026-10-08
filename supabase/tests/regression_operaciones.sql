-- Pruebas de regresión del Centro de Operación (snapshot `event_operations_overview` v2).
-- Se ejecuta como un solo bloque DO con fixtures propios. Siempre termina con RAISE EXCEPTION que trae los
-- resultados, así que todos los cambios se revierten. Cubre: autorización real (se ejecuta el RPC bajo identidades
-- temporales), agregados de reservaciones/asistencias, talleres multidivisión y sin división, cancelaciones con
-- reservaciones afectadas, ubicación (sesión con fallback a taller), sesiones ocultas, volumen (más de 100 sesiones),
-- preparación vs operación real, compatibilidad con el contrato anterior y ausencia de datos personales.
-- Las señales de atención y la presentación viven en TypeScript (operationsHelpers.ts) y se prueban con vitest.
-- Éxito: "OPERACIONES REGRESSION: N passed, 0 failed".

DO $test$
DECLARE
  c  uuid := '00000000-0000-4000-8000-0000000000e1';
  s  uuid := '00000000-0000-4000-8000-0000000000e2';
  r  uuid := '00000000-0000-4000-8000-0000000000e3';
  pa uuid := '00000000-0000-4000-8000-0000000000f1';
  pb uuid := '00000000-0000-4000-8000-0000000000f2';
  pc uuid := '00000000-0000-4000-8000-0000000000f3';
  ed uuid := active_edition_id();
  v_div1 uuid; v_div2 uuid; v_career uuid;
  v_act uuid; v_sid uuid; v_act2 uuid; v_sid_pend uuid;
  v_act_multi uuid; v_act_vida uuid; v_act_loc uuid; v_act_demo uuid; v_sid_cancel uuid; v_sid_loc uuid;
  v_other uuid;
  v_pa uuid; v_pb uuid; v_pc uuid;
  v_st record;
  v_q text; v_val text; v_err text; v_ok boolean; v_uid uuid;
  v_res text := ''; v_pass int := 0; v_fail int := 0;
BEGIN
  -- ===== Fixture: identidades temporales =====
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'ro.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, pa, pb, pc]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RO Coord', true, 'ro.e1@test.invalid'),
    (s, 'staff', 'RO Staff', true, 'ro.e2@test.invalid'),
    (r, 'sorteo', 'RO Sorteo', true, 'ro.e3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');

  SELECT id INTO v_div1 FROM divisions ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_div2 FROM divisions WHERE id <> v_div1 ORDER BY sort_order, id LIMIT 1;
  IF v_div2 IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_2_DIVISIONS'; END IF;
  INSERT INTO careers (code, name, division_id, is_demo, is_active)
  VALUES ('RO-REAL', 'RO Carrera', v_div1, false, true) RETURNING id INTO v_career;

  INSERT INTO participants (edition_id, email, full_name, origin, auth_user_id, initial_career_id)
  VALUES (ed, 'ro.a@test.invalid', 'Ana RO', 'forms', pa, v_career),
         (ed, 'ro.b@test.invalid', 'Beto RO', 'forms', pb, v_career),
         (ed, 'ro.c@test.invalid', 'Carla RO', 'forms', pc, v_career);
  SELECT id INTO v_pa FROM participants WHERE email = 'ro.a@test.invalid';
  SELECT id INTO v_pb FROM participants WHERE email = 'ro.b@test.invalid';
  SELECT id INTO v_pc FROM participants WHERE email = 'ro.c@test.invalid';

  -- Taller 1 (una división): futura + en curso + terminada + cancelada + oculta
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div1, 'RO Taller Op', '', 'Salon RO', false) RETURNING id INTO v_act;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '2 hours', now() + interval '2 hours 30 minutes', 10, 'Salon RO', 'activa', false, 1)
  RETURNING id INTO v_sid;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() - interval '5 min', now() + interval '25 min', 10, 'Salon RO Cur', 'activa', false, 1);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() - interval '30 min', now() - interval '5 min', 10, 'Salon RO End', 'activa', false, 1);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '5 hours', now() + interval '6 hours', 10, 'Salon RO Canc', 'cancelada', false, 1)
  RETURNING id INTO v_sid_cancel;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + interval '7 hours', now() + interval '8 hours', 10, 'Salon RO Ocult', 'oculta', false, 1);

  -- Taller 2: sesión terminada sin asistencias (check-in pendiente)
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div1, 'RO Taller Pend', '', 'Salon RO Pend', false) RETURNING id INTO v_act2;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act2, now() - interval '10 min', now() - interval '2 min', 10, 'Salon RO Pend', 'activa', false, 1)
  RETURNING id INTO v_sid_pend;

  -- Taller multidivisión (division_id NULL, dos divisiones), taller sin división y taller sin ubicación en la sesión
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, NULL, 'RO Taller Multi', '', 'Salon RO Multi', false) RETURNING id INTO v_act_multi;
  DELETE FROM activity_divisions WHERE activity_id = v_act_multi;
  INSERT INTO activity_divisions (activity_id, division_id) VALUES (v_act_multi, v_div1), (v_act_multi, v_div2);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_multi, now() + interval '3 hours', now() + interval '3 hours 30 minutes', 20, '', 'activa', false, 1);
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, NULL, 'RO Taller Vida', '', 'Salon RO Vida', false) RETURNING id INTO v_act_vida;
  DELETE FROM activity_divisions WHERE activity_id = v_act_vida;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_vida, now() + interval '4 hours', now() + interval '4 hours 30 minutes', 20, '', 'activa', false, 1);
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div2, 'RO Taller Sin Lugar', '', '', false) RETURNING id INTO v_act_loc;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_loc, now() + interval '1 hour', now() + interval '90 minutes', 5, '', 'activa', false, 1)
  RETURNING id INTO v_sid_loc;
  -- Taller de prueba (is_demo): visible en preparación, oculto en operación real
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div1, 'RO Taller Demo', '', 'Salon RO Demo', true) RETURNING id INTO v_act_demo;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_demo, now() + interval '9 hours', now() + interval '10 hours', 5, 'Salon RO Demo', 'activa', true, 1);

  -- Volumen: 60 talleres con 2 sesiones cada uno (120 sesiones) con una reservación en la mitad
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  SELECT ed, v_div1, 'RO Volumen ' || lpad(g::text, 2, '0'), '', 'Salon RO Vol ' || g, false FROM generate_series(1, 60) g;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  SELECT a.id, now() + interval '20 hours' + make_interval(mins => k * 30), now() + interval '20 hours' + make_interval(mins => k * 30 + 25), 30, 'Salon RO Vol', 'activa', false, 1
  FROM activities a, generate_series(0, 1) k WHERE a.title LIKE 'RO Volumen %';

  -- Reservaciones: Ana y Beto en la sesión futura; Ana en la pendiente; sesión cancelada con 2 afectados (Beto resuelto)
  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES
    (v_pa, v_sid, v_act), (v_pb, v_sid, v_act), (v_pa, v_sid_pend, v_act2);
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method)
  VALUES (v_pa, v_sid, v_act, 1, 'qr');
  INSERT INTO reservations (participant_id, session_id, activity_id, status, ended_at) VALUES
    (v_pb, v_sid_cancel, v_act, 'cancelada_sesion', now() - interval '1 minute'),
    (v_pc, v_sid_cancel, v_act, 'cancelada_sesion', now() - interval '1 minute');
  -- Beto ya eligió otra sesión después de la cancelación (resuelta); Carla sigue sin alternativa (sin resolver)
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT v_pb, id, activity_id FROM activity_sessions WHERE activity_id = v_act_multi;

  UPDATE editions SET checkin_close_after_minutes = 20 WHERE id = ed;

  CREATE TEMP TABLE ro_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO ro_steps (name, who, q, expect) VALUES
  -- ===== 1. AUTORIZACIÓN REAL =====
  ('auth: anon sin permiso', 'X', 'select event_operations_overview()', 'ERR:permission denied'),
  ('auth: participante rechazado', 'A', 'select event_operations_overview()', 'ERR:NOT_AUTHORIZED'),
  ('auth: sorteo rechazado', 'R', 'select event_operations_overview()', 'ERR:NOT_AUTHORIZED'),
  ('auth: staff permitido', 'S', 'select (event_operations_overview()->''summary'')->''sessions_total'' is not null', 'TRUE'),
  ('auth: coordinacion permitido', 'C', 'select (event_operations_overview()->''summary'')->''sessions_total'' is not null', 'TRUE'),
  ('grant: anon sin EXECUTE', 'P', 'select not has_function_privilege(''anon'', ''public.event_operations_overview()'', ''EXECUTE'')', 'TRUE'),
  ('grant: authenticated con EXECUTE', 'P', 'select has_function_privilege(''authenticated'', ''public.event_operations_overview()'', ''EXECUTE'')', 'TRUE'),
  -- ===== 2. AGREGADOS (reservaciones y asistencias) =====
  ('metric: capacidad = 10', 'C', 'select (s->>''capacity'')::int = 10 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: reservados = 2', 'C', 'select (s->>''reserved'')::int = 2 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: disponibles = 8', 'C', 'select (s->>''remaining'')::int = 8 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: asistencias = 1', 'C', 'select (s->>''attended'')::int = 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('metric: la sesión cancelada no cuenta reservados', 'C', 'select (s->>''reserved'')::int = 0 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO Canc''', 'TRUE'),
  ('metric: participantes con compromiso activo >= 1', 'C', 'select (event_operations_overview()->''summary''->>''participants_with_reservations'')::int >= 1', 'TRUE'),
  ('metric: reservaciones activas >= 1', 'C', 'select (event_operations_overview()->''summary''->>''active_reservations'')::int >= 1', 'TRUE'),
  ('metric: participantes con asistencia >= 1', 'C', 'select (event_operations_overview()->''summary''->>''unique_attended_participants'')::int >= 1', 'TRUE'),
  ('metric: totales de preparación cuentan sesiones activas', 'C', 'select (event_operations_overview()->''summary''->>''capacity_total'')::int >= 10 + 20 + 20 + 5 and (event_operations_overview()->''summary''->>''reserved_total'')::int >= 4 and (event_operations_overview()->''summary''->>''activities_total'')::int >= 66', 'TRUE'),
  ('metric: suma de reservados por sesión coincide con el total', 'C', 'select (select sum((x->>''reserved'')::int) from jsonb_array_elements(event_operations_overview()->''sessions'') x where x->>''status'' = ''activa'') = (event_operations_overview()->''summary''->>''reserved_total'')::int', 'TRUE'),
  -- ===== 3. ESTADOS TEMPORALES =====
  ('temporal: futura starts_at > server_time', 'C', 'select (s->>''starts_at'')::timestamptz > (event_operations_overview()->>''server_time'')::timestamptz from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('temporal: en curso starts_at <= now < ends_at', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO Cur'' and (s->>''starts_at'')::timestamptz <= now() and (s->>''ends_at'')::timestamptz > now())', 'TRUE'),
  ('temporal: terminada ends_at < now', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO End'' and (s->>''ends_at'')::timestamptz < now())', 'TRUE'),
  ('temporal: cancelada status', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''status'' = ''cancelada'' and s->>''location'' = ''Salon RO Canc'')', 'TRUE'),
  ('temporal: oculta status', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''status'' = ''oculta'' and s->>''location'' = ''Salon RO Ocult'')', 'TRUE'),
  ('temporal: raíz con server_time, fecha y zona de la edición', 'C', 'select (event_operations_overview() ?& array[''server_time'',''event_date'',''timezone'',''mode'',''checkin_close_after_minutes'']) and event_operations_overview()->>''timezone'' is not null', 'TRUE'),
  -- ===== 4. CHECK-IN PENDIENTE =====
  ('checkin: ventana = 20', 'C', 'select (event_operations_overview()->>''checkin_close_after_minutes'')::int = 20', 'TRUE'),
  ('checkin: sesion 0 asistencias reserved > 0', 'C', 'select exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Pend'' and (s->>''attended'')::int = 0 and (s->>''reserved'')::int > 0)', 'TRUE'),
  -- ===== 5. DIVISIONES (multidivisión real) =====
  ('divisiones: una división', 'C', 'select jsonb_array_length(s->''divisions'') = 1 and s->''divisions''->0 ?& array[''id'',''code'',''name''] from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  ('divisiones: multidivisión entrega las dos', 'C', 'select jsonb_array_length(s->''divisions'') = 2 and (select count(distinct d->>''id'') = 2 from jsonb_array_elements(s->''divisions'') d) from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Multi''', 'TRUE'),
  ('divisiones: multidivisión conserva compatibilidad (primera división, no NULL)', 'C', 'select s->>''division_id'' is not null and s->>''division_name'' <> '''' and s->>''division_code'' <> '''' from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Multi''', 'TRUE'),
  ('divisiones: sin división entrega lista vacía y textos vacíos (no NULL)', 'C', 'select s->''divisions'' = ''[]''::jsonb and s->>''division_id'' is null and s->>''division_name'' = '''' and s->>''division_code'' = '''' from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Vida''', 'TRUE'),
  ('divisiones: un taller con una sola división por activities.division_id mantiene su división', 'C', 'select s->''divisions''->0->>''id'' = s->>''division_id'' from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Sin Lugar''', 'TRUE'),
  -- ===== 6. CANCELACIONES CON AFECTADOS =====
  ('cancelada: 2 reservaciones afectadas, 1 sin resolver', 'C', 'select (s->>''affected_reservations'')::int = 2 and (s->>''affected_unresolved'')::int = 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO Canc''', 'TRUE'),
  ('cancelada: sesiones no canceladas sin afectados', 'C', 'select (s->>''affected_reservations'')::int = 0 and (s->>''affected_unresolved'')::int = 0 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO''', 'TRUE'),
  -- ===== 7. UBICACIÓN =====
  ('ubicación: la sesión sin lugar cae al lugar del taller', 'C', 'select s->>''location'' = ''Salon RO Multi'' from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Multi''', 'TRUE'),
  ('ubicación: sin lugar en sesión ni taller es NULL para que la interfaz lo señale', 'C', 'select s->''location'' = ''null''::jsonb from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Sin Lugar''', 'TRUE'),
  ('ubicación: sesión sin lugar y taller sin lugar (Vida) cae al lugar del taller', 'C', 'select s->>''location'' = ''Salon RO Vida'' from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' = ''RO Taller Vida''', 'TRUE'),
  -- ===== 8. VOLUMEN =====
  ('volumen: 120 sesiones de 60 talleres en un solo snapshot', 'C', 'select count(*) = 120 and count(distinct s->>''activity_id'') = 60 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''title'' like ''RO Volumen %''', 'TRUE'),
  ('volumen: ordenado cronológicamente', 'C', 'select bool_and(t >= lag_t) from (select (x.s->>''starts_at'')::timestamptz t, lag((x.s->>''starts_at'')::timestamptz) over (order by x.ord) lag_t from jsonb_array_elements(event_operations_overview()->''sessions'') with ordinality x(s, ord)) q where lag_t is not null', 'TRUE'),
  -- ===== 9. PREPARACIÓN vs OPERACIÓN REAL =====
  ('modo: en preparación se ven los talleres de prueba', 'C', 'select event_operations_overview()->>''mode'' = ''preparacion'' and exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO Demo'')', 'TRUE'),
  ('modo: pasar a operación real (fixture)', 'P', 'update editions set mode = ''operacion_real'' where id = active_edition_id()', 'OK'),
  ('modo: en operación real no se ven los de prueba y sí los reales', 'C', 'select event_operations_overview()->>''mode'' = ''operacion_real'' and not exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO Demo'') and exists (select 1 from jsonb_array_elements(event_operations_overview()->''sessions'') s where s->>''location'' = ''Salon RO'')', 'TRUE'),
  ('modo: en operación real el staff sigue autorizado', 'S', 'select jsonb_array_length(event_operations_overview()->''sessions'') > 0', 'TRUE'),
  -- ===== 10. COMPATIBILIDAD CON EL CONTRATO ANTERIOR =====
  ('compat: cada sesión conserva todas las claves anteriores', 'C', 'select bool_and(s ?& array[''session_id'',''activity_id'',''title'',''division_id'',''division_name'',''division_code'',''starts_at'',''ends_at'',''location'',''status'',''capacity'',''reserved'',''remaining'',''attended'',''is_demo'']) from jsonb_array_elements(event_operations_overview()->''sessions'') s', 'TRUE'),
  ('compat: el resumen conserva todas las claves anteriores', 'C', 'select event_operations_overview()->''summary'' ?& array[''participants_total'',''platform_consents'',''active_reservations'',''participants_with_reservations'',''total_attendances'',''unique_attended_participants'',''sessions_total'',''sessions_upcoming'',''sessions_in_progress'',''sessions_ended'',''sessions_cancelled'']', 'TRUE'),
  ('compat: ninguna división anterior es NULL en nombre (el filtro anterior ordena por nombre)', 'C', 'select bool_and(s->>''division_name'' is not null) from jsonb_array_elements(event_operations_overview()->''sessions'') s', 'TRUE'),
  -- ===== 11. PRIVACIDAD =====
  ('privacidad: las sesiones solo traen claves operativas', 'C', 'select bool_and((select array_agg(k order by k) from jsonb_object_keys(s) k) <@ array[''activity_id'',''affected_reservations'',''affected_unresolved'',''attended'',''capacity'',''division_code'',''division_id'',''division_name'',''divisions'',''ends_at'',''is_demo'',''location'',''remaining'',''reserved'',''session_id'',''starts_at'',''status'',''title'']) from jsonb_array_elements(event_operations_overview()->''sessions'') s', 'TRUE'),
  ('privacidad: las divisiones solo traen id, code y name', 'C', 'select bool_and((select array_agg(k order by k) from jsonb_object_keys(d) k) = array[''code'',''id'',''name'']) from jsonb_array_elements(event_operations_overview()->''sessions'') s, jsonb_array_elements(s->''divisions'') d', 'TRUE'),
  ('privacidad: ningún dato personal en todo el snapshot', 'C', 'select not (event_operations_overview()::text ~* ''(full_name|"email"|"phone"|birth_date|high_school|ro\.a@test|Ana RO|Beto RO|Carla RO)'')', 'TRUE'),
  ('privacidad: summary sin PII', 'C', 'select not exists (select 1 from jsonb_object_keys(event_operations_overview()->''summary'') k where k in (''full_name'',''email'',''phone'',''birth_date'',''high_school''))', 'TRUE');

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
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_uid)::text, true);
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
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);

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
        v_st.name, v_st.expect, COALESCE(v_err, 'none'), COALESCE(left(v_val, 200), 'null'));
    END IF;
  END LOOP;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'OPERACIONES REGRESSION: % passed, % failed
%', v_pass, v_fail, v_res;
  ELSE
    RAISE EXCEPTION 'OPERACIONES REGRESSION: % passed, 0 failed', v_pass;
  END IF;
END
$test$;
