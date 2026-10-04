-- Pruebas de regresión de asistencia / check-in (QR y código manual).
-- Se ejecuta como un solo bloque DO. Siempre termina con RAISE EXCEPTION que trae los resultados,
-- así que todos los cambios se revierten. Cubre: autorización, credenciales, método real (QR vs
-- código), rango, reservación (vigente / cambiada / cancelada por sesión), ventana de tiempo,
-- sesión oculta, idempotencia, créditos/snapshot, regeneración, unicidad y reintento por colisión.
-- Pega el archivo completo en el SQL editor.

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  s uuid := '00000000-0000-4000-8000-0000000000c2';
  r uuid := '00000000-0000-4000-8000-0000000000c3';
  ua uuid := '00000000-0000-4000-8000-0000000000d1';
  ub uuid := '00000000-0000-4000-8000-0000000000d2';
  un uuid := '00000000-0000-4000-8000-0000000000d3';
  ud uuid := '00000000-0000-4000-8000-0000000000d4';
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_act uuid; v_sid uuid; v_career uuid; v_res_cb uuid;
  v_pa uuid; v_pb uuid; v_pd uuid;
  sid jsonb := '{}'; tok jsonb := '{}'; code jsonb := '{}';
  v_cr_old_tok text; v_cr_old_code text; v_cr_new jsonb;
  st record; k record;
  v_uid uuid; v_q text; v_val text; v_err text; v_ok boolean;
  v_res text := ''; v_pass int := 0; v_fail int := 0;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rtr.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, ua, ub, un, ud]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RTR Coord', true, 'rtr.c1@test.invalid'),
    (s, 'staff', 'RTR Staff', true, 'rtr.c2@test.invalid'),
    (r, 'sorteo', 'RTR Sorteo', true, 'rtr.c3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RTR-REAL2', 'RTR Carrera 2', v_div, false, true)
  RETURNING id INTO v_career;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, auth_user_id, initial_career_id) VALUES
    (ed, 'rtr.a@test.invalid', 'Ana Ruta', '2008-01-01', 'forms', ua, v_career),
    (ed, 'rtr.b@test.invalid', 'Beto Ruta', '2008-01-02', 'forms', ub, v_career),
    (ed, 'rtr.n@test.invalid', 'Nora SinAviso', '2008-01-03', 'forms', un, v_career),
    (ed, 'rtr.d@test.invalid', 'Dana Cambio', '2008-01-04', 'forms', ud, v_career);
  SELECT id INTO v_pa FROM participants WHERE email = 'rtr.a@test.invalid';
  SELECT id INTO v_pb FROM participants WHERE email = 'rtr.b@test.invalid';
  SELECT id INTO v_pd FROM participants WHERE email = 'rtr.d@test.invalid';
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = p.id AND p.email IN ('rtr.a@test.invalid', 'rtr.b@test.invalid', 'rtr.d@test.invalid');
  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL,
    max_reservations = 10, travel_buffer_minutes = 10,
    checkin_open_before_minutes = 5, checkin_close_after_minutes = 20 WHERE id = ed;
  -- Rango = sellos + 1 (tope 5), para poder verificar el rango devuelto.
  UPDATE rank_levels SET required_attendances = level - 1, required_divisions = 0 WHERE edition_id = ed;

  -- end_min: minutos desde ahora en que termina la sesión (negativo = ya terminó).
  FOR k IN SELECT * FROM (VALUES
    ('C1', -2, 1), ('C2', -2, 2), ('CN', -2, 1), ('CO', -2, 1), ('CF', 6000, 1),
    ('CL', -30, 1), ('CR', -2, 1), ('CA', -2, 1), ('CB', -2, 1), ('CX', 9000, 1)
  ) AS x(sk, end_min, cr) LOOP
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (ed, v_div, 'RTR ' || k.sk, '', 'Edificio RTR', false) RETURNING id INTO v_act;
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
    VALUES (v_act, now() + make_interval(mins => k.end_min - 20), now() + make_interval(mins => k.end_min),
            30, 'Edificio RTR', 'activa', false, k.cr)
    RETURNING id INTO v_sid;
    sid := sid || jsonb_build_object(k.sk, v_sid);
    tok := tok || jsonb_build_object(k.sk, (SELECT extensions.pgp_sym_decrypt(qr_token_encrypted, credential_encryption_key()) FROM session_credentials WHERE session_id = v_sid));
    code := code || jsonb_build_object(k.sk, (SELECT extensions.pgp_sym_decrypt(manual_code_encrypted, credential_encryption_key()) FROM session_credentials WHERE session_id = v_sid));
  END LOOP;

  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT v_pa, id, activity_id FROM activity_sessions
  WHERE id IN ((sid->>'C1')::uuid, (sid->>'C2')::uuid, (sid->>'CO')::uuid, (sid->>'CL')::uuid);
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT v_pb, id, activity_id FROM activity_sessions
  WHERE id IN ((sid->>'C1')::uuid, (sid->>'CN')::uuid, (sid->>'CR')::uuid);
  -- D cambió su reservación de CA a CB (mismo resultado que change_reservation).
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT v_pd, id, activity_id FROM activity_sessions WHERE id = (sid->>'CB')::uuid RETURNING id INTO v_res_cb;
  INSERT INTO reservations (participant_id, session_id, activity_id, status, ended_at, replaced_by)
  SELECT v_pd, id, activity_id, 'cambiada', now(), v_res_cb FROM activity_sessions WHERE id = (sid->>'CA')::uuid;
  -- CO queda oculta con la reservación vigente de A.
  UPDATE activity_sessions SET status = 'oculta' WHERE id = (sid->>'CO')::uuid;

  -- Coordinación regenera CR antes de las pruebas; se guardan credenciales anterior y nueva.
  v_cr_old_tok := tok->>'CR'; v_cr_old_code := code->>'CR';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_cr_new := regenerate_session_credential((sid->>'CR')::uuid, 'prueba regeneracion');
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  CREATE TEMP TABLE rt_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rt_steps (name, who, q, expect) VALUES
  ('auth anon', 'X', 'select check_in(''x'')', 'ERR:permission denied'),
  ('auth sinAviso', 'N', 'select check_in(''x'')', 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('auth staff', 'S', 'select check_in(''x'')', 'ERR:NOT_AUTHORIZED'),
  ('auth sorteo', 'R', 'select check_in(''x'')', 'ERR:NOT_AUTHORIZED'),
  ('estudiante no credenciales', 'A', 'select session_credential_display(' || quote_literal(sid->>'C1') || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('estudiante no asistencias', 'A', 'select count(*) from attendances', 'ERR:permission denied'),
  ('estudiante no credenciales tabla', 'A', 'select count(*) from session_credentials', 'ERR:permission denied'),
  ('estudiante no clave', 'A', 'select credential_encryption_key()', 'ERR:permission denied'),
  ('estudiante no resolve', 'A', 'select resolve_credential(''x'')', 'ERR:permission denied'),
  ('estudiante no vault', 'A', 'select count(*) from vault.decrypted_secrets', 'ERR:permission denied'),
  ('anon no clave', 'X', 'select credential_encryption_key()', 'ERR:permission denied'),
  ('sorteo no overview', 'R', 'select session_checkin_overview()', 'ERR:NOT_AUTHORIZED'),
  ('sorteo no credenciales', 'R', 'select session_credential_display(' || quote_literal(sid->>'C1') || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('sorteo no regenera', 'R', 'select regenerate_session_credential(' || quote_literal(sid->>'C1') || '::uuid, ''filtracion'')', 'ERR:NOT_AUTHORIZED'),
  ('staff no regenera', 'S', 'select regenerate_session_credential(' || quote_literal(sid->>'C1') || '::uuid, ''filtracion'')', 'ERR:NOT_AUTHORIZED'),
  ('clave en vault', 'P', 'select length(credential_encryption_key()) >= 32', 'TRUE'),
  ('cred inventado', 'A', 'select check_in(''0000000000000000000000000000000000000000000000000000000000000000'')', 'ERR:INVALID_CREDENTIAL'),
  ('cred incorrecto', 'A', 'select check_in(''ZZZZZZ'')', 'ERR:INVALID_CREDENTIAL'),
  ('cred vacio', 'A', 'select check_in('''')', 'ERR:INVALID_CREDENTIAL'),
  -- Método real: primer check-in de A por QR, de B por código.
  ('A C1 primer QR', 'A', 'select r->>''method'' = ''qr'' and (r->>''credits_granted'')::int = 1 and (r->>''level'')::int = 2 and not (r->>''already_registered'')::boolean from (select check_in(' || quote_literal(tok->>'C1') || ') r) x', 'TRUE'),
  ('A C1 guardado qr', 'P', 'select method = ''qr'' from attendances where participant_id = ' || quote_literal(v_pa) || '::uuid and session_id = ' || quote_literal(sid->>'C1') || '::uuid', 'TRUE'),
  ('B sin C2', 'B', 'select check_in(' || quote_literal(tok->>'C2') || ')', 'ERR:NO_RESERVATION'),
  ('B C1 primer codigo', 'B', 'select r->>''method'' = ''codigo_manual'' and not (r->>''already_registered'')::boolean from (select check_in(' || quote_literal(lower(code->>'C1')) || ') r) x', 'TRUE'),
  ('B C1 guardado codigo', 'P', 'select method = ''codigo_manual'' from attendances where participant_id = ' || quote_literal(v_pb) || '::uuid and session_id = ' || quote_literal(sid->>'C1') || '::uuid', 'TRUE'),
  ('auditoria A qr', 'P', 'select exists (select 1 from audit_log where action = ''attendance.checked_in'' and detail->>''participant_id'' = ' || quote_literal(v_pa) || ' and detail->>''method'' = ''qr'')', 'TRUE'),
  ('auditoria B codigo', 'P', 'select exists (select 1 from audit_log where action = ''attendance.checked_in'' and detail->>''participant_id'' = ' || quote_literal(v_pb) || ' and detail->>''method'' = ''codigo_manual'')', 'TRUE'),
  ('idem A QR', 'A', 'select (check_in(' || quote_literal(tok->>'C1') || ')->>''already_registered'')::boolean', 'TRUE'),
  ('idem A codigo conserva qr', 'A', 'select (r->>''already_registered'')::boolean and r->>''method'' = ''qr'' from (select check_in(' || quote_literal(code->>'C1') || ') r) x', 'TRUE'),
  ('idem B QR conserva codigo', 'B', 'select (r->>''already_registered'')::boolean and r->>''method'' = ''codigo_manual'' from (select check_in(' || quote_literal(tok->>'C1') || ') r) x', 'TRUE'),
  ('metodos sin cambio', 'P', 'select count(*) = 2 from attendances where session_id = ' || quote_literal(sid->>'C1') || '::uuid and ((participant_id = ' || quote_literal(v_pa) || '::uuid and method = ''qr'') or (participant_id = ' || quote_literal(v_pb) || '::uuid and method = ''codigo_manual''))', 'TRUE'),
  ('reintentos no auditan', 'P', 'select count(*) = 2 from audit_log where action = ''attendance.checked_in'' and detail->>''session_id'' = ' || quote_literal(sid->>'C1'), 'TRUE'),
  -- Créditos, rango y snapshot.
  ('A C2 2cred rango', 'A', 'select (r->>''credits_granted'')::int = 2 and (r->>''stamps'')::int = 3 and (r->>''level'')::int = 4 from (select check_in(' || quote_literal(tok->>'C2') || ') r) x', 'TRUE'),
  ('rango = pasaporte', 'A', 'select (check_in(' || quote_literal(tok->>'C2') || ')->>''level'')::int = (my_progress()->>''level'')::int', 'TRUE'),
  ('2cred=1asist', 'P', 'select count(*) = 1 from attendances where participant_id = ' || quote_literal(v_pa) || '::uuid and session_id = ' || quote_literal(sid->>'C2') || '::uuid', 'TRUE'),
  ('sellos=3', 'P', 'select my_stamp_count(' || quote_literal(v_pa) || '::uuid) = 3', 'TRUE'),
  ('talleres=2', 'P', 'select my_attended_workshop_count(' || quote_literal(v_pa) || '::uuid) = 2', 'TRUE'),
  ('snapshot: cambiar credits', 'P', 'update activity_sessions set credits = 9 where id = ' || quote_literal(sid->>'C1') || '::uuid', 'OK'),
  ('snapshot: verificar', 'P', 'select credits_granted = 1 from attendances where participant_id = ' || quote_literal(v_pa) || '::uuid and session_id = ' || quote_literal(sid->>'C1') || '::uuid', 'TRUE'),
  -- Ventana de tiempo.
  ('CF temprano', 'A', 'select check_in(' || quote_literal(tok->>'CF') || ')', 'ERR:CHECKIN_TOO_EARLY'),
  ('CL tarde', 'A', 'select check_in(' || quote_literal(tok->>'CL') || ')', 'ERR:CHECKIN_TOO_LATE'),
  ('CL tarde codigo', 'A', 'select check_in(' || quote_literal(code->>'CL') || ')', 'ERR:CHECKIN_TOO_LATE'),
  -- Sesión oculta con reservación vigente.
  ('CO oculta valida', 'A', 'select not (check_in(' || quote_literal(tok->>'CO') || ')->>''already_registered'')::boolean', 'TRUE'),
  ('sellos=4', 'P', 'select my_stamp_count(' || quote_literal(v_pa) || '::uuid) = 4', 'TRUE'),
  -- Sesión cancelada y reactivada.
  ('CN cancelar', 'P', 'update activity_sessions set status = ''cancelada'' where id = ' || quote_literal(sid->>'CN') || '::uuid', 'OK'),
  ('CN cancelada rechaza', 'B', 'select check_in(' || quote_literal(tok->>'CN') || ')', 'ERR:SESSION_CANCELLED'),
  ('CN reserva cancelada_sesion', 'P', 'select status = ''cancelada_sesion'' from reservations where participant_id = ' || quote_literal(v_pb) || '::uuid and session_id = ' || quote_literal(sid->>'CN') || '::uuid', 'TRUE'),
  ('CN reactivar', 'P', 'update activity_sessions set status = ''activa'' where id = ' || quote_literal(sid->>'CN') || '::uuid', 'OK'),
  ('CN reactivada no revive', 'B', 'select check_in(' || quote_literal(tok->>'CN') || ')', 'ERR:NO_RESERVATION'),
  ('CN sin asistencia', 'P', 'select not exists (select 1 from attendances where session_id = ' || quote_literal(sid->>'CN') || '::uuid)', 'TRUE'),
  -- Reservación cambiada.
  ('D sesion anterior no', 'D', 'select check_in(' || quote_literal(tok->>'CA') || ')', 'ERR:NO_RESERVATION'),
  ('D sesion anterior codigo no', 'D', 'select check_in(' || quote_literal(code->>'CA') || ')', 'ERR:NO_RESERVATION'),
  ('D nueva por codigo', 'D', 'select r->>''method'' = ''codigo_manual'' and not (r->>''already_registered'')::boolean from (select check_in(' || quote_literal(code->>'CB') || ') r) x', 'TRUE'),
  ('D guardado codigo', 'P', 'select method = ''codigo_manual'' from attendances where participant_id = ' || quote_literal(v_pd) || '::uuid and session_id = ' || quote_literal(sid->>'CB') || '::uuid', 'TRUE'),
  ('D idem QR conserva codigo', 'D', 'select (r->>''already_registered'')::boolean and r->>''method'' = ''codigo_manual'' from (select check_in(' || quote_literal(tok->>'CB') || ') r) x', 'TRUE'),
  -- Regeneración: credenciales anteriores dejan de servir, nuevas sí.
  ('regen QR anterior falla', 'B', 'select check_in(' || quote_literal(v_cr_old_tok) || ')', 'ERR:INVALID_CREDENTIAL'),
  ('regen codigo anterior falla', 'B', 'select check_in(' || quote_literal(v_cr_old_code) || ')', 'ERR:INVALID_CREDENTIAL'),
  ('regen QR nuevo funciona', 'B', 'select r->>''method'' = ''qr'' and not (r->>''already_registered'')::boolean from (select check_in(' || quote_literal(v_cr_new->>'qr_token') || ') r) x', 'TRUE'),
  ('regen codigo nuevo resuelve', 'B', 'select (check_in(' || quote_literal(v_cr_new->>'manual_code') || ')->>''already_registered'')::boolean', 'TRUE'),
  ('regen auditada', 'P', 'select exists (select 1 from audit_log where action = ''checkin.credential_regenerated'' and detail->>''session_id'' = ' || quote_literal(sid->>'CR') || ')', 'TRUE'),
  ('regen motivo corto', 'C', 'select regenerate_session_credential(' || quote_literal(sid->>'CX') || '::uuid, ''x'')', 'ERR:REASON_REQUIRED_SHORT'),
  ('coord overview', 'C', 'select jsonb_array_length(session_checkin_overview()) > 0', 'TRUE'),
  ('coord display', 'C', 'select (session_credential_display(' || quote_literal(sid->>'C1') || '::uuid)->>''manual_code'') is not null', 'TRUE'),
  ('staff overview', 'S', 'select jsonb_array_length(session_checkin_overview()) > 0', 'TRUE'),
  ('staff display', 'S', 'select (session_credential_display(' || quote_literal(sid->>'C1') || '::uuid)->>''manual_code'') is not null', 'TRUE'),
  -- Unicidad en base de datos.
  ('unico codigo', 'P', 'update session_credentials set manual_code_hash = (select manual_code_hash from session_credentials where session_id = ' || quote_literal(sid->>'C2') || '::uuid) where session_id = ' || quote_literal(sid->>'CX') || '::uuid', 'ERR:duplicate key'),
  ('unico QR', 'P', 'update session_credentials set qr_token_hash = (select qr_token_hash from session_credentials where session_id = ' || quote_literal(sid->>'C2') || '::uuid) where session_id = ' || quote_literal(sid->>'CX') || '::uuid', 'ERR:duplicate key'),
  ('codigo seguro formato', 'P', 'select bool_and(generate_manual_code() ~ ''^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'') from generate_series(1, 200)', 'TRUE'),
  -- Colisión forzada: el generador devuelve el código de C1 las primeras 2 veces.
  ('stub colision', 'P', 'create or replace function public.generate_manual_code() returns text language plpgsql volatile security definer set search_path = public, extensions as $f$ declare n int := coalesce(nullif(current_setting(''rt.calls'', true), ''''), ''0'')::int + 1; begin perform set_config(''rt.calls'', n::text, true); if n <= 2 then return ' || quote_literal(code->>'C1') || '; end if; return (select string_agg(substr(''ABCDEFGHJKLMNPQRSTUVWXYZ23456789'', (get_byte(x.b, i) % 32) + 1, 1), '''' order by i) from (select extensions.gen_random_bytes(6) as b) x, generate_series(0, 5) i); end $f$', 'OK'),
  ('colision: reset', 'P', 'select set_config(''rt.calls'', ''0'', true)', 'OK'),
  ('colision regen reintenta', 'C', 'select (regenerate_session_credential(' || quote_literal(sid->>'CX') || '::uuid, ''colision prueba'')->>''manual_code'') <> ' || quote_literal(code->>'C1'), 'TRUE'),
  ('colision: 3 intentos', 'P', 'select current_setting(''rt.calls'')::int = 3', 'TRUE'),
  ('colision: C1 intacto', 'P', 'select (resolve_credential(' || quote_literal(code->>'C1') || ')).session_id = ' || quote_literal(sid->>'C1') || '::uuid', 'TRUE'),
  ('colision alta: reset', 'P', 'select set_config(''rt.calls'', ''0'', true)', 'OK'),
  ('colision alta sesion', 'P', 'insert into activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits) select activity_id, now() + interval ''9 days'', now() + interval ''9 days 20 minutes'', 30, ''RTR-NEW'', ''activa'', false, 1 from activity_sessions where id = ' || quote_literal(sid->>'CX') || '::uuid', 'OK'),
  ('colision alta: credencial', 'P', 'select count(*) = 1 and current_setting(''rt.calls'')::int = 3 from session_credentials sc join activity_sessions s on s.id = sc.session_id where s.location = ''RTR-NEW''', 'TRUE'),
  ('colision agotada: reset', 'P', 'select set_config(''rt.calls'', ''-100'', true)', 'OK'),
  ('colision agotada', 'C', 'select regenerate_session_credential(' || quote_literal(sid->>'CX') || '::uuid, ''colision prueba'')', 'ERR:CREDENTIAL_GENERATION_FAILED'),
  ('progreso', 'A', 'select (my_progress()->>''stamps'')::int = 4 and (my_progress()->>''attended_workshops'')::int = 3 and (my_progress()->>''level'')::int = 5', 'TRUE'),
  ('invariante', 'P', 'select not exists (select 1 from attendances group by participant_id, session_id having count(*) > 1)', 'TRUE');

  FOR st IN SELECT * FROM rt_steps ORDER BY seq LOOP
    v_q := st.q;
    v_uid := CASE st.who WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r WHEN 'A' THEN ua WHEN 'B' THEN ub WHEN 'N' THEN un WHEN 'D' THEN ud END;
    v_val := NULL; v_err := NULL;
    BEGIN
      IF st.who = 'X' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
      ELSIF v_uid IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
      END IF;
      IF v_q ~* '^(update|insert|create)' THEN EXECUTE v_q; ELSE EXECUTE v_q INTO v_val; END IF;
    EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    v_ok := CASE
      WHEN st.expect = 'OK' THEN v_err IS NULL
      WHEN st.expect = 'TRUE' THEN v_err IS NULL AND v_val = 'true'
      WHEN st.expect LIKE 'ERR:%' THEN v_err LIKE '%' || substr(st.expect, 5) || '%'
    END;
    IF v_ok THEN v_pass := v_pass + 1;
    ELSE v_fail := v_fail + 1; v_res := v_res || st.name || '[' || coalesce('err:' || v_err, 'val:' || coalesce(v_val, 'null')) || '] '; END IF;
  END LOOP;
  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, v_res;
END
$test$;
