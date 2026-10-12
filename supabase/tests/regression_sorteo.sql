-- Regresión vigente del sorteo. Ejecutar con psql -v ON_ERROR_STOP=1 en una base local/descartable.
-- Todos los fixtures viven dentro de una transacción que termina, a propósito, con
--   RAISE EXCEPTION 'RAFFLE REGRESSION: N passed, M failed'
-- (revierte todo). Éxito únicamente si el mensaje dice «0 failed».
--
-- Parte 1. Clasificación oficial por SELLOS (Universo, Galaxia, Sistema Solar): matriz completa, composición de
--          sellos (60 min = 2), tipos de actividad, categoría más alta, Bitácora = módulo administrativo, DEMO/real.
-- Parte 2. Administración de categorías (alternativas, validación, compatibilidad con clientes anteriores).
-- Parte 3. Operación del sorteo: roles, premios, sorteo idempotente, confirmación, no-show, invalidación, PII.
BEGIN;

CREATE TEMP TABLE rs_results (seq serial, ok boolean, name text, detail text) ON COMMIT DROP;
CREATE TEMP TABLE rs_ids (key text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE rs_cred (key text PRIMARY KEY, qr text NOT NULL, code text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE rs_expect (pkey text PRIMARY KEY, academic int, university_life int, expected text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM rs_ids WHERE key = p_key;
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
  INSERT INTO rs_results (ok, name, detail) VALUES (
    CASE WHEN p_want LIKE 'ERR:%' THEN coalesce(p_got, '') LIKE 'ERR:%' AND position(substr(p_want, 5) IN coalesce(p_got, '')) > 0
         ELSE p_got IS NOT DISTINCT FROM p_want END,
    p_name, format('esperado %s, obtenido %s', p_want, coalesce(p_got, 'NULL')));
END $f$;

CREATE FUNCTION pg_temp.expect_true(p_name text, p_cond boolean) RETURNS void LANGUAGE sql AS $f$
  SELECT pg_temp.expect(p_name, coalesce(p_cond, false)::text, 'true');
$f$;

CREATE FUNCTION pg_temp.mk_staff(p_key text, p_role text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); mail text := 'rs.' || p_key || '@test.invalid';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, '{}', '{}', now(), now());
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES (u, p_role, 'RS ' || p_key, true, mail);
  INSERT INTO staff_roles (user_id, role) VALUES (u, p_role);
  INSERT INTO rs_ids VALUES (p_key, u);
END $f$;

-- Alumno con cuenta y Aviso aceptado. rs_ids guarda 'u:<clave>' (usuario) y 'p:<clave>' (participante).
CREATE FUNCTION pg_temp.mk_participant(p_key text, p_demo boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); pid uuid; mail text := 'rs.' || p_key || '@test.invalid';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, '{}', '{}', now(), now());
  INSERT INTO participants (edition_id, email, full_name, origin, is_demo, auth_user_id)
  VALUES (active_edition_id(), mail, 'RS ' || p_key, 'demo', p_demo, u) RETURNING id INTO pid;
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (pid, u, 'RS ' || p_key)
  ON CONFLICT (participant_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = active_edition_id() AND pp.participant_id = pid;
  INSERT INTO rs_ids VALUES ('u:' || p_key, u), ('p:' || p_key, pid);
END $f$;

-- Taller con UNA sesión en curso de `p_minutes`. Los sellos de la sesión los fija la base según la duración.
CREATE FUNCTION pg_temp.mk_activity(p_key text, p_type text, p_category text, p_minutes int, p_demo boolean DEFAULT true, p_division uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE a uuid; s uuid; c jsonb;
BEGIN
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type, experience_category)
  VALUES (active_edition_id(), p_division, 'RS ' || p_key, p_demo, p_type, p_category) RETURNING id INTO a;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status)
  VALUES (a, now() - interval '5 min', now() - interval '5 min' + make_interval(mins => p_minutes), 500, p_demo, 'activa')
  RETURNING id INTO s;
  c := rotate_activity_credential(a);
  INSERT INTO rs_ids VALUES ('a:' || p_key, a), ('s:' || p_key, s);
  INSERT INTO rs_cred VALUES (p_key, c->>'qr_token', c->>'manual_code');
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

-- Categoría alcanzada según el motor del sorteo («—» = sin categoría).
CREATE FUNCTION pg_temp.category_of(p_pkey text) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce((SELECT name FROM raffle_categories WHERE id = participant_raffle_category(pg_temp.id('p:' || p_pkey))), '—');
$f$;

-- Lo que ve el alumno en su Bitácora (RPC real, con su sesión).
CREATE FUNCTION pg_temp.passport(p_pkey text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(pg_temp.id('u:' || p_pkey), 'select my_raffle_status()')::jsonb;
$f$;

CREATE FUNCTION pg_temp.demo_category(p_name text, p_demo boolean DEFAULT true) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM raffle_categories WHERE edition_id = active_edition_id() AND name = p_name AND is_demo = p_demo;
$f$;

-- =====================================================================================================================
-- Fixtures
-- =====================================================================================================================
DO $fixtures$
DECLARE v_div uuid; v_div_lider uuid; i int;
BEGIN
  IF (SELECT mode FROM editions WHERE id = active_edition_id()) <> 'preparacion' THEN RAISE EXCEPTION 'TEST_REQUIRES_PREPARACION'; END IF;
  PERFORM pg_temp.mk_staff('coord', 'coordinacion');
  PERFORM pg_temp.mk_staff('staff', 'staff');
  PERFORM pg_temp.mk_staff('sorteo', 'sorteo');
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('rs-div', 'RS División DEMO', 9990, true) RETURNING id INTO v_div;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('rs-liderazgo', 'RS Liderazgo DEMO', 9991, true) RETURNING id INTO v_div_lider;

  -- Académicos: 60 min = 2 sellos; 30 y 45 min = 1 sello.
  PERFORM pg_temp.mk_activity('acad60_1', 'academica', NULL, 60, true, v_div);
  PERFORM pg_temp.mk_activity('acad60_2', 'academica', NULL, 60, true, v_div);
  FOR i IN 1..5 LOOP PERFORM pg_temp.mk_activity('acad30_' || i, 'academica', NULL, 30, true, v_div); END LOOP;
  PERFORM pg_temp.mk_activity('acad45', 'academica', NULL, 45, true, v_div);
  -- Académico de una división llamada «Liderazgo»: sigue siendo académico.
  PERFORM pg_temp.mk_activity('acad_div_liderazgo', 'academica', NULL, 30, true, v_div_lider);
  -- Vida Universitaria (cualquier categoría de experiencia): 60 min = 2 sellos; 15 y 45 min = 1 sello.
  PERFORM pg_temp.mk_activity('vida60_1', 'vida_universitaria', 'deportiva', 60);
  PERFORM pg_temp.mk_activity('vida60_2', 'vida_universitaria', 'artistica_cultural', 60);
  FOR i IN 1..5 LOOP PERFORM pg_temp.mk_activity('vida15_' || i, 'vida_universitaria', 'otra', 15); END LOOP;
  PERFORM pg_temp.mk_activity('vida45', 'vida_universitaria', 'vida_universitaria', 45);
  PERFORM pg_temp.mk_activity('vida_cat_liderazgo', 'vida_universitaria', 'liderazgo', 30);
  -- Tipo anterior al catálogo oficial (solo datos DEMO antiguos): cuenta como Vida Universitaria.
  PERFORM pg_temp.mk_activity('tipo_liderazgo', 'liderazgo', NULL, 30, true, v_div);
  -- Catálogo REAL, para el aislamiento.
  PERFORM pg_temp.mk_activity('real_acad60', 'academica', NULL, 60, false);
  PERFORM pg_temp.mk_activity('real_vida60', 'vida_universitaria', 'deportiva', 60, false);
END $fixtures$;

-- =====================================================================================================================
-- Parte 1. Clasificación oficial
-- =====================================================================================================================
DO $classification$
DECLARE
  r record; st jsonb; view jsonb; answer text;
  coord uuid := pg_temp.id('coord'); sorteo uuid := pg_temp.id('sorteo');
BEGIN
  -- 1.1 Las categorías oficiales existen en DEMO y en real, con sus alternativas exactas; las antiguas ya no.
  FOR r IN SELECT * FROM (VALUES
      ('Sistema Solar', 10, '[{"academic": 1, "university_life": 1}]'::jsonb),
      ('Galaxia',       20, '[{"academic": 2, "university_life": 1}, {"total": 4}]'::jsonb),
      ('Universo',      30, '[{"academic": 3, "university_life": 1}, {"academic": 2, "university_life": 2}]'::jsonb)
    ) AS t(name, sort_order, rules) LOOP
    PERFORM pg_temp.expect_true(format('oficial: %s existe en DEMO y real con sus reglas', r.name),
      (SELECT count(*) = 2 AND bool_and(rc.rules = r.rules AND rc.sort_order = r.sort_order AND rc.is_active)
       FROM raffle_categories rc WHERE rc.edition_id = active_edition_id() AND rc.name = r.name));
  END LOOP;
  PERFORM pg_temp.expect_true('oficial: ya no existen Baja / Media / Mayor',
    NOT EXISTS (SELECT 1 FROM raffle_categories WHERE edition_id = active_edition_id() AND name IN ('Baja', 'Media', 'Mayor')));

  -- 1.2 Matriz oficial (académicos, Vida Universitaria) → categoría. Las diez primeras filas son las del reglamento.
  INSERT INTO rs_expect (pkey, academic, university_life, expected) VALUES
    ('m10', 1, 0, '—'), ('m11', 1, 1, 'Sistema Solar'), ('m12', 1, 2, 'Sistema Solar'), ('m21', 2, 1, 'Galaxia'),
    ('m22', 2, 2, 'Universo'), ('m31', 3, 1, 'Universo'), ('m40', 4, 0, 'Galaxia'), ('m04', 0, 4, 'Galaxia'),
    ('m30', 3, 0, '—'), ('m13', 1, 3, 'Galaxia'),
    ('m00', 0, 0, '—'), ('m01', 0, 1, '—'), ('m20', 2, 0, '—'), ('m02', 0, 2, '—'), ('m03', 0, 3, '—'),
    ('m41', 4, 1, 'Universo'), ('m50', 5, 0, 'Galaxia'), ('m05', 0, 5, 'Galaxia'), ('m33', 3, 3, 'Universo'),
    ('m23', 2, 3, 'Universo'), ('m32', 3, 2, 'Universo');
  FOR r IN SELECT * FROM rs_expect ORDER BY pkey LOOP
    PERFORM pg_temp.mk_participant(r.pkey);
    PERFORM pg_temp.give(r.pkey, r.academic, r.university_life);
  END LOOP;
  -- Misma cantidad de sellos reunida solo con talleres de 1 sello: el resultado no depende de la composición.
  INSERT INTO rs_expect (pkey, academic, university_life, expected) VALUES
    ('s21', 2, 1, 'Galaxia'), ('s22', 2, 2, 'Universo'), ('s40', 4, 0, 'Galaxia'), ('s31', 3, 1, 'Universo'), ('s30', 3, 0, '—');
  FOR r IN SELECT * FROM rs_expect WHERE pkey LIKE 's%' ORDER BY pkey LOOP
    PERFORM pg_temp.mk_participant(r.pkey);
    PERFORM pg_temp.give(r.pkey, r.academic, r.university_life, true);
  END LOOP;

  FOR r IN SELECT * FROM rs_expect ORDER BY pkey LOOP
    PERFORM pg_temp.expect(format('matriz %s: %s académicos + %s Vida Universitaria → %s', r.pkey, r.academic, r.university_life, r.expected),
      pg_temp.category_of(r.pkey), r.expected);
    -- 1.3 Bitácora (RPC del alumno): mismos sellos por tipo, mismo total y misma categoría.
    st := pg_temp.passport(r.pkey);
    PERFORM pg_temp.expect(format('bitácora %s: sellos y categoría', r.pkey),
      format('%s+%s=%s %s', st->>'academic_stamps', st->>'university_life_stamps', st->>'total_stamps', coalesce(st->>'raffle_category_name', '—')),
      format('%s+%s=%s %s', r.academic, r.university_life, r.academic + r.university_life, r.expected));
    PERFORM pg_temp.expect_true(format('bitácora %s: total = sellos de la Bitácora (my_stamp_count)', r.pkey),
      (st->>'total_stamps')::int = my_stamp_count(pg_temp.id('p:' || r.pkey)));
  END LOOP;
  st := pg_temp.passport('m11');
  PERFORM pg_temp.expect_true('bitácora: incluye las categorías vigentes de su modo, de menor a mayor',
    (SELECT array_agg(c->>'name' ORDER BY ord) FROM jsonb_array_elements(st->'categories') WITH ORDINALITY x(c, ord)) = ARRAY['Sistema Solar', 'Galaxia', 'Universo']
    AND st->'categories'->1->'rules' = '[{"academic": 2, "university_life": 1}, {"total": 4}]'::jsonb);
  PERFORM pg_temp.expect_true('bitácora: conserva las claves anteriores con el valor en sellos',
    (pg_temp.passport('m40')->>'academic_tickets')::int = 4 AND (pg_temp.passport('m13')->>'leadership_tickets')::int = 3);

  -- 1.4 Un taller de 60 minutos aporta 2 sellos de su tipo (no 1 taller = 1).
  PERFORM pg_temp.expect_true('60 min: m40 llegó a 4 académicos con solo 2 talleres',
    (SELECT count(*) = 2 AND sum(credits_granted) = 4 FROM attendances WHERE participant_id = pg_temp.id('p:m40')));
  PERFORM pg_temp.expect_true('60 min: m04 llegó a 4 de Vida Universitaria con solo 2 talleres',
    (SELECT count(*) = 2 AND sum(credits_granted) = 4 FROM attendances WHERE participant_id = pg_temp.id('p:m04')));

  -- 1.5 Tipos de actividad: decide el tipo, no la palabra «liderazgo».
  PERFORM pg_temp.mk_participant('tipos');
  PERFORM pg_temp.attend('tipos', 'acad_div_liderazgo');
  PERFORM pg_temp.expect('tipos: académico de la división «Liderazgo» = académico',
    (SELECT format('%s+%s', academic, university_life) FROM participant_stamps(pg_temp.id('p:tipos'))), '1+0');
  PERFORM pg_temp.attend('tipos', 'vida_cat_liderazgo');
  PERFORM pg_temp.expect('tipos: Vida Universitaria con categoría «liderazgo» = Vida Universitaria',
    (SELECT format('%s+%s', academic, university_life) FROM participant_stamps(pg_temp.id('p:tipos'))), '1+1');
  PERFORM pg_temp.attend('tipos', 'tipo_liderazgo');
  PERFORM pg_temp.expect('tipos: tipo anterior «liderazgo» = Vida Universitaria',
    (SELECT format('%s+%s', academic, university_life) FROM participant_stamps(pg_temp.id('p:tipos'))), '1+2');
  PERFORM pg_temp.attend('tipos', 'vida45');
  PERFORM pg_temp.attend('tipos', 'acad45');
  PERFORM pg_temp.expect('tipos: 45 minutos = 1 sello de su tipo',
    (SELECT format('%s+%s', academic, university_life) FROM participant_stamps(pg_temp.id('p:tipos'))), '2+3');
  INSERT INTO rs_expect VALUES ('tipos', 2, 3, 'Universo');
  PERFORM pg_temp.expect('tipos: 2+3 → Universo', pg_temp.category_of('tipos'), 'Universo');

  -- 1.6 De punta a punta con check_in real (QR y código manual), como lo vive el alumno.
  PERFORM pg_temp.mk_participant('e2e_galaxia');
  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES
    (pg_temp.id('p:e2e_galaxia'), pg_temp.id('s:acad60_1'), pg_temp.id('a:acad60_1')),
    (pg_temp.id('p:e2e_galaxia'), pg_temp.id('s:vida45'), pg_temp.id('a:vida45'));
  answer := pg_temp.as_user(pg_temp.id('u:e2e_galaxia'), format('select check_in(%L)', (SELECT qr FROM rs_cred WHERE key = 'acad60_1')));
  PERFORM pg_temp.expect('e2e: QR en académico de 60 min acredita 2 sellos', (answer::jsonb->>'credits_granted'), '2');
  PERFORM pg_temp.expect('e2e: con 2 académicos y 0 de Vida Universitaria aún no hay categoría', pg_temp.category_of('e2e_galaxia'), '—');
  answer := pg_temp.as_user(pg_temp.id('u:e2e_galaxia'), format('select check_in(%L)', (SELECT code FROM rs_cred WHERE key = 'vida45')));
  PERFORM pg_temp.expect('e2e: código manual en Vida Universitaria de 45 min acredita 1 sello', (answer::jsonb->>'credits_granted'), '1');
  st := pg_temp.passport('e2e_galaxia');
  PERFORM pg_temp.expect('e2e: académico 60 + Vida Universitaria 45 → Galaxia (2+1)',
    format('%s+%s %s', st->>'academic_stamps', st->>'university_life_stamps', st->>'raffle_category_name'), '2+1 Galaxia');
  answer := pg_temp.as_user(pg_temp.id('u:e2e_galaxia'), format('select check_in(%L)', (SELECT qr FROM rs_cred WHERE key = 'vida45')));
  st := pg_temp.passport('e2e_galaxia');
  PERFORM pg_temp.expect('e2e: volver a escanear no cambia sellos ni categoría',
    format('%s %s+%s %s', answer::jsonb->>'already_registered', st->>'academic_stamps', st->>'university_life_stamps', st->>'raffle_category_name'),
    'true 2+1 Galaxia');
  INSERT INTO rs_expect VALUES ('e2e_galaxia', 2, 1, 'Galaxia');

  PERFORM pg_temp.mk_participant('e2e_universo');
  INSERT INTO reservations (participant_id, session_id, activity_id) VALUES
    (pg_temp.id('p:e2e_universo'), pg_temp.id('s:acad60_2'), pg_temp.id('a:acad60_2')),
    (pg_temp.id('p:e2e_universo'), pg_temp.id('s:vida60_1'), pg_temp.id('a:vida60_1'));
  answer := pg_temp.as_user(pg_temp.id('u:e2e_universo'), format('select check_in(%L)', (SELECT code FROM rs_cred WHERE key = 'acad60_2')));
  PERFORM pg_temp.expect('e2e: código manual en académico de 60 min acredita 2 sellos', (answer::jsonb->>'credits_granted'), '2');
  answer := pg_temp.as_user(pg_temp.id('u:e2e_universo'), format('select check_in(%L)', (SELECT qr FROM rs_cred WHERE key = 'vida60_1')));
  PERFORM pg_temp.expect('e2e: QR en Vida Universitaria de 60 min acredita 2 sellos', (answer::jsonb->>'credits_granted'), '2');
  st := pg_temp.passport('e2e_universo');
  PERFORM pg_temp.expect('e2e: dos talleres de 60 min (académico + Vida Universitaria) → Universo (2+2)',
    format('%s+%s=%s %s', st->>'academic_stamps', st->>'university_life_stamps', st->>'total_stamps', st->>'raffle_category_name'), '2+2=4 Universo');
  PERFORM pg_temp.expect('e2e: la Bitácora (my_progress) muestra los mismos 4 sellos en 2 talleres',
    (SELECT format('%s/%s', x->>'stamps', x->>'attended_workshops') FROM (SELECT pg_temp.as_user(pg_temp.id('u:e2e_universo'), 'select my_progress()')::jsonb x) q), '4/2');
  INSERT INTO rs_expect VALUES ('e2e_universo', 2, 2, 'Universo');

  -- 1.7 Aislamiento DEMO / real: un alumno real se clasifica en las categorías reales y nunca en las DEMO.
  PERFORM pg_temp.mk_participant('real22', false);
  PERFORM pg_temp.attend('real22', 'real_acad60');
  PERFORM pg_temp.attend('real22', 'real_vida60');
  PERFORM pg_temp.expect_true('aislamiento: alumno real 2+2 → Universo REAL (no el DEMO)',
    participant_raffle_category(pg_temp.id('p:real22')) = pg_temp.demo_category('Universo', false));
  answer := pg_temp.as_user(pg_temp.id('u:m10'), format('select check_in(%L)', (SELECT qr FROM rs_cred WHERE key = 'real_acad60')));
  PERFORM pg_temp.expect('aislamiento: un alumno DEMO no puede registrar asistencia a un taller real', answer, 'ERR:INVALID_CREDENTIAL');

  -- 1.8 Módulo administrativo = Bitácora: los candidatos por categoría son exactamente los clasificados arriba,
  --     cada alumno aparece solo en su categoría MÁS ALTA y el alumno real no entra a las DEMO.
  view := pg_temp.as_user(coord, 'select raffle_operator_view()')::jsonb;
  FOR r IN SELECT rc.id, rc.name, rc.is_demo FROM raffle_categories rc WHERE rc.edition_id = active_edition_id() ORDER BY rc.is_demo, rc.sort_order LOOP
    PERFORM pg_temp.expect(format('admin: candidatos de %s (%s)', r.name, CASE WHEN r.is_demo THEN 'DEMO' ELSE 'real' END),
      (SELECT c->>'pool_count' FROM jsonb_array_elements(view->'categories') c WHERE c->>'id' = r.id::text),
      CASE WHEN r.is_demo THEN (SELECT count(*)::text FROM rs_expect WHERE expected = r.name)
           WHEN r.name = 'Universo' THEN '1' ELSE '0' END);
    PERFORM pg_temp.expect(format('admin: raffle_pool_count coincide en %s (%s)', r.name, CASE WHEN r.is_demo THEN 'DEMO' ELSE 'real' END),
      pg_temp.as_user(coord, format('select raffle_pool_count(%L)', r.id)),
      (SELECT c->>'pool_count' FROM jsonb_array_elements(view->'categories') c WHERE c->>'id' = r.id::text));
  END LOOP;
  PERFORM pg_temp.expect_true('admin: nadie cuenta en dos categorías (suma de candidatos DEMO = alumnos clasificados)',
    (SELECT sum((c->>'pool_count')::int) FROM jsonb_array_elements(view->'categories') c WHERE (c->>'is_demo')::boolean)
      = (SELECT count(*) FROM rs_expect WHERE expected <> '—'));
  PERFORM pg_temp.expect_true('admin: cada categoría expone sus alternativas',
    (SELECT bool_and(jsonb_typeof(c->'rules') = 'array' AND jsonb_array_length(c->'rules') >= 1) FROM jsonb_array_elements(view->'categories') c));
  -- Sin categoría: se agrupan por combinación de sellos (solo quienes tienen al menos un sello).
  PERFORM pg_temp.expect('admin: combinaciones sin categoría',
    (SELECT string_agg(format('%s+%s×%s', c->>'academic', c->>'university_life', c->>'count'), ' ' ORDER BY (c->>'academic')::int DESC, (c->>'university_life')::int DESC)
     FROM jsonb_array_elements(view->'unassigned_combinations') c),
    (SELECT string_agg(format('%s+%s×%s', academic, university_life, n), ' ' ORDER BY academic DESC, university_life DESC)
     FROM (SELECT academic, university_life, count(*) n FROM rs_expect WHERE expected = '—' AND academic + university_life > 0 GROUP BY 1, 2) g));
  -- Rol Sorteo en preparación: solo ve y opera las categorías DEMO.
  view := pg_temp.as_user(sorteo, 'select raffle_operator_view()')::jsonb;
  PERFORM pg_temp.expect_true('aislamiento: Sorteo en preparación solo ve categorías DEMO, con los mismos candidatos',
    (SELECT count(*) = 3 AND bool_and((c->>'is_demo')::boolean
        AND (c->>'pool_count')::int = (SELECT count(*) FROM rs_expect e WHERE e.expected = c->>'name'))
     FROM jsonb_array_elements(view->'categories') c));
  PERFORM pg_temp.expect('aislamiento: Sorteo no puede consultar el pool real',
    pg_temp.as_user(sorteo, format('select raffle_pool_count(%L)', pg_temp.demo_category('Universo', false))), 'ERR:NOT_AUTHORIZED');

  -- 1.9 Al sumar sellos se sube de categoría y se deja la anterior (nunca se acumulan).
  PERFORM pg_temp.expect('sube: 1+1 empieza en Sistema Solar', pg_temp.category_of('m11'), 'Sistema Solar');
  PERFORM pg_temp.attend('m11', 'acad30_5');
  PERFORM pg_temp.expect('sube: con un académico más (2+1) pasa a Galaxia', pg_temp.category_of('m11'), 'Galaxia');
  PERFORM pg_temp.attend('m11', 'vida15_5');
  PERFORM pg_temp.expect('sube: con otro de Vida Universitaria (2+2) pasa a Universo', pg_temp.category_of('m11'), 'Universo');
  PERFORM pg_temp.expect_true('sube: ya no cuenta en Sistema Solar ni en Galaxia',
    (SELECT count(*) FROM raffle_categories rc WHERE rc.is_demo AND rc.edition_id = active_edition_id()
       AND participant_raffle_category(pg_temp.id('p:m11')) = rc.id) = 1);
END $classification$;

-- =====================================================================================================================
-- Parte 2. Administración de categorías
-- =====================================================================================================================
DO $categories$
DECLARE
  coord uuid := pg_temp.id('coord'); staff uuid := pg_temp.id('staff'); sorteo uuid := pg_temp.id('sorteo');
  answer text; v_extra uuid; v_legacy uuid; r record;
BEGIN
  PERFORM pg_temp.expect_true('rol: Sorteo lee categorías con sus alternativas',
    (SELECT count(*) = 3 AND bool_and(jsonb_typeof(c->'rules') = 'array')
     FROM jsonb_array_elements(pg_temp.as_user(sorteo, 'select raffle_categories_read()')::jsonb) c));
  PERFORM pg_temp.expect('rol: Staff no administra categorías',
    pg_temp.as_user(staff, $q$select save_raffle_category('{"name": "RS No", "rules": [{"total": 1}]}')$q$), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('rol: Sorteo no administra categorías',
    pg_temp.as_user(sorteo, $q$select save_raffle_category('{"name": "RS No", "rules": [{"total": 1}]}')$q$), 'ERR:NOT_AUTHORIZED');

  -- Alternativas inválidas.
  FOR r IN SELECT * FROM (VALUES
      ('lista vacía', '[]'), ('no es lista', '{"academic": 1}'), ('negativo', '[{"academic": -1}]'),
      ('texto', '[{"academic": "2"}]'), ('decimal', '[{"total": 1.5}]'), ('clave desconocida', '[{"leadership": 1}]'),
      ('alternativa no objeto', '[3]'), ('demasiado grande', '[{"total": 1000}]')
    ) AS t(label, rules) LOOP
    PERFORM pg_temp.expect(format('validación: se rechaza %s', r.label),
      pg_temp.as_user(coord, format('select save_raffle_category(%L::jsonb)', jsonb_build_object('name', 'RS Inválida', 'is_demo', true, 'rules', r.rules::jsonb)::text)),
      'ERR:INVALID_REQUIREMENTS');
  END LOOP;
  BEGIN
    UPDATE raffle_categories SET rules = '[{"academic": -3}]' WHERE id = pg_temp.demo_category('Galaxia');
    PERFORM pg_temp.expect('validación: la tabla rechaza reglas inválidas aunque no pasen por el RPC', 'aceptó', 'ERR:INVALID_REQUIREMENTS');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.expect('validación: la tabla rechaza reglas inválidas aunque no pasen por el RPC', 'ERR:' || SQLERRM, 'ERR:INVALID_REQUIREMENTS');
  END;

  -- Una categoría nueva, más alta, con una alternativa por total: se asigna la MÁS ALTA alcanzada.
  answer := pg_temp.as_user(coord, $q$select save_raffle_category('{"name": "RS Cinco", "sort_order": 40, "is_demo": true, "rules": [{"academic": 5}, {"university_life": 5}]}')$q$);
  PERFORM pg_temp.expect_true('categoría: Coordinación crea una categoría con alternativas', answer NOT LIKE 'ERR:%');
  v_extra := answer::uuid;
  PERFORM pg_temp.expect('categoría: 5+0 sube a la nueva categoría más alta', pg_temp.category_of('m50'), 'RS Cinco');
  PERFORM pg_temp.expect('categoría: 0+5 la alcanza por la segunda alternativa', pg_temp.category_of('m05'), 'RS Cinco');
  PERFORM pg_temp.expect('categoría: 4+1 no la alcanza y conserva Universo', pg_temp.category_of('m41'), 'Universo');
  PERFORM pg_temp.expect_true('categoría: las columnas anteriores reflejan la primera alternativa',
    (SELECT required_academic = 5 AND required_leadership = 0 FROM raffle_categories WHERE id = v_extra));
  PERFORM pg_temp.expect_true('categoría: queda auditada con sus reglas',
    EXISTS (SELECT 1 FROM audit_log WHERE action = 'raffle.category_saved' AND detail->>'id' = v_extra::text AND jsonb_array_length(detail->'rules') = 2));
  answer := pg_temp.as_user(coord, format($q$select save_raffle_category('{"id": "%s", "name": "RS Cinco", "sort_order": 40, "is_active": false, "rules": [{"academic": 5}, {"university_life": 5}]}')$q$, v_extra));
  PERFORM pg_temp.expect('categoría: al desactivarla, 5+0 vuelve a Galaxia', pg_temp.category_of('m50'), 'Galaxia');

  -- Cliente anterior: solo envía required_academic / required_leadership.
  answer := pg_temp.as_user(coord, $q$select save_raffle_category('{"name": "RS Antigua", "sort_order": 5, "is_demo": true, "required_academic": 1, "required_leadership": 0}')$q$);
  v_legacy := answer::uuid;
  PERFORM pg_temp.expect_true('compatibilidad: el formato anterior se guarda como alternativa única',
    (SELECT rules = '[{"academic": 1, "university_life": 0}]'::jsonb FROM raffle_categories WHERE id = v_legacy));
  PERFORM pg_temp.expect('compatibilidad: 1+0 entra a esa categoría', pg_temp.category_of('m10'), 'RS Antigua');
  PERFORM pg_temp.expect('compatibilidad: 3+0 también (y sigue sin Galaxia)', pg_temp.category_of('m30'), 'RS Antigua');
  UPDATE raffle_categories SET required_academic = 3 WHERE id = v_legacy;
  PERFORM pg_temp.expect_true('compatibilidad: escribir la columna anterior actualiza la alternativa',
    (SELECT rules = '[{"academic": 3, "university_life": 0}]'::jsonb FROM raffle_categories WHERE id = v_legacy));
  PERFORM pg_temp.expect('compatibilidad: 1+0 ya no la alcanza', pg_temp.category_of('m10'), '—');
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_demo)
  VALUES (active_edition_id(), 'RS Alta directa', 1, 0, 3, true);
  PERFORM pg_temp.expect_true('compatibilidad: un alta directa sin reglas toma su condición de las columnas anteriores',
    (SELECT rules = '[{"academic": 0, "university_life": 3}]'::jsonb FROM raffle_categories WHERE name = 'RS Alta directa'));
  PERFORM pg_temp.expect('compatibilidad: 0+3 la alcanza', pg_temp.category_of('m03'), 'RS Alta directa');
  DELETE FROM raffle_categories WHERE name IN ('RS Cinco', 'RS Antigua', 'RS Alta directa');
  PERFORM pg_temp.expect('categoría: sin las categorías de prueba, 3+0 vuelve a no tener categoría', pg_temp.category_of('m30'), '—');

  -- Los auxiliares internos no son ejecutables por usuarios autenticados.
  FOR r IN SELECT * FROM (VALUES
      ('participant_tickets', format('select participant_tickets(%L)', pg_temp.id('p:m11'))),
      ('participant_stamps', format('select academic from participant_stamps(%L)', pg_temp.id('p:m11'))),
      ('participant_raffle_category', format('select participant_raffle_category(%L)', pg_temp.id('p:m11'))),
      ('raffle_rules_met', $q$select raffle_rules_met('[{"total": 1}]', 9, 9)$q$),
      ('raffle_rules_valid', $q$select raffle_rules_valid('[{"total": 1}]')$q$),
      ('session_stamp_credits', 'select session_stamp_credits(now(), now())')
    ) AS t(fn, q) LOOP
    PERFORM pg_temp.expect(format('helper: %s no ejecutable por Sorteo', r.fn), pg_temp.as_user(sorteo, r.q), 'ERR:permission denied');
    PERFORM pg_temp.expect(format('helper: %s no ejecutable por un alumno', r.fn), pg_temp.as_user(pg_temp.id('u:m11'), r.q), 'ERR:permission denied');
  END LOOP;
END $categories$;

-- =====================================================================================================================
-- Parte 3. Operación del sorteo (premios y ganadores) con las categorías oficiales
-- =====================================================================================================================
DO $operation$
DECLARE
  coord uuid := pg_temp.id('coord'); staff uuid := pg_temp.id('staff'); sorteo uuid := pg_temp.id('sorteo');
  cat_ss uuid := pg_temp.demo_category('Sistema Solar'); cat_uni uuid := pg_temp.demo_category('Universo');
  cat_uni_real uuid := pg_temp.demo_category('Universo', false);
  prize_ss uuid; prize_uni uuid; prize_inactive uuid; prize_chain uuid; prize_pending uuid; prize_real uuid;
  answer text; first_no_show uuid; winner uuid; st jsonb;
BEGIN
  -- Pools controlados: se retiran las asistencias de la Parte 1 (menos las del alumno real).
  DELETE FROM attendances WHERE participant_id IN (SELECT id FROM participants WHERE is_demo AND email LIKE 'rs.%@test.invalid');
  -- o1: 1+0 sin categoría · o2: 3+1 Universo (único) · o3 y o4: 1+1 Sistema Solar.
  PERFORM pg_temp.mk_participant('o1'); PERFORM pg_temp.give('o1', 1, 0);
  PERFORM pg_temp.mk_participant('o2'); PERFORM pg_temp.give('o2', 3, 1);
  PERFORM pg_temp.mk_participant('o3'); PERFORM pg_temp.give('o3', 1, 1);
  PERFORM pg_temp.mk_participant('o4'); PERFORM pg_temp.give('o4', 1, 1);
  PERFORM pg_temp.expect('pool: o1 sin categoría', pg_temp.category_of('o1'), '—');
  PERFORM pg_temp.expect('pool: o2 Universo', pg_temp.category_of('o2'), 'Universo');
  PERFORM pg_temp.expect('pool: o3 Sistema Solar', pg_temp.category_of('o3'), 'Sistema Solar');
  PERFORM pg_temp.expect('pool: o4 Sistema Solar', pg_temp.category_of('o4'), 'Sistema Solar');

  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (active_edition_id(), cat_ss, 'RS Premio Sistema Solar', 2, true, 1, true) RETURNING id INTO prize_ss;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (active_edition_id(), cat_uni, 'RS Premio Universo', 1, true, 1, true) RETURNING id INTO prize_uni;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (active_edition_id(), cat_ss, 'RS Premio Inactivo', 1, false, 0, true) RETURNING id INTO prize_inactive;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (active_edition_id(), cat_ss, 'RS Premio Cadena', 1, true, 2, true) RETURNING id INTO prize_chain;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (active_edition_id(), cat_ss, 'RS Premio Pending', 1, true, 3, true) RETURNING id INTO prize_pending;

  -- Roles y premios.
  PERFORM pg_temp.expect('rol: Staff no sortea', pg_temp.as_user(staff, format('select draw_winner(%L, %L)', prize_ss, 'rs-staff')), 'ERR:NOT_AUTHORIZED');
  PERFORM pg_temp.expect('helper: get_pending_winner no ejecutable por auth', pg_temp.as_user(sorteo, format('select get_pending_winner(%L)', prize_ss)), 'ERR:permission denied');
  PERFORM pg_temp.expect('premio inactivo: draw_winner rechaza', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_inactive, 'rs-inactive')), 'ERR:PRIZE_INACTIVE');
  PERFORM pg_temp.expect_true('premio: Sorteo ve los premios de una categoría oficial',
    (SELECT count(*) = 4 FROM jsonb_array_elements(pg_temp.as_user(sorteo, format('select raffle_prizes_read(%L)', cat_ss))::jsonb)));
  PERFORM pg_temp.expect('premio: sin candidatos en Galaxia el pool está vacío',
    pg_temp.as_user(coord, format($q$select draw_winner((select save_raffle_prize('{"category_id": "%s", "name": "RS Premio Galaxia", "quantity": 1, "is_active": true, "sort_order": 1}')), 'rs-galaxia')$q$, pg_temp.demo_category('Galaxia'))),
    'ERR:POOL_EMPTY');

  -- Cadena de no-show: A no se presenta → B → B no se presenta → A vuelve a ser elegible.
  answer := pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_chain, 'ch1'));
  PERFORM pg_temp.expect_true('cadena: primer sorteo (Sistema Solar: o3 y o4)',
    answer NOT LIKE 'ERR:%' AND (answer::jsonb->>'participant_id')::uuid IN (pg_temp.id('p:o3'), pg_temp.id('p:o4'))
    AND (answer::jsonb->>'category_name') = 'Sistema Solar' AND (answer::jsonb->>'pool_size')::int = 2);
  first_no_show := (answer::jsonb->>'participant_id')::uuid;
  PERFORM pg_temp.expect('cadena: no-show A', pg_temp.as_user(sorteo, format($q$select mark_no_show((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_chain)), 'no_presentado');
  -- Toda la suite comparte now(): se distinguen las rondas como solicitudes reales separadas.
  UPDATE raffle_winners SET drawn_at = now() - interval '2 seconds' WHERE prize_id = prize_chain AND status = 'no_presentado';
  answer := pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_chain, 'ch2'));
  PERFORM pg_temp.expect_true('cadena: el re-sorteo elige a B, distinto de A',
    answer NOT LIKE 'ERR:%' AND (answer::jsonb->>'participant_id')::uuid IN (pg_temp.id('p:o3'), pg_temp.id('p:o4'))
    AND (answer::jsonb->>'participant_id')::uuid <> first_no_show);
  PERFORM pg_temp.expect('cadena: no-show B', pg_temp.as_user(sorteo, format($q$select mark_no_show((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_chain)), 'no_presentado');
  UPDATE raffle_winners SET drawn_at = now() - interval '1 second' WHERE prize_id = prize_chain AND status = 'no_presentado' AND participant_id <> first_no_show;
  PERFORM pg_temp.expect_true('cadena: A vuelve a ser elegible en Sistema Solar', participant_raffle_category(first_no_show) = cat_ss);
  PERFORM pg_temp.expect_true('cadena: tercer sorteo exitoso',
    pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_chain, 'ch3')) NOT LIKE 'ERR:%');

  -- Recuperación de una selección pendiente.
  PERFORM pg_temp.expect('pending: mientras hay un seleccionado, el otro premio solo ve a quien queda libre',
    pg_temp.as_user(sorteo, format($q$select (draw_winner(%L, 'pk1')->>'pool_size')$q$, prize_pending)), '1');
  st := pg_temp.as_user(sorteo, format('select raffle_pending_selection(%L)', prize_pending))::jsonb;
  PERFORM pg_temp.expect_true('pending: la recuperación trae nombre, premio y categoría oficial',
    st ? 'display_name' AND st ? 'prize_name' AND (st->>'category_name') = 'Sistema Solar');
  PERFORM pg_temp.expect('cadena: libera la tercera selección', pg_temp.as_user(sorteo, format($q$select mark_no_show((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_chain)), 'no_presentado');
  PERFORM pg_temp.expect('pending: libera la selección', pg_temp.as_user(sorteo, format($q$select mark_no_show((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_pending)), 'no_presentado');

  -- Sorteo, idempotencia, confirmación e inventario.
  answer := pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_ss, 'rs-key-1'));
  PERFORM pg_temp.expect_true('sorteo: sortear premio Sistema Solar', answer NOT LIKE 'ERR:%' AND (answer::jsonb->>'status') = 'seleccionado');
  PERFORM pg_temp.expect_true('sorteo: un ganador seleccionado', (SELECT count(*) = 1 FROM raffle_winners WHERE prize_id = prize_ss AND status = 'seleccionado'));
  PERFORM pg_temp.expect('sorteo: idempotencia con la misma clave', pg_temp.as_user(sorteo, format($q$select draw_winner(%L, 'rs-key-1')->>'idempotent'$q$, prize_ss)), 'true');
  PERFORM pg_temp.expect_true('sorteo: la misma clave no crea otro ganador', (SELECT count(*) = 1 FROM raffle_winners WHERE prize_id = prize_ss));
  PERFORM pg_temp.expect('sorteo: un pendiente bloquea un nuevo sorteo', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_ss, 'rs-key-2')), 'ERR:PENDING_SELECTION');
  PERFORM pg_temp.expect('sorteo: confirmar ganador', pg_temp.as_user(sorteo, format($q$select confirm_winner((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_ss)), 'confirmado');
  PERFORM pg_temp.expect_true('sorteo: el inventario descuenta',
    (SELECT (c->>'delivered')::int = 1 AND (c->>'available')::int = 1
     FROM jsonb_array_elements(pg_temp.as_user(sorteo, format('select raffle_prizes_read(%L)', cat_ss))::jsonb) c WHERE c->>'id' = prize_ss::text));
  SELECT participant_id INTO winner FROM raffle_winners WHERE prize_id = prize_ss AND status = 'confirmado';
  PERFORM pg_temp.expect_true('sorteo: el ganador confirmado sale del pool', participant_raffle_category(winner) IS NULL);
  st := pg_temp.as_user((SELECT auth_user_id FROM participants WHERE id = winner), 'select my_raffle_status()')::jsonb;
  PERFORM pg_temp.expect('sorteo: su Bitácora lo marca como ganador y conserva sus sellos',
    format('%s %s %s+%s', st->>'has_won', coalesce(st->>'raffle_category_name', '—'), st->>'academic_stamps', st->>'university_life_stamps'), 'true — 1+1');
  PERFORM pg_temp.expect('sorteo: el pool de Sistema Solar baja a 1', pg_temp.as_user(sorteo, format('select raffle_pool_count(%L)', cat_ss)), '1');
  PERFORM pg_temp.expect_true('sorteo: sortear la segunda unidad', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_ss, 'rs-key-3')) NOT LIKE 'ERR:%');
  PERFORM pg_temp.expect('sorteo: confirmar segundo ganador', pg_temp.as_user(sorteo, format($q$select confirm_winner((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_ss)), 'confirmado');
  PERFORM pg_temp.expect_true('sorteo: dos ganadores distintos, uno por alumno',
    (SELECT count(DISTINCT participant_id) = 2 FROM raffle_winners WHERE prize_id = prize_ss AND status = 'confirmado'));
  PERFORM pg_temp.expect('sorteo: premio agotado', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_ss, 'rs-key-4')), 'ERR:PRIZE_EXHAUSTED');

  -- No-show en Universo (o2 es el único candidato).
  answer := pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_uni, 'rs-key-5'));
  PERFORM pg_temp.expect_true('no-show: sortear premio Universo elige a o2',
    answer NOT LIKE 'ERR:%' AND (answer::jsonb->>'participant_id')::uuid = pg_temp.id('p:o2') AND (answer::jsonb->>'category_name') = 'Universo');
  PERFORM pg_temp.expect('no-show: marcar no presentado', pg_temp.as_user(sorteo, format($q$select mark_no_show((raffle_pending_selection(%L)->>'winner_id')::uuid)->>'status'$q$, prize_uni)), 'no_presentado');
  PERFORM pg_temp.expect_true('no-show: no cuenta como ganado', (SELECT count(*) = 0 FROM raffle_winners WHERE prize_id = prize_uni AND status = 'confirmado'));
  PERFORM pg_temp.expect_true('no-show: inventario restaurado',
    (SELECT quantity - (SELECT count(*) FROM raffle_winners WHERE prize_id = prize_uni AND status IN ('seleccionado', 'confirmado')) = 1 FROM raffle_prizes WHERE id = prize_uni));
  PERFORM pg_temp.expect('no-show: o2 sigue en Universo', pg_temp.category_of('o2'), 'Universo');
  PERFORM pg_temp.expect('no-show: sin nadie más, el pool de ese premio queda vacío', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_uni, 'rs-key-6')), 'ERR:POOL_EMPTY');

  -- Guardas de premios e invalidación.
  PERFORM pg_temp.expect('cantidad: no baja de lo comprometido',
    pg_temp.as_user(coord, format('select save_raffle_prize(%L::jsonb)', jsonb_build_object('id', prize_ss, 'category_id', cat_ss, 'name', 'RS Premio Sistema Solar', 'quantity', 1, 'is_active', true, 'sort_order', 1)::text)),
    'ERR:QUANTITY_BELOW_COMMITTED');
  PERFORM pg_temp.expect('aislamiento: un premio DEMO no se mueve a una categoría real',
    pg_temp.as_user(coord, format('select save_raffle_prize(%L::jsonb)', jsonb_build_object('id', prize_ss, 'category_id', cat_uni_real, 'name', 'RS Premio Sistema Solar', 'quantity', 2, 'is_active', true, 'sort_order', 1)::text)),
    'ERR:DEMO_REAL_MISMATCH');
  PERFORM pg_temp.expect('invalidar: sin motivo se rechaza', pg_temp.as_user(coord, $q$select invalidate_winner('00000000-0000-0000-0000-000000000000', '')$q$), 'ERR:REASON_REQUIRED');
  PERFORM pg_temp.expect('invalidar: Coordinación invalida con motivo',
    pg_temp.as_user(coord, format($q$select invalidate_winner(%L, 'RS motivo de prueba')->>'status'$q$, (SELECT id FROM raffle_winners WHERE prize_id = prize_ss AND participant_id = winner AND status = 'confirmado'))),
    'invalidado');
  PERFORM pg_temp.expect_true('invalidar: el alumno vuelve a su categoría y el inventario se restaura',
    participant_raffle_category(winner) = cat_ss
    AND (SELECT count(*) = 1 FROM raffle_winners WHERE prize_id = prize_ss AND status IN ('seleccionado', 'confirmado')));
  PERFORM pg_temp.expect_true('rol: Sorteo ve ganadores sin datos personales',
    (SELECT count(*) > 0 AND NOT bool_or(w ? 'email' OR w ? 'phone' OR w ? 'birth_date' OR w ? 'participant_id')
     FROM jsonb_array_elements(pg_temp.as_user(sorteo, 'select raffle_winners_read()')::jsonb) w));
  PERFORM pg_temp.expect_true('rol: el historial muestra el nombre oficial de la categoría',
    (SELECT bool_and(w->>'category_name' IN ('Sistema Solar', 'Universo'))
     FROM jsonb_array_elements(pg_temp.as_user(sorteo, 'select raffle_winners_read()')::jsonb) w));

  -- Aislamiento DEMO / real al sortear.
  PERFORM pg_temp.expect_true('aislamiento: ningún ganador DEMO es un alumno real',
    NOT EXISTS (SELECT 1 FROM raffle_winners rw JOIN participants p ON p.id = rw.participant_id WHERE rw.is_demo AND NOT p.is_demo));
  answer := pg_temp.as_user(coord, format($q$select save_raffle_prize('{"category_id": "%s", "name": "RS Premio Real", "quantity": 1, "is_active": true, "sort_order": 1}')$q$, cat_uni_real));
  prize_real := answer::uuid;
  PERFORM pg_temp.expect('aislamiento: Sorteo no sortea premios reales en preparación', pg_temp.as_user(sorteo, format('select draw_winner(%L, %L)', prize_real, 'rs-real-1')), 'ERR:NOT_AUTHORIZED');
  answer := pg_temp.as_user(coord, format('select draw_winner(%L, %L)', prize_real, 'rs-real-2'));
  PERFORM pg_temp.expect_true('aislamiento: el pool real solo contiene al alumno real',
    answer NOT LIKE 'ERR:%' AND (answer::jsonb->>'participant_id')::uuid = pg_temp.id('p:real22') AND (answer::jsonb->>'pool_size')::int = 1);
END $operation$;

DO $summary$
DECLARE v_pass int; v_fail int; r record;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok) INTO v_pass, v_fail FROM rs_results;
  FOR r IN SELECT * FROM rs_results ORDER BY seq LOOP
    RAISE NOTICE '%', CASE WHEN r.ok THEN '  OK  | ' || r.name ELSE ' FAIL | ' || r.name || ' (' || r.detail || ')' END;
  END LOOP;
  RAISE EXCEPTION 'RAFFLE REGRESSION: % passed, % failed', v_pass, v_fail;
END $summary$;
