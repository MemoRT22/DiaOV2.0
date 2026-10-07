-- Regresión: flexibilidad operativa del alumno (migración 20261007120000_student_operational_flexibility).
-- Ejecutar como UN solo bloque, DESPUÉS de la migración. Fixtures propios y demo; SIEMPRE termina con una excepción
-- (STUDENT_FLEX_OK n checks), así que todo se revierte. Falla rápido: STUDENT_FLEX_FAIL[nombre].
-- Los tiempos son relativos a now() (constante dentro de la transacción).

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

-- Crea una actividad con una sesión; start/end en minutos relativos a now(). Devuelve ids y credencial en claro.
CREATE FUNCTION pg_temp.mk(p_title text, p_start numeric, p_end numeric, p_cap int DEFAULT 30,
                           p_status text DEFAULT 'activa', p_real boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE v_act uuid; v_ses uuid; v_cred jsonb; v_div uuid;
BEGIN
  SELECT id INTO v_div FROM divisions WHERE is_demo = NOT p_real ORDER BY name LIMIT 1;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type)
  VALUES (active_edition_id(), v_div, 'SF ' || p_title, '', 'Salón SF', NOT p_real, 'academica') RETURNING id INTO v_act;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + make_interval(secs => p_start * 60), now() + make_interval(secs => p_end * 60), p_cap, 'Salón SF', p_status, NOT p_real, 1)
  RETURNING id INTO v_ses;
  v_cred := rotate_activity_credential(v_act);
  RETURN jsonb_build_object('act', v_act, 'ses', v_ses, 'qr', v_cred->>'qr_token', 'code', v_cred->>'manual_code');
END
$f$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  v_career uuid := (SELECT id FROM careers WHERE is_demo ORDER BY name LIMIT 1);
  u text[] := ARRAY[gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
                    gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text];
  pid uuid[] := '{}'; i int;
  ua text; ub text; uc text; ud text; ue text; uf text; ug text; uh text;
  n int := 0; v text; j jsonb; res_a text; res_b text; msgs0 int; msgs1 int;
  -- sesiones
  f1 jsonb; f2 jsonb; f3 jsonb; f4 jsonb; p1 jsonb; p2 jsonb; e1 jsonb; fl jsonb; cx jsonb; rl jsonb;
  w10a jsonb; w10b jsonb; w11a jsonb; w11b jsonb; w12a jsonb; w12b jsonb; w13 jsonb; f5 jsonb; q1 jsonb;
  g jsonb[] := '{}'; h jsonb[] := '{}';
  r_a_p1 text; r_b_f1 text; r_c_p2 text; r_f_p2 text; r_e_f2 text; r_e_f3 text; r_f_new text; r_a_e1 text;
BEGIN
  -- ---------- usuarios y participantes (A..H), todos demo y con Aviso aceptado ----------
  FOR i IN 1..8 LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (u[i]::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sf.' || i || '@test.invalid', '{}', '{}', now(), now());
    INSERT INTO participants (edition_id, email, full_name, phone, high_school, initial_career_id, origin, is_demo, auth_user_id, forms_consent, forms_consent_at, forms_consent_version)
    VALUES (ed, 'sf.' || i || '@test.invalid', 'SF Alumno ' || i, '9980000000', 'Otra escuela', v_career, 'demo', true, u[i]::uuid, true, now(), 'v1');
  END LOOP;
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id WHERE pp.participant_id = p.id AND p.email LIKE 'sf.%@test.invalid';
  ua := u[1]; ub := u[2]; uc := u[3]; ud := u[4]; ue := u[5]; uf := u[6]; ug := u[7]; uh := u[8];
  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL,
    max_reservations = 4, travel_buffer_minutes = 10, checkin_open_before_minutes = 5, checkin_close_after_minutes = 20 WHERE id = ed;

  -- ---------- catálogo ----------
  f1 := pg_temp.mk('F1', 60, 90);      -- futura
  f2 := pg_temp.mk('F2', 90, 120);     -- consecutiva exacta a F1
  f3 := pg_temp.mk('F3', 125, 155);    -- 5 min tras F2 (menos que el traslado recomendado)
  f4 := pg_temp.mk('F4', 100, 130);    -- se SOLAPA con F2
  f5 := pg_temp.mk('F5', 500, 530);
  p1 := pg_temp.mk('P1', -10, 20);     -- en curso
  p2 := pg_temp.mk('P2', -5, 25);      -- en curso
  e1 := pg_temp.mk('E1', -60, -30);    -- terminó hace 30 min (más que el antiguo cierre de 20)
  fl := pg_temp.mk('LLENA', 200, 230, 1);
  cx := pg_temp.mk('CANCELADA', 300, 330, 30, 'cancelada');
  rl := pg_temp.mk('REAL', 10, 40, 30, 'activa', true);
  FOR i IN 1..5 LOOP g := g || pg_temp.mk('G' || i, 600 + i * 100, 630 + i * 100); END LOOP;

  -- ======================= CHECK-IN =======================
  -- 1) reserva válida + QR durante la sesión
  r_a_p1 := pg_temp.run(ua, format($q$select reserve_session(%L)$q$, p1->>'ses'));
  IF r_a_p1 LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar sesión en curso: %]', r_a_p1; END IF;
  v := pg_temp.run(ua, format($q$select check_in(%L)$q$, p1->>'qr'));
  IF v LIKE 'ERR:%' OR (v::jsonb->>'already_registered') <> 'false' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[check-in durante sesión: %]', v; END IF;
  n := n + 1;

  -- 4) duplicado: idempotente, sin segunda asistencia
  v := pg_temp.run(ua, format($q$select check_in(%L)$q$, p1->>'code'));
  IF v LIKE 'ERR:%' OR (v::jsonb->>'already_registered') <> 'true' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[idempotencia: %]', v; END IF;
  IF (SELECT count(*) FROM attendances WHERE participant_id = (SELECT id FROM participants WHERE auth_user_id = ua::uuid)) <> 1 THEN
    RAISE EXCEPTION 'STUDENT_FLEX_FAIL[doble asistencia]'; END IF;
  n := n + 2;

  -- 2) QR válido mucho antes de ends_at (sesión futura, 90 min antes del fin)
  v := pg_temp.run(ub, format($q$select reserve_session(%L)$q$, f1->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar futura: %]', v; END IF;
  r_b_f1 := v::jsonb->>'reservation_id';
  v := pg_temp.run(ub, format($q$select check_in(%L)$q$, f1->>'qr'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[check-in muy temprano: %]', v; END IF;
  n := n + 2;

  -- 3) QR válido después del antiguo cierre (sesión terminada hace 30 min > 20)
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT p.id, (e1->>'ses')::uuid, (e1->>'act')::uuid FROM participants p WHERE p.auth_user_id = ua::uuid RETURNING id::text INTO r_a_e1;
  v := pg_temp.run(ua, format($q$select check_in(%L)$q$, e1->>'qr'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[check-in tardío: %]', v; END IF;
  n := n + 1;

  -- 5) código inválido, 6) sin reservación, 7) sesión cancelada, 8) demo/real
  IF pg_temp.run(uc, $q$select check_in('ZZZZZZ')$q$) <> 'ERR:INVALID_CREDENTIAL' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[código inválido]'; END IF;
  IF pg_temp.run(uc, format($q$select check_in(%L)$q$, p1->>'qr')) <> 'ERR:NO_RESERVATION' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[sin reservación]'; END IF;
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT p.id, (cx->>'ses')::uuid, (cx->>'act')::uuid FROM participants p WHERE p.auth_user_id = uh::uuid;
  IF pg_temp.run(uh, format($q$select check_in(%L)$q$, cx->>'qr')) <> 'ERR:SESSION_CANCELLED' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[sesión cancelada]'; END IF;
  IF pg_temp.run(uh, format($q$select check_in(%L)$q$, rl->>'qr')) <> 'ERR:INVALID_CREDENTIAL' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[demo vs real]'; END IF;
  n := n + 4;

  -- ======================= RESERVAR =======================
  -- 10) en curso → permitido; 11) terminada → bloqueada
  r_c_p2 := pg_temp.run(uc, format($q$select reserve_session(%L)$q$, p2->>'ses'));
  IF r_c_p2 LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar en curso: %]', r_c_p2; END IF;
  r_c_p2 := r_c_p2::jsonb->>'reservation_id';
  IF pg_temp.run(uc, format($q$select reserve_session(%L)$q$, e1->>'ses')) <> 'ERR:SESSION_ENDED' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar terminada]'; END IF;
  n := n + 2;

  -- 12) llena: B toma el único lugar; C no puede (sin overbooking)
  IF pg_temp.run(ub, format($q$select reserve_session(%L)$q$, fl->>'ses')) LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar última plaza]'; END IF;
  IF pg_temp.run(uc, format($q$select reserve_session(%L)$q$, fl->>'ses')) <> 'ERR:SESSION_FULL' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[sesión llena]'; END IF;
  n := n + 2;

  -- 13) quinto compromiso activo → bloqueado
  FOR i IN 1..4 LOOP
    IF pg_temp.run(ud, format($q$select reserve_session(%L)$q$, g[i]->>'ses')) LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar G%]', i; END IF;
  END LOOP;
  v := pg_temp.run(ud, format($q$select reserve_session(%L)$q$, g[5]->>'ses'));
  IF v <> 'ERR:MAX_RESERVATIONS' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[quinto compromiso: %]', v; END IF;
  n := n + 1;

  -- 14) actividad ya asistida → bloqueada
  IF pg_temp.run(ua, format($q$select reserve_session(%L)$q$, p1->>'ses')) <> 'ERR:ALREADY_ATTENDED' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[actividad asistida]'; END IF;
  n := n + 1;

  -- ======================= HORARIOS =======================
  -- 15) solapamiento real → bloqueado
  v := pg_temp.run(ue, format($q$select reserve_session(%L)$q$, f2->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[reservar F2: %]', v; END IF;
  r_e_f2 := v::jsonb->>'reservation_id';
  IF pg_temp.run(ue, format($q$select reserve_session(%L)$q$, f4->>'ses')) <> 'ERR:SCHEDULE_CONFLICT' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[solapamiento real]'; END IF;
  -- 16) consecutivas exactas → permitido
  v := pg_temp.run(ue, format($q$select reserve_session(%L)$q$, f1->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[consecutivas exactas: %]', v; END IF;
  -- 17) menos de travel_buffer sin solapar → permitido
  v := pg_temp.run(ue, format($q$select reserve_session(%L)$q$, f3->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[traslado ajustado: %]', v; END IF;
  r_e_f3 := v::jsonb->>'reservation_id';
  n := n + 4;
  -- 18) el tablero lo marca como traslado ajustado (y NO como conflicto)
  v := pg_temp.run(ue, format($q$select (s->'tight_transfer_with')::text || '|' || (s->'conflicts_with')::text from jsonb_array_elements(my_reservation_board()->'sessions') s where s->>'id' = %L$q$, f3->>'ses'));
  IF v NOT LIKE '[%' OR v NOT LIKE '%|[]' OR position(r_e_f2 in v) = 0 THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[tablero traslado ajustado: %]', v; END IF;
  v := pg_temp.run(ue, format($q$select (s->'conflicts_with')::text from jsonb_array_elements(my_reservation_board()->'sessions') s where s->>'id' = %L$q$, f4->>'ses'));
  IF v NOT LIKE '[%' OR v = '[]' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[tablero conflicto real: %]', v; END IF;
  n := n + 2;

  -- ======================= CANCELAR / CAMBIAR =======================
  -- 23) Realtime: cancelar emite un mensaje de disponibilidad
  SELECT count(*) INTO msgs0 FROM realtime.messages WHERE topic = 'availability:' || ed::text;
  -- 19) cancelar sesión en curso sin asistencia → OK
  v := pg_temp.run(uc, format($q$select cancel_reservation(%L)$q$, r_c_p2));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[cancelar en curso: %]', v; END IF;
  IF (SELECT status FROM reservations WHERE id = r_c_p2::uuid) <> 'cancelada_alumno' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[estado tras cancelar]'; END IF;
  SELECT count(*) INTO msgs1 FROM realtime.messages WHERE topic = 'availability:' || ed::text;
  IF msgs1 <= msgs0 THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[sin Realtime al cancelar %/%]', msgs0, msgs1; END IF;
  n := n + 3;
  -- 20) cancelar con asistencia → bloqueado
  v := pg_temp.run(ua, format($q$select cancel_reservation(%L)$q$, r_a_p1::jsonb->>'reservation_id'));
  IF v <> 'ERR:ALREADY_ATTENDED' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[cancelar con asistencia: %]', v; END IF;
  n := n + 1;

  -- 21) cambiar sesión en curso sin asistencia → OK (F cambia P2 → futura F5)
  v := pg_temp.run(uf, format($q$select reserve_session(%L)$q$, p2->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[F reserva P2: %]', v; END IF;
  r_f_p2 := v::jsonb->>'reservation_id';
  SELECT count(*) INTO msgs0 FROM realtime.messages WHERE topic = 'availability:' || ed::text;
  v := pg_temp.run(uf, format($q$select change_reservation(%L, %L)$q$, r_f_p2, f5->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[cambiar en curso: %]', v; END IF;
  r_f_new := v::jsonb->>'reservation_id';
  IF (SELECT status FROM reservations WHERE id = r_f_p2::uuid) <> 'cambiada' OR (SELECT status FROM reservations WHERE id = r_f_new::uuid) <> 'vigente' THEN
    RAISE EXCEPTION 'STUDENT_FLEX_FAIL[estados tras cambio]'; END IF;
  -- 23) Realtime en vieja y nueva sesión
  SELECT count(*) INTO msgs1 FROM realtime.messages WHERE topic = 'availability:' || ed::text;
  IF msgs1 - msgs0 < 2 THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[Realtime en cambio %]', msgs1 - msgs0; END IF;
  n := n + 3;
  -- el destino también puede estar en curso: F5 → P1 (aún no asistida por F)
  v := pg_temp.run(uf, format($q$select change_reservation(%L, %L)$q$, r_f_new, p1->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[cambiar a sesión en curso: %]', v; END IF;
  r_f_new := v::jsonb->>'reservation_id';
  n := n + 1;
  -- 22) cambio fallido por cupo conserva la reservación anterior (P1 → LLENA)
  v := pg_temp.run(uf, format($q$select change_reservation(%L, %L)$q$, r_f_new, fl->>'ses'));
  IF v <> 'ERR:SESSION_FULL' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[cambio a llena: %]', v; END IF;
  IF (SELECT status FROM reservations WHERE id = r_f_new::uuid) <> 'vigente' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[se perdió la reservación anterior]'; END IF;
  n := n + 2;

  -- ======================= MISMO TALLER EN OTRO HORARIO =======================
  -- 24) mientras la primera sigue en curso → SAME_WORKSHOP
  w10a := pg_temp.mk('W10', -5, 25);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES ((w10a->>'act')::uuid, now() + interval '200 minutes', now() + interval '230 minutes', 30, 'Salón SF', 'activa', true, 1)
  RETURNING jsonb_build_object('ses', id)::jsonb INTO w10b;
  IF pg_temp.run(ug, format($q$select reserve_session(%L)$q$, w10a->>'ses')) LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[G reserva W10 en curso]'; END IF;
  v := pg_temp.run(ug, format($q$select reserve_session(%L)$q$, w10b->>'ses'));
  IF v <> 'ERR:SAME_WORKSHOP' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[misma actividad en curso: %]', v; END IF;
  n := n + 1;

  -- 25) primera ya terminada y sin asistencia → se puede reservar la segunda; la anterior queda `expirada` (historial)
  w11a := pg_temp.mk('W11', -60, -30);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES ((w11a->>'act')::uuid, now() + interval '400 minutes', now() + interval '430 minutes', 30, 'Salón SF', 'activa', true, 1)
  RETURNING jsonb_build_object('ses', id)::jsonb INTO w11b;
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT p.id, (w11a->>'ses')::uuid, (w11a->>'act')::uuid FROM participants p WHERE p.auth_user_id = ub::uuid;
  v := pg_temp.run(ub, format($q$select reserve_session(%L)$q$, w11b->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[misma actividad tras terminar: %]', v; END IF;
  IF (SELECT status FROM reservations WHERE session_id = (w11a->>'ses')::uuid AND participant_id = (SELECT id FROM participants WHERE auth_user_id = ub::uuid)) <> 'expirada' THEN
    RAISE EXCEPTION 'STUDENT_FLEX_FAIL[la anterior no se archivó como expirada]'; END IF;
  n := n + 2;

  -- 26) check-in con reservación pasada (expirada) + nueva vigente futura: elige la sesión pasada más reciente
  v := pg_temp.run(ub, format($q$select check_in(%L)$q$, w11a->>'qr'));
  IF v LIKE 'ERR:%' OR (v::jsonb->>'session_id') <> (w11a->>'ses') THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[elección pasada vs futura: %]', v; END IF;
  -- 27) una asistencia por actividad: no se puede insertar otra para la misma actividad
  v := pg_temp.run('postgres', format($q$insert into attendances (participant_id, session_id, activity_id, credits_granted, method)
      select p.id, %L::uuid, %L::uuid, 1, 'qr' from participants p where p.auth_user_id = %L::uuid$q$, w11b->>'ses', w11a->>'act', ub));
  IF v NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[doble asistencia por actividad]'; END IF;
  n := n + 2;

  -- elección determinista: sesión en curso preferida sobre una pasada (expirada) de la misma actividad
  w12a := pg_temp.mk('W12', -60, -30);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES ((w12a->>'act')::uuid, now() - interval '5 minutes', now() + interval '25 minutes', 30, 'Salón SF', 'activa', true, 1)
  RETURNING jsonb_build_object('ses', id)::jsonb INTO w12b;
  INSERT INTO reservations (participant_id, session_id, activity_id, status, ended_at)
  SELECT p.id, (w12a->>'ses')::uuid, (w12a->>'act')::uuid, 'expirada', now() FROM participants p WHERE p.auth_user_id = uc::uuid;
  v := pg_temp.run(uc, format($q$select reserve_session(%L)$q$, w12b->>'ses'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[C reserva W12 en curso: %]', v; END IF;
  v := pg_temp.run(uc, format($q$select check_in(%L)$q$, w12a->>'qr'));
  IF v LIKE 'ERR:%' OR (v::jsonb->>'session_id') <> (w12b->>'ses') THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[elección en curso: %]', v; END IF;
  n := n + 1;

  -- ======================= LÍMITE DE 4 =======================
  -- 28) el check-in libera el compromiso dentro del máximo; 29) puede reservar otro
  q1 := pg_temp.mk('Q1', 1300, 1330);
  FOR i IN 1..3 LOOP h := h || pg_temp.mk('H' || i, 700 + i * 100, 730 + i * 100); END LOOP;
  v := pg_temp.run(uf, format($q$select reserve_session(%L)$q$, q1->>'ses'));  -- F ya tiene P1 + (F5 cambiada) → activa: P1; suma Q1
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[F reserva Q1: %]', v; END IF;
  FOR i IN 1..2 LOOP
    IF pg_temp.run(uf, format($q$select reserve_session(%L)$q$, h[i]->>'ses')) LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[F reserva H%]', i; END IF;
  END LOOP;
  IF pg_temp.run(uf, format($q$select reserve_session(%L)$q$, h[3]->>'ses')) <> 'ERR:MAX_RESERVATIONS' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[F debía estar en 4 de 4]'; END IF;
  v := pg_temp.run(uf, format($q$select check_in(%L)$q$, q1->>'qr'));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[F check-in Q1: %]', v; END IF;
  IF (SELECT active_reservation_count(id) FROM participants WHERE auth_user_id = uf::uuid) <> 3 THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[el check-in no liberó el compromiso]'; END IF;
  IF pg_temp.run(uf, format($q$select reserve_session(%L)$q$, h[3]->>'ses')) LIKE 'ERR:%' THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[no pudo reservar otro tras completar]'; END IF;
  n := n + 3;

  -- ======================= SESIÓN TERMINADA: ya no se puede cancelar/cambiar =======================
  v := pg_temp.run(ua, format($q$select cancel_reservation(%L)$q$, r_a_e1));
  IF v NOT IN ('ERR:ALREADY_ATTENDED', 'ERR:SESSION_ENDED') THEN RAISE EXCEPTION 'STUDENT_FLEX_FAIL[cancelar terminada: %]', v; END IF;
  n := n + 1;

  RAISE EXCEPTION 'STUDENT_FLEX_OK % checks', n;
END
$test$;
