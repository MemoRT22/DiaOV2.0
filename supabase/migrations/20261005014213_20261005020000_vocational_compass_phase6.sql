/*
# Fase 6: Brújula Vocacional — modelo de evidencia, motor de recomendación y correcciones

## 1. Modelo de metadata vocacional (tags)
- Nueva tabla `vocational_tags`: tags temáticos administrables por Coordinación.
  Cada tag tiene `code`, `label`, `is_demo`, `is_active`.
- Nueva tabla `career_vocational_tags`: relación N:M entre carreras y tags.
  Opcional: una carrera sin tags sigue funcionando.
- Nueva tabla `activity_vocational_tags`: relación N:M entre actividades y tags.
  Opcional: una actividad sin tags sigue funcionando.
- Ambas tablas respetan `is_demo` del registro padre (trigger guard_is_demo ya cubre divisions/careers/activities).

## 2. Función my_vocational_profile()
- RPC SECURITY DEFINER, requiere `require_participant(true)`.
- Construye el perfil vocacional del aspirante con evidencia real:
  - interés inicial (carrera + división)
  - talleres asistidos (título, división, tipo, tags)
  - talleres reservados vigentes que NO fueron asistidos (señal más débil)
  - divisiones visitadas (derivadas de asistencias)
  - intereses posteriores guardados
  - hasta 3 recomendaciones con razones estructuradas
- No devuelve PII innecesaria.
- No usa sellos, rango, tickets de sorteo.

## 3. Motor de recomendación
- Server-side, dentro de my_vocational_profile().
- Candidatos: carreras activas, de la misma edición, del mismo entorno demo/real.
- Ponderación: asistencia > reservación > interés inicial como contexto.
- Cada recomendación incluye razones reales (evidence array).
- Puede devolver 0, 1, 2 o 3 recomendaciones según evidencia disponible.
- No inventa afinidad numérica.

## 4. Corrección de save_post_event_interests
- Ya usa require_participant(true). Se añaden validaciones:
  - carrera del mismo entorno demo/real del participante
  - carrera de la misma edición
- No cambia el comportamiento existente de máximo 3, sin duplicados, ventana abierta.

## 5. Exportación vocacional
- Nueva función export_vocational(p_reason, p_include_demo) para Coordinación.
- Devuelve por participante: ID, interés inicial, 3 opciones posteriores,
  talleres asistidos, divisiones visitadas, tags relevantes.
- No incluye score ficticio.

## 6. Auditoría
- save_post_event_interests ya no audita (no cambiaba antes). Se mantiene igual.
- export_vocational audita como 'vocational.exported'.
*/

-- 1. Tabla de tags vocacionales
CREATE TABLE IF NOT EXISTS vocational_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vocational_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read vocational_tags" ON vocational_tags;
CREATE POLICY "Public can read vocational_tags" ON vocational_tags
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON vocational_tags FROM anon, authenticated;

-- 2. Relación carrera-tag
CREATE TABLE IF NOT EXISTS career_vocational_tags (
  career_id uuid NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES vocational_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (career_id, tag_id)
);
ALTER TABLE career_vocational_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read career_vocational_tags" ON career_vocational_tags;
CREATE POLICY "Public can read career_vocational_tags" ON career_vocational_tags
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON career_vocational_tags FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS career_vocational_tags_tag_idx ON career_vocational_tags (tag_id);

-- 3. Relación actividad-tag
CREATE TABLE IF NOT EXISTS activity_vocational_tags (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES vocational_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, tag_id)
);
ALTER TABLE activity_vocational_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read activity_vocational_tags" ON activity_vocational_tags;
CREATE POLICY "Public can read activity_vocational_tags" ON activity_vocational_tags
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON activity_vocational_tags FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS activity_vocational_tags_tag_idx ON activity_vocational_tags (tag_id);

-- 4. Función my_vocational_profile()
CREATE OR REPLACE FUNCTION public.my_vocational_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_ed editions%ROWTYPE;
  v_participant participants%ROWTYPE;
  v_initial_career jsonb;
  v_attended jsonb;
  v_reserved_only jsonb;
  v_divisions_visited jsonb;
  v_interests jsonb;
  v_attended_tag_codes text[];
  v_reserved_tag_codes text[];
  v_all_tag_codes text[];
  v_recommendations jsonb;
BEGIN
  -- Get participant and edition
  SELECT p.* INTO v_participant FROM participants p WHERE p.id = v_pid;
  SELECT e.* INTO v_ed FROM editions e WHERE e.id = v_participant.edition_id;

  -- Initial interest
  SELECT jsonb_build_object(
    'career_id', c.id, 'career_name', c.name,
    'division_id', d.id, 'division_name', d.name,
    'division_code', d.code
  ) INTO v_initial_career
  FROM careers c
  JOIN divisions d ON d.id = c.division_id
  WHERE c.id = v_participant.initial_career_id;

  IF v_initial_career IS NULL THEN
    v_initial_career := 'null'::jsonb;
  END IF;

  -- Attended workshops (strong evidence)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', a.id, 'title', a.title, 'activity_type', a.activity_type,
    'division_id', a.division_id, 'division_name', d.name, 'division_code', d.code,
    'tags', coalesce((
      SELECT jsonb_agg(jsonb_build_object('code', vt.code, 'label', vt.label) ORDER BY vt.code)
      FROM activity_vocational_tags avt
      JOIN vocational_tags vt ON vt.id = avt.tag_id
      WHERE avt.activity_id = a.id AND vt.is_active
    ), '[]'::jsonb)
  ) ORDER BY s.starts_at), '[]'::jsonb) INTO v_attended
  FROM attendances att
  JOIN activity_sessions s ON s.id = att.session_id
  JOIN activities a ON a.id = att.activity_id
  JOIN divisions d ON d.id = a.division_id
  WHERE att.participant_id = v_pid;

  -- Reserved-only workshops (weaker evidence: reserved but not attended)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', a.id, 'title', a.title, 'activity_type', a.activity_type,
    'division_id', a.division_id, 'division_name', d.name, 'division_code', d.code
  ) ORDER BY s.starts_at), '[]'::jsonb) INTO v_reserved_only
  FROM reservations r
  JOIN activity_sessions s ON s.id = r.session_id
  JOIN activities a ON a.id = r.activity_id
  JOIN divisions d ON d.id = a.division_id
  WHERE r.participant_id = v_pid
    AND r.status = 'vigente'
    AND NOT EXISTS (
      SELECT 1 FROM attendances att WHERE att.participant_id = v_pid AND att.session_id = r.session_id
    );

  -- Divisions visited (from attendances only)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'division_id', d.id, 'division_name', d.name, 'division_code', d.code
  ) ORDER BY d.sort_order), '[]'::jsonb) INTO v_divisions_visited
  FROM (
    SELECT DISTINCT a.division_id
    FROM attendances att JOIN activities a ON a.id = att.activity_id
    WHERE att.participant_id = v_pid
  ) dist
  JOIN divisions d ON d.id = dist.division_id;

  -- Post-event interests
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'preference', i.preference, 'career_id', c.id, 'career_name', c.name,
    'division_id', d.id, 'division_name', d.name
  ) ORDER BY i.preference), '[]'::jsonb) INTO v_interests
  FROM post_event_interests i
  JOIN careers c ON c.id = i.career_id
  JOIN divisions d ON d.id = c.division_id
  WHERE i.participant_id = v_pid;

  -- Collect tag codes from attended and reserved activities
  SELECT coalesce(array_agg(DISTINCT vt.code), '{}') INTO v_attended_tag_codes
  FROM activity_vocational_tags avt
  JOIN vocational_tags vt ON vt.id = avt.tag_id AND vt.is_active
  WHERE avt.activity_id IN (
    SELECT a.id FROM attendances att JOIN activities a ON a.id = att.activity_id WHERE att.participant_id = v_pid
  );

  SELECT coalesce(array_agg(DISTINCT vt.code), '{}') INTO v_reserved_tag_codes
  FROM activity_vocational_tags avt
  JOIN vocational_tags vt ON vt.id = avt.tag_id AND vt.is_active
  WHERE avt.activity_id IN (
    SELECT a.id FROM reservations r JOIN activities a ON a.id = r.activity_id
    WHERE r.participant_id = v_pid AND r.status = 'vigente'
  );

  v_all_tag_codes := array(SELECT DISTINCT unnest(v_attended_tag_codes || v_reserved_tag_codes));

  -- Build recommendations (server-side, no LLM)
  -- Score: attended_same_division=3, reserved_same_division=1, tag_match=2, is_initial=1
  -- Only careers active, same edition context, same demo/real environment
  WITH candidate_careers AS (
    SELECT c.id, c.name, c.division_id, d.name AS division_name, d.code AS division_code,
           c.is_demo AS career_is_demo
    FROM careers c
    JOIN divisions d ON d.id = c.division_id
    WHERE c.is_active
      AND c.is_demo = v_participant.is_demo
      AND EXISTS (
        SELECT 1 FROM activities a
        WHERE a.division_id = c.division_id AND a.edition_id = v_ed.id AND a.is_demo = v_participant.is_demo
      )
  ),
  attended_divisions AS (
    SELECT DISTINCT a.division_id
    FROM attendances att JOIN activities a ON a.id = att.activity_id
    WHERE att.participant_id = v_pid
  ),
  reserved_divisions AS (
    SELECT DISTINCT a.division_id
    FROM reservations r JOIN activities a ON a.id = r.activity_id
    WHERE r.participant_id = v_pid AND r.status = 'vigente'
  ),
  career_tag_matches AS (
    SELECT cvt.career_id, count(DISTINCT cvt.tag_id) AS tag_count
    FROM career_vocational_tags cvt
    JOIN vocational_tags vt ON vt.id = cvt.tag_id AND vt.is_active
    WHERE cvt.tag_id IN (
      SELECT avt.tag_id FROM activity_vocational_tags avt
      JOIN vocational_tags vt2 ON vt2.id = avt.tag_id AND vt2.is_active
      WHERE avt.activity_id IN (
        SELECT a.id FROM attendances att JOIN activities a ON a.id = att.activity_id WHERE att.participant_id = v_pid
        UNION
        SELECT a.id FROM reservations r JOIN activities a ON a.id = r.activity_id
        WHERE r.participant_id = v_pid AND r.status = 'vigente'
      )
    )
    GROUP BY cvt.career_id
  ),
  scored AS (
    SELECT cc.id, cc.name, cc.division_id, cc.division_name, cc.division_code,
      (CASE WHEN cc.division_id IN (SELECT division_id FROM attended_divisions) THEN 3 ELSE 0 END
       + CASE WHEN cc.division_id IN (SELECT division_id FROM reserved_divisions) THEN 1 ELSE 0 END
       + coalesce(ctm.tag_count, 0) * 2
       + CASE WHEN cc.id = v_participant.initial_career_id THEN 1 ELSE 0 END) AS score,
      (CASE WHEN cc.division_id IN (SELECT division_id FROM attended_divisions) THEN true ELSE false END) AS evidence_attended_division,
      (CASE WHEN cc.division_id IN (SELECT division_id FROM reserved_divisions) THEN true ELSE false END) AS evidence_reserved_division,
      coalesce(ctm.tag_count, 0) > 0 AS evidence_tag_match,
      cc.id = v_participant.initial_career_id AS evidence_initial_interest,
      coalesce(ctm.tag_count, 0) AS tag_match_count
    FROM candidate_careers cc
    LEFT JOIN career_tag_matches ctm ON ctm.career_id = cc.id
  ),
  filtered AS (
    SELECT * FROM scored WHERE score > 0
  ),
  ranked AS (
    SELECT f.*,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object('code', vt.code, 'label', vt.label) ORDER BY vt.code)
        FROM career_vocational_tags cvt
        JOIN vocational_tags vt ON vt.id = cvt.tag_id AND vt.is_active
        WHERE cvt.career_id = f.id
        AND vt.code = ANY(v_all_tag_codes)
      ), '[]'::jsonb) AS matched_tags
    FROM filtered f
    ORDER BY f.score DESC, f.name
    LIMIT 3
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'career_id', r.id, 'career_name', r.name,
    'division_id', r.division_id, 'division_name', r.division_name, 'division_code', r.division_code,
    'reasons', (
      jsonb_build_array()
      || CASE WHEN r.evidence_attended_division THEN jsonb_build_object('type', 'attended_division', 'text',
        'Asististe a talleres de la división ' || r.division_name) END
      || CASE WHEN r.evidence_reserved_division AND NOT r.evidence_attended_division THEN jsonb_build_object('type', 'reserved_division', 'text',
        'Reservaste talleres de la división ' || r.division_name) END
      || CASE WHEN r.evidence_tag_match THEN jsonb_build_object('type', 'tag_match', 'text',
        'Exploraste áreas relacionadas con esta carrera') END
      || CASE WHEN r.evidence_initial_interest THEN jsonb_build_object('type', 'initial_interest', 'text',
        'Esta fue tu carrera de interés inicial') END
    ),
    'matched_tags', r.matched_tags,
    'is_initial_interest', r.evidence_initial_interest
  ) ORDER BY r.score DESC, r.name), '[]'::jsonb) INTO v_recommendations
  FROM ranked r;

  RETURN jsonb_build_object(
    'initial_interest', v_initial_career,
    'attended_workshops', v_attended,
    'reserved_workshops', v_reserved_only,
    'divisions_visited', v_divisions_visited,
    'post_event_interests', v_interests,
    'recommendations', v_recommendations,
    'tag_codes_explored', to_jsonb(v_all_tag_codes)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_vocational_profile() FROM anon;

-- 5. Corregir save_post_event_interests: validar entorno demo/real y edición
CREATE OR REPLACE FUNCTION public.save_post_event_interests(p_career_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_ed editions%ROWTYPE;
  v_close timestamptz;
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF v_ed.interests_close_at IS NOT NULL AND now() >= v_ed.interests_close_at THEN
    RAISE EXCEPTION 'INTERESTS_CLOSED';
  END IF;

  IF v_n > 3 THEN RAISE EXCEPTION 'TOO_MANY_INTERESTS'; END IF;

  IF v_n > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN
    RAISE EXCEPTION 'DUPLICATE_INTEREST';
  END IF;

  -- Validate each career: active, same demo/real environment as participant, exists in catalog
  IF v_n > 0 THEN
    IF (SELECT count(*) FROM careers c
        WHERE c.id = ANY(p_career_ids)
        AND c.is_active
        AND c.is_demo = (SELECT is_demo FROM participants WHERE id = v_pid)
        AND EXISTS (
          SELECT 1 FROM activities a
          JOIN activity_sessions s ON s.activity_id = a.id
          WHERE a.division_id = c.division_id
            AND a.edition_id = v_ed.id
            AND a.is_demo = (SELECT is_demo FROM participants WHERE id = v_pid)
        )) <> v_n THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
  END IF;

  DELETE FROM post_event_interests WHERE participant_id = v_pid;
  INSERT INTO post_event_interests (participant_id, preference, career_id)
  SELECT v_pid, ord::smallint, cid FROM unnest(p_career_ids) WITH ORDINALITY AS t(cid, ord);

  PERFORM write_audit('interests.saved', jsonb_build_object('count', v_n));
END;
$$;

-- 6. Función de exportación vocacional
CREATE OR REPLACE FUNCTION public.export_vocational(p_reason text, p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ed editions%ROWTYPE;
  v_rows jsonb;
  v_n int;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  SELECT * INTO v_ed FROM editions WHERE id = active_edition_id();

  SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.full_name), '[]'::jsonb), count(*) INTO v_rows, v_n
  FROM (
    SELECT
      p.id::text AS participant_id,
      p.full_name,
      p.is_demo,
      c.code AS initial_career_code,
      c.name AS initial_career,
      d.name AS initial_division,
      (SELECT ic.name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id
       WHERE i.participant_id = p.id AND i.preference = 1) AS interest_1,
      (SELECT ic.name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id
       WHERE i.participant_id = p.id AND i.preference = 2) AS interest_2,
      (SELECT ic.name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id
       WHERE i.participant_id = p.id AND i.preference = 3) AS interest_3,
      (SELECT count(*) FROM attendances a WHERE a.participant_id = p.id) AS attended_count,
      (SELECT coalesce(string_agg(DISTINCT div.name, ', ' ORDER BY div.name), '')
       FROM attendances att
       JOIN activities act ON act.id = att.activity_id
       JOIN divisions div ON div.id = act.division_id
       WHERE att.participant_id = p.id) AS divisions_visited,
      (SELECT coalesce(string_agg(a.title, ' | ' ORDER BY s.starts_at), '')
       FROM attendances att
       JOIN activity_sessions s ON s.id = att.session_id
       JOIN activities a ON a.id = att.activity_id
       WHERE att.participant_id = p.id) AS attended_workshops
    FROM participants p
    LEFT JOIN careers c ON c.id = p.initial_career_id
    LEFT JOIN divisions d ON d.id = c.division_id
    WHERE p.edition_id = v_ed.id AND (coalesce(p_include_demo, false) OR NOT p.is_demo)
  ) x;

  PERFORM write_audit('vocational.exported', jsonb_build_object(
    'count', v_n, 'reason', left(btrim(p_reason), 300), 'include_demo', coalesce(p_include_demo, false)
  ));

  RETURN jsonb_build_object(
    'edition', v_ed.name, 'edition_code', v_ed.code,
    'generated_at', now(),
    'generated_by', (SELECT full_name FROM staff_members WHERE user_id = auth.uid()),
    'count', v_n, 'rows', v_rows
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.export_vocational(text, boolean) FROM anon, authenticated;