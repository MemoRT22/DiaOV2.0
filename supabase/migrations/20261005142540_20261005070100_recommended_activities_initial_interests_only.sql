/*
# Fase 8A — Recomendaciones basadas exclusivamente en intereses iniciales

## Cambios
- `my_recommended_activities()` ahora usa exclusivamente `initial_interests` como
  fuente de intereses, eliminando `post_event_interests` de la lógica de recomendaciones.
- Prioridad determinística:
  1. Talleres relacionados con carrera inicial 1 (preference = 1) primero
  2. Talleres relacionados con carrera inicial 2 (preference = 2) después
  3. Si un taller está relacionado con ambas, aparece una sola vez (deduplicación)
- Se mantienen todos los filtros existentes:
  - activity_careers como relación explícita carrera ↔ taller
  - Sesiones con status = 'activa'
  - Aislamiento demo/real
  - Reservación existente
  - Talleres ya asistidos
  - Cupo disponible
- `post_event_interests` se reserva para la etapa posterior del evento.

## Seguridad
- Sin cambios en permisos: CREATE OR REPLACE mantiene los grants existentes.
- Revocada de anon como antes.
*/

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

  -- Build ordered interest list from initial_interests only (preference 1, then 2)
  v_interest_ids := ARRAY(
    SELECT ii.career_id FROM initial_interests ii
    WHERE ii.participant_id = v_pid
    ORDER BY ii.preference
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
