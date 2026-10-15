-- Regresión: tolerancia de inscripción según la duración del taller
-- (migración 20261014220000_enrollment_tolerance_by_duration).
-- Ejecutar como UN solo bloque, DESPUÉS de la migración, en una base local/descartable. Fixtures propios y demo;
-- SIEMPRE termina con una excepción (ENROLLMENT_TOLERANCE_OK n checks), así que todo se revierte.
-- Falla rápido: ENROLLMENT_TOLERANCE_FAIL[nombre].
--
-- now() es constante dentro de la transacción, así que los límites se prueban de forma exacta:
-- una sesión que empezó hace exactamente `tolerancia` minutos está EN el límite (permitida) y una que empezó
-- un microsegundo antes ya está fuera.
--   15 min -> 5 min · 30 min -> 10 min · 60 min -> 20 min

CREATE FUNCTION pg_temp.run(who text, q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  IF who IS NOT NULL AND who <> 'postgres' THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', who, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
  BEGIN
    IF q ~* '^\s*(select|with)' THEN EXECUTE q INTO v; v := coalesce(nullif(v, ''), 'ok'); ELSE EXECUTE q; v := 'ok'; END IF;
  EXCEPTION WHEN others THEN v := 'ERR:' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
END
$f$;

-- Compara y falla con el nombre del check. Devuelve 1 para poder contar.
CREATE FUNCTION pg_temp.expect(p_name text, p_got text, p_want text) RETURNS int
LANGUAGE plpgsql AS $f$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'ENROLLMENT_TOLERANCE_FAIL[%]: esperado %, obtenido %', p_name, p_want, p_got;
  END IF;
  RETURN 1;
END
$f$;

-- Sesión de `p_dur` minutos que empezó (o empezará) `p_off` respecto de now().
CREATE FUNCTION pg_temp.mk(p_title text, p_off interval, p_dur int, p_cap int DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE v_act uuid; v_ses uuid; v_cred jsonb; v_div uuid;
BEGIN
  SELECT id INTO v_div FROM divisions WHERE is_demo ORDER BY name LIMIT 1;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type)
  VALUES (active_edition_id(), v_div, 'ET ' || p_title, '', 'Salón ET', true, 'academica') RETURNING id INTO v_act;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + p_off, now() + p_off + make_interval(mins => p_dur), p_cap, 'Salón ET', 'activa', true, 1)
  RETURNING id INTO v_ses;
  v_cred := rotate_activity_credential(v_act);
  RETURN jsonb_build_object('act', v_act, 'ses', v_ses, 'qr', v_cred->>'qr_token', 'code', v_cred->>'manual_code');
END
$f$;

-- Alumno demo con consentimientos; devuelve su auth uid como texto.
CREATE FUNCTION pg_temp.mkp(p_label text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v_u uuid := gen_random_uuid(); v_career uuid := (SELECT id FROM careers WHERE is_demo ORDER BY name LIMIT 1);
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'et.' || lower(p_label) || '@test.invalid', '{}', '{}', now(), now());
  INSERT INTO participants (edition_id, email, full_name, phone, high_school, initial_career_id, origin, is_demo, auth_user_id, forms_consent, forms_consent_at, forms_consent_version)
  VALUES (active_edition_id(), 'et.' || lower(p_label) || '@test.invalid', 'ET ' || p_label, '9980000000', 'Otra escuela', v_career, 'demo', true, v_u, true, now(), 'v1');
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id WHERE pp.participant_id = p.id AND p.auth_user_id = v_u;
  RETURN v_u::text;
END
$f$;

CREATE FUNCTION pg_temp.pid(p_uid text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM participants WHERE auth_user_id = p_uid::uuid $f$;

-- Reservaciones de un alumno (cualquier estado) y las vigentes.
CREATE FUNCTION pg_temp.res_count(p_uid text, p_ses jsonb DEFAULT NULL) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM reservations WHERE participant_id = pg_temp.pid(p_uid)
    AND (p_ses IS NULL OR session_id = (p_ses->>'ses')::uuid) $f$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  n int := 0; v text; j jsonb; i int; d int; t numeric;
  u text; ux text; uy text;
  s jsonb; sa jsonb; sb jsonb; sc jsonb; sx jsonb; sy jsonb;
  durs int[] := ARRAY[15, 30, 60];
  rid text; rid2 text; r_before int; seats_before int;
  win_open timestamptz; win_close timestamptz; v_car uuid;
BEGIN
  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL,
    max_reservations = 4, travel_buffer_minutes = 10 WHERE id = ed;

  -- ===== 0) la regla en un solo lugar: 15 → 5, 30 → 10, 60 → 20 minutos; sin acceso para el cliente =====
  n := n + pg_temp.expect('deadline 15', (SELECT (session_enrollment_deadline(now(), now() + interval '15 min') - now())::text), '00:05:00');
  n := n + pg_temp.expect('deadline 30', (SELECT (session_enrollment_deadline(now(), now() + interval '30 min') - now())::text), '00:10:00');
  n := n + pg_temp.expect('deadline 60', (SELECT (session_enrollment_deadline(now(), now() + interval '60 min') - now())::text), '00:20:00');
  u := pg_temp.mkp('acl');
  n := n + pg_temp.expect('helper no ejecutable por alumnos',
    (pg_temp.run(u, $q$select session_enrollment_deadline(now(), now())::text$q$) LIKE 'ERR:permission denied%')::text, 'true');
  n := n + pg_temp.expect('assert_reservable sigue cerrada a alumnos',
    (pg_temp.run(u, $q$select 1 from assert_reservable(gen_random_uuid(), gen_random_uuid(), null)$q$) LIKE 'ERR:permission denied%')::text, 'true');

  -- ===== 1) límites por duración: antes, al iniciar, a mitad, EN el límite, y justo después =====
  FOREACH d IN ARRAY durs LOOP
    t := d / 3.0;  -- 5, 10, 20 minutos
    -- 1 minuto antes del inicio
    s := pg_temp.mk(d || '-antes', interval '1 minute', d);
    u := pg_temp.mkp(d || 'antes');
    v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
    n := n + pg_temp.expect(d || ' min: un minuto antes reserva', (left(v, 4) <> 'ERR:')::text, 'true');
    -- exactamente al comenzar
    s := pg_temp.mk(d || '-inicio', interval '0', d);
    u := pg_temp.mkp(d || 'inicio');
    v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
    n := n + pg_temp.expect(d || ' min: al comenzar reserva', (left(v, 4) <> 'ERR:')::text, 'true');
    -- a la mitad de la tolerancia
    s := pg_temp.mk(d || '-mitad', make_interval(secs => -t * 30), d);
    u := pg_temp.mkp(d || 'mitad');
    v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
    n := n + pg_temp.expect(d || ' min: a mitad de la tolerancia reserva', (left(v, 4) <> 'ERR:')::text, 'true');
    -- EXACTAMENTE en el límite: todavía permitido
    s := pg_temp.mk(d || '-limite', make_interval(secs => -t * 60), d);
    u := pg_temp.mkp(d || 'limite');
    v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
    n := n + pg_temp.expect(d || ' min: exactamente en el límite reserva', (left(v, 4) <> 'ERR:')::text, 'true');
    n := n + pg_temp.expect(d || ' min: la reservación del límite quedó vigente',
      (SELECT status FROM reservations WHERE participant_id = pg_temp.pid(u) AND session_id = (s->>'ses')::uuid), 'vigente');
    -- un segundo después del límite: rechazada, sin dejar rastro
    s := pg_temp.mk(d || '-pasado', make_interval(secs => -t * 60 - 1), d);
    u := pg_temp.mkp(d || 'pasado');
    v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
    n := n + pg_temp.expect(d || ' min: +1 s rechaza', v, 'ERR:ENROLLMENT_CLOSED');
    n := n + pg_temp.expect(d || ' min: +1 s no crea reservación', pg_temp.res_count(u)::text, '0');
    -- un microsegundo después del límite también
    s := pg_temp.mk(d || '-micro', make_interval(secs => -t * 60) - interval '1 microsecond', d);
    u := pg_temp.mkp(d || 'micro');
    v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
    n := n + pg_temp.expect(d || ' min: +1 µs rechaza', v, 'ERR:ENROLLMENT_CLOSED');
  END LOOP;

  -- Ejemplo del enunciado: 10:00 → 15 min hasta 10:05, 30 min hasta 10:10, 60 min hasta 10:20 (hora de Cancún).
  n := n + pg_temp.expect('ejemplo 10:00/15', (SELECT to_char(session_enrollment_deadline(ts, ts + interval '15 min') AT TIME ZONE 'America/Cancun', 'HH24:MI:SS')
    FROM (SELECT (date '2026-10-15' + time '10:00') AT TIME ZONE 'America/Cancun' AS ts) q), '10:05:00');
  n := n + pg_temp.expect('ejemplo 10:00/30', (SELECT to_char(session_enrollment_deadline(ts, ts + interval '30 min') AT TIME ZONE 'America/Cancun', 'HH24:MI:SS')
    FROM (SELECT (date '2026-10-15' + time '10:00') AT TIME ZONE 'America/Cancun' AS ts) q), '10:10:00');
  n := n + pg_temp.expect('ejemplo 10:00/60', (SELECT to_char(session_enrollment_deadline(ts, ts + interval '60 min') AT TIME ZONE 'America/Cancun', 'HH24:MI:SS')
    FROM (SELECT (date '2026-10-15' + time '10:00') AT TIME ZONE 'America/Cancun' AS ts) q), '10:20:00');

  -- ===== 2) sesión terminada: sigue siendo SESSION_ENDED (no cambia el contrato existente) =====
  s := pg_temp.mk('terminada', interval '-90 minutes', 30);
  u := pg_temp.mkp('terminada');
  n := n + pg_temp.expect('terminada', pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses')), 'ERR:SESSION_ENDED');

  -- ===== 3) cupo: lleno dentro y fuera de tolerancia se rechaza siempre =====
  s := pg_temp.mk('llena-dentro', interval '-5 minutes', 30, 1);
  u := pg_temp.mkp('llenaA'); ux := pg_temp.mkp('llenaB');
  v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
  n := n + pg_temp.expect('última plaza dentro de tolerancia', (left(v, 4) <> 'ERR:')::text, 'true');
  n := n + pg_temp.expect('llena dentro de tolerancia', pg_temp.run(ux, format($q$select reserve_session(%L)$q$, s->>'ses')), 'ERR:SESSION_FULL');
  s := pg_temp.mk('llena-fuera', interval '-15 minutes', 30, 1);
  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES (pg_temp.pid(u), (s->>'ses')::uuid, (s->>'act')::uuid);
  v := pg_temp.run(ux, format($q$select reserve_session(%L)$q$, s->>'ses'));
  n := n + pg_temp.expect('llena y fuera de tolerancia se rechaza', (v IN ('ERR:ENROLLMENT_CLOSED', 'ERR:SESSION_FULL'))::text, 'true');
  n := n + pg_temp.expect('llena: no se creó ninguna reservación', pg_temp.res_count(ux)::text, '0');
  n := n + pg_temp.expect('llena: no hubo sobrecupo', (SELECT session_reserved_count((s->>'ses')::uuid))::text, '1');

  -- ===== 4) QR sin reservación: se rechaza, no se reserva sola y no hay asistencia (dentro y fuera de tolerancia) =====
  sa := pg_temp.mk('qr-dentro', interval '-3 minutes', 30);
  sb := pg_temp.mk('qr-fuera', interval '-20 minutes', 30);
  u := pg_temp.mkp('qrsin');
  -- Regla vigente (2026-10-15): sin reservación TAMBIÉN cuenta (dentro y fuera de tolerancia), sin crear reservación; una asistencia por actividad.
  n := n + pg_temp.expect('QR sin reservación (aún en tolerancia) cuenta',
    (SELECT CASE WHEN r LIKE 'ERR:%' THEN r ELSE r::jsonb->>'without_reservation' END FROM (SELECT pg_temp.run(u, format($q$select check_in(%L)$q$, sa->>'qr')) r) t), 'true');
  n := n + pg_temp.expect('QR sin reservación (fuera de tolerancia) cuenta',
    (SELECT CASE WHEN r LIKE 'ERR:%' THEN r ELSE r::jsonb->>'without_reservation' END FROM (SELECT pg_temp.run(u, format($q$select check_in(%L)$q$, sb->>'qr')) r) t), 'true');
  n := n + pg_temp.expect('código manual después del QR: ya registrada',
    (SELECT CASE WHEN r LIKE 'ERR:%' THEN r ELSE r::jsonb->>'already_registered' END FROM (SELECT pg_temp.run(u, format($q$select check_in(%L)$q$, sb->>'code')) r) t), 'true');
  n := n + pg_temp.expect('escanear no genera reservación', pg_temp.res_count(u)::text, '0');
  n := n + pg_temp.expect('dos asistencias sin reservación (una por actividad)',
    (SELECT count(*) FROM attendances WHERE participant_id = pg_temp.pid(u) AND reservation_id IS NULL)::text, '2');
  DELETE FROM attendances WHERE participant_id = pg_temp.pid(u);  -- el resto del escenario parte sin asistencias

  -- ===== 5) reservar dentro de tolerancia y luego escanear =====
  s := pg_temp.mk('reserva-y-qr', interval '-10 minutes', 30);   -- EN el límite exacto
  u := pg_temp.mkp('reservayqr');
  v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
  n := n + pg_temp.expect('reserva en el límite exacto', (left(v, 4) <> 'ERR:')::text, 'true');
  v := pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr'));
  n := n + pg_temp.expect('escanea tras reservar', (left(v, 4) <> 'ERR:' AND v::jsonb->>'already_registered' = 'false')::text, 'true');
  n := n + pg_temp.expect('sello de 30 min = 1', (v::jsonb->>'credits_granted'), '1');

  -- ===== 6) la reservación existente se conserva y su QR NO depende del horario ni de la tolerancia =====
  sa := pg_temp.mk('existente-fuera', interval '-25 minutes', 60);   -- 60 min: tolerancia 20, ya pasó; en curso
  sb := pg_temp.mk('existente-terminada', interval '-120 minutes', 30);  -- terminó hace 90 min
  u := pg_temp.mkp('existentes');
  INSERT INTO reservations (participant_id, session_id, activity_id)
  VALUES (pg_temp.pid(u), (sa->>'ses')::uuid, (sa->>'act')::uuid) RETURNING id::text INTO rid;
  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES (pg_temp.pid(u), (sb->>'ses')::uuid, (sb->>'act')::uuid);
  -- volver a reservar la misma sesión no la toca ni la duplica
  n := n + pg_temp.expect('existente: reservar de nuevo = ALREADY_RESERVED', pg_temp.run(u, format($q$select reserve_session(%L)$q$, sa->>'ses')), 'ERR:ALREADY_RESERVED');
  n := n + pg_temp.expect('existente: sigue vigente y con el mismo id',
    (SELECT status || ':' || (id::text = rid)::text FROM reservations WHERE id = rid::uuid), 'vigente:true');
  n := n + pg_temp.expect('existente: una sola reservación en esa sesión', pg_temp.res_count(u, sa)::text, '1');
  -- el tablero la muestra como propia aunque la inscripción ya cerró
  v := pg_temp.run(u, format($q$select (s->>'my_reservation_id') || ':' || (s->>'enrollment_open') from jsonb_array_elements(my_reservation_board()->'sessions') s where s->>'id' = %L$q$, sa->>'ses'));
  n := n + pg_temp.expect('existente: el tablero la conserva (inscripción cerrada)', v, rid || ':false');
  -- QR en curso fuera de tolerancia
  v := pg_temp.run(u, format($q$select check_in(%L)$q$, sa->>'qr'));
  n := n + pg_temp.expect('QR con reservación previa, fuera de tolerancia', (left(v, 4) <> 'ERR:' AND v::jsonb->>'already_registered' = 'false')::text, 'true');
  n := n + pg_temp.expect('60 min otorgan 2 sellos', (v::jsonb->>'credits_granted'), '2');
  -- QR con la sesión ya terminada
  v := pg_temp.run(u, format($q$select check_in(%L)$q$, sb->>'qr'));
  n := n + pg_temp.expect('QR después de terminar el taller con reservación previa', (left(v, 4) <> 'ERR:' AND v::jsonb->>'already_registered' = 'false')::text, 'true');
  n := n + pg_temp.expect('dos asistencias registradas', (SELECT count(*) FROM attendances WHERE participant_id = pg_temp.pid(u))::text, '2');

  -- cancelar una reservación fuera de tolerancia sigue permitido mientras la sesión no termine (regla actual)
  sa := pg_temp.mk('cancelable', interval '-12 minutes', 30);
  u := pg_temp.mkp('cancela');
  INSERT INTO reservations (participant_id, session_id, activity_id)
  VALUES (pg_temp.pid(u), (sa->>'ses')::uuid, (sa->>'act')::uuid) RETURNING id::text INTO rid;
  n := n + pg_temp.expect('cancelar fuera de tolerancia sigue permitido', (left(pg_temp.run(u, format($q$select cancel_reservation(%L)$q$, rid)), 4) <> 'ERR:')::text, 'true');
  n := n + pg_temp.expect('cancelada', (SELECT status FROM reservations WHERE id = rid::uuid), 'cancelada_alumno');

  -- ===== 7) cambio de reservación =====
  sa := pg_temp.mk('cambio-origen', interval '60 minutes', 30);
  sx := pg_temp.mk('cambio-fuera', interval '-11 minutes', 30);       -- pasó 1 min del límite de 10
  sy := pg_temp.mk('cambio-limite', interval '-10 minutes', 30);      -- EN el límite
  sc := pg_temp.mk('cambio-terminada', interval '-90 minutes', 30);
  u := pg_temp.mkp('cambio');
  v := pg_temp.run(u, format($q$select reserve_session(%L)$q$, sa->>'ses'));
  rid := v::jsonb->>'reservation_id';
  r_before := pg_temp.res_count(u);
  seats_before := session_reserved_count((sa->>'ses')::uuid);
  -- hacia una sesión fuera de tolerancia: rechazado y todo intacto
  n := n + pg_temp.expect('cambiar hacia fuera de tolerancia', pg_temp.run(u, format($q$select change_reservation(%L, %L)$q$, rid, sx->>'ses')), 'ERR:ENROLLMENT_CLOSED');
  n := n + pg_temp.expect('cambio rechazado: la original sigue vigente', (SELECT status FROM reservations WHERE id = rid::uuid), 'vigente');
  n := n + pg_temp.expect('cambio rechazado: sin reservaciones nuevas', pg_temp.res_count(u)::text, r_before::text);
  n := n + pg_temp.expect('cambio rechazado: sin reservación en el destino', pg_temp.res_count(u, sx)::text, '0');
  n := n + pg_temp.expect('cambio rechazado: la original no fue reemplazada', (SELECT (replaced_by IS NULL)::text FROM reservations WHERE id = rid::uuid), 'true');
  n := n + pg_temp.expect('cambio rechazado: cupo del origen intacto', session_reserved_count((sa->>'ses')::uuid)::text, seats_before::text);
  n := n + pg_temp.expect('cambiar hacia sesión terminada', pg_temp.run(u, format($q$select change_reservation(%L, %L)$q$, rid, sc->>'ses')), 'ERR:SESSION_ENDED');
  n := n + pg_temp.expect('cambio a terminada: la original sigue vigente', (SELECT status FROM reservations WHERE id = rid::uuid), 'vigente');
  -- hacia una sesión EN el límite: permitido
  v := pg_temp.run(u, format($q$select change_reservation(%L, %L)$q$, rid, sy->>'ses'));
  n := n + pg_temp.expect('cambiar hacia el límite exacto', (left(v, 4) <> 'ERR:')::text, 'true');
  n := n + pg_temp.expect('cambio permitido: la original quedó cambiada', (SELECT status FROM reservations WHERE id = rid::uuid), 'cambiada');
  n := n + pg_temp.expect('cambio permitido: reservación vigente en el destino',
    (SELECT status FROM reservations WHERE participant_id = pg_temp.pid(u) AND session_id = (sy->>'ses')::uuid), 'vigente');
  -- una reservación vieja que ya pasó su tolerancia puede cambiarse HACIA una sesión abierta (regla existente)
  sa := pg_temp.mk('cambio-nueva', interval '45 minutes', 30);
  rid2 := (SELECT id::text FROM reservations WHERE participant_id = pg_temp.pid(u) AND session_id = (sy->>'ses')::uuid);
  -- la reservación del límite sigue siendo cambiable (la sesión no terminó); el destino está abierto
  v := pg_temp.run(u, format($q$select change_reservation(%L, %L)$q$, rid2, sa->>'ses'));
  n := n + pg_temp.expect('reservación existente fuera de tolerancia puede cambiarse a una sesión abierta', (left(v, 4) <> 'ERR:')::text, 'true');

  -- 7b) el cambio respeta 5/10/20 min según la duración del DESTINO: en el límite pasa, +1 s no y la original se conserva
  FOREACH d IN ARRAY durs LOOP
    t := d / 3.0;
    sa := pg_temp.mk(d || '-cambio-origen', interval '3 hours', 30);
    sx := pg_temp.mk(d || '-cambio-pasado', make_interval(secs => -t * 60 - 1), d);
    sy := pg_temp.mk(d || '-cambio-limite', make_interval(secs => -t * 60), d);
    u := pg_temp.mkp(d || 'cambio7b');
    rid := (pg_temp.run(u, format($q$select reserve_session(%L)$q$, sa->>'ses')))::jsonb->>'reservation_id';
    n := n + pg_temp.expect(d || ' min: cambio +1 s rechazado', pg_temp.run(u, format($q$select change_reservation(%L, %L)$q$, rid, sx->>'ses')), 'ERR:ENROLLMENT_CLOSED');
    n := n + pg_temp.expect(d || ' min: cambio rechazado conserva la original', (SELECT status || ':' || coalesce(replaced_by::text, 'sin-reemplazo') FROM reservations WHERE id = rid::uuid), 'vigente:sin-reemplazo');
    n := n + pg_temp.expect(d || ' min: cambio rechazado, una sola reservación', pg_temp.res_count(u)::text, '1');
    v := pg_temp.run(u, format($q$select change_reservation(%L, %L)$q$, rid, sy->>'ses'));
    n := n + pg_temp.expect(d || ' min: cambio exactamente en el límite', (left(v, 4) <> 'ERR:')::text, 'true');
    n := n + pg_temp.expect(d || ' min: cambio aplicado', (SELECT status FROM reservations WHERE id = rid::uuid), 'cambiada');
  END LOOP;

  -- ===== 8) el tablero publica el cierre de inscripción por sesión =====
  s := pg_temp.mk('tablero-dentro', interval '-10 minutes', 30);
  sx := pg_temp.mk('tablero-fuera', interval '-10 minutes' - interval '1 second', 30);
  sy := pg_temp.mk('tablero-futura', interval '30 minutes', 15);
  u := pg_temp.mkp('tablero');
  v := pg_temp.run(u, format($q$select (s->>'enrollment_open') || '|' || ((s->>'enrollment_closes_at')::timestamptz = %L::timestamptz + interval '10 minutes')::text
      from jsonb_array_elements(my_reservation_board()->'sessions') s where s->>'id' = %L$q$, (SELECT starts_at FROM activity_sessions WHERE id = (s->>'ses')::uuid), s->>'ses'));
  n := n + pg_temp.expect('tablero: sesión EN el límite sigue abierta', v, 'true|true');
  v := pg_temp.run(u, format($q$select (s->>'enrollment_open') from jsonb_array_elements(my_reservation_board()->'sessions') s where s->>'id' = %L$q$, sx->>'ses'));
  n := n + pg_temp.expect('tablero: sesión pasada del límite cerrada', v, 'false');
  v := pg_temp.run(u, format($q$select (s->>'enrollment_open') || '|' || ((s->>'enrollment_closes_at')::timestamptz - (s->>'starts_at')::timestamptz)::text
      from jsonb_array_elements(my_reservation_board()->'sessions') s where s->>'id' = %L$q$, sy->>'ses'));
  n := n + pg_temp.expect('tablero: futura de 15 min abierta y con 5 min de tolerancia', v, 'true|00:05:00');

  -- ===== 9) la ventana global sigue mandando y no se modifica =====
  SELECT reservations_open_at, reservations_close_at INTO win_open, win_close FROM editions WHERE id = ed;
  UPDATE editions SET reservations_close_at = now() - interval '1 minute' WHERE id = ed;
  s := pg_temp.mk('ventana', interval '1 minute', 30);
  u := pg_temp.mkp('ventana');
  n := n + pg_temp.expect('ventana global cerrada manda', pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses')), 'ERR:RESERVATIONS_CLOSED');
  UPDATE editions SET reservations_close_at = win_close WHERE id = ed;
  n := n + pg_temp.expect('la prueba no tocó la ventana',
    (SELECT (reservations_open_at = win_open AND reservations_close_at IS NOT DISTINCT FROM win_close)::text FROM editions WHERE id = ed), 'true');

  -- ===== 10) reglas existentes dentro de tolerancia: conflicto de horario y máximo =====
  sa := pg_temp.mk('regla-a', interval '-5 minutes', 30);
  sb := pg_temp.mk('regla-b', interval '-2 minutes', 30);          -- se traslapa con A, ambas dentro de tolerancia
  u := pg_temp.mkp('reglas');
  n := n + pg_temp.expect('regla: primera reserva', (left(pg_temp.run(u, format($q$select reserve_session(%L)$q$, sa->>'ses')), 4) <> 'ERR:')::text, 'true');
  n := n + pg_temp.expect('regla: conflicto de horario se conserva', pg_temp.run(u, format($q$select reserve_session(%L)$q$, sb->>'ses')), 'ERR:SCHEDULE_CONFLICT');
  s := pg_temp.mk('regla-mismo-taller', interval '2 hours', 30);
  n := n + pg_temp.expect('regla: tolerancia no oculta ALREADY_RESERVED', pg_temp.run(u, format($q$select reserve_session(%L)$q$, sa->>'ses')), 'ERR:ALREADY_RESERVED');

  -- ===== 11) recomendador: lo que solo tiene sesiones fuera de tolerancia no se anuncia como disponible =====
  sa := pg_temp.mk('rec-fuera', interval '-15 minutes', 30);   -- en curso, 5 min fuera
  sb := pg_temp.mk('rec-dentro', interval '-5 minutes', 30);   -- en curso, dentro
  u := pg_temp.mkp('recomienda');
  INSERT INTO careers (code, name, division_id, is_demo)
  VALUES ('ET-REC-' || substr(gen_random_uuid()::text, 1, 8), 'ET Carrera recomendada', (SELECT id FROM divisions WHERE is_demo ORDER BY name LIMIT 1), true)
  RETURNING id INTO v_car;
  INSERT INTO activity_careers (activity_id, career_id) VALUES ((sa->>'act')::uuid, v_car), ((sb->>'act')::uuid, v_car);
  INSERT INTO initial_interests (participant_id, career_id, preference) VALUES (pg_temp.pid(u), v_car, 1);
  v := pg_temp.run(u, format($q$select (r->>'has_open_session') from jsonb_array_elements(my_recommended_activities()->'recommendations') r where r->>'activity_id' = %L$q$, sa->>'act'));
  n := n + pg_temp.expect('recomendador: fuera de tolerancia no está abierta', v, 'false');
  v := pg_temp.run(u, format($q$select (r->>'has_open_session') from jsonb_array_elements(my_recommended_activities()->'recommendations') r where r->>'activity_id' = %L$q$, sb->>'act'));
  n := n + pg_temp.expect('recomendador: dentro de tolerancia sí está abierta', v, 'true');

  RAISE EXCEPTION 'ENROLLMENT_TOLERANCE_OK % checks', n;
END
$test$;
