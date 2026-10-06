/*
# Propuestas — categoría de experiencia (Vida Universitaria) y objetivo condicional

1. `experience_category` (nullable): obligatoria para `vida_universitaria`, siempre NULL para `academica`.
   Valores: liderazgo | deportiva | artistica_cultural | vida_universitaria | otra.
   Es independiente de la división/carrera académica "Liderazgo".
2. `objective` pasa a ser opcional en la base; sigue siendo obligatorio para `academica` (constraint).
3. `create_workshop_submission_internal` acepta `experience_category` (lista blanca estricta) y aplica las reglas.
*/

ALTER TABLE workshop_submissions ADD COLUMN IF NOT EXISTS experience_category text;
ALTER TABLE workshop_submissions ALTER COLUMN objective DROP NOT NULL;

ALTER TABLE workshop_submissions DROP CONSTRAINT IF EXISTS workshop_submissions_text_check;
ALTER TABLE workshop_submissions ADD CONSTRAINT workshop_submissions_text_check CHECK (
  btrim(facilitator_name) <> '' AND length(facilitator_name) <= 200
  AND (facilitator_phone IS NULL OR (btrim(facilitator_phone) <> '' AND length(facilitator_phone) <= 40))
  AND btrim(title) <> '' AND length(title) <= 300
  AND btrim(student_pitch) <> '' AND length(student_pitch) <= 2000
  AND btrim(why_join) <> '' AND length(why_join) <= 2000
  AND (objective IS NULL OR (btrim(objective) <> '' AND length(objective) <= 2000))
  AND btrim(student_experience) <> '' AND length(student_experience) <= 3000
  AND btrim(takeaway) <> '' AND length(takeaway) <= 2000
  AND btrim(building) <> '' AND length(building) <= 200
  AND btrim(room_space) <> '' AND length(room_space) <= 200
  AND (requirements IS NULL OR length(requirements) <= 3000)
  AND (notes IS NULL OR length(notes) <= 3000)
  AND (admin_notes IS NULL OR length(admin_notes) <= 5000));

ALTER TABLE workshop_submissions DROP CONSTRAINT IF EXISTS workshop_submissions_experience_category_check;
ALTER TABLE workshop_submissions ADD CONSTRAINT workshop_submissions_experience_category_check CHECK (
  (activity_type = 'academica' AND experience_category IS NULL)
  OR (activity_type = 'vida_universitaria'
      AND experience_category IN ('liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra')));

ALTER TABLE workshop_submissions DROP CONSTRAINT IF EXISTS workshop_submissions_objective_required_check;
ALTER TABLE workshop_submissions ADD CONSTRAINT workshop_submissions_objective_required_check CHECK (
  activity_type <> 'academica' OR objective IS NOT NULL);

CREATE OR REPLACE FUNCTION create_workshop_submission_internal(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed editions%ROWTYPE; v_id uuid; v_submitted timestamptz;
  v_career_ids uuid[]; v_n int; v_keywords text[]; v_type text; v_cat text;
  v_allowed constant text[] := ARRAY[
    'facilitator_name', 'facilitator_email', 'activity_type', 'experience_category',
    'title', 'student_pitch', 'why_join', 'objective', 'student_experience', 'takeaway', 'keywords',
    'session_duration_minutes', 'capacity_per_session', 'building', 'room_space',
    'requirements', 'notes', 'career_ids'];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS k WHERE k <> ALL (v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;
  IF jsonb_typeof(p_payload->'career_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF jsonb_typeof(p_payload->'keywords') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;

  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  v_type := p_payload->>'activity_type';
  IF v_type IS NULL OR v_type NOT IN ('academica', 'vida_universitaria') THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  v_cat := nullif(btrim(p_payload->>'experience_category'), '');
  IF v_type = 'academica' AND v_cat IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF v_type = 'vida_universitaria' AND (v_cat IS NULL OR v_cat NOT IN ('liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra')) THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;

  BEGIN
    v_career_ids := ARRAY(SELECT jsonb_array_elements_text(p_payload->'career_ids')::uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END;
  v_n := coalesce(cardinality(v_career_ids), 0);
  IF v_type = 'academica' AND v_n = 0 THEN RAISE EXCEPTION 'CAREERS_REQUIRED'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_career_ids) AS x) <> v_n THEN RAISE EXCEPTION 'DUPLICATE_CAREER'; END IF;

  IF v_n > 0 AND (SELECT count(*) FROM careers c
      WHERE c.id = ANY (v_career_ids) AND c.is_active AND NOT c.is_demo
        AND EXISTS (SELECT 1 FROM divisions d WHERE d.id = c.division_id AND NOT d.is_demo)) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END IF;

  v_keywords := ARRAY(SELECT jsonb_array_elements_text(p_payload->'keywords'));
  v_submitted := now();

  INSERT INTO workshop_submissions (
    edition_id, status, is_demo, submitted_at,
    facilitator_name, facilitator_email, division_id, activity_type, experience_category,
    title, student_pitch, why_join, objective, student_experience, takeaway, keywords,
    session_duration_minutes, capacity_per_session, operating_start_time, operating_end_time, break_minutes,
    building, room_space, requirements, notes)
  VALUES (
    v_ed.id, 'submitted', false, v_submitted,
    p_payload->>'facilitator_name', p_payload->>'facilitator_email', NULL, v_type, v_cat,
    p_payload->>'title', p_payload->>'student_pitch', p_payload->>'why_join', nullif(btrim(p_payload->>'objective'), ''),
    p_payload->>'student_experience', p_payload->>'takeaway', v_keywords,
    (p_payload->>'session_duration_minutes')::int, (p_payload->>'capacity_per_session')::int,
    TIME '10:00', TIME '12:00', 0,
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
