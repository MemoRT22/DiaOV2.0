-- Correcciones posteriores a 20261007190000_workshops_single_flow (ya aplicada: NO se modifica). Compatible con frontend anterior y nuevo.

-- 1) Ubicación operacional: activity_sessions.location tiene default '' (no NULL), así que coalesce(s.location, a.location) nunca
--    llegaba a la ubicación de la activity. Una sesión sin override ('' ) hereda la ubicación del taller. No se modifica ningún dato.
CREATE OR REPLACE FUNCTION public.workshop_admin_get_internal(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_submission public.workshop_submissions%ROWTYPE;
  v_careers jsonb;
  v_reviewer text;
  v_sessions jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_edition AND status <> 'draft';
  IF v_submission.id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'career_id', c.id, 'career_name', c.name, 'division_id', d.id,
    'division_name', d.name, 'division_code', d.code
  ) ORDER BY d.sort_order, d.name, c.name), '[]'::jsonb) INTO v_careers
  FROM public.workshop_submission_careers sc
  JOIN public.careers c ON c.id = sc.career_id
  JOIN public.divisions d ON d.id = c.division_id
  WHERE sc.submission_id = v_submission.id;
  SELECT full_name INTO v_reviewer FROM public.staff_members WHERE user_id = v_submission.reviewed_by;
  IF v_submission.published_activity_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'capacity', s.capacity, 'reserved', public.session_reserved_count(s.id),
      'location', coalesce(nullif(s.location, ''), a.location), 'status', s.status
    ) ORDER BY s.starts_at, s.id), '[]'::jsonb) INTO v_sessions
    FROM public.activity_sessions s
    JOIN public.activities a ON a.id = s.activity_id AND a.edition_id = v_edition
    WHERE s.activity_id = v_submission.published_activity_id;
  END IF;
  RETURN to_jsonb(v_submission) || jsonb_build_object('careers', v_careers, 'reviewer_name', v_reviewer, 'sessions', v_sessions);
END;
$$;
REVOKE ALL ON FUNCTION public.workshop_admin_get_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_admin_get_internal(uuid) TO service_role;

-- 2) Tablero del alumno: un taller puede pertenecer a varias divisiones (activity_divisions) y entonces activities.division_id es NULL.
--    Se conserva `division_id` (legacy, singular) y se añade `division_ids` con TODAS las divisiones relacionadas, sin duplicados;
--    una activity legacy con division_id pero sin filas en activity_divisions sigue incluyendo esa división.
--    Es la definición vigente de my_reservation_board() con ese único campo añadido (reservas, disponibilidad y conflictos no cambian).
CREATE OR REPLACE FUNCTION public.my_reservation_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
-- Los permisos de CREATE OR REPLACE se conservan (authenticated; el resto sin acceso).
