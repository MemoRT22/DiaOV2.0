-- Recomendador determinístico de talleres académicos (sin IA, sin embeddings, sin servicios externos).
--
-- Fuente de datos (ya existente, no se crea ninguna tabla):
--   initial_interests (carreras que el alumno declaró en el prerregistro/autorregistro, con `preference`),
--   careers.division_id, activity_careers (las afinidades que salen de la propuesta del tallerista al publicar:
--   workshop_submission_careers → activity_careers) y activity_divisions.
-- Los intereses POST-evento (post_event_interests) NO se usan: su propósito es otro.
--
-- ALGORITMO (todo set-based, una sola consulta, sin N+1)
--   Elegibilidad
--     · misma edición, mismo is_demo, activity_type = 'academica'.
--     · NIVEL 1  exact_career : la actividad está ligada (activity_careers) a ≥ 1 carrera de interés del alumno.
--                Se devuelven TODAS las exactas relevantes (una sola entrada por actividad, con todas las carreras coincidentes).
--     · NIVEL 2  same_division: la actividad pertenece (activity_divisions) a la división de alguna carrera de interés, NO es exacta,
--                no está ya asistida y es accionable. Solo se usa para completar hasta 4 opciones NUEVAS y utilizables.
--     · "Relevante" (exacta): tiene alguna sesión activa que no ha terminado, o ya está reservada, o ya fue asistida (se conserva para «Explorado»).
--       Una actividad con todas sus sesiones terminadas y sin reservación/asistencia NO se recomienda.
--     · "Utilizable y nueva": no asistida y (reservada o con una sesión activa que no terminó y aún tiene lugares).
--       Faltan = max(0, 4 − exactas nuevas y utilizables); el nivel 2 aporta como máximo ese número.
--       Las ya asistidas NO cuentan para el mínimo.
--   Orden (lexicográfico, estable y explicable; no hay puntuaciones mágicas)
--     1. no asistidas antes que asistidas
--     2. exact_career antes que same_division
--     3. interest_priority ascendente (preferencia del mejor interés que explica la recomendación; en división, la del interés cuya división coincide)
--     4. disponibilidad: sin reservar con sesión EN CURSO y lugares (1) → sin reservar con sesión futura y lugares (2) → ya en tu ruta (3) → sin lugares (4)
--     5. inicio de la próxima sesión con lugares (más cercana primero)
--     6. título (minúsculas) y activity_id como desempate final
--   Mismo alumno + mismos datos + mismo instante ⇒ mismo resultado.
--
-- CONTRATO  my_recommended_activities() → jsonb
--   { recommendations: [ {
--       activity_id, title, description(≤200), division_id/name/code (solo si la actividad tiene UNA división), divisions[],
--       recommendation_type: 'exact_career' | 'same_division',
--       matched_careers: [{career_id, career_name, preference}]   -- vacío en same_division
--       matched_division: {division_id, division_name, division_code} | null   -- solo en same_division
--       interest_priority: int,
--       has_open_session: bool,
--       already_attended, already_reserved,
--       sessions: [{session_id, starts_at, ends_at, location, capacity, reserved, remaining, credits, started, ended}],
--       -- compatibilidad con el frontend anterior:
--       related_careers: text, careers: [{career_id, career_name}], priority: int
--     } ... ],
--     interest_career_ids: uuid[], attended_activity_ids: uuid[],
--     summary: { exact: n, same_division: n, minimum_target: 4 } }
--
-- Solo describe y ordena: nunca crea, cambia ni cancela reservaciones, y no duplica assert_reservable() (el tablero de reservaciones
-- sigue siendo la autoridad de lo que realmente se puede reservar). Una actividad creada manualmente sin activity_careers no se
-- recomienda por afinidad exacta hasta que se configuren sus carreras.

CREATE OR REPLACE FUNCTION public.my_recommended_activities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_ed editions%ROWTYPE;
  v_target constant int := 4;
  v_interest_ids uuid[];
  v_attended_ids uuid[];
  v_result jsonb;
  v_summary jsonb;
BEGIN
  SELECT p.* INTO v_p FROM participants p WHERE p.id = v_pid;
  SELECT e.* INTO v_ed FROM editions e WHERE e.id = v_p.edition_id;

  v_interest_ids := ARRAY(
    SELECT ii.career_id FROM initial_interests ii
    WHERE ii.participant_id = v_pid AND ii.career_id IS NOT NULL
    ORDER BY ii.preference
  );

  SELECT coalesce(array_agg(DISTINCT att.activity_id), '{}') INTO v_attended_ids
  FROM attendances att WHERE att.participant_id = v_pid;

  WITH interests AS (
    SELECT ii.career_id, ii.preference::int AS pref, c.name AS career_name, c.division_id
    FROM initial_interests ii
    JOIN careers c ON c.id = ii.career_id
    WHERE ii.participant_id = v_pid AND ii.career_id IS NOT NULL
  ),
  acts AS (
    SELECT a.id, a.title, a.description, a.location
    FROM activities a
    WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo AND a.activity_type = 'academica'
  ),
  seat_counts AS (
    SELECT r.session_id, count(*)::int AS n
    FROM reservations r
    WHERE r.status IN ('vigente', 'expirada')
    GROUP BY r.session_id
  ),
  sess AS (
    SELECT s.id, s.activity_id, s.starts_at, s.ends_at, s.capacity, s.location, s.credits,
           coalesce(sc.n, 0) AS reserved,
           greatest(s.capacity - coalesce(sc.n, 0), 0) AS remaining
    FROM activity_sessions s
    JOIN acts ON acts.id = s.activity_id
    LEFT JOIN seat_counts sc ON sc.session_id = s.id
    WHERE s.status = 'activa' AND s.is_demo = v_p.is_demo
  ),
  act_state AS (
    SELECT acts.id AS activity_id,
           coalesce(bool_or(s.starts_at <= now() AND s.ends_at > now() AND s.remaining > 0), false) AS live_open,
           coalesce(bool_or(s.starts_at > now() AND s.remaining > 0), false) AS future_open,
           coalesce(bool_or(s.ends_at > now()), false) AS has_unended,
           min(s.starts_at) FILTER (WHERE s.ends_at > now() AND s.remaining > 0) AS next_open_start
    FROM acts LEFT JOIN sess s ON s.activity_id = acts.id
    GROUP BY acts.id
  ),
  mine AS (
    SELECT DISTINCT r.activity_id FROM reservations r WHERE r.participant_id = v_pid AND r.status = 'vigente'
  ),
  done AS (
    SELECT DISTINCT att.activity_id FROM attendances att WHERE att.participant_id = v_pid
  ),
  exact AS (
    SELECT ac.activity_id,
           min(i.pref) AS pref,
           jsonb_agg(jsonb_build_object('career_id', i.career_id, 'career_name', i.career_name, 'preference', i.pref)
                     ORDER BY i.pref, i.career_name) AS matched
    FROM activity_careers ac
    JOIN interests i ON i.career_id = ac.career_id
    JOIN acts ON acts.id = ac.activity_id
    GROUP BY ac.activity_id
  ),
  div_match AS (
    SELECT DISTINCT ON (ad.activity_id)
           ad.activity_id, i.pref, d.id AS division_id, d.name AS division_name, d.code AS division_code
    FROM activity_divisions ad
    JOIN interests i ON i.division_id = ad.division_id
    JOIN divisions d ON d.id = ad.division_id
    JOIN acts ON acts.id = ad.activity_id
    ORDER BY ad.activity_id, i.pref, d.name
  ),
  cand AS (
    SELECT a.id AS activity_id, a.title, 'exact_career'::text AS rtype, e.pref, e.matched, NULL::jsonb AS mdiv
    FROM acts a JOIN exact e ON e.activity_id = a.id
    UNION ALL
    SELECT a.id, a.title, 'same_division', dm.pref, '[]'::jsonb,
           jsonb_build_object('division_id', dm.division_id, 'division_name', dm.division_name, 'division_code', dm.division_code)
    FROM acts a JOIN div_match dm ON dm.activity_id = a.id
    WHERE NOT EXISTS (SELECT 1 FROM exact e WHERE e.activity_id = a.id)
  ),
  scored AS (
    SELECT c.*,
           (d.activity_id IS NOT NULL) AS attended,
           (m.activity_id IS NOT NULL) AS reserved,
           coalesce(st.live_open, false) AS live_open,
           coalesce(st.future_open, false) AS future_open,
           coalesce(st.has_unended, false) AS has_unended,
           st.next_open_start,
           CASE WHEN m.activity_id IS NOT NULL THEN 3
                WHEN coalesce(st.live_open, false) THEN 1
                WHEN coalesce(st.future_open, false) THEN 2
                ELSE 4 END AS avail_rank
    FROM cand c
    LEFT JOIN done d ON d.activity_id = c.activity_id
    LEFT JOIN mine m ON m.activity_id = c.activity_id
    LEFT JOIN act_state st ON st.activity_id = c.activity_id
  ),
  eligible AS (
    SELECT s.* FROM scored s
    WHERE (s.rtype = 'exact_career' AND (s.has_unended OR s.reserved OR s.attended))
       OR (s.rtype = 'same_division' AND NOT s.attended AND (s.reserved OR s.live_open OR s.future_open))
  ),
  need AS (
    SELECT greatest(v_target - count(*), 0)::int AS n
    FROM eligible e
    WHERE e.rtype = 'exact_career' AND NOT e.attended AND (e.reserved OR e.live_open OR e.future_open)
  ),
  fallback AS (
    SELECT e.*, row_number() OVER (ORDER BY e.pref, e.avail_rank, e.next_open_start NULLS LAST, lower(e.title), e.activity_id) AS rn
    FROM eligible e WHERE e.rtype = 'same_division'
  ),
  picked AS (
    SELECT e.activity_id, e.title, e.rtype, e.pref, e.matched, e.mdiv, e.attended, e.reserved, e.live_open, e.future_open,
           e.avail_rank, e.next_open_start
    FROM eligible e WHERE e.rtype = 'exact_career'
    UNION ALL
    SELECT f.activity_id, f.title, f.rtype, f.pref, f.matched, f.mdiv, f.attended, f.reserved, f.live_open, f.future_open,
           f.avail_rank, f.next_open_start
    FROM fallback f CROSS JOIN need WHERE f.rn <= need.n
  ),
  shaped AS (
    SELECT p.*,
           left(a.description, 200) AS description,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('division_id', div.id, 'division_name', div.name, 'division_code', div.code) ORDER BY div.name)
             FROM activity_divisions ad JOIN divisions div ON div.id = ad.division_id
             WHERE ad.activity_id = p.activity_id
           ), '[]'::jsonb) AS divisions_array,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
               'session_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
               'location', coalesce(nullif(s.location, ''), a.location),
               'capacity', s.capacity, 'reserved', s.reserved, 'remaining', s.remaining,
               'credits', s.credits, 'started', now() >= s.starts_at, 'ended', now() >= s.ends_at
             ) ORDER BY s.starts_at)
             FROM sess s WHERE s.activity_id = p.activity_id
           ), '[]'::jsonb) AS sessions
    FROM picked p JOIN activities a ON a.id = p.activity_id
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'activity_id', sh.activity_id,
      'title', sh.title,
      'description', sh.description,
      'division_id', CASE WHEN jsonb_array_length(sh.divisions_array) = 1 THEN sh.divisions_array->0->>'division_id' END,
      'division_name', CASE WHEN jsonb_array_length(sh.divisions_array) = 1 THEN sh.divisions_array->0->>'division_name' END,
      'division_code', CASE WHEN jsonb_array_length(sh.divisions_array) = 1 THEN sh.divisions_array->0->>'division_code' END,
      'divisions', sh.divisions_array,
      'recommendation_type', sh.rtype,
      'matched_careers', sh.matched,
      'matched_division', sh.mdiv,
      'interest_priority', sh.pref,
      'has_open_session', (sh.live_open OR sh.future_open),
      'already_attended', sh.attended,
      'already_reserved', sh.reserved,
      'sessions', sh.sessions,
      'related_careers', coalesce((SELECT string_agg(m->>'career_name', ', ' ORDER BY (m->>'preference')::int) FROM jsonb_array_elements(sh.matched) m), ''),
      'careers', coalesce((SELECT jsonb_agg(jsonb_build_object('career_id', m->>'career_id', 'career_name', m->>'career_name') ORDER BY (m->>'preference')::int) FROM jsonb_array_elements(sh.matched) m), '[]'::jsonb),
      'priority', sh.pref
    ) ORDER BY sh.attended, (sh.rtype <> 'exact_career'), sh.pref, sh.avail_rank, sh.next_open_start NULLS LAST, lower(sh.title), sh.activity_id), '[]'::jsonb),
    jsonb_build_object(
      'exact', count(*) FILTER (WHERE sh.rtype = 'exact_career'),
      'same_division', count(*) FILTER (WHERE sh.rtype = 'same_division'),
      'minimum_target', v_target)
  INTO v_result, v_summary
  FROM shaped sh;

  RETURN jsonb_build_object(
    'recommendations', v_result,
    'interest_career_ids', to_jsonb(v_interest_ids),
    'attended_activity_ids', to_jsonb(v_attended_ids),
    'summary', v_summary
  );
END;
$function$;

-- Misma exposición que antes: solo participantes autenticados (la función resuelve al participante desde auth.uid()).
REVOKE ALL ON FUNCTION public.my_recommended_activities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_recommended_activities() TO authenticated;
