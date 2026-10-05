/*
# Fase 6: Recomendaciones de talleres por interes vocacional

## 1. Tabla activity_careers (relacion many-to-many Carrera <-> Taller)
- Permite que una actividad se relacione con varias carreras y viceversa.
- Opcional: una actividad sin carreres relacionadas sigue funcionando.
- Respeta aisamiento demo/real mediante trigger.

## 2. RPC save_activity_careers(p_activity_id, p_career_ids)
- Para Coordinacion: agrega/retira relaciones carrera-taller.
- Valida demo/real, carreras activas, que las carreras pertenezcan al catalogo.
- Audita el cambio.

## 3. RPC my_recommended_activities()
- Para el alumno autenticado (require_participant(true)).
- Usa carrera inicial + intereses posteriores para encontrar talleres relacionados.
- Filtra por entorno demo/real, sesiones activas, edicion correcta.
- Excluye actividades ya asistidas (las marca como exploradas).
- Orden determinista: carrera inicial > interes 1 > interes 2 > interes 3.
- Deduplica actividades que coinciden con varias carreras.
- No usa gamificacion (sellos, rango, tickets).
- Puede devolver 0 recomendaciones.
*/

-- 1. Tabla activity_careers
CREATE TABLE IF NOT EXISTS activity_careers (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  career_id uuid NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, career_id)
);

ALTER TABLE activity_careers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read activity_careers" ON activity_careers;
CREATE POLICY "Public can read activity_careers" ON activity_careers
  FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON activity_careers FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS activity_careers_career_idx ON activity_careers (career_id);

-- 2. RPC save_activity_careers
CREATE OR REPLACE FUNCTION public.save_activity_careers(p_activity_id uuid, p_career_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_act activities%ROWTYPE;
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
BEGIN
  PERFORM require_coordinacion();
  SELECT a.* INTO v_act FROM activities a WHERE a.id = p_activity_id AND a.edition_id = v_ed;
  IF v_act.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- Validate all careers: active, same demo/real environment as activity
  IF v_n > 0 THEN
    IF (SELECT count(*) FROM careers c
        WHERE c.id = ANY(p_career_ids)
        AND c.is_active
        AND c.is_demo = v_act.is_demo
        AND EXISTS (SELECT 1 FROM activities a WHERE a.division_id = c.division_id AND a.edition_id = v_ed AND a.is_demo = v_act.is_demo)
       ) <> v_n THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
    -- No duplicates
    IF (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN
      RAISE EXCEPTION 'DUPLICATE_INTEREST';
    END IF;
  END IF;

  -- Replace all relationships
  DELETE FROM activity_careers WHERE activity_id = p_activity_id;
  INSERT INTO activity_careers (activity_id, career_id)
  SELECT p_activity_id, cid FROM unnest(p_career_ids) AS t(cid)
  WHERE cid IS NOT NULL;

  PERFORM write_audit('catalog.activity_careers_saved', jsonb_build_object(
    'activity_id', p_activity_id, 'career_count', v_n
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_activity_careers(uuid, uuid[]) FROM anon, authenticated;

-- 3. RPC my_recommended_activities
CREATE OR REPLACE FUNCTION public.my_recommended_activities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_ed editions%ROWTYPE;
  v_interest_ids uuid[];
  v_attended_ids uuid[];
  v_result jsonb;
BEGIN
  SELECT p.* INTO v_p FROM participants p WHERE p.id = v_pid;
  SELECT e.* INTO v_ed FROM editions e WHERE e.id = v_p.edition_id;

  -- Build ordered interest list: initial_career_id first, then post_event_interests by preference
  v_interest_ids := ARRAY(
    SELECT career_id FROM (
      SELECT v_p.initial_career_id AS career_id, 0 AS ord
      WHERE v_p.initial_career_id IS NOT NULL
      UNION ALL
      SELECT i.career_id, i.preference AS ord
      FROM post_event_interests i WHERE i.participant_id = v_pid
    ) x WHERE career_id IS NOT NULL ORDER BY ord
  );

  -- Attended activity IDs (to mark as explored)
  SELECT coalesce(array_agg(DISTINCT att.activity_id), '{}') INTO v_attended_ids
  FROM attendances att WHERE att.participant_id = v_pid;

  -- Build recommendations
  -- For each interest (in order), find related activities not yet attended,
  -- with at least one active session in the correct edition/environment.
  -- Deduplicate: if an activity matches multiple interests, merge the career names.
  WITH interest_careers AS (
    SELECT unnest(v_interest_ids) AS career_id, ord
    FROM generate_subscripts(v_interest_ids, 1) AS t(ord)
  ),
  related_activities AS (
    SELECT ac.activity_id, ic.career_id, ic.ord,
           c.name AS career_name,
           c.id AS cid
    FROM activity_careers ac
    JOIN interest_careers ic ON ic.career_id = ac.career_id
    JOIN careers c ON c.id = ic.career_id
    JOIN activities a ON a.id = ac.activity_id
    WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
  ),
  -- Only activities with at least one active session
  activities_with_sessions AS (
    SELECT DISTINCT ra.activity_id, ra.career_name, ra.career_id, ra.ord
    FROM related_activities ra
    JOIN activity_sessions s ON s.activity_id = ra.activity_id
    WHERE s.status = 'activa'
      AND s.is_demo = v_p.is_demo
  ),
  -- Deduplicate: aggregate career names per activity, keep min ord
  deduped AS (
    SELECT
      aw.activity_id,
      min(aw.ord) AS priority,
      string_agg(DISTINCT aw.career_name, ', ' ORDER BY aw.career_name) AS related_careers,
      jsonb_agg(DISTINCT jsonb_build_object('career_id', aw.career_id, 'career_name', aw.career_name)) AS careers
    FROM activities_with_sessions aw
    GROUP BY aw.activity_id
  ),
  -- Build final result with activity details and sessions
  final AS (
    SELECT
      d.activity_id,
      d.priority,
      d.related_careers,
      d.careers,
      a.title,
      a.description,
      a.division_id,
      div.name AS division_name,
      div.code AS division_code,
      a.is_demo,
      (d.activity_id = ANY(v_attended_ids)) AS already_attended,
      EXISTS (
        SELECT 1 FROM reservations r
        JOIN activity_sessions s ON s.id = r.session_id
        WHERE r.participant_id = v_pid AND r.status = 'vigente' AND s.activity_id = d.activity_id
      ) AS already_reserved,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'session_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
          'location', coalesce(nullif(s.location, ''), a.location),
          'capacity', s.capacity,
          'reserved', session_reserved_count(s.id),
          'remaining', greatest(s.capacity - session_reserved_count(s.id), 0),
          'credits', s.credits,
          'started', now() >= s.starts_at
        ) ORDER BY s.starts_at)
        FROM activity_sessions s
        WHERE s.activity_id = d.activity_id AND s.status = 'activa' AND s.is_demo = v_p.is_demo
      ), '[]'::jsonb) AS sessions
    FROM deduped d
    JOIN activities a ON a.id = d.activity_id
    JOIN divisions div ON div.id = a.division_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', f.activity_id,
    'title', f.title,
    'description', left(f.description, 200),
    'division_id', f.division_id,
    'division_name', f.division_name,
    'division_code', f.division_code,
    'related_careers', f.related_careers,
    'careers', f.careers,
    'already_attended', f.already_attended,
    'already_reserved', f.already_reserved,
    'sessions', f.sessions,
    'priority', f.priority
  ) ORDER BY f.already_attended, f.priority, f.title), '[]'::jsonb) INTO v_result
  FROM final f;

  RETURN jsonb_build_object(
    'recommendations', v_result,
    'interest_career_ids', to_jsonb(v_interest_ids),
    'attended_activity_ids', to_jsonb(v_attended_ids)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_recommended_activities() FROM anon;