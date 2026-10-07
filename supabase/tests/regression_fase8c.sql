-- AVISO (migración 20261007120000_student_operational_flexibility): este archivo todavía codifica reglas RETIRADAS: CHECKIN_TOO_LATE, la ventana ends_at+checkin_close_after_minutes para SAME_WORKSHOP y el buffer de traslado como SCHEDULE_CONFLICT.
-- Ya no son válidas: la hora programada no autoriza el check-in, una sesión en curso se puede reservar/cancelar/cambiar,
-- y solo el solapamiento real bloquea (el traslado es advertencia). La cobertura vigente está en regression_student_flexibility.sql.
-- (Esta suite histórica ya no se ejecutaba tal cual: usa columnas retiradas como participants.birth_date.)
-- Fase 8C: Regresión de reservaciones progresivas, agenda vs. contador, histórico y ventana de check-in.
-- Un solo bloque DO, autocontenido: todo el fixture (sesiones pasadas incluidas) se inserta directo con
-- los tiempos finales, sin tocar triggers ni protecciones. Siempre termina con RAISE EXCEPTION (rollback)
-- que trae "N ok M fail: detalle".
--
-- Edición activa esperada: checkin_open_before=5, checkin_close_after=20, travel_buffer=10, max_reservations=4.
-- now() es constante dentro de la transacción; los escenarios se construyen con offsets (minutos) respecto a now().
DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_ed editions%ROWTYPE;
  v_u uuid[] := ARRAY[]::uuid[];   -- auth users, index 1..12
  v_p uuid[] := ARRAY[]::uuid[];   -- participants, index 1..12
  v_act jsonb := '{}'::jsonb;      -- code -> activity id
  v_ses jsonb := '{}'::jsonb;      -- code -> session id
  v_tok jsonb := '{}'::jsonb;      -- activity code -> qr token
  v_cred jsonb; v_rv jsonb; v_board jsonb; v_ops jsonb; v_chk jsonb; x jsonb;
  r record; v_id uuid; v_i int; v_n int; v_n2 int; v_stamps0 int;
  v_ops_base int; v_ops_base_p int;
  v_err text; v_pass int := 0; v_fail int := 0; v_res_str text := '';
BEGIN
  SELECT * INTO v_ed FROM editions WHERE id = ed;

  -- ===================== FIXTURE =====================
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt8c.coord@test.invalid', '{}', '{}', now(), now());
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES (c, 'coordinacion', 'RT8C Coord', true, 'rt8c.coord@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion');

  FOR v_i IN 1..12 LOOP
    v_id := ('00000000-0000-4000-8000-' || lpad(to_hex(x'c100'::int + v_i), 12, '0'))::uuid;
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'rt8c.p' || v_i || '@test.invalid', '{}', '{}', now(), now());
    v_u := v_u || v_id;
    INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
    VALUES (ed, 'rt8c.p' || v_i || '@test.invalid', 'RT8C P' || v_i, '2008-01-01', 'demo', true, v_id)
    RETURNING id INTO v_id;
    v_p := v_p || v_id;
    UPDATE participant_profiles SET platform_consent_version = v_ed.privacy_notice_version, platform_consent_at = now()
    WHERE participant_id = v_id;
  END LOOP;
  -- 1 Ana (check-in temprano) · 2 Pablo (agenda tras asistencia) · 3 Dora (ventana post ends_at)
  -- 4 Fede (límite exacto) · 5 Erik (ventana cerrada) · 6 Mia (credits=2) · 7-9 asistieron · 10 no-show
  -- 11 Carlos (sin reserva) · 12 Zoe (sesión en curso)

  -- Activities (un código por taller)
  FOR r IN SELECT unnest(ARRAY['A','X','Y','Y2','B','C','D','E','M','W','H','G','Hc','H2','Wp']) AS code LOOP
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (ed, v_div, 'RT8C ' || r.code, '', r.code, true) RETURNING id INTO v_id;
    v_act := v_act || jsonb_build_object(r.code, v_id);
  END LOOP;

  -- Sessions: (code, activity, start offset min, end offset min, credits, capacity)
  FOR r IN SELECT * FROM (VALUES
      ('A1',  'A',    1,    4, 1, 4),
      ('A2',  'A',   70,   90, 1, 4),
      ('X1',  'X',    8,   28, 1, 4),   -- choca con A1 + buffer (A1 termina +4, buffer hasta +14)
      ('Y1',  'Y',   14,   34, 1, 4),   -- empieza justo cuando termina A1 + buffer: compatible
      ('Y21', 'Y2',  13,   33, 1, 4),   -- un minuto antes: aún choca
      ('B1',  'B',  100,  120, 1, 4),
      ('C1',  'C',  130,  150, 1, 4),
      ('D1',  'D',  160,  180, 1, 4),
      ('E1',  'E',  190,  210, 1, 4),
      ('M1',  'M',    1,    5, 2, 4),   -- taller de 2 sellos
      ('Wd',  'W',  -25,   -5, 1, 4),   -- terminó hace 5 min (dentro de ventana de check-in)
      ('Wf',  'W',  -40,  -20, 1, 4),   -- terminó hace exactamente 20 min (último instante válido)
      ('We',  'W',  -50,  -21, 1, 4),   -- terminó hace 21 min (ventana cerrada)
      ('Wn',  'W',  400,  420, 1, 4),
      ('S1',  'H',  -50,  -30, 1, 4),   -- sesión histórica, capacidad 4
      ('S2',  'H',  300,  320, 1, 4),
      ('G1',  'G',  -25,   -5, 1, 4),   -- terminó hace 5 min
      ('Hc1', 'Hc',   3,   23, 1, 4),   -- choca con G1 + buffer (hasta +5)
      ('H21', 'H2',   6,   26, 1, 4),   -- empieza después de G1 + buffer
      ('Wp1', 'Wp', -10,   10, 1, 4),   -- en curso
      ('Wp2', 'Wp', 500,  520, 1, 4)
    ) AS t(code, act, so, eo, cr, cap)
  LOOP
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
    VALUES ((v_act->>r.act)::uuid, now() + make_interval(mins => r.so), now() + make_interval(mins => r.eo),
            r.cap, r.act, 'activa', true, r.cr) RETURNING id INTO v_id;
    v_ses := v_ses || jsonb_build_object(r.code, v_id);
  END LOOP;

  -- Credenciales QR (una por actividad) vistas como coordinación
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOR r IN SELECT unnest(ARRAY['A','M','W']) AS code LOOP
    SELECT activity_credential_display((v_act->>r.code)::uuid) INTO v_cred;
    v_tok := v_tok || jsonb_build_object(r.code, v_cred->>'qr_token');
  END LOOP;
  -- baseline del Centro de Operación (el entorno puede tener otros datos)
  v_ops := event_operations_overview();
  v_ops_base := (v_ops->'summary'->>'active_reservations')::int;
  v_ops_base_p := (v_ops->'summary'->>'participants_with_reservations')::int;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);

  -- ===================== 1. Check-in temprano: libera contador, NO libera agenda =====================
  -- Ana: reserva A1, B, C, D (límite 4 = max_reservations)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOREACH x IN ARRAY ARRAY['"A1"','"B1"','"C1"','"D1"']::jsonb[] LOOP
    v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>(x#>>'{}'))::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.res' || (x#>>'{}') || '[' || v_err || '] '; END IF;
  END LOOP;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'E1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%MAX_RESERVATIONS%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.max4[' || coalesce(v_err, 'ok') || '] '; END IF;

  -- check-in antes de ends_at (A1 termina en +4 min; la ventana abre 5 min antes)
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'A') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL AND (v_rv->>'already_registered') = 'false' AND (v_rv->>'session_id') = v_ses->>'A1'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.chkA[' || coalesce(v_err, v_rv::text) || '] '; END IF;

  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  v_n := active_reservation_count(v_p[1]);
  IF v_n = 3 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.act3[' || v_n || '] '; END IF;

  -- La asistencia NO libera la agenda: X1 (dentro de A1 + buffer) y Y21 (1 min antes del fin del buffer) siguen chocando
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'X1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SCHEDULE_CONFLICT%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.confX[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Y21')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SCHEDULE_CONFLICT%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.confY2[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- el tablero lo refleja: X1 lista a A1 en conflicts_with
  v_board := my_reservation_board();
  SELECT jsonb_array_length(s->'conflicts_with') INTO v_n FROM jsonb_array_elements(v_board->'sessions') s WHERE s->>'id' = v_ses->>'X1';
  IF v_n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.boardConf[' || coalesce(v_n::text, 'null') || '] '; END IF;
  -- terminado A1 + buffer (Y1 empieza exactamente en +14): sin conflicto, y supera el total histórico del límite
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Y1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.resY1[' || coalesce(v_err, '?') || '] '; END IF;
  v_board := my_reservation_board();
  IF (v_board->>'active_reservation_count')::int = 4 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.boardAct4[' || (v_board->>'active_reservation_count') || '] '; END IF;
  SELECT s->>'derived_status' INTO v_err FROM jsonb_array_elements(v_board->'reservations') s WHERE s->>'session_id' = v_ses->>'A1';
  IF v_err = 'completed' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.A1completed[' || coalesce(v_err, 'null') || '] '; END IF;
  -- de nuevo al límite: E1 bloqueado
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'E1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%MAX_RESERVATIONS%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.max4b[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- ALREADY_ATTENDED + reescaneo idempotente
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'A2')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%ALREADY_ATTENDED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.alreadyAtt[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- ALREADY_RESERVED: la misma sesión dos veces / cambiar hacia una sesión que ya se tiene
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'B1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%ALREADY_RESERVED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.dupSession[' || coalesce(v_err, 'ok') || '] '; END IF;
  SELECT (s->>'id')::uuid INTO v_id FROM jsonb_array_elements(v_board->'reservations') s WHERE s->>'session_id' = v_ses->>'C1';
  v_err := NULL; BEGIN PERFORM change_reservation(v_id, (v_ses->>'B1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%ALREADY_RESERVED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.changeToHeld[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'A') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL AND (v_rv->>'already_registered') = 'true' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.rescan[' || coalesce(v_err, v_rv::text) || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM attendances WHERE participant_id = v_p[1] AND activity_id = (v_act->>'A')::uuid;
  IF v_n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.oneAtt[' || v_n || '] '; END IF;
  -- total de filas vigentes (5) > límite (4): el límite es de compromisos, no del histórico
  SELECT count(*) INTO v_n FROM reservations WHERE participant_id = v_p[1] AND status = 'vigente';
  IF v_n = 5 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.vigRows5[' || v_n || '] '; END IF;

  -- Pablo: G1 terminó hace 5 min (con asistencia). Hc1 empieza en +3 (< fin + buffer = +5): choca. H21 en +6: compatible.
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[2], (v_ses->>'G1')::uuid, (v_act->>'G')::uuid, 'vigente');
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p[2], (v_ses->>'G1')::uuid, (v_act->>'G')::uuid, 1, 'qr');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[2], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Hc1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SCHEDULE_CONFLICT%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.pabloConf[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'H21')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.pabloOk[' || coalesce(v_err, '?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);

  -- ===================== 2. Ventana posterior de check-in / pérdida definitiva =====================
  -- Dora: Wd terminó hace 5 min (dentro de 20): ya no cuenta para el límite pero sigue siendo "el taller"
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[3], (v_ses->>'Wd')::uuid, (v_act->>'W')::uuid, 'vigente');
  v_n := active_reservation_count(v_p[3]);
  IF v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.doraCount0[' || v_n || '] '; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[3], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_board := my_reservation_board();
  SELECT s->>'derived_status' INTO v_err FROM jsonb_array_elements(v_board->'reservations') s WHERE s->>'session_id' = v_ses->>'Wd';
  IF v_err = 'ended' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.doraEnded[' || coalesce(v_err, 'null') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Wn')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SAME_WORKSHOP%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.doraSame[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- su check-in sigue siendo válido y usa la reservación Wd
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'W') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL AND (v_rv->>'session_id') = v_ses->>'Wd' AND (v_rv->>'already_registered') = 'false'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.doraChk[' || coalesce(v_err, v_rv::text) || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Wn')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%ALREADY_ATTENDED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.doraAlready[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);

  -- Fede: Wf terminó hace exactamente 20 min = último instante de check-in válido: sigue bloqueando el taller
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[4], (v_ses->>'Wf')::uuid, (v_act->>'W')::uuid, 'vigente');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[4], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Wn')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SAME_WORKSHOP%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.fedeSame[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT status INTO v_err FROM reservations WHERE participant_id = v_p[4] AND session_id = (v_ses->>'Wf')::uuid;
  IF v_err = 'vigente' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.fedeStillVig[' || coalesce(v_err, 'null') || '] '; END IF;

  -- Erik: We terminó hace 21 min, sin asistencia: perdida. check-in tarde; puede reservar otra sesión del taller.
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[5], (v_ses->>'We')::uuid, (v_act->>'W')::uuid, 'vigente');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[5], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_board := my_reservation_board();
  SELECT s->>'derived_status' INTO v_err FROM jsonb_array_elements(v_board->'reservations') s WHERE s->>'session_id' = v_ses->>'We';
  IF v_err = 'expired' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.erikDerived[' || coalesce(v_err, 'null') || '] '; END IF;
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'W') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%CHECKIN_TOO_LATE%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.erikLate[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Wn')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.erikResWn[' || coalesce(v_err, '?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM reservations WHERE participant_id = v_p[5] AND activity_id = (v_act->>'W')::uuid AND status = 'expirada' AND session_id = (v_ses->>'We')::uuid;
  SELECT count(*) INTO v_n2 FROM reservations WHERE participant_id = v_p[5] AND activity_id = (v_act->>'W')::uuid AND status = 'vigente';
  IF v_n = 1 AND v_n2 = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.erikExp[' || v_n || '/' || v_n2 || '] '; END IF;

  -- Sin reservación: NO_RESERVATION y ningún progreso
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[11], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'A') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%NO_RESERVATION%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.noRes[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM attendances WHERE participant_id = v_p[11];
  IF v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.carlos0[' || v_n || '] '; END IF;

  -- Sesión en curso: sigue siendo compromiso (cuenta) y bloquea el taller
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[12], (v_ses->>'Wp1')::uuid, (v_act->>'Wp')::uuid, 'vigente');
  v_n := active_reservation_count(v_p[12]);
  IF v_n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.zoeCount1[' || v_n || '] '; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[12], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_board := my_reservation_board();
  SELECT s->>'derived_status' INTO v_err FROM jsonb_array_elements(v_board->'reservations') s WHERE s->>'session_id' = v_ses->>'Wp1';
  IF v_err = 'in_progress' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.zoeInProg[' || coalesce(v_err, 'null') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'Wp2')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SAME_WORKSHOP%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.zoeSame[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);

  -- ===================== 3. Taller de 2 sellos: sellos != escaneos =====================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[6], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'M1')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.resM[' || coalesce(v_err, '?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  v_stamps0 := my_stamp_count(v_p[6]);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[6], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'M') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL AND (v_rv->>'already_registered') = 'false' AND (v_rv->>'credits_granted')::int = 2
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.scan1[' || coalesce(v_err, v_rv::text) || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM attendances WHERE participant_id = v_p[6] AND activity_id = (v_act->>'M')::uuid;
  SELECT credits_granted INTO v_n2 FROM attendances WHERE participant_id = v_p[6] AND activity_id = (v_act->>'M')::uuid;
  IF v_n = 1 AND v_n2 = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.row[' || v_n || '/' || coalesce(v_n2::text, 'null') || '] '; END IF;
  v_n := my_stamp_count(v_p[6]);
  IF v_n = v_stamps0 + 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.stamps+2[' || v_stamps0 || '->' || v_n || '] '; END IF;
  -- segundo escaneo
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[6], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN SELECT check_in(v_tok->>'M') INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL AND (v_rv->>'already_registered') = 'true' AND (v_rv->>'credits_granted')::int = 2
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.scan2[' || coalesce(v_err, v_rv::text) || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM attendances WHERE participant_id = v_p[6] AND activity_id = (v_act->>'M')::uuid;
  IF v_n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.stillOneRow[' || v_n || '] '; END IF;
  v_n := my_stamp_count(v_p[6]);
  IF v_n = v_stamps0 + 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.stillStamps2[' || v_stamps0 || '->' || v_n || '] '; END IF;

  -- ===================== 4. Histórico con no-show =====================
  -- S1 (cap 4, terminó hace 30 min, ventana cerrada): P7,P8,P9 asistieron; P10 no-show.
  FOR v_i IN 7..10 LOOP
    INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[v_i], (v_ses->>'S1')::uuid, (v_act->>'H')::uuid, 'vigente');
  END LOOP;
  FOR v_i IN 7..9 LOOP
    INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p[v_i], (v_ses->>'S1')::uuid, (v_act->>'H')::uuid, 1, 'qr');
  END LOOP;
  -- P10 tiene 3 compromisos activos (B, C, D) y después reserva otro horario del mismo taller (S2)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[10], 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOREACH x IN ARRAY ARRAY['"B1"','"C1"','"D1"']::jsonb[] LOOP
    v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>(x#>>'{}'))::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.p10res' || (x#>>'{}') || '[' || v_err || '] '; END IF;
  END LOOP;
  v_err := NULL; BEGIN PERFORM reserve_session((v_ses->>'S2')::uuid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.p10S2[' || coalesce(v_err, '?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);

  -- el no-show quedó 'expirada' y NO consume max_reservations (4 = B, C, D, S2)
  SELECT status INTO v_err FROM reservations WHERE participant_id = v_p[10] AND session_id = (v_ses->>'S1')::uuid;
  IF v_err = 'expirada' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.p10Exp[' || coalesce(v_err, 'null') || '] '; END IF;
  v_n := active_reservation_count(v_p[10]);
  IF v_n = 4 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.p10Act4[' || v_n || '] '; END IF;
  -- histórico de S1: reservados 4 (aunque una quedó expirada), asistencias 3
  v_n := session_reserved_count((v_ses->>'S1')::uuid);
  SELECT count(*) INTO v_n2 FROM attendances WHERE session_id = (v_ses->>'S1')::uuid;
  IF v_n = 4 AND v_n2 = 3 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.hist[' || v_n || '/' || v_n2 || '] '; END IF;

  -- RPC operativas (como coordinación)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_ops := event_operations_overview();
  SELECT s INTO x FROM jsonb_array_elements(v_ops->'sessions') s WHERE s->>'session_id' = v_ses->>'S1';
  IF (x->>'reserved')::int = 4 AND (x->>'attended')::int = 3 AND (x->>'remaining')::int = 0
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.opsS1[' || coalesce(x::text, 'null') || '] '; END IF;
  SELECT s INTO x FROM jsonb_array_elements(v_ops->'sessions') s WHERE s->>'session_id' = v_ses->>'S2';
  IF (x->>'reserved')::int = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.opsS2[' || coalesce(x::text, 'null') || '] '; END IF;
  v_chk := activity_checkin_overview();
  SELECT s INTO x FROM jsonb_array_elements(v_chk) s WHERE s->>'activity_id' = v_act->>'H';
  IF (x->>'total_reserved')::int = 5 AND (x->>'total_attended')::int = 3
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.chkTotals[' || coalesce(x->>'total_reserved', 'null') || '/' || coalesce(x->>'total_attended', 'null') || '] '; END IF;
  SELECT s INTO x FROM jsonb_array_elements(x->'sessions') s WHERE s->>'session_id' = v_ses->>'S1';
  IF (x->>'reserved')::int = 4 AND (x->>'attended')::int = 3
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.chkS1[' || coalesce(x::text, 'null') || '] '; END IF;

  -- summary.active_reservations = solo compromisos activos (vigente + sesión no terminada + sin asistencia):
  -- Ana 4 (B,C,D,Y1) + Pablo 1 (H21) + Dora 0 + Fede 0 + Erik 1 (Wn) + Mia 0 + P10 4 (B,C,D,S2) + Zoe 1 (Wp1 en curso) = 11
  v_n := (v_ops->'summary'->>'active_reservations')::int - v_ops_base;
  v_n2 := (v_ops->'summary'->>'participants_with_reservations')::int - v_ops_base_p;
  IF v_n = 11 AND v_n2 = 5 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.opsActive[' || v_n || '/' || v_n2 || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  -- contraste: las filas 'vigente' crudas son más (incluye reservaciones ya cumplidas o terminadas)
  SELECT count(*) INTO v_n FROM reservations WHERE participant_id = ANY (v_p) AND status = 'vigente';
  IF v_n > 11 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.rawVigente[' || v_n || '] '; END IF;

  -- ===================== 5. Seguridad / integridad =====================
  PERFORM set_config('role', 'anon', true); PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  v_err := NULL; BEGIN PERFORM active_reservation_count(v_p[1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.anon[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  v_err := NULL;
  BEGIN
    INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method)
    VALUES (v_p[1], (v_ses->>'A2')::uuid, (v_act->>'A')::uuid, 1, 'qr');
  EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%unique%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.dupAtt[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- las protecciones de producción siguen activas
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'activity_sessions_guard_reservations' AND tgenabled = 'O';
  IF v_n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.guardOn[' || v_n || '] '; END IF;

  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, coalesce(nullif(v_res_str, ''), '(none)');
END
$test$;
