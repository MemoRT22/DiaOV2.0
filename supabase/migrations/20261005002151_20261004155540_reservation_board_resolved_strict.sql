CREATE OR REPLACE FUNCTION public.my_reservation_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_pid uuid := require_participant(true); v_p participants%ROWTYPE; v_ed editions%ROWTYPE; v_buffer interval;
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
'travel_buffer_minutes', v_ed.travel_buffer_minutes,
'sessions', coalesce((
SELECT jsonb_agg(jsonb_build_object(
'id', s.id, 'activity_id', s.activity_id, 'title', a.title, 'description', a.description,
'division_id', a.division_id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
'location', coalesce(nullif(s.location, ''), a.location), 'credits', s.credits, 'status', s.status,
'capacity', s.capacity, 'reserved', c.reserved, 'remaining', greatest(s.capacity - c.reserved, 0),
'started', now() >= s.starts_at,
'my_reservation_id', (SELECT r.id FROM reservations r WHERE r.session_id = s.id
AND r.participant_id = v_pid AND r.status = 'vigente'),
'conflicts_with', coalesce((
SELECT jsonb_agg(r.id) FROM reservations r JOIN activity_sessions o ON o.id = r.session_id
WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
AND o.starts_at < s.ends_at + v_buffer AND s.starts_at < o.ends_at + v_buffer), '[]'::jsonb)
) ORDER BY s.starts_at, a.title)
FROM activity_sessions s
JOIN activities a ON a.id = s.activity_id
CROSS JOIN LATERAL (SELECT session_reserved_count(s.id) AS reserved) c
WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
AND (s.status = 'activa' OR EXISTS (
SELECT 1 FROM reservations r WHERE r.session_id = s.id AND r.participant_id = v_pid
AND r.status IN ('vigente', 'cancelada_sesion')))
), '[]'::jsonb),
'reservations', coalesce((
SELECT jsonb_agg(jsonb_build_object(
'id', r.id, 'session_id', r.session_id, 'activity_id', r.activity_id, 'status', r.status,
'created_at', r.created_at, 'ended_at', r.ended_at,
'resolved', r.status = 'cancelada_sesion' AND EXISTS (
SELECT 1 FROM reservations n WHERE n.participant_id = v_pid AND n.status = 'vigente'
AND n.created_at > r.ended_at)
) ORDER BY s.starts_at)
FROM reservations r JOIN activity_sessions s ON s.id = r.session_id
WHERE r.participant_id = v_pid AND r.status IN ('vigente', 'cancelada_sesion')
), '[]'::jsonb)
);
END;
$function$;