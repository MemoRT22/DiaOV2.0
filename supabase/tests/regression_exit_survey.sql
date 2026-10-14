-- Regresión de la ENCUESTA DE SALIDA y de su integración obligatoria con el sorteo. Ejecutar con psql en una base local/descartable
-- (nunca en producción). Todo ocurre dentro de una transacción que termina, a propósito, con
--   RAISE EXCEPTION 'EXIT_SURVEY_OK: N passed, M failed'
-- (revierte todo). Éxito únicamente si el mensaje dice «0 failed».
--
-- Cubre: sellos sin encuesta (no entra), encuesta sin sellos (no entra), ambos (entra), categoría más alta, quien ya ganó, hora de
-- apertura validada por el servidor, validación de respuestas, duplicados, inmutabilidad, permisos, aislamiento DEMO/real,
-- consistencia entre elegibles mostrados y sorteo, trigger de defensa y compatibilidad con ganadores históricos.
BEGIN;

CREATE TEMP TABLE es_results (seq serial, ok boolean, name text, detail text) ON COMMIT DROP;
CREATE TEMP TABLE es_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE es_cred (key text PRIMARY KEY, qr text NOT NULL, code text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE es_expect (pkey text PRIMARY KEY, academic int, university_life int, expected text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM es_ids WHERE key = p_key;
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_MISSING[%]', p_key; END IF;
  RETURN v;
END $f$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN answer;
END $f$;

-- `p_want` = 'ERR:CODIGO' acepta cualquier error que contenga el código; en otro caso compara el texto exacto.
CREATE FUNCTION pg_temp.expect(p_name text, p_got text, p_want text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO es_results (ok, name, detail) VALUES (
    CASE WHEN p_want LIKE 'ERR:%' THEN coalesce(p_got, '') LIKE 'ERR:%' AND position(substr(p_want, 5) IN coalesce(p_got, '')) > 0
         ELSE p_got IS NOT DISTINCT FROM p_want END,
    p_name, format('esperado %s, obtenido %s', p_want, coalesce(p_got, 'NULL')));
END $f$;

CREATE FUNCTION pg_temp.expect_true(p_name text, p_cond boolean) RETURNS void LANGUAGE sql AS $f$
  SELECT pg_temp.expect(p_name, coalesce(p_cond, false)::text, 'true');
$f$;

-- Escritura directa en la base (propietario), fuera de los RPC: devuelve 'ok' o 'ERR:<mensaje>'.
CREATE FUNCTION pg_temp.as_owner(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN others THEN RETURN 'ERR:' || SQLERRM;
END $f$;

CREATE FUNCTION pg_temp.mk_staff(p_key text, p_role text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); mail text := 'es.' || p_key || '@test.invalid';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, '{}', '{}', now(), now());
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES (u, p_role, 'ES ' || p_key, true, mail);
  INSERT INTO staff_roles (user_id, role) VALUES (u, p_role);
  INSERT INTO es_ids VALUES (p_key, u);
END $f$;

-- Alumno con cuenta y Aviso aceptado. es_ids guarda 'u:<clave>' (usuario) y 'p:<clave>' (participante).
CREATE FUNCTION pg_temp.mk_participant(p_key text, p_demo boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); pid uuid; mail text := 'es.' || p_key || '@test.invalid';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, '{}', '{}', now(), now());
  INSERT INTO participants (edition_id, email, full_name, origin, is_demo, auth_user_id)
  VALUES (active_edition_id(), mail, 'ES ' || p_key, 'demo', p_demo, u) RETURNING id INTO pid;
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (pid, u, 'ES ' || p_key)
  ON CONFLICT (participant_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = active_edition_id() AND pp.participant_id = pid;
  INSERT INTO es_ids VALUES ('u:' || p_key, u), ('p:' || p_key, pid);
END $f$;

-- Taller con UNA sesión en curso de `p_minutes`. Los sellos de la sesión los fija la base según la duración.
CREATE FUNCTION pg_temp.mk_activity(p_key text, p_type text, p_category text, p_minutes int, p_demo boolean DEFAULT true, p_division uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE a uuid; s uuid; c jsonb;
BEGIN
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type, experience_category)
  VALUES (active_edition_id(), p_division, 'ES ' || p_key, p_demo, p_type, p_category) RETURNING id INTO a;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status)
  VALUES (a, now() - interval '5 min', now() - interval '5 min' + make_interval(mins => p_minutes), 500, p_demo, 'activa')
  RETURNING id INTO s;
  c := rotate_activity_credential(a);
  INSERT INTO es_ids VALUES ('a:' || p_key, a), ('s:' || p_key, s);
  INSERT INTO es_cred VALUES (p_key, c->>'qr_token', c->>'manual_code');
END $f$;

-- Asistencia ya acreditada: el snapshot toma los sellos de la sesión.
CREATE FUNCTION pg_temp.attend(p_pkey text, p_akey text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method)
  SELECT pg_temp.id('p:' || p_pkey), s.id, s.activity_id, s.credits, 'qr'
  FROM activity_sessions s WHERE s.id = pg_temp.id('s:' || p_akey);
$f$;

-- Da exactamente (académicos, Vida Universitaria) sellos. Por defecto usa talleres de 60 min (2 sellos) cuando
-- caben; con `p_singles` usa solo talleres de 1 sello, para demostrar que cuenta el sello y no la composición.
CREATE FUNCTION pg_temp.give(p_pkey text, p_academic int, p_university_life int, p_singles boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE left_a int := p_academic; left_v int := p_university_life; n60 int := 0; n1 int := 0;
BEGIN
  WHILE left_a > 0 LOOP
    IF NOT p_singles AND left_a >= 2 AND n60 < 2 THEN n60 := n60 + 1; PERFORM pg_temp.attend(p_pkey, 'acad60_' || n60); left_a := left_a - 2;
    ELSE n1 := n1 + 1; PERFORM pg_temp.attend(p_pkey, 'acad30_' || n1); left_a := left_a - 1; END IF;
  END LOOP;
  n60 := 0; n1 := 0;
  WHILE left_v > 0 LOOP
    IF NOT p_singles AND left_v >= 2 AND n60 < 2 THEN n60 := n60 + 1; PERFORM pg_temp.attend(p_pkey, 'vida60_' || n60); left_v := left_v - 2;
    ELSE n1 := n1 + 1; PERFORM pg_temp.attend(p_pkey, 'vida15_' || n1); left_v := left_v - 1; END IF;
  END LOOP;
END $f$;


CREATE FUNCTION pg_temp.as_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('role', 'anon', true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role', 'postgres', true);
  RETURN answer;
END $f$;
CREATE FUNCTION pg_temp.survey_payload(p_over jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT (jsonb_build_object('version', exit_survey_version(), 'q1', 'entre_varias', 'q2', 4, 'q3', 'algunas_opciones',
    'q4', jsonb_build_array('salud', 'ingenierias'), 'q5', 9, 'comment', 'Más talleres de robótica') || p_over)::text;
$f$;
CREATE FUNCTION pg_temp.submit(p_pkey text, p_over jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(pg_temp.id('u:' || p_pkey), format('select submit_exit_survey(%L::jsonb)::text', pg_temp.survey_payload(p_over)));
$f$;
CREATE FUNCTION pg_temp.status(p_pkey text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(pg_temp.id('u:' || p_pkey), 'select my_exit_survey()::text')::jsonb;
$f$;
CREATE FUNCTION pg_temp.raffle(p_pkey text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(pg_temp.id('u:' || p_pkey), 'select my_raffle_status()::text')::jsonb;
$f$;
CREATE FUNCTION pg_temp.surveyed(p_pkey text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT participant_exit_survey_completed(pg_temp.id('p:' || p_pkey));
$f$;
CREATE FUNCTION pg_temp.cat_id(p_name text, p_demo boolean DEFAULT true) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM raffle_categories WHERE edition_id = active_edition_id() AND name = p_name AND is_demo = p_demo;
$f$;
CREATE FUNCTION pg_temp.in_pool(p_pkey text, p_cat text, p_demo boolean DEFAULT true) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM raffle_eligible_pool(pg_temp.cat_id(p_cat, p_demo), NULL, p_demo) t WHERE t.participant_id = pg_temp.id('p:' || p_pkey));
$f$;
-- Sellos acreditados con talleres de 1 sello (Sistema Solar = 1 académico + 1 Vida Universitaria).
CREATE FUNCTION pg_temp.stamp_ss(p_pkey text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM pg_temp.give(p_pkey, 1, 1, true); END $f$;

DO $fixtures$
DECLARE v_div uuid; i int;
BEGIN
  IF (SELECT mode FROM editions WHERE id = active_edition_id()) <> 'preparacion' THEN RAISE EXCEPTION 'TEST_REQUIRES_PREPARACION'; END IF;
  PERFORM pg_temp.mk_staff('coord', 'coordinacion');
  PERFORM pg_temp.mk_staff('staff', 'staff');
  PERFORM pg_temp.mk_staff('sorteo', 'sorteo');
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('es-div', 'ES División DEMO', 9990, true) RETURNING id INTO v_div;
  PERFORM pg_temp.mk_activity('acad60_1', 'academica', NULL, 60, true, v_div);
  PERFORM pg_temp.mk_activity('acad60_2', 'academica', NULL, 60, true, v_div);
  FOR i IN 1..5 LOOP PERFORM pg_temp.mk_activity('acad30_' || i, 'academica', NULL, 30, true, v_div); END LOOP;
  PERFORM pg_temp.mk_activity('vida60_1', 'vida_universitaria', 'deportiva', 60);
  PERFORM pg_temp.mk_activity('vida60_2', 'vida_universitaria', 'artistica_cultural', 60);
  FOR i IN 1..5 LOOP PERFORM pg_temp.mk_activity('vida15_' || i, 'vida_universitaria', 'otra', 15); END LOOP;
  PERFORM pg_temp.mk_activity('real_acad30', 'academica', NULL, 30, false);
  PERFORM pg_temp.mk_activity('real_vida15', 'vida_universitaria', 'otra', 15, false);
END $fixtures$;

DO $survey$
DECLARE
  coord uuid := pg_temp.id('coord'); sorteo uuid := pg_temp.id('sorteo'); staff uuid := pg_temp.id('staff');
  ed uuid := active_edition_id();
  ss uuid; ga uuid; un uuid; ss_real uuid;
  prize_ss uuid; prize_ga uuid; prize_un uuid; prize2_ss uuid;
  st jsonb; rs jsonb; draw jsonb; answer text; before_count int; v_interests int; v_event date; v_tz text;
  winner_row uuid; admin_view jsonb; n int;
BEGIN
  SELECT event_date, timezone INTO v_event, v_tz FROM editions WHERE id = ed;
  ss := pg_temp.cat_id('Sistema Solar'); ga := pg_temp.cat_id('Galaxia'); un := pg_temp.cat_id('Universo'); ss_real := pg_temp.cat_id('Sistema Solar', false);
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, is_demo) VALUES (ed, ss, 'ES Premio SS', 3, true, true) RETURNING id INTO prize_ss;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, is_demo) VALUES (ed, ss, 'ES Premio SS 2', 3, true, true) RETURNING id INTO prize2_ss;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, is_demo) VALUES (ed, ga, 'ES Premio GA', 3, true, true) RETURNING id INTO prize_ga;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, is_demo) VALUES (ed, un, 'ES Premio UN', 3, true, true) RETURNING id INTO prize_un;

  -- ===== Participantes ==============================================================================================
  PERFORM pg_temp.mk_participant('a');  PERFORM pg_temp.stamp_ss('a');                    -- 1. sellos suficientes, encuesta pendiente
  PERFORM pg_temp.mk_participant('b');                                                    -- 2. encuesta sin sellos (la contesta abajo)
  PERFORM pg_temp.mk_participant('c');  PERFORM pg_temp.stamp_ss('c');                    -- 3. sellos + encuesta
  PERFORM pg_temp.mk_participant('d');  PERFORM pg_temp.give('d', 3, 1, true);            -- 4. Universo por sellos (también cumple Galaxia y Sistema Solar)
  PERFORM pg_temp.mk_participant('e');  PERFORM pg_temp.stamp_ss('e');                    -- 5. ya ganó
  PERFORM pg_temp.mk_participant('real', false); PERFORM pg_temp.give('real', 1, 1, true); -- real: sellos de Sistema Solar

  -- ===== 0. Sin encuesta no hay nada guardado y la regla de sellos NO cambió ==========================================
  PERFORM pg_temp.expect_true('0: nadie ha contestado todavía', NOT pg_temp.surveyed('a') AND NOT pg_temp.surveyed('c') AND NOT pg_temp.surveyed('real'));
  PERFORM pg_temp.expect('0: reglas de sellos intactas (Sistema Solar = 1 académico + 1 Vida Universitaria)',
    (SELECT rules::text FROM raffle_categories WHERE id = ss), '[{"academic": 1, "university_life": 1}]');
  PERFORM pg_temp.expect('0: reglas de sellos intactas (Universo)', (SELECT rules::text FROM raffle_categories WHERE id = un),
    '[{"academic": 3, "university_life": 1}, {"academic": 2, "university_life": 2}]');

  -- ===== 1. Sellos suficientes + encuesta pendiente: NO entra al sorteo ===========================================
  PERFORM pg_temp.expect('1: la categoría por sellos sí existe', (SELECT name FROM raffle_categories WHERE id = participant_stamp_category(pg_temp.id('p:a'))), 'Sistema Solar');
  PERFORM pg_temp.expect_true('1: pero la categoría del sorteo es NULL', participant_raffle_category(pg_temp.id('p:a')) IS NULL);
  PERFORM pg_temp.expect_true('1: no está en el conjunto sorteable', NOT pg_temp.in_pool('a', 'Sistema Solar'));
  rs := pg_temp.raffle('a');
  PERFORM pg_temp.expect('1: Bitácora sigue mostrando su categoría por sellos', rs->>'raffle_category_name', 'Sistema Solar');
  PERFORM pg_temp.expect('1: Bitácora: encuesta pendiente', rs->>'survey_completed', 'false');
  PERFORM pg_temp.expect('1: Bitácora: todavía no es elegible', rs->>'raffle_eligible', 'false');

  -- ===== 2. Encuesta completada sin sellos: tampoco entra ==========================================================
  PERFORM pg_temp.expect('2: B contesta (ensayo: cuenta DEMO abierta)', (pg_temp.submit('b'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect_true('2: sin sellos no hay categoría del sorteo aunque haya encuesta', pg_temp.surveyed('b') AND participant_raffle_category(pg_temp.id('p:b')) IS NULL);
  PERFORM pg_temp.expect_true('2: B no está en ningún conjunto sorteable',
    NOT pg_temp.in_pool('b', 'Sistema Solar') AND NOT pg_temp.in_pool('b', 'Galaxia') AND NOT pg_temp.in_pool('b', 'Universo'));
  rs := pg_temp.raffle('b');
  PERFORM pg_temp.expect('2: Bitácora de B: sin categoría', coalesce(rs->>'raffle_category_name', '—'), '—');
  PERFORM pg_temp.expect('2: Bitácora de B: no elegible', rs->>'raffle_eligible', 'false');

  -- ===== 3. Sellos + encuesta: SÍ entra ============================================================================
  PERFORM pg_temp.expect('3: C contesta', (pg_temp.submit('c'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect_true('3: C está en el conjunto de Sistema Solar', pg_temp.in_pool('c', 'Sistema Solar'));
  rs := pg_temp.raffle('c');
  PERFORM pg_temp.expect('3: Bitácora de C: elegible de inmediato', rs->>'raffle_eligible', 'true');
  PERFORM pg_temp.expect('3: la respuesta del envío ya trae el estado (servidor): elegible', (pg_temp.status('c'))->>'eligible', 'true');

  -- ===== 4. Varias categorías: solo la más alta ====================================================================
  PERFORM pg_temp.expect('4: D contesta', (pg_temp.submit('d'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect('4: D participa solo en Universo', (SELECT name FROM raffle_categories WHERE id = participant_raffle_category(pg_temp.id('p:d'))), 'Universo');
  PERFORM pg_temp.expect_true('4: D no está en Galaxia ni en Sistema Solar',
    pg_temp.in_pool('d', 'Universo') AND NOT pg_temp.in_pool('d', 'Galaxia') AND NOT pg_temp.in_pool('d', 'Sistema Solar'));

  -- ===== 5. Quien ya ganó no puede recibir un segundo premio =======================================================
  PERFORM pg_temp.submit('e');
  PERFORM pg_temp.expect_true('5: antes de ganar, E (sellos + encuesta) sí estaba en su conjunto', pg_temp.in_pool('e', 'Sistema Solar'));
  INSERT INTO raffle_winners (edition_id, category_id, prize_id, participant_id, status, is_demo, confirmed_at)
  VALUES (ed, ss, prize2_ss, pg_temp.id('p:e'), 'confirmado', true, now());
  PERFORM pg_temp.expect_true('5: quien ganó sale de su categoría y de todos los conjuntos',
    participant_raffle_category(pg_temp.id('p:e')) IS NULL AND participant_stamp_category(pg_temp.id('p:e')) IS NULL AND NOT pg_temp.in_pool('e', 'Sistema Solar'));
  PERFORM pg_temp.expect('5: la Bitácora de E ya no ofrece categoría ni elegibilidad', (pg_temp.raffle('e'))->>'raffle_eligible', 'false');
  PERFORM pg_temp.expect_true('5: E tiene un solo resultado', (SELECT count(*) = 1 FROM raffle_winners WHERE participant_id = pg_temp.id('p:e')));

  -- ===== 6. Aislamiento ensayo / oficial ===========================================================================
  PERFORM pg_temp.expect('6: el real sin encuesta no entra (su conjunto real)', pg_temp.in_pool('real', 'Sistema Solar', false)::text, 'false');
  PERFORM pg_temp.expect_true('6: nadie del ensayo aparece en el conjunto real',
    NOT EXISTS (SELECT 1 FROM raffle_eligible_pool(ss_real, NULL, false) t JOIN participants p ON p.id = t.participant_id WHERE p.is_demo));
  -- Hora de apertura: en el futuro, el alumno REAL no puede contestar; la cuenta DEMO del ensayo sí.
  PERFORM pg_temp.as_user(coord, format('select set_exit_survey_opens_at(%L::timestamptz)::text', now() + interval '2 days'));
  PERFORM pg_temp.expect('6: real, antes de la hora: cerrada', (pg_temp.status('real'))->>'is_open', 'false');
  PERFORM pg_temp.expect('6: real, antes de la hora: el envío se rechaza', pg_temp.submit('real'), 'ERR:SURVEY_NOT_OPEN');
  PERFORM pg_temp.expect_true('6: nada se guardó para el real', NOT pg_temp.surveyed('real'));
  PERFORM pg_temp.expect('6: el ensayo DEMO sí puede probarla antes', (pg_temp.status('a'))->>'is_open', 'true');
  -- La hora llega: ahora sí (reloj del servidor).
  PERFORM pg_temp.as_user(coord, format('select set_exit_survey_opens_at(%L::timestamptz)::text', now() - interval '1 minute'));
  PERFORM pg_temp.expect('6: real, pasada la hora: abierta', (pg_temp.status('real'))->>'is_open', 'true');
  st := pg_temp.status('real');
  PERFORM pg_temp.expect_true('6: el estado trae la hora del servidor y la de apertura', st ? 'server_now' AND st ? 'opens_at' AND (st->>'server_now')::timestamptz >= (st->>'opens_at')::timestamptz);
  PERFORM pg_temp.expect('6: el real contesta', (pg_temp.submit('real'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect('6: su respuesta queda marcada como oficial (no DEMO)', (SELECT is_demo::text FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:real')), 'false');
  PERFORM pg_temp.expect('6: la de un DEMO queda marcada como ensayo', (SELECT is_demo::text FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:c')), 'true');
  PERFORM pg_temp.expect_true('6: el real ya está en su conjunto real', pg_temp.in_pool('real', 'Sistema Solar', false));
  -- Hora por omisión: día del evento a las 13:00 de Cancún.
  PERFORM pg_temp.as_user(coord, 'select set_exit_survey_opens_at(NULL)::text');
  PERFORM pg_temp.expect('6: por omisión abre el día del evento a las 13:00 hora de Cancún',
    (exit_survey_opens_at_of(ed) AT TIME ZONE coalesce(v_tz, 'America/Cancun'))::text, (v_event + time '13:00')::text);
  PERFORM pg_temp.expect_true('6: 13:00 de Cancún (UTC-5) = 18:00 UTC', (exit_survey_opens_at_of(ed) AT TIME ZONE 'UTC') = (v_event + time '18:00'));

  -- ===== 7. Consistencia: lo que se muestra = el conjunto del que se sortea ========================================
  PERFORM pg_temp.as_user(coord, format('select set_exit_survey_opens_at(%L::timestamptz)::text', now() - interval '1 minute'));
  admin_view := pg_temp.as_user(sorteo, 'select raffle_operator_view()::text')::jsonb;
  FOR n IN 1..3 LOOP
    PERFORM pg_temp.expect(format('7: pool_count del panel = raffle_pool_count = tamaño del conjunto (%s)', (ARRAY['Sistema Solar', 'Galaxia', 'Universo'])[n]),
      (SELECT (c->>'pool_count') FROM jsonb_array_elements(admin_view->'categories') c WHERE c->>'name' = (ARRAY['Sistema Solar', 'Galaxia', 'Universo'])[n] AND (c->>'is_demo')::boolean),
      (SELECT count(*)::text FROM raffle_eligible_pool(pg_temp.cat_id((ARRAY['Sistema Solar', 'Galaxia', 'Universo'])[n]), NULL, true)));
    PERFORM pg_temp.expect(format('7: raffle_pool_count RPC coincide (%s)', (ARRAY['Sistema Solar', 'Galaxia', 'Universo'])[n]),
      pg_temp.as_user(sorteo, format('select raffle_pool_count(%L)', pg_temp.cat_id((ARRAY['Sistema Solar', 'Galaxia', 'Universo'])[n]))),
      (SELECT count(*)::text FROM raffle_eligible_pool(pg_temp.cat_id((ARRAY['Sistema Solar', 'Galaxia', 'Universo'])[n]), NULL, true)));
  END LOOP;
  PERFORM pg_temp.expect('7: el panel explica quién falta: A tiene los sellos de Sistema Solar y no contesta',
    (SELECT c->>'survey_pending_count' FROM jsonb_array_elements(admin_view->'categories') c WHERE c->>'name' = 'Sistema Solar' AND (c->>'is_demo')::boolean), '1');
  -- El conjunto real del sorteo: solo C (A sin encuesta, E ya ganó). El tamaño informado por draw_winner es ese conjunto.
  draw := pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_ss, 'es-consistency'))::jsonb;
  PERFORM pg_temp.expect_true('7: draw_winner sortea dentro del conjunto mostrado (tamaño y persona)',
    (draw->>'pool_size')::int = 1 AND (draw->>'participant_id')::uuid = pg_temp.id('p:c'));
  PERFORM pg_temp.expect_true('7: nunca salió A (sin encuesta)', NOT EXISTS (SELECT 1 FROM raffle_winners WHERE participant_id = pg_temp.id('p:a')));

  -- ===== 8. A contesta y entra de inmediato =======================================================================
  -- C quedó «seleccionado» en prize_ss; A tiene los sellos pero no ha contestado: el conjunto sorteable del otro premio está vacío.
  PERFORM pg_temp.expect('8: mientras A no conteste, no hay a quién sortear', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize2_ss, 'es-empty')), 'ERR:POOL_EMPTY');
  PERFORM pg_temp.expect('8: A contesta', (pg_temp.submit('a'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect('8: Bitácora de A se actualiza de inmediato: elegible', (pg_temp.raffle('a'))->>'raffle_eligible', 'true');
  PERFORM pg_temp.expect_true('8: y entra al sorteo (único elegible)',
    (pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize2_ss, 'es-a-in'))::jsonb->>'participant_id')::uuid = pg_temp.id('p:a'));

  -- ===== 9. Validación de las respuestas ===========================================================================
  PERFORM pg_temp.mk_participant('v'); -- sin sellos: solo sirve para validar
  FOR answer IN SELECT unnest(ARRAY[
      '{"q1": "otra"}', '{"q1": 3}', '{"q3": "talvez"}', '{"q2": 0}', '{"q2": 6}', '{"q2": 3.5}', '{"q2": "4"}', '{"q5": -1}', '{"q5": 11}', '{"q5": 7.2}',
      '{"q4": []}', '{"q4": ["salud","deporte","negocios","derecho_ri"]}', '{"q4": ["salud","salud"]}', '{"q4": ["astrologia"]}',
      '{"q4": ["ninguna","salud"]}', '{"q4": "salud"}', '{"q4": [1]}', '{"comment": 5}', '{"version": "exit-2025"}', '{"participant_id": "00000000-0000-0000-0000-000000000000"}',
      '{"completed_at": "2020-01-01"}', '{"extra": true}']) LOOP
    PERFORM pg_temp.expect('9: se rechaza ' || answer, pg_temp.submit('v', answer::jsonb), CASE WHEN answer LIKE '%exit-2025%' THEN 'ERR:SURVEY_VERSION_MISMATCH' ELSE 'ERR:INVALID_SURVEY_ANSWERS' END);
  END LOOP;
  -- Faltantes: cada una de las cinco obligatorias.
  FOR answer IN SELECT unnest(ARRAY['q1', 'q2', 'q3', 'q4', 'q5']) LOOP
    PERFORM pg_temp.expect('9: falta ' || answer, pg_temp.as_user(pg_temp.id('u:v'), format('select submit_exit_survey(%L::jsonb)::text', (pg_temp.survey_payload()::jsonb - answer)::text)), 'ERR:INVALID_SURVEY_ANSWERS');
  END LOOP;
  PERFORM pg_temp.expect('9: formulario vacío', pg_temp.as_user(pg_temp.id('u:v'), $q$select submit_exit_survey('{}'::jsonb)::text$q$), 'ERR:SURVEY_VERSION_MISMATCH');
  PERFORM pg_temp.expect('9: solo con la versión (sin respuestas)', pg_temp.as_user(pg_temp.id('u:v'), format('select submit_exit_survey(%L::jsonb)::text', jsonb_build_object('version', exit_survey_version())::text)), 'ERR:INVALID_SURVEY_ANSWERS');
  PERFORM pg_temp.expect('9: no es un objeto', pg_temp.as_user(pg_temp.id('u:v'), $q$select submit_exit_survey('[1]'::jsonb)::text$q$), 'ERR:INVALID_SURVEY_ANSWERS');
  PERFORM pg_temp.expect('9: comentario de más de 500 caracteres', pg_temp.submit('v', jsonb_build_object('comment', repeat('x', 501))), 'ERR:INVALID_SURVEY_ANSWERS');
  PERFORM pg_temp.expect_true('9: ningún intento inválido dejó una encuesta «completada»', NOT pg_temp.surveyed('v'));
  PERFORM pg_temp.expect('9: «Todavía sin un área definida» es válida', (pg_temp.submit('v', '{"q4": ["ninguna"]}'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect('9: se guardó como una sola opción', (SELECT q4_areas::text FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:v')), '{ninguna}');
  -- El comentario es opcional; los espacios y los caracteres de control no cuentan.
  PERFORM pg_temp.mk_participant('w');
  PERFORM pg_temp.expect('9: sin comentario', (pg_temp.as_user(pg_temp.id('u:w'), format('select submit_exit_survey(%L::jsonb)::text', (pg_temp.survey_payload()::jsonb - 'comment')::text)))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect('9: el comentario ausente queda NULL', (SELECT coalesce(improvement_comment, 'NULL') FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:w')), 'NULL');
  PERFORM pg_temp.mk_participant('w2');
  PERFORM pg_temp.submit('w2', '{"comment": "   "}');
  PERFORM pg_temp.expect('9: un comentario en blanco queda NULL', (SELECT coalesce(improvement_comment, 'NULL') FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:w2')), 'NULL');

  -- ===== 10. Solo por sí mismo, sin duplicados, sin ediciones ======================================================
  PERFORM pg_temp.mk_participant('x'); PERFORM pg_temp.mk_participant('y');
  PERFORM pg_temp.expect('10: X contesta con q5 = 9', (pg_temp.submit('x'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect_true('10: lo de X no afecta a Y', NOT pg_temp.surveyed('y') AND (pg_temp.status('y'))->>'completed' = 'false');
  answer := pg_temp.submit('x', '{"q5": 0, "q1": "sin_idea"}');
  PERFORM pg_temp.expect_true('10: reenviar (conexión perdida / doble clic) no duplica y responde «ya completada»',
    (answer::jsonb->>'already_completed') = 'true' AND (answer::jsonb->>'saved') = 'false');
  PERFORM pg_temp.expect('10: y NO sobrescribe lo ya guardado', (SELECT q5_recommend::text || '/' || q1_prior_clarity FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:x')), '9/entre_varias');
  PERFORM pg_temp.expect('10: una sola fila por persona', (SELECT count(*)::text FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:x')), '1');
  PERFORM pg_temp.expect('10: la base impide el duplicado aunque se intente directo',
    pg_temp.as_owner(format($q$INSERT INTO exit_survey_responses(edition_id,participant_id,survey_version,is_demo,q1_prior_clarity,q2_workshop_rating,q3_post_clarity,q4_areas,q5_recommend)
      VALUES (%L,%L,'exit-2026-v1',true,'sin_idea',1,'ya_claro',ARRAY['salud'],5)$q$, ed, pg_temp.id('p:x'))), 'ERR:exit_survey_one_per_participant');
  PERFORM pg_temp.expect('10: la base rechaza formularios manipulados (q2 = 9)',
    pg_temp.as_owner(format($q$INSERT INTO exit_survey_responses(edition_id,participant_id,survey_version,is_demo,q1_prior_clarity,q2_workshop_rating,q3_post_clarity,q4_areas,q5_recommend)
      VALUES (%L,%L,'exit-2026-v1',true,'sin_idea',9,'ya_claro',ARRAY['salud'],5)$q$, ed, pg_temp.id('p:y'))), 'ERR:check');
  PERFORM pg_temp.expect('10: ni siquiera el propietario edita una respuesta enviada', pg_temp.as_owner(format('UPDATE exit_survey_responses SET q5_recommend = 1 WHERE participant_id = %L', pg_temp.id('p:x'))), 'ERR:SURVEY_IMMUTABLE');
  PERFORM pg_temp.expect('10: ni la fecha de finalización del servidor', pg_temp.as_owner(format($q$UPDATE exit_survey_responses SET completed_at = '2020-01-01' WHERE participant_id = %L$q$, pg_temp.id('p:x'))), 'ERR:SURVEY_IMMUTABLE');
  PERFORM pg_temp.expect_true('10: completed_at lo puso el servidor (ahora, no una fecha del navegador)',
    (SELECT completed_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute' FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:x')));

  -- ===== 11. Permisos ==============================================================================================
  PERFORM pg_temp.expect('11: anónimo no ve su estado', pg_temp.as_anon('select my_exit_survey()::text'), 'ERR:permission denied');
  PERFORM pg_temp.expect('11: anónimo no envía', pg_temp.as_anon($q$select submit_exit_survey('{}'::jsonb)::text$q$), 'ERR:permission denied');
  PERFORM pg_temp.expect('11: Staff (sin ser alumno) no tiene encuesta', pg_temp.as_user(staff, 'select my_exit_survey()::text'), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: Staff no envía encuestas', pg_temp.as_user(staff, format('select submit_exit_survey(%L::jsonb)::text', pg_temp.survey_payload())), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: la tabla no se lee directamente', pg_temp.as_user(pg_temp.id('u:x'), 'select count(*)::text from exit_survey_responses'), 'ERR:permission denied');
  PERFORM pg_temp.expect('11: ni se escribe directamente', pg_temp.as_user(pg_temp.id('u:y'), format($q$insert into exit_survey_responses(edition_id,participant_id,survey_version,is_demo,q1_prior_clarity,q2_workshop_rating,q3_post_clarity,q4_areas,q5_recommend) values (%L,%L,'exit-2026-v1',true,'sin_idea',1,'ya_claro',ARRAY['salud'],5) returning id::text$q$, ed, pg_temp.id('p:y'))), 'ERR:permission denied');
  PERFORM pg_temp.expect('11: las funciones internas no se ejecutan desde el navegador',
    pg_temp.as_user(pg_temp.id('u:x'), format('select participant_exit_survey_completed(%L)::text', pg_temp.id('p:y'))), 'ERR:permission denied');
  PERFORM pg_temp.expect('11: Sorteo no cambia la hora de apertura', pg_temp.as_user(sorteo, 'select set_exit_survey_opens_at(NULL)::text'), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: Staff no cambia la hora de apertura', pg_temp.as_user(staff, 'select set_exit_survey_opens_at(NULL)::text'), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: el alumno no cambia la hora de apertura', pg_temp.as_user(pg_temp.id('u:x'), 'select set_exit_survey_opens_at(NULL)::text'), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: un alumno no ve los resultados', pg_temp.as_user(pg_temp.id('u:x'), 'select exit_survey_admin()::text'), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: Sorteo no ve los resultados', pg_temp.as_user(sorteo, 'select exit_survey_admin()::text'), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('11: una hora absurda se rechaza (error de captura)', pg_temp.as_user(coord, $q$select set_exit_survey_opens_at('2031-01-01T00:00:00Z'::timestamptz)::text$q$), 'ERR:INVALID_OPENING_TIME');
  PERFORM pg_temp.expect('11: Coordinación cambia la hora y queda en la auditoría',
    (pg_temp.as_user(coord, format('select set_exit_survey_opens_at(%L::timestamptz)::text', (exit_survey_opens_at_of(ed) + interval '30 minutes')))::jsonb->>'custom'), 'true');
  PERFORM pg_temp.expect_true('11: auditado', EXISTS (SELECT 1 FROM audit_log WHERE action = 'exit_survey.opens_at_changed' AND actor_user_id = coord));

  -- ===== 12. Resultados para Coordinación: agregados, sin identidades, ensayo y oficial separados ===================
  admin_view := pg_temp.as_user(coord, 'select exit_survey_admin()::text')::jsonb;
  PERFORM pg_temp.expect_true('12: separa oficial y ensayo',
    (admin_view->'official'->>'completed')::int = 1 AND (admin_view->'rehearsal'->>'completed')::int = (SELECT count(*) FROM exit_survey_responses WHERE is_demo));
  PERFORM pg_temp.expect_true('12: sin identidades (ni participant_id, ni correo, ni nombre)',
    admin_view::text !~* 'participant_id|@test.invalid|ES a|auth_user');
  PERFORM pg_temp.expect_true('12: los comentarios viajan sin autor', jsonb_typeof(admin_view->'rehearsal'->'comments') = 'array' AND (admin_view->'rehearsal'->'comments'->0) ? 'text' AND NOT (admin_view->'rehearsal'->'comments'->0) ? 'participant_id');
  PERFORM pg_temp.expect_true('12: agregados: promedio de estrellas y NPS',
    (admin_view->'rehearsal'->>'q2_average') IS NOT NULL AND (admin_view->'rehearsal'->>'q5_promoters')::int >= 1 AND (admin_view->'official'->'q4') ? 'salud');

  -- ===== 13. Defensa en profundidad: ningún resultado nuevo sin encuesta; los históricos no se tocan ===============
  PERFORM pg_temp.mk_participant('z'); PERFORM pg_temp.stamp_ss('z');
  PERFORM pg_temp.expect('13: un INSERT directo de ganador sin encuesta se rechaza',
    pg_temp.as_owner(format($q$INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,is_demo) VALUES (%L,%L,%L,%L,'seleccionado',true)$q$, ed, ss, prize_ss, pg_temp.id('p:z'))), 'ERR:SURVEY_REQUIRED');
  PERFORM pg_temp.expect('13: ni como confirmado', pg_temp.as_owner(format($q$INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,is_demo,confirmed_at) VALUES (%L,%L,%L,%L,'confirmado',true,now())$q$, ed, ss, prize_ss, pg_temp.id('p:z'))), 'ERR:SURVEY_REQUIRED');
  -- Un resultado histórico (de antes de la encuesta) sigue vivo y editable: se simula con el de C borrando su encuesta.
  DELETE FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:c');
  PERFORM pg_temp.expect('13: un ganador histórico sin encuesta conserva su resultado y se puede confirmar/invalidar',
    pg_temp.as_owner(format($q$UPDATE raffle_winners SET status = 'invalidado', invalidation_reason = 'prueba histórica' WHERE participant_id = %L$q$, pg_temp.id('p:c'))), 'ok');
  PERFORM pg_temp.expect_true('13: el historial de ganadores sigue completo', (SELECT count(*) >= 3 FROM raffle_winners WHERE is_demo));

  -- ===== 14. Datos del alumno: intereses de carrera NO se tocan ni son requisito ===================================
  SELECT count(*) INTO before_count FROM initial_interests WHERE participant_id = pg_temp.id('p:a');
  SELECT count(*) INTO v_interests FROM post_event_interests WHERE participant_id = pg_temp.id('p:a');
  PERFORM pg_temp.expect_true('14: la encuesta no modifica los intereses de carrera de nadie',
    (SELECT count(*) FROM initial_interests WHERE participant_id = pg_temp.id('p:a')) = before_count
    AND (SELECT count(*) FROM post_event_interests WHERE participant_id = pg_temp.id('p:a')) = v_interests);
  PERFORM pg_temp.expect_true('14: A entró al sorteo sin haber elegido carreras de interés',
    v_interests = 0 AND participant_exit_survey_completed(pg_temp.id('p:a')));

  -- ===== 14b. Invitación automática: reclamo ATÓMICO, una sola vez por alumno, solo con la encuesta abierta ======================
  PERFORM pg_temp.mk_participant('inv');
  PERFORM pg_temp.as_user(coord, format('select set_exit_survey_opens_at(%L::timestamptz)::text', now() + interval '2 days'));
  PERFORM pg_temp.mk_participant('invreal', false);
  answer := pg_temp.as_user(pg_temp.id('u:invreal'), 'select exit_survey_mark_invited()::text');
  PERFORM pg_temp.expect('14b: antes de la hora no se «gasta» la invitación de un alumno real (no la obtiene)', (answer::jsonb)->>'claimed', 'false');
  PERFORM pg_temp.expect('14b: y no queda registrada', (answer::jsonb)->>'invited_at', NULL);
  PERFORM pg_temp.as_user(coord, format('select set_exit_survey_opens_at(%L::timestamptz)::text', now() - interval '1 minute'));
  PERFORM pg_temp.expect('14b: sin invitación al inicio', ((pg_temp.status('inv'))->>'invited_at'), NULL);
  answer := pg_temp.as_user(pg_temp.id('u:inv'), 'select exit_survey_mark_invited()::text');
  PERFORM pg_temp.expect('14b: el PRIMER dispositivo obtiene el derecho (claimed = true)', (answer::jsonb)->>'claimed', 'true');
  PERFORM pg_temp.expect_true('14b: queda registrada en el servidor', (answer::jsonb->>'invited_at') IS NOT NULL);
  PERFORM pg_temp.expect('14b: el SEGUNDO (otra pestaña / otro dispositivo / reintento) no lo obtiene',
    (pg_temp.as_user(pg_temp.id('u:inv'), 'select exit_survey_mark_invited()::text')::jsonb)->>'claimed', 'false');
  PERFORM pg_temp.expect('14b: ni un tercero', (pg_temp.as_user(pg_temp.id('u:inv'), 'select exit_survey_mark_invited()::text')::jsonb)->>'claimed', 'false');
  PERFORM pg_temp.expect('14b: la fecha del reclamo no se mueve', (pg_temp.as_user(pg_temp.id('u:inv'), 'select exit_survey_mark_invited()::text')::jsonb)->>'invited_at', answer::jsonb->>'invited_at');
  PERFORM pg_temp.expect('14b: no depende del dispositivo: otra sesión del mismo alumno lo ve', ((pg_temp.status('inv'))->>'invited_at'), answer::jsonb->>'invited_at');
  PERFORM pg_temp.expect_true('14b: haber sido invitado NO impide contestar', (pg_temp.submit('inv'))::jsonb->>'saved' = 'true');
  PERFORM pg_temp.mk_participant('invdone');
  PERFORM pg_temp.submit('invdone');
  PERFORM pg_temp.expect('14b: quien ya contestó no obtiene la invitación', (pg_temp.as_user(pg_temp.id('u:invdone'), 'select exit_survey_mark_invited()::text')::jsonb)->>'claimed', 'false');
  PERFORM pg_temp.expect('14b: anónimo no puede', pg_temp.as_anon('select exit_survey_mark_invited()::text'), 'ERR:permission denied');
  PERFORM pg_temp.expect('14b: la tabla no se lee directo', pg_temp.as_user(pg_temp.id('u:inv'), 'select count(*)::text from exit_survey_invitations'), 'ERR:permission denied');

  -- ===== 14c. Ganador histórico de ensayo (de antes de la encuesta): su resultado no se toca ni se invalida ============
  PERFORM pg_temp.mk_participant('hist'); PERFORM pg_temp.stamp_ss('hist');
  ALTER TABLE raffle_winners DISABLE TRIGGER raffle_winners_require_survey; -- solo para simular una fila anterior a la migración
  INSERT INTO raffle_winners (edition_id, category_id, prize_id, participant_id, status, is_demo, confirmed_at)
    VALUES (ed, ss, prize_ss, pg_temp.id('p:hist'), 'confirmado', true, now()) RETURNING id INTO winner_row;
  ALTER TABLE raffle_winners ENABLE TRIGGER raffle_winners_require_survey;
  PERFORM pg_temp.expect_true('14c: sigue siendo ganador (sin encuesta, sin invalidarse)', participant_has_won(pg_temp.id('p:hist')) AND (SELECT status = 'confirmado' FROM raffle_winners WHERE id = winner_row));
  PERFORM pg_temp.expect_true('14c: su premio sigue visible para él', jsonb_array_length((pg_temp.as_user(pg_temp.id('u:hist'), 'select my_raffle_prizes()::text')::jsonb)->'prizes') = 1);
  PERFORM pg_temp.expect_true('14c: sin segundo premio: fuera de su categoría y de todos los conjuntos', participant_raffle_category(pg_temp.id('p:hist')) IS NULL AND NOT pg_temp.in_pool('hist', 'Sistema Solar'));
  PERFORM pg_temp.expect('14c: la Bitácora lo marca como ganador y sin categoría ofrecida', (pg_temp.raffle('hist'))->>'has_won', 'true');
  answer := pg_temp.as_user(pg_temp.id('u:hist'), 'select exit_survey_mark_invited()::text');
  PERFORM pg_temp.expect('14c: puede ser invitado a la encuesta (no es requisito para conservar su premio)', (answer::jsonb)->>'claimed', 'true');
  PERFORM pg_temp.expect('14c: y puede contestarla', (pg_temp.submit('hist'))::jsonb->>'saved', 'true');
  PERFORM pg_temp.expect_true('14c: contestarla no cambia su resultado', (SELECT status = 'confirmado' AND confirmed_at IS NOT NULL FROM raffle_winners WHERE id = winner_row));
  PERFORM pg_temp.expect('14c: ni lo devuelve al sorteo', pg_temp.in_pool('hist', 'Sistema Solar')::text, 'false');

  -- ===== 15. Limpieza: borrar al participante borra su encuesta (cascada) ==========================================
  PERFORM pg_temp.expect_true('15: existe la encuesta de X', pg_temp.surveyed('x'));
  DELETE FROM participants WHERE id = pg_temp.id('p:x');
  PERFORM pg_temp.expect('15: al borrar al participante desaparece su encuesta', (SELECT count(*)::text FROM exit_survey_responses WHERE participant_id = pg_temp.id('p:x')), '0');
END $survey$;

DO $summary$
DECLARE v_pass int; v_fail int; r record;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok) INTO v_pass, v_fail FROM es_results;
  FOR r IN SELECT * FROM es_results ORDER BY seq LOOP
    RAISE NOTICE '%', CASE WHEN r.ok THEN '  OK  | ' || r.name ELSE ' FAIL | ' || r.name || ' (' || r.detail || ')' END;
  END LOOP;
  RAISE EXCEPTION 'EXIT_SURVEY_OK: % passed, % failed', v_pass, v_fail;
END $summary$;
