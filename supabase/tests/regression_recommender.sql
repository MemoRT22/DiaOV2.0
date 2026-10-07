-- Regresión: recomendador determinístico (migración 20261007180000_deterministic_workshop_recommender).
-- Ejecutar como UN solo bloque, DESPUÉS de la migración. Fixtures propios y demo; SIEMPRE termina con una excepción
-- (RECOMMENDER_OK n checks), así que todo se revierte. Falla rápido: RECOMMENDER_FAIL[nombre].

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

-- Actividad + sesión (minutos relativos a now()) con carreras/divisiones. Devuelve {act, ses}.
CREATE FUNCTION pg_temp.mkact(p_title text, p_type text, p_careers uuid[], p_divs uuid[], p_start numeric, p_end numeric,
                              p_cap int DEFAULT 30, p_demo boolean DEFAULT true, p_edition uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE v_act uuid; v_ses uuid; c uuid; d uuid;
BEGIN
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type)
  VALUES (coalesce(p_edition, active_edition_id()), p_divs[1], 'RC ' || p_title, 'Descripción', 'Salón RC', p_demo, p_type) RETURNING id INTO v_act;
  FOREACH c IN ARRAY coalesce(p_careers, '{}') LOOP INSERT INTO activity_careers (activity_id, career_id) VALUES (v_act, c); END LOOP;
  FOREACH d IN ARRAY coalesce(p_divs, '{}') LOOP INSERT INTO activity_divisions (activity_id, division_id) VALUES (v_act, d); END LOOP;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + make_interval(secs => p_start * 60), now() + make_interval(secs => p_end * 60), p_cap, 'Salón RC', 'activa', p_demo, 1)
  RETURNING id INTO v_ses;
  RETURN jsonb_build_object('act', v_act, 'ses', v_ses);
END
$f$;

-- Participante demo con Aviso aceptado e intereses iniciales EXACTOS (preferencia = posición). Devuelve su auth id.
CREATE FUNCTION pg_temp.mkp(p_n int, p_interests uuid[]) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); pid uuid; i int; v_career uuid := (SELECT id FROM careers WHERE is_demo ORDER BY name LIMIT 1);
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc.' || p_n || '@test.invalid', '{}', '{}', now(), now());
  INSERT INTO participants (edition_id, email, full_name, phone, high_school, initial_career_id, origin, is_demo, auth_user_id, forms_consent, forms_consent_at, forms_consent_version)
  VALUES (active_edition_id(), 'rc.' || p_n || '@test.invalid', 'RC Alumno ' || p_n, '9980000000', 'Otra escuela', v_career, 'demo', true, u, true, now(), 'v1')
  RETURNING id INTO pid;
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE pp.participant_id = pid AND e.id = active_edition_id();
  DELETE FROM initial_interests WHERE participant_id = pid;  -- el alta pudo sembrar uno: aquí controlamos los intereses
  FOR i IN 1..coalesce(array_length(p_interests, 1), 0) LOOP
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw) VALUES (pid, i, p_interests[i], '');
  END LOOP;
  RETURN u::text;
END
$f$;

-- Recomendaciones como ese alumno → jsonb (o excepción con el error).
CREATE FUNCTION pg_temp.recs(who text) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE v text := pg_temp.run(who, 'select my_recommended_activities()');
BEGIN
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[RPC: %]', v; END IF;
  RETURN v::jsonb;
END
$f$;

-- «Título:tipo» en el orden devuelto (sin el prefijo RC), p. ej. «Anatomía aplicada:E,Odontología digital:D».
CREATE FUNCTION pg_temp.seq(j jsonb) RETURNS text
LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(substr(r->>'title', 4) || ':' || CASE r->>'recommendation_type' WHEN 'exact_career' THEN 'E' ELSE 'D' END, ',' ORDER BY ord), '')
  FROM jsonb_array_elements(j->'recommendations') WITH ORDINALITY AS t(r, ord)
$f$;

CREATE FUNCTION pg_temp.item(j jsonb, p_title text) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT r FROM jsonb_array_elements(j->'recommendations') r WHERE r->>'title' = 'RC ' || p_title
$f$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  other_ed uuid := gen_random_uuid();
  ds uuid; dn uuid; de uuid; dv uuid; real_div uuid;
  mc uuid; od uuid; nu uuid; tf uuid; en uuid; fi uuid; ar uuid;
  a jsonb; b jsonb; g jsonb; x jsonb; e2 jsonb;
  u1 text; u2 text; u3 text; u4 text; u5 text; u6 text; u7 text;
  j jsonb; n int := 0; v text; it jsonb;
BEGIN
  -- ---------- catálogo propio ----------
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RC-SALUD', 'RC Ciencias de la Salud', 900, true) RETURNING id INTO ds;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RC-NEG', 'RC Negocios', 901, true) RETURNING id INTO dn;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RC-ENF', 'RC Enfermería y Cuidado', 902, true) RETURNING id INTO de;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RC-VAC', 'RC Arquitectura', 903, true) RETURNING id INTO dv;
  SELECT id INTO real_div FROM divisions WHERE NOT is_demo ORDER BY name LIMIT 1;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-MC', 'Médico Cirujano RC', ds, true, true) RETURNING id INTO mc;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-OD', 'Odontología RC', ds, true, true) RETURNING id INTO od;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-NU', 'Nutrición RC', ds, true, true) RETURNING id INTO nu;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-TF', 'Terapia Física RC', ds, true, true) RETURNING id INTO tf;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-EN', 'Enfermería RC', de, true, true) RETURNING id INTO en;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-AR', 'Arquitectura RC', dv, true, true) RETURNING id INTO ar;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RC-FI', 'Finanzas RC', dn, true, true) RETURNING id INTO fi;

  -- Médico Cirujano: A (futura +60), B (en curso), G (sin lugares), H (terminó), I (liderazgo, no académica)
  a := pg_temp.mkact('Simulación clínica', 'academica', ARRAY[mc], ARRAY[ds], 60, 90);
  b := pg_temp.mkact('Anatomía aplicada', 'academica', ARRAY[mc], ARRAY[ds], -10, 20);
  g := pg_temp.mkact('Cardiología básica', 'academica', ARRAY[mc], ARRAY[ds], 300, 330, 1);
  PERFORM pg_temp.mkact('Taller pasado', 'academica', ARRAY[mc], ARRAY[ds], -90, -60);
  PERFORM pg_temp.mkact('Liderazgo clínico', 'liderazgo', ARRAY[mc], ARRAY[ds], 100, 130);
  -- Misma división, otras carreras (fallback): C +30, E +40, E2 +45, F +50, X +55 (Nutrición y Terapia Física)
  PERFORM pg_temp.mkact('Odontología digital', 'academica', ARRAY[od], ARRAY[ds], 30, 60);
  PERFORM pg_temp.mkact('Nutrición deportiva', 'academica', ARRAY[nu], ARRAY[ds], 40, 70);
  e2 := pg_temp.mkact('Nutrición infantil', 'academica', ARRAY[nu], ARRAY[ds], 45, 75);
  PERFORM pg_temp.mkact('Terapia física', 'academica', ARRAY[tf], ARRAY[ds], 50, 80);
  x := pg_temp.mkact('Nutrición clínica', 'academica', ARRAY[nu, tf], ARRAY[ds], 55, 85);
  -- Otra división, entorno real y otra edición: nunca deben aparecer
  PERFORM pg_temp.mkact('Mercados financieros', 'academica', ARRAY[fi], ARRAY[dn], 30, 60);
  PERFORM pg_temp.mkact('Real de Médico Cirujano', 'academica', ARRAY[mc], ARRAY[real_div], 30, 60, 30, false);
  INSERT INTO editions SELECT * FROM jsonb_populate_record(null::editions, to_jsonb((SELECT e FROM editions e WHERE e.id = ed)) || jsonb_build_object('id', other_ed, 'code', 'RC-OTRA', 'is_active', false));
  PERFORM pg_temp.mkact('Otra edición de Médico Cirujano', 'academica', ARRAY[mc], ARRAY[ds], 30, 60, 30, true, other_ed);
  -- Enfermería (otra división): cuatro exactas, sin fallback
  PERFORM pg_temp.mkact('Urgencias', 'academica', ARRAY[en], ARRAY[de], 20, 50);
  PERFORM pg_temp.mkact('Radiología', 'academica', ARRAY[en], ARRAY[de], 25, 55);
  PERFORM pg_temp.mkact('Quirófano', 'academica', ARRAY[en], ARRAY[de], 35, 65);
  PERFORM pg_temp.mkact('Pediatría', 'academica', ARRAY[en], ARRAY[de], 90, 120);

  u1 := pg_temp.mkp(1, ARRAY[mc]);        -- Médico Cirujano
  u2 := pg_temp.mkp(2, ARRAY[en]);        -- Enfermería (4 exactas)
  u3 := pg_temp.mkp(3, ARRAY[nu, tf]);    -- preferencias: #1 Nutrición, #2 Terapia Física
  u4 := pg_temp.mkp(4, ARRAY[mc]);        -- ya asistió a Simulación clínica
  u5 := pg_temp.mkp(5, ARRAY[mc]);        -- ya reservó Simulación clínica
  u6 := pg_temp.mkp(6, ARRAY[]::uuid[]);  -- sin intereses (y ocupa el único lugar de Cardiología)
  u7 := pg_temp.mkp(7, ARRAY[ar]);        -- carrera sin ningún taller relacionado ni en su división
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT id, (g->>'ses')::uuid, (g->>'act')::uuid FROM participants WHERE auth_user_id = u6::uuid;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method)
  SELECT id, (a->>'ses')::uuid, (a->>'act')::uuid, 1, 'qr' FROM participants WHERE auth_user_id = u4::uuid;
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT id, (a->>'ses')::uuid, (a->>'act')::uuid FROM participants WHERE auth_user_id = u5::uuid;

  -- ======================= Médico Cirujano =======================
  j := pg_temp.recs(u1);
  v := pg_temp.seq(j);
  -- exactas: en curso con lugares, futura con lugares, sin lugares; después 2 de la misma división (la más cercana primero)
  IF v <> 'Anatomía aplicada:E,Simulación clínica:E,Cardiología básica:E,Odontología digital:D,Nutrición deportiva:D' THEN
    RAISE EXCEPTION 'RECOMMENDER_FAIL[orden Médico Cirujano: %]', v; END IF;
  n := n + 1;
  it := pg_temp.item(j, 'Simulación clínica');
  IF it->>'recommendation_type' <> 'exact_career' OR it#>>'{matched_careers,0,career_name}' <> 'Médico Cirujano RC' OR (it->>'interest_priority')::int <> 1
     OR it->'matched_division' <> 'null'::jsonb THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[contrato exacta: %]', it; END IF;
  it := pg_temp.item(j, 'Odontología digital');
  IF it->>'recommendation_type' <> 'same_division' OR jsonb_array_length(it->'matched_careers') <> 0
     OR it#>>'{matched_division,division_name}' <> 'RC Ciencias de la Salud' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[contrato división: %]', it; END IF;
  n := n + 2;
  -- no relacionadas, terminada, no académica, real, otra edición, y fallback acotado a lo necesario
  IF v ~ 'Mercados|Taller pasado|Liderazgo clínico|Real de|Otra edición|Terapia física|Nutrición infantil|Nutrición clínica' THEN
    RAISE EXCEPTION 'RECOMMENDER_FAIL[no debía aparecer: %]', v; END IF;
  n := n + 1;
  IF (j->'summary'->>'exact')::int <> 3 OR (j->'summary'->>'same_division')::int <> 2 THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[resumen: %]', j->'summary'; END IF;
  IF (pg_temp.item(j, 'Cardiología básica')->>'has_open_session')::boolean THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[sin lugares marcada abierta]'; END IF;
  -- sessions[*] lleva `ended` (el tipo TypeScript RecommendedSession debe reflejarlo)
  IF (pg_temp.item(j, 'Simulación clínica')#>>'{sessions,0,ended}') <> 'false' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[sessions[*].ended ausente]'; END IF;
  n := n + 3;
  -- determinista: dos llamadas, mismo resultado
  IF pg_temp.recs(u1)::text <> j::text THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[no determinista]'; END IF;
  n := n + 1;

  -- ======================= suficientes exactas: sin fallback =======================
  j := pg_temp.recs(u2);
  v := pg_temp.seq(j);
  IF v <> 'Urgencias:E,Radiología:E,Quirófano:E,Pediatría:E' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[4 exactas: %]', v; END IF;
  n := n + 1;

  -- ======================= preferencia + multi-match =======================
  j := pg_temp.recs(u3);
  v := pg_temp.seq(j);
  -- #1 Nutrición (Nutrición deportiva, infantil y la que une ambas) antes que #2 Terapia Física; sin duplicar la multi-carrera
  IF v <> 'Nutrición deportiva:E,Nutrición infantil:E,Nutrición clínica:E,Terapia física:E' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[preferencia: %]', v; END IF;
  n := n + 1;
  it := pg_temp.item(j, 'Nutrición clínica');
  IF jsonb_array_length(it->'matched_careers') <> 2 OR (it->>'interest_priority')::int <> 1
     OR it#>>'{matched_careers,0,career_name}' <> 'Nutrición RC' OR it#>>'{matched_careers,1,career_name}' <> 'Terapia Física RC' THEN
    RAISE EXCEPTION 'RECOMMENDER_FAIL[multi-match: %]', it; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(j->'recommendations') r WHERE r->>'title' = 'RC Nutrición clínica') <> 1 THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[duplicada]'; END IF;
  IF (pg_temp.item(j, 'Terapia física')->>'interest_priority')::int <> 2 THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[prioridad #2]'; END IF;
  n := n + 3;

  -- ======================= ya asistida: al final, y no cuenta para el mínimo =======================
  j := pg_temp.recs(u4);
  v := pg_temp.seq(j);
  IF v <> 'Anatomía aplicada:E,Cardiología básica:E,Odontología digital:D,Nutrición deportiva:D,Nutrición infantil:D,Simulación clínica:E' THEN
    RAISE EXCEPTION 'RECOMMENDER_FAIL[asistida: %]', v; END IF;
  it := pg_temp.item(j, 'Simulación clínica');
  IF NOT (it->>'already_attended')::boolean THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[asistida sin marcar]'; END IF;
  IF (j->'summary'->>'same_division')::int <> 3 THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[la asistida no debía contar para el mínimo]'; END IF;
  n := n + 3;

  -- ======================= ya reservada =======================
  j := pg_temp.recs(u5);
  v := pg_temp.seq(j);
  IF v <> 'Anatomía aplicada:E,Simulación clínica:E,Cardiología básica:E,Odontología digital:D,Nutrición deportiva:D' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[reservada: %]', v; END IF;
  IF NOT (pg_temp.item(j, 'Simulación clínica')->>'already_reserved')::boolean THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[reservada sin marcar]'; END IF;
  IF (pg_temp.item(pg_temp.recs(u1), 'Simulación clínica')->>'already_reserved')::boolean THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[reservada de otro alumno]'; END IF;
  n := n + 3;

  -- ======================= sin intereses / carrera sin talleres: vacío y sin error =======================
  IF jsonb_array_length(pg_temp.recs(u6)->'recommendations') <> 0 THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[sin intereses]'; END IF;
  IF jsonb_array_length(pg_temp.recs(u7)->'recommendations') <> 0 THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[carrera sin talleres]'; END IF;
  n := n + 2;

  -- ======================= seguridad =======================
  IF pg_temp.run(gen_random_uuid()::text, 'select my_recommended_activities()') <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[no participante]'; END IF;
  IF pg_temp.run(u1, format('select my_recommended_activities(%L)', u2)) NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'RECOMMENDER_FAIL[acepta participante externo]'; END IF;
  n := n + 2;

  -- ======================= nunca crea ni cambia reservaciones =======================
  IF (SELECT count(*) FROM reservations WHERE participant_id = (SELECT id FROM participants WHERE auth_user_id = u1::uuid)) <> 0 THEN
    RAISE EXCEPTION 'RECOMMENDER_FAIL[el recomendador creó reservaciones]'; END IF;
  n := n + 1;

  RAISE EXCEPTION 'RECOMMENDER_OK % checks', n;
END
$test$;
