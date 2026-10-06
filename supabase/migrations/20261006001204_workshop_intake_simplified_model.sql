/*
# Formulario público de propuestas — modelo simplificado

Reglas de negocio cerradas después de la primera versión del formulario:

1. Responsable: solo nombre y correo. `facilitator_phone` deja de pedirse (la columna se conserva nullable).
2. Tipo de taller: `academica | vida_universitaria` (antes `academica | liderazgo`). Aplica solo al modelo de
   propuestas; el catálogo canónico `activities` no se toca. La carrera académica de la división `Liderazgo`
   es independiente de este tipo.
3. `division_id` deja de ser requisito del intake (nullable). El tallerista no la elige y no se infiere de forma
   automática: un taller académico puede relacionarse con carreras de varias divisiones. La división definitiva
   se resuelve en la revisión administrativa.
4. Carreras: `academica` exige al menos una (constraint trigger diferido); `vida_universitaria` permite cero.
5. Duración: solo 30 o 60 minutos (constraint en base de datos, además de la Edge Function).
6. Horario: todos los talleres operan 10:00–12:00 sin descanso. El servidor lo guarda siempre
   (`10:00`, `12:00`, `0`); nunca viene del cliente. Todavía NO se generan sesiones.
7. `create_workshop_submission_internal` rechaza cualquier clave fuera de su lista blanca (defensa en
   profundidad; la Edge Function ya rechaza campos desconocidos con UNKNOWN_FIELDS).

No hay propuestas existentes (0 filas al aplicar esta migración), así que los nuevos constraints no requieren
migración de datos. Nada de esto toca el catálogo de divisiones/carreras.
*/

-- ========== 1. División opcional en el intake ==========
ALTER TABLE workshop_submissions ALTER COLUMN division_id DROP NOT NULL;
COMMENT ON COLUMN workshop_submissions.division_id IS
  'Opcional. El formulario público no la pide; la define la revisión administrativa antes de publicar.';

-- ========== 2. Tipo de taller ==========
ALTER TABLE workshop_submissions DROP CONSTRAINT IF EXISTS workshop_submissions_activity_type_check;
ALTER TABLE workshop_submissions ADD CONSTRAINT workshop_submissions_activity_type_check
  CHECK (activity_type IN ('academica', 'vida_universitaria'));

-- ========== 3. Duración: solo 30 o 60 ==========
ALTER TABLE workshop_submissions DROP CONSTRAINT IF EXISTS workshop_submissions_duration_check;
ALTER TABLE workshop_submissions ADD CONSTRAINT workshop_submissions_duration_check
  CHECK (session_duration_minutes IN (30, 60));

-- ========== 4. Horario fijo por defecto (lo fija la función; el default protege otros caminos de escritura) ==========
ALTER TABLE workshop_submissions ALTER COLUMN operating_start_time SET DEFAULT TIME '10:00';
ALTER TABLE workshop_submissions ALTER COLUMN operating_end_time SET DEFAULT TIME '12:00';
ALTER TABLE workshop_submissions ALTER COLUMN break_minutes SET DEFAULT 0;

-- ========== 5. "Al menos una carrera" solo para talleres académicos ==========
CREATE OR REPLACE FUNCTION workshop_submission_require_career()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_status text; v_type text;
BEGIN
  IF TG_TABLE_NAME = 'workshop_submissions' THEN
    v_id := NEW.id; v_status := NEW.status; v_type := NEW.activity_type;
  ELSE
    v_id := OLD.submission_id;
    SELECT status, activity_type INTO v_status, v_type FROM workshop_submissions WHERE id = v_id;
    IF v_status IS NULL THEN RETURN NULL; END IF;
  END IF;
  IF v_status <> 'draft' AND v_type = 'academica'
     AND NOT EXISTS (SELECT 1 FROM workshop_submission_careers WHERE submission_id = v_id) THEN
    RAISE EXCEPTION 'SUBMISSION_REQUIRES_CAREER' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION workshop_submission_require_career() FROM PUBLIC, anon, authenticated;

-- También se revalida si cambia el tipo (p. ej. de vida_universitaria a academica sin carreras).
DROP TRIGGER IF EXISTS workshop_submissions_require_career ON workshop_submissions;
CREATE CONSTRAINT TRIGGER workshop_submissions_require_career
  AFTER INSERT OR UPDATE OF status, activity_type ON workshop_submissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workshop_submission_require_career();

-- ========== 6. Primitiva interna: crear propuesta ==========
CREATE OR REPLACE FUNCTION create_workshop_submission_internal(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed editions%ROWTYPE; v_id uuid; v_submitted timestamptz;
  v_career_ids uuid[]; v_n int; v_keywords text[]; v_type text;
  v_allowed constant text[] := ARRAY[
    'facilitator_name', 'facilitator_email', 'activity_type',
    'title', 'student_pitch', 'why_join', 'objective', 'student_experience', 'takeaway', 'keywords',
    'session_duration_minutes', 'capacity_per_session', 'building', 'room_space',
    'requirements', 'notes', 'career_ids'];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  -- Lista blanca estricta: teléfono, división, horario y descanso ya no son entrada del cliente.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS k WHERE k <> ALL (v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;
  IF jsonb_typeof(p_payload->'career_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF jsonb_typeof(p_payload->'keywords') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;

  -- La edición la resuelve el servidor; el cliente no la elige.
  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  v_type := p_payload->>'activity_type';
  IF v_type IS NULL OR v_type NOT IN ('academica', 'vida_universitaria') THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;

  BEGIN
    v_career_ids := ARRAY(SELECT jsonb_array_elements_text(p_payload->'career_ids')::uuid);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END;
  v_n := coalesce(cardinality(v_career_ids), 0);
  -- Académico: al menos una carrera. Vida Universitaria: cero permitido.
  IF v_type = 'academica' AND v_n = 0 THEN RAISE EXCEPTION 'CAREERS_REQUIRED'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_career_ids) AS x) <> v_n THEN RAISE EXCEPTION 'DUPLICATE_CAREER'; END IF;

  -- Solo carreras REALES, activas y de una división real; pueden ser de divisiones distintas.
  IF v_n > 0 AND (SELECT count(*) FROM careers c
      WHERE c.id = ANY (v_career_ids) AND c.is_active AND NOT c.is_demo
        AND EXISTS (SELECT 1 FROM divisions d WHERE d.id = c.division_id AND NOT d.is_demo)) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END IF;

  v_keywords := ARRAY(SELECT jsonb_array_elements_text(p_payload->'keywords'));
  v_submitted := now();

  -- status/edición/is_demo, horario y descanso los fija el servidor. division_id queda nulo (la define la revisión).
  INSERT INTO workshop_submissions (
    edition_id, status, is_demo, submitted_at,
    facilitator_name, facilitator_email, division_id, activity_type,
    title, student_pitch, why_join, objective, student_experience, takeaway, keywords,
    session_duration_minutes, capacity_per_session, operating_start_time, operating_end_time, break_minutes,
    building, room_space, requirements, notes)
  VALUES (
    v_ed.id, 'submitted', false, v_submitted,
    p_payload->>'facilitator_name', p_payload->>'facilitator_email', NULL, v_type,
    p_payload->>'title', p_payload->>'student_pitch', p_payload->>'why_join', p_payload->>'objective',
    p_payload->>'student_experience', p_payload->>'takeaway', v_keywords,
    (p_payload->>'session_duration_minutes')::int, (p_payload->>'capacity_per_session')::int,
    TIME '10:00', TIME '12:00', 0,
    p_payload->>'building', p_payload->>'room_space',
    nullif(btrim(p_payload->>'requirements'), ''), nullif(btrim(p_payload->>'notes'), ''))
  RETURNING id INTO v_id;

  INSERT INTO workshop_submission_careers (submission_id, career_id)
  SELECT v_id, x FROM unnest(v_career_ids) AS x;

  -- Auditoría mínima: sin contenido de la propuesta, correo ni notas.
  PERFORM write_audit('workshop_submission.created',
    jsonb_build_object('submission_id', v_id, 'edition_id', v_ed.id, 'status', 'submitted'));

  RETURN jsonb_build_object('submission_id', v_id, 'status', 'submitted', 'submitted_at', v_submitted);
END;
$$;
REVOKE ALL ON FUNCTION create_workshop_submission_internal(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_workshop_submission_internal(jsonb) TO service_role;
