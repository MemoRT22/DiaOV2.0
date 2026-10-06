/*
# Formulario público de propuestas — correcciones 9A

1. Permisos: `workshop_submissions_set_updated_at()` (función de trigger) conservaba EXECUTE heredado
   (PUBLIC/anon/authenticated). Se revoca; los triggers no necesitan EXECUTE del cliente.
2. Keywords: la regla de duplicados en PostgreSQL ahora es la MISMA que la de la Edge Function:
   trim + espacios colapsados + sin mayúsculas + sin acentos (NFD sin marcas combinantes).
   Evita discrepancias como "Simulación" vs "simulacion".
3. Catálogo real solamente: el formulario público ya no muestra ni acepta datos demo, en ningún modo de
   la edición. El catálogo devuelve solo divisiones reales y carreras activas reales (de una división real);
   la creación rechaza división o carreras demo. Si todavía no hay catálogo real, el catálogo sale vacío
   y el frontend muestra "Registro aún no disponible" sin usar datos demo como alternativa.
*/

-- ========== 1. Permisos del trigger helper ==========
REVOKE ALL ON FUNCTION workshop_submissions_set_updated_at() FROM PUBLIC, anon, authenticated;

-- ========== 2. Keywords: mismo criterio de duplicados que la Edge Function ==========
CREATE OR REPLACE FUNCTION workshop_fold_keyword(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT lower(regexp_replace(regexp_replace(normalize(btrim(t), NFD), '[̀-ͯ]', '', 'g'), '\s+', ' ', 'g'));
$$;
REVOKE ALL ON FUNCTION workshop_fold_keyword(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION workshop_fold_keyword(text) TO service_role;

CREATE OR REPLACE FUNCTION workshop_keywords_valid(k text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT k IS NOT NULL
    AND cardinality(k) BETWEEN 3 AND 5
    AND NOT EXISTS (SELECT 1 FROM unnest(k) AS x WHERE x IS NULL OR btrim(x) = '' OR length(x) > 80)
    AND (SELECT count(DISTINCT public.workshop_fold_keyword(x)) FROM unnest(k) AS x) = cardinality(k);
$$;

-- ========== 3. Catálogo real solamente ==========
CREATE OR REPLACE FUNCTION workshop_intake_catalog_internal()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed editions%ROWTYPE;
BEGIN
  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  RETURN jsonb_build_object(
    'edition', jsonb_build_object('name', v_ed.name, 'event_date', v_ed.event_date),
    'divisions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('division_id', d.id, 'division_name', d.name) ORDER BY d.sort_order, d.name)
      FROM divisions d WHERE NOT d.is_demo), '[]'::jsonb),
    'careers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('career_id', c.id, 'career_name', c.name, 'division_id', c.division_id) ORDER BY c.name)
      FROM careers c
      WHERE c.is_active AND NOT c.is_demo
        AND EXISTS (SELECT 1 FROM divisions d WHERE d.id = c.division_id AND NOT d.is_demo)), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION workshop_intake_catalog_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION workshop_intake_catalog_internal() TO service_role;

CREATE OR REPLACE FUNCTION create_workshop_submission_internal(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed editions%ROWTYPE; v_id uuid; v_submitted timestamptz;
  v_div divisions%ROWTYPE; v_career_ids uuid[]; v_n int; v_keywords text[];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF jsonb_typeof(p_payload->'career_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF jsonb_typeof(p_payload->'keywords') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;

  -- La edición la resuelve el servidor; el cliente no la elige.
  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  BEGIN
    v_career_ids := ARRAY(SELECT jsonb_array_elements_text(p_payload->'career_ids')::uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END;
  v_n := coalesce(cardinality(v_career_ids), 0);
  IF v_n = 0 THEN RAISE EXCEPTION 'CAREERS_REQUIRED'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_career_ids) AS x) <> v_n THEN RAISE EXCEPTION 'DUPLICATE_CAREER'; END IF;

  -- Solo división REAL (nunca demo).
  BEGIN
    SELECT * INTO v_div FROM divisions
    WHERE id = (p_payload->>'division_id')::uuid AND NOT is_demo;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_DIVISION';
  END;
  IF v_div.id IS NULL THEN RAISE EXCEPTION 'INVALID_DIVISION'; END IF;

  -- Solo carreras REALES, activas y de una división real.
  IF (SELECT count(*) FROM careers c
      WHERE c.id = ANY (v_career_ids) AND c.is_active AND NOT c.is_demo
        AND EXISTS (SELECT 1 FROM divisions d WHERE d.id = c.division_id AND NOT d.is_demo)) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END IF;

  v_keywords := ARRAY(SELECT jsonb_array_elements_text(p_payload->'keywords'));
  v_submitted := now();

  INSERT INTO workshop_submissions (
    edition_id, status, is_demo, submitted_at,
    facilitator_name, facilitator_email, facilitator_phone,
    division_id, activity_type,
    title, student_pitch, why_join, objective, student_experience, takeaway, keywords,
    session_duration_minutes, capacity_per_session, operating_start_time, operating_end_time, break_minutes,
    building, room_space, requirements, notes)
  VALUES (
    v_ed.id, 'submitted', false, v_submitted,
    p_payload->>'facilitator_name', p_payload->>'facilitator_email', nullif(btrim(p_payload->>'facilitator_phone'), ''),
    v_div.id, p_payload->>'activity_type',
    p_payload->>'title', p_payload->>'student_pitch', p_payload->>'why_join', p_payload->>'objective',
    p_payload->>'student_experience', p_payload->>'takeaway', v_keywords,
    (p_payload->>'session_duration_minutes')::int, (p_payload->>'capacity_per_session')::int,
    (p_payload->>'operating_start_time')::time, (p_payload->>'operating_end_time')::time, (p_payload->>'break_minutes')::int,
    p_payload->>'building', p_payload->>'room_space',
    nullif(btrim(p_payload->>'requirements'), ''), nullif(btrim(p_payload->>'notes'), ''))
  RETURNING id INTO v_id;

  INSERT INTO workshop_submission_careers (submission_id, career_id)
  SELECT v_id, x FROM unnest(v_career_ids) AS x;

  PERFORM write_audit('workshop_submission.created',
    jsonb_build_object('submission_id', v_id, 'edition_id', v_ed.id, 'status', 'submitted'));

  RETURN jsonb_build_object('submission_id', v_id, 'status', 'submitted', 'submitted_at', v_submitted);
END;
$$;
REVOKE ALL ON FUNCTION create_workshop_submission_internal(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_workshop_submission_internal(jsonb) TO service_role;
