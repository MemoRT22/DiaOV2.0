-- Explicit audience; existing activities retain student behavior by default.
-- Only the known educators-only activity changes audience. Academic relationships,
-- schedules, capacities and credentials are preserved.
ALTER TABLE public.activities ADD COLUMN audience text NOT NULL DEFAULT 'students'
  CONSTRAINT activities_audience_check CHECK (audience IN ('students', 'educators'));
COMMENT ON COLUMN public.activities.audience IS 'students: ordinary student flow; educators: educational staff only';
UPDATE public.activities SET audience = 'educators'
WHERE id = 'cef9d429-d193-49fc-8883-d15a5ee30fdc';

CREATE OR REPLACE FUNCTION public.set_activity_audience(p_activity uuid, p_audience text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  IF p_audience IS NULL OR p_audience NOT IN ('students', 'educators') THEN
    RAISE EXCEPTION 'INVALID_AUDIENCE';
  END IF;
  PERFORM 1 FROM activities WHERE id = p_activity AND edition_id = active_edition_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  UPDATE activities SET audience = p_audience WHERE id = p_activity;
  PERFORM write_audit('activity.audience_changed', jsonb_build_object('activity_id', p_activity, 'audience', p_audience));
END;
$$;
REVOKE ALL ON FUNCTION public.set_activity_audience(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_activity_audience(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.activity_audience(p_activity uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audience text;
BEGIN
  PERFORM require_coordinacion();
  SELECT audience INTO v_audience FROM activities
  WHERE id = p_activity AND edition_id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_audience;
END;
$$;
REVOKE ALL ON FUNCTION public.activity_audience(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_audience(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assert_reservable(p_pid uuid, p_session uuid, p_exclude uuid)
RETURNS activity_sessions
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p participants%ROWTYPE; v_ed editions%ROWTYPE; v_s activity_sessions%ROWTYPE; v_a activities%ROWTYPE;
  v_win text; v_active int;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = p_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;
  v_win := reservation_window(v_ed.reservations_open_at, v_ed.reservations_close_at);
  IF v_win = 'not_open' THEN RAISE EXCEPTION 'RESERVATIONS_NOT_OPEN'; END IF;
  IF v_win = 'closed' THEN RAISE EXCEPTION 'RESERVATIONS_CLOSED'; END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = p_session;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;
  IF v_s.id IS NULL OR v_a.edition_id IS DISTINCT FROM v_ed.id OR v_a.is_demo IS DISTINCT FROM v_p.is_demo
     OR v_s.status = 'oculta' THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE';
  END IF;
  IF v_a.audience <> 'students' THEN RAISE EXCEPTION 'ACTIVITY_EDUCATORS_ONLY'; END IF;
  IF v_s.is_demo IS DISTINCT FROM v_p.is_demo THEN RAISE EXCEPTION 'SESSION_UNAVAILABLE'; END IF;
  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
  -- Una sesión en curso sigue aceptando alumnos; solo deja de hacerlo cuando termina.
  IF now() >= v_s.ends_at THEN RAISE EXCEPTION 'SESSION_ENDED'; END IF;

  IF EXISTS (SELECT 1 FROM attendances WHERE participant_id = p_pid AND activity_id = v_s.activity_id) THEN
    RAISE EXCEPTION 'ALREADY_ATTENDED';
  END IF;

  IF EXISTS (SELECT 1 FROM reservations WHERE participant_id = p_pid AND session_id = p_session
             AND status = 'vigente' AND id IS DISTINCT FROM p_exclude) THEN
    RAISE EXCEPTION 'ALREADY_RESERVED';
  END IF;

  -- El taller sigue ocupado mientras la sesión reservada no termine; después (sin asistencia) se puede reservar otro horario.
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions s2 ON s2.id = r.session_id
             WHERE r.participant_id = p_pid AND r.activity_id = v_s.activity_id
               AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND now() < s2.ends_at) THEN
    RAISE EXCEPTION 'SAME_WORKSHOP';
  END IF;

  v_active := active_reservation_count(p_pid);
  IF p_exclude IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM reservations r
               JOIN activity_sessions s2 ON s2.id = r.session_id
               WHERE r.id = p_exclude AND r.status = 'vigente'
                 AND now() < s2.ends_at
                 AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id)) THEN
      v_active := v_active - 1;
    END IF;
  END IF;
  IF v_active >= v_ed.max_reservations THEN
    RAISE EXCEPTION 'MAX_RESERVATIONS';
  END IF;

  -- Solo el solapamiento temporal REAL con un compromiso VIGENTE bloquea: reservación vigente, sin asistencia y cuya sesión no terminó.
  -- Una actividad con asistencia ya está completada y libera al alumno aunque su horario nominal siga abierto (taller que terminó antes).
  -- Sesiones consecutivas o con poco traslado son válidas (el buffer es solo una advertencia).
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions o ON o.id = r.session_id
             WHERE r.participant_id = p_pid AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND now() < o.ends_at
               AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id)
               AND o.starts_at < v_s.ends_at AND v_s.starts_at < o.ends_at) THEN
    RAISE EXCEPTION 'SCHEDULE_CONFLICT';
  END IF;

  IF session_reserved_count(p_session) >= v_s.capacity THEN RAISE EXCEPTION 'SESSION_FULL'; END IF;
  RETURN v_s;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_reservable(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_reservation_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := require_participant(true); v_p participants%ROWTYPE; v_ed editions%ROWTYPE;
  v_buffer interval;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;
  v_buffer := make_interval(mins => v_ed.travel_buffer_minutes);

  RETURN jsonb_build_object(
    'server_time', now(),
    'window', reservation_window(v_ed.reservations_open_at, v_ed.reservations_close_at),
    'opens_at', v_ed.reservations_open_at,
    'closes_at', v_ed.reservations_close_at,
    'max_reservations', v_ed.max_reservations,
    'active_reservation_count', active_reservation_count(v_pid),
    'travel_buffer_minutes', v_ed.travel_buffer_minutes,
    'checkin_close_after_minutes', v_ed.checkin_close_after_minutes,
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'activity_id', s.activity_id, 'title', a.title, 'description', a.description,
        'division_id', a.division_id,
        -- Tipo oficial de la misión y, en Vida Universitaria, su categoría de experiencia.
        'activity_type', a.activity_type, 'experience_category', a.experience_category,
        'division_ids', coalesce((
          SELECT jsonb_agg(d.division_id ORDER BY d.division_id)
          FROM (
            SELECT ad.division_id FROM activity_divisions ad WHERE ad.activity_id = a.id
            UNION
            SELECT a.division_id WHERE a.division_id IS NOT NULL
          ) d), '[]'::jsonb),
        'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'location', coalesce(nullif(s.location, ''), a.location), 'credits', s.credits, 'status', s.status,
        'capacity', s.capacity, 'reserved', c.reserved, 'remaining', greatest(s.capacity - c.reserved, 0),
        'started', now() >= s.starts_at,
        'ended', now() >= s.ends_at,
        'in_progress', now() >= s.starts_at AND now() < s.ends_at,
        'attended', EXISTS (SELECT 1 FROM attendances at WHERE at.participant_id = v_pid AND at.activity_id = s.activity_id),
        'my_reservation_id', (SELECT r.id FROM reservations r WHERE r.session_id = s.id
                              AND r.participant_id = v_pid AND r.status = 'vigente'),
        'conflicts_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r
          JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
            AND now() < o.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a2 WHERE a2.participant_id = v_pid AND a2.activity_id = r.activity_id)
            AND o.starts_at < s.ends_at AND s.starts_at < o.ends_at), '[]'::jsonb),
        'tight_transfer_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r
          JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
            AND NOT EXISTS (SELECT 1 FROM attendances a3 WHERE a3.participant_id = v_pid AND a3.activity_id = r.activity_id)
            AND ((o.ends_at <= s.starts_at AND s.starts_at < o.ends_at + v_buffer AND now() < o.ends_at)
                 OR (s.ends_at <= o.starts_at AND o.starts_at < s.ends_at + v_buffer AND now() < s.ends_at))), '[]'::jsonb)
      ) ORDER BY s.starts_at, a.title)
      FROM activity_sessions s
      JOIN activities a ON a.id = s.activity_id
      CROSS JOIN LATERAL (SELECT session_reserved_count(s.id) AS reserved) c
      WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
        AND s.is_demo = v_p.is_demo
        AND (a.audience = 'students' OR EXISTS (
          SELECT 1 FROM reservations own WHERE own.participant_id = v_pid AND own.session_id = s.id
            AND own.status IN ('vigente', 'cancelada_sesion', 'expirada')
        ))
        AND (s.status = 'activa' OR EXISTS (
          SELECT 1 FROM reservations r WHERE r.session_id = s.id AND r.participant_id = v_pid
            AND r.status IN ('vigente', 'cancelada_sesion', 'expirada')))
    ), '[]'::jsonb),
    'reservations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'session_id', r.session_id, 'activity_id', r.activity_id, 'status', r.status,
        'created_at', r.created_at, 'ended_at', r.ended_at,
        'resolved', r.status = 'cancelada_sesion' AND EXISTS (
          SELECT 1 FROM reservations n WHERE n.participant_id = v_pid AND n.status = 'vigente'
            AND n.created_at > r.ended_at),
        'derived_status',
          CASE
            WHEN EXISTS (SELECT 1 FROM attendances at WHERE at.participant_id = v_pid AND at.activity_id = r.activity_id)
              THEN 'completed'
            WHEN r.status = 'expirada' THEN 'expired'
            WHEN r.status = 'cancelada_sesion' THEN 'cancelled'
            WHEN r.status = 'vigente' AND now() >= s.ends_at THEN 'ended'
            WHEN r.status = 'vigente' AND now() >= s.starts_at THEN 'in_progress'
            WHEN r.status = 'vigente' THEN 'active'
            ELSE r.status
          END,
        'credits_granted', (
          SELECT at.credits_granted FROM attendances at
          WHERE at.participant_id = v_pid AND at.activity_id = r.activity_id LIMIT 1)
      ) ORDER BY s.starts_at)
      FROM reservations r JOIN activity_sessions s ON s.id = r.session_id
      WHERE r.participant_id = v_pid AND r.status IN ('vigente', 'cancelada_sesion', 'expirada')
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_reservation_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_reservation_board() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_workshop_detail(p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant_id uuid := public.require_participant(true);
  v_participant public.participants%ROWTYPE;
  v_detail jsonb;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = v_participant_id;

  SELECT jsonb_build_object(
    'activity_id', a.id,
    'title', a.title,
    'student_pitch', a.description,
    'activity_type', a.activity_type,
    'experience_category', a.experience_category,
    'objective', nullif(btrim(ws.objective), ''),
    'takeaway', nullif(btrim(ws.takeaway), ''),
    'requirements', nullif(btrim(ws.requirements), ''),
    'careers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
      FROM public.activity_careers ac
      JOIN public.careers c ON c.id = ac.career_id
      WHERE ac.activity_id = a.id AND c.is_demo = a.is_demo
    ), '[]'::jsonb),
    'divisions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.sort_order, d.name)
      FROM public.divisions d
      WHERE d.id IN (
        SELECT ad.division_id FROM public.activity_divisions ad WHERE ad.activity_id = a.id
        UNION
        SELECT a.division_id WHERE a.division_id IS NOT NULL
      ) AND d.is_demo = a.is_demo
    ), '[]'::jsonb)
  ) INTO v_detail
  FROM public.activities a
  JOIN public.editions e ON e.id = a.edition_id AND e.is_active
  LEFT JOIN LATERAL (
    SELECT s.objective, s.takeaway, s.requirements
    FROM public.workshop_submissions s
    WHERE s.published_activity_id = a.id AND s.edition_id = a.edition_id
      AND s.is_demo = a.is_demo AND s.status = 'published'
    ORDER BY s.id LIMIT 1
  ) ws ON true
  WHERE a.id = p_activity_id
    AND a.audience = 'students'
    AND a.edition_id = v_participant.edition_id
    AND a.is_demo = v_participant.is_demo
    AND EXISTS (
      SELECT 1 FROM public.activity_sessions s
      WHERE s.activity_id = a.id AND s.status = 'activa'
    );

  RETURN v_detail;
END;
$$;
REVOKE ALL ON FUNCTION public.my_workshop_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_workshop_detail(uuid) TO authenticated;

-- Reconcile recommendations with current activity types, expired-seat accounting
-- and DEMO scope. Legacy keys remain compatible with cached frontends.
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
    JOIN careers c ON c.id = ii.career_id AND c.is_demo = v_p.is_demo
    WHERE ii.participant_id = v_pid AND ii.career_id IS NOT NULL
  ),
  acts AS (
    SELECT a.id, a.title, a.description, a.location
    FROM activities a
    WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo AND a.activity_type = 'academica' AND a.audience = 'students'
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

