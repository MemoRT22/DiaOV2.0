-- Regresión: el QR / código del taller registra la asistencia AUNQUE el alumno no haya reservado
-- (migración 20261015170000_checkin_without_reservation). Ejecutar como UN solo bloque en una base local/descartable, DESPUÉS de la migración.
-- Fixtures propios y demo; SIEMPRE termina con una excepción (UNRESERVED_CHECKIN_OK n checks), así que todo se revierte.

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
    RAISE EXCEPTION 'UNRESERVED_CHECKIN_FAIL[%]: esperado %, obtenido %', p_name, p_want, p_got;
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


-- Sesión extra de la MISMA actividad (otra hora).
CREATE FUNCTION pg_temp.extra_session(p_act uuid, p_off interval, p_dur int, p_status text DEFAULT 'activa') RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (p_act, now() + p_off, now() + p_off + make_interval(mins => p_dur), 30, 'Salón UC', p_status, true, 1) RETURNING id INTO v;
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.field(p_json text, p_key text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN p_json LIKE 'ERR:%' THEN p_json ELSE p_json::jsonb->>p_key END $f$;

DO $test$
DECLARE
  n int := 0; u text; s jsonb; v text; ses2 uuid; ses3 uuid; seats_before int; d int;
BEGIN
  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL WHERE id = active_edition_id();

  -- 1) sin reservación cuenta, en la sesión en curso, sin reservación ni cupo ocupado; sellos por duración (15→1, 30→1, 60→2)
  FOREACH d IN ARRAY ARRAY[15, 30, 60] LOOP
    s := pg_temp.mk('sr-' || d, interval '-2 minutes', d);
    u := pg_temp.mkp('sr' || d);
    seats_before := session_reserved_count((s->>'ses')::uuid);
    v := pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr'));
    n := n + pg_temp.expect(d || ' min: sin reservación cuenta', pg_temp.field(v, 'without_reservation'), 'true');
    n := n + pg_temp.expect(d || ' min: en la sesión de esa actividad', pg_temp.field(v, 'session_id'), s->>'ses');
    n := n + pg_temp.expect(d || ' min: sellos por duración', pg_temp.field(v, 'credits_granted'), CASE WHEN d = 60 THEN '2' ELSE '1' END);
    n := n + pg_temp.expect(d || ' min: attendance sin reservation_id',
      (SELECT count(*) FROM attendances WHERE participant_id = pg_temp.pid(u) AND session_id = (s->>'ses')::uuid AND reservation_id IS NULL)::text, '1');
    n := n + pg_temp.expect(d || ' min: no crea reservación', pg_temp.res_count(u)::text, '0');
    n := n + pg_temp.expect(d || ' min: no ocupa cupo', session_reserved_count((s->>'ses')::uuid)::text, seats_before::text);
    -- idempotente: otra lectura (QR o código) no suma sellos ni filas
    v := pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'code'));
    n := n + pg_temp.expect(d || ' min: segundo escaneo ya registrado', pg_temp.field(v, 'already_registered'), 'true');
    n := n + pg_temp.expect(d || ' min: una sola asistencia', (SELECT count(*) FROM attendances WHERE participant_id = pg_temp.pid(u))::text, '1');
  END LOOP;

  -- 2) con varias sesiones elige la que corresponde al momento: en curso > terminó más reciente > próxima
  s := pg_temp.mk('multi', interval '-90 minutes', 30);               -- terminó hace 60 min
  ses2 := pg_temp.extra_session((s->>'act')::uuid, interval '-10 minutes', 30);   -- en curso
  ses3 := pg_temp.extra_session((s->>'act')::uuid, interval '60 minutes', 30);    -- próxima
  u := pg_temp.mkp('multi1');
  n := n + pg_temp.expect('varias sesiones: elige la EN CURSO', pg_temp.field(pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr')), 'session_id'), ses2::text);
  UPDATE activity_sessions SET starts_at = now() + interval '30 minutes', ends_at = now() + interval '60 minutes' WHERE id = ses2;  -- ya no está en curso (sin reservaciones)
  u := pg_temp.mkp('multi2');
  n := n + pg_temp.expect('sin sesión en curso: la que terminó más reciente', pg_temp.field(pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr')), 'session_id'), s->>'ses');
  UPDATE activity_sessions SET status = 'cancelada' WHERE id = (s->>'ses')::uuid;   -- una sesión cancelada nunca se elige
  u := pg_temp.mkp('multi3');
  n := n + pg_temp.expect('solo próximas: la más cercana', pg_temp.field(pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr')), 'session_id'), ses2::text);

  -- 3) con reservación nada cambia: misma sesión elegida y reservation_id guardado
  s := pg_temp.mk('con-res', interval '-1 minute', 30);
  u := pg_temp.mkp('conres');
  PERFORM pg_temp.run(u, format($q$select reserve_session(%L)$q$, s->>'ses'));
  v := pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr'));
  n := n + pg_temp.expect('con reservación: without_reservation=false', pg_temp.field(v, 'without_reservation'), 'false');
  n := n + pg_temp.expect('con reservación: guarda reservation_id',
    (SELECT (reservation_id IS NOT NULL)::text FROM attendances WHERE participant_id = pg_temp.pid(u) AND session_id = (s->>'ses')::uuid), 'true');

  -- 4) actividad solo para personal educativo: no cuenta a alumnos
  s := pg_temp.mk('edu', interval '-1 minute', 30);
  UPDATE activities SET audience = 'educators' WHERE id = (s->>'act')::uuid;
  u := pg_temp.mkp('edu');
  n := n + pg_temp.expect('educadores: no cuenta', pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr')), 'ERR:ACTIVITY_EDUCATORS_ONLY');
  n := n + pg_temp.expect('educadores: sin asistencia', (SELECT count(*) FROM attendances WHERE participant_id = pg_temp.pid(u))::text, '0');

  -- 5) todas las sesiones canceladas: SESSION_CANCELLED
  s := pg_temp.mk('canc', interval '-1 minute', 30);
  UPDATE activity_sessions SET status = 'cancelada' WHERE id = (s->>'ses')::uuid;
  u := pg_temp.mkp('canc');
  n := n + pg_temp.expect('solo canceladas', pg_temp.run(u, format($q$select check_in(%L)$q$, s->>'qr')), 'ERR:SESSION_CANCELLED');

  -- 6) credencial inválida y otra edición/DEMO siguen rechazadas
  u := pg_temp.mkp('inv');
  n := n + pg_temp.expect('código inválido', pg_temp.run(u, $q$select check_in('ZZZZZZ')$q$), 'ERR:INVALID_CREDENTIAL');

  RAISE EXCEPTION 'UNRESERVED_CHECKIN_OK % checks', n;
END
$test$;
