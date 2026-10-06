/*
# Propuestas de talleres (formulario público) — capa de datos

Capa independiente del catálogo oficial: `activities`, `activity_sessions` y `activity_careers` NO se tocan.

## Tablas
- `workshop_submissions`: una fila por propuesta. El envío público siempre crea `status = 'submitted'`.
- `workshop_submission_careers`: carreras afines (una o varias, sin máximo, sin duplicados).

## Defensa en profundidad
La Edge Function `workshop-intake` valida la experiencia/API; PostgreSQL protege los invariantes:
status, activity_type, duración, capacidad, descanso, horario, keywords (3 a 5, sin vacías ni duplicadas),
longitudes máximas, FKs y "al menos una carrera" (constraint trigger diferido).

## Superficie y permisos
- RLS habilitado en ambas tablas, sin políticas; anon/authenticated sin ningún privilegio de tabla.
- `create_workshop_submission_internal(jsonb)` y `workshop_intake_catalog_internal()` son primitivas internas:
  EXECUTE solo para service_role (usada exclusivamente por la Edge Function), search_path fijo, PUBLIC revocado.
- La función de creación lee SOLO una lista blanca de claves del payload; edición, estado y campos
  administrativos los fija el servidor, nunca el cliente.

## Entorno demo/real
Misma convención que el resto del sistema: en modo `preparacion` el catálogo incluye datos demo; en
`operacion_real` solo datos reales. Una propuesta no mezcla división y carreras de distinto entorno y guarda
`is_demo` derivado de su división.
*/

-- ========== 1. Helper inmutable para keywords ==========
CREATE OR REPLACE FUNCTION workshop_keywords_valid(k text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT k IS NOT NULL
    AND cardinality(k) BETWEEN 3 AND 5
    AND NOT EXISTS (SELECT 1 FROM unnest(k) AS x WHERE x IS NULL OR btrim(x) = '' OR length(x) > 80)
    AND (SELECT count(DISTINCT lower(btrim(x))) FROM unnest(k) AS x) = cardinality(k);
$$;

-- ========== 2. workshop_submissions ==========
CREATE TABLE IF NOT EXISTS workshop_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'submitted',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,

  -- responsable
  facilitator_name text NOT NULL,
  facilitator_email text NOT NULL,
  facilitator_phone text,

  -- organización
  division_id uuid NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  activity_type text NOT NULL,

  -- contenido
  title text NOT NULL,
  student_pitch text NOT NULL,
  why_join text NOT NULL,
  objective text NOT NULL,
  student_experience text NOT NULL,
  takeaway text NOT NULL,
  keywords text[] NOT NULL,

  -- operación (todavía no se generan sesiones)
  session_duration_minutes integer NOT NULL,
  capacity_per_session integer NOT NULL,
  operating_start_time time NOT NULL,
  operating_end_time time NOT NULL,
  break_minutes integer NOT NULL,

  -- ubicación (edificio y espacio por separado; room_space admite 'Por confirmar')
  building text NOT NULL,
  room_space text NOT NULL,

  -- logística
  requirements text,
  notes text,

  -- administrativos (solo los fija la revisión interna, nunca el formulario público)
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_notes text,
  published_activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,

  CONSTRAINT workshop_submissions_status_check CHECK (status IN
    ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'published', 'archived')),
  CONSTRAINT workshop_submissions_activity_type_check CHECK (activity_type IN ('academica', 'liderazgo')),
  CONSTRAINT workshop_submissions_submitted_at_check CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CONSTRAINT workshop_submissions_duration_check CHECK (session_duration_minutes > 0 AND session_duration_minutes <= 1440),
  CONSTRAINT workshop_submissions_capacity_check CHECK (capacity_per_session > 0 AND capacity_per_session <= 10000),
  CONSTRAINT workshop_submissions_break_check CHECK (break_minutes >= 0 AND break_minutes <= 1440),
  CONSTRAINT workshop_submissions_hours_check CHECK (operating_end_time > operating_start_time),
  CONSTRAINT workshop_submissions_keywords_check CHECK (workshop_keywords_valid(keywords)),
  CONSTRAINT workshop_submissions_email_check CHECK (
    length(facilitator_email) <= 254 AND facilitator_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT workshop_submissions_text_check CHECK (
    btrim(facilitator_name) <> '' AND length(facilitator_name) <= 200
    AND (facilitator_phone IS NULL OR (btrim(facilitator_phone) <> '' AND length(facilitator_phone) <= 40))
    AND btrim(title) <> '' AND length(title) <= 300
    AND btrim(student_pitch) <> '' AND length(student_pitch) <= 2000
    AND btrim(why_join) <> '' AND length(why_join) <= 2000
    AND btrim(objective) <> '' AND length(objective) <= 2000
    AND btrim(student_experience) <> '' AND length(student_experience) <= 3000
    AND btrim(takeaway) <> '' AND length(takeaway) <= 2000
    AND btrim(building) <> '' AND length(building) <= 200
    AND btrim(room_space) <> '' AND length(room_space) <= 200
    AND (requirements IS NULL OR length(requirements) <= 3000)
    AND (notes IS NULL OR length(notes) <= 3000)
    AND (admin_notes IS NULL OR length(admin_notes) <= 5000))
);

CREATE INDEX IF NOT EXISTS workshop_submissions_edition_status_idx ON workshop_submissions (edition_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS workshop_submissions_division_idx ON workshop_submissions (division_id);
CREATE INDEX IF NOT EXISTS workshop_submissions_email_idx ON workshop_submissions (lower(facilitator_email));
CREATE INDEX IF NOT EXISTS workshop_submissions_published_activity_idx ON workshop_submissions (published_activity_id) WHERE published_activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workshop_submissions_reviewed_by_idx ON workshop_submissions (reviewed_by) WHERE reviewed_by IS NOT NULL;

CREATE OR REPLACE FUNCTION workshop_submissions_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workshop_submissions_updated_at ON workshop_submissions;
CREATE TRIGGER workshop_submissions_updated_at BEFORE UPDATE ON workshop_submissions
  FOR EACH ROW EXECUTE FUNCTION workshop_submissions_set_updated_at();

-- ========== 3. workshop_submission_careers ==========
CREATE TABLE IF NOT EXISTS workshop_submission_careers (
  submission_id uuid NOT NULL REFERENCES workshop_submissions(id) ON DELETE CASCADE,
  career_id uuid NOT NULL REFERENCES careers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, career_id)
);
CREATE INDEX IF NOT EXISTS workshop_submission_careers_career_idx ON workshop_submission_careers (career_id);

-- "Al menos una carrera": se verifica al cierre de la transacción (diferido), tanto al crear/cambiar de estado
-- una propuesta como al borrar carreras. Un borrado en cascada de la propuesta no se bloquea.
CREATE OR REPLACE FUNCTION workshop_submission_require_career()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_status text;
BEGIN
  IF TG_TABLE_NAME = 'workshop_submissions' THEN
    v_id := NEW.id; v_status := NEW.status;
  ELSE
    v_id := OLD.submission_id;
    SELECT status INTO v_status FROM workshop_submissions WHERE id = v_id;
    IF v_status IS NULL THEN RETURN NULL; END IF;
  END IF;
  IF v_status <> 'draft' AND NOT EXISTS (SELECT 1 FROM workshop_submission_careers WHERE submission_id = v_id) THEN
    RAISE EXCEPTION 'SUBMISSION_REQUIRES_CAREER' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION workshop_submission_require_career() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workshop_submissions_require_career ON workshop_submissions;
CREATE CONSTRAINT TRIGGER workshop_submissions_require_career
  AFTER INSERT OR UPDATE OF status ON workshop_submissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workshop_submission_require_career();
DROP TRIGGER IF EXISTS workshop_submission_careers_require_career ON workshop_submission_careers;
CREATE CONSTRAINT TRIGGER workshop_submission_careers_require_career
  AFTER DELETE ON workshop_submission_careers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workshop_submission_require_career();

-- ========== 4. Seguridad: RLS sin políticas, sin privilegios para anon/authenticated ==========
ALTER TABLE workshop_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_submission_careers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workshop_submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON workshop_submission_careers FROM PUBLIC, anon, authenticated;

-- ========== 5. Primitiva interna: catálogo del formulario ==========
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
      FROM divisions d WHERE v_ed.mode = 'preparacion' OR NOT d.is_demo), '[]'::jsonb),
    'careers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('career_id', c.id, 'career_name', c.name, 'division_id', c.division_id) ORDER BY c.name)
      FROM careers c WHERE c.is_active AND (v_ed.mode = 'preparacion' OR NOT c.is_demo)), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION workshop_intake_catalog_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION workshop_intake_catalog_internal() TO service_role;

-- ========== 6. Primitiva interna: crear propuesta (transaccional) ==========
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

  BEGIN
    SELECT * INTO v_div FROM divisions
    WHERE id = (p_payload->>'division_id')::uuid AND (v_ed.mode = 'preparacion' OR NOT is_demo);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_DIVISION';
  END;
  IF v_div.id IS NULL THEN RAISE EXCEPTION 'INVALID_DIVISION'; END IF;

  -- Carreras existentes, activas y visibles para el entorno de la edición.
  IF (SELECT count(*) FROM careers c
      WHERE c.id = ANY (v_career_ids) AND c.is_active AND (v_ed.mode = 'preparacion' OR NOT c.is_demo)) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END IF;
  -- Sin mezclar entornos demo/real dentro de una misma propuesta.
  IF EXISTS (SELECT 1 FROM careers c WHERE c.id = ANY (v_career_ids) AND c.is_demo <> v_div.is_demo) THEN
    RAISE EXCEPTION 'CATALOG_MISMATCH';
  END IF;

  v_keywords := ARRAY(SELECT jsonb_array_elements_text(p_payload->'keywords'));
  v_submitted := now();

  -- Solo claves de la lista blanca. status/edition/is_demo y campos administrativos los fija el servidor.
  INSERT INTO workshop_submissions (
    edition_id, status, is_demo, submitted_at,
    facilitator_name, facilitator_email, facilitator_phone,
    division_id, activity_type,
    title, student_pitch, why_join, objective, student_experience, takeaway, keywords,
    session_duration_minutes, capacity_per_session, operating_start_time, operating_end_time, break_minutes,
    building, room_space, requirements, notes)
  VALUES (
    v_ed.id, 'submitted', v_div.is_demo, v_submitted,
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

  -- Auditoría mínima: sin contenido de la propuesta, correo, teléfono ni notas.
  PERFORM write_audit('workshop_submission.created',
    jsonb_build_object('submission_id', v_id, 'edition_id', v_ed.id, 'status', 'submitted'));

  RETURN jsonb_build_object('submission_id', v_id, 'status', 'submitted', 'submitted_at', v_submitted);
END;
$$;
REVOKE ALL ON FUNCTION create_workshop_submission_internal(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_workshop_submission_internal(jsonb) TO service_role;
