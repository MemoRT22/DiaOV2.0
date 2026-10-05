/*
# Corrección Fase 6: eliminar arquitectura vocacional anterior, corregir permisos y ordinality

## 1. Eliminar my_vocational_profile() y tablas vocacionales
- DROP FUNCTION my_vocational_profile (no dependencias)
- DROP TABLE activity_vocational_tags, career_vocational_tags, vocational_tags (orden: relaciones primero)
- export_vocational se conserva (no depende de las tablas eliminadas)

## 2. Corregir permisos RPC
- save_activity_careers: REVOKE de PUBLIC y anon, GRANT a authenticated
- my_recommended_activities: REVOKE de PUBLIC y anon, GRANT a authenticated

## 3. Corregir my_recommended_activities: usar WITH ORDINALITY
- Reemplazar unnest + generate_subscripts por WITH ORDINALITY
- Preservar orden: inicial (0) > interes 1 > interes 2 > interes 3
- Actividad con varias carreras: prioridad más alta (min ord), no duplicada
*/

-- 1. Eliminar función y tablas vocacionales
DROP FUNCTION IF EXISTS public.my_vocational_profile();
DROP TABLE IF EXISTS public.activity_vocational_tags;
DROP TABLE IF EXISTS public.career_vocational_tags;
DROP TABLE IF EXISTS public.vocational_tags;

-- 2. Corregir permisos RPC
REVOKE EXECUTE ON FUNCTION public.save_activity_careers(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_activity_careers(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_activity_careers(uuid, uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_recommended_activities() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_recommended_activities() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_recommended_activities() TO authenticated;

-- 3. Recrear my_recommended_activities con WITH ORDINALITY
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
  v_attended_ids uuid[];
  v_result jsonb;
BEGIN
  SELECT p.* INTO v_p FROM participants p WHERE p.id = v_pid;
  SELECT e.* INTO v_ed FROM editions e WHERE e.id = v_p.edition_id;

  SELECT coalesce(array_agg(DISTINCT att.activity_id), '{}') INTO v_attended_ids
  FROM attendances att WHERE att.participant_id = v_pid;

  WITH interest_careers AS (
    SELECT career_id, ord FROM (
      SELECT v_p.initial_career_id AS career_id, 0 AS ord
      WHERE v_p.initial_career_id IS NOT NULL
      UNION ALL
      SELECT i.career_id, i.preference::int AS ord
      FROM post_event_interests i WHERE i.participant_id = v_pid
    ) ic WHERE career_id IS NOT NULL
  ),
  related_activities AS (
    SELECT ac.activity_id, ic.career_id, ic.ord,
           c.name AS career_name, c.id AS cid
    FROM activity_careers ac
    JOIN interest_careers ic ON ic.career_id = ac.career_id
    JOIN careers c ON c.id = ic.career_id
    JOIN activities a ON a.id = ac.activity_id
    WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
  ),
  activities_with_sessions AS (
    SELECT DISTINCT ra.activity_id, ra.career_name, ra.career_id, ra.ord
    FROM related_activities ra
    JOIN activity_sessions s ON s.activity_id = ra.activity_id
    WHERE s.status = 'activa' AND s.is_demo = v_p.is_demo
  ),
  deduped AS (
    SELECT
      aw.activity_id,
      min(aw.ord) AS priority,
      string_agg(DISTINCT aw.career_name, ', ' ORDER BY aw.career_name) AS related_careers,
      jsonb_agg(DISTINCT jsonb_build_object('career_id', aw.career_id, 'career_name', aw.career_name)) AS careers
    FROM activities_with_sessions aw
    GROUP BY aw.activity_id
  ),
  final AS (
    SELECT
      d.activity_id, d.priority, d.related_careers, d.careers,
      a.title, a.description, a.division_id,
      div.name AS division_name, div.code AS division_code,
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
          'credits', s.credits, 'started', now() >= s.starts_at
        ) ORDER BY s.starts_at)
        FROM activity_sessions s
        WHERE s.activity_id = d.activity_id AND s.status = 'activa' AND s.is_demo = v_p.is_demo
      ), '[]'::jsonb) AS sessions
    FROM deduped d
    JOIN activities a ON a.id = d.activity_id
    JOIN divisions div ON div.id = a.division_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', f.activity_id, 'title', f.title,
    'description', left(f.description, 200),
    'division_id', f.division_id, 'division_name', f.division_name, 'division_code', f.division_code,
    'related_careers', f.related_careers, 'careers', f.careers,
    'already_attended', f.already_attended, 'already_reserved', f.already_reserved,
    'sessions', f.sessions, 'priority', f.priority
  ) ORDER BY f.already_attended, f.priority, f.title), '[]'::jsonb) INTO v_result
  FROM final f;

  RETURN jsonb_build_object('recommendations', v_result, 'attended_activity_ids', to_jsonb(v_attended_ids));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_recommended_activities() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_recommended_activities() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_recommended_activities() TO authenticated;