/*
  Hotfix de rendimiento: `my_reservation_board()`.

  Diagnostico (produccion, 2026-10-15 ~14:57 UTC): ~50 mil llamadas a ~1.3 s (hasta 8 s) = casi todo el tiempo de CPU de PostgreSQL;
  el inicio de sesion (Auth), `editions`, `divisions`, etc. iban lentos solo por la saturacion.
  Causa: por cada llamada se ejecutaba `session_reserved_count(s.id)` UNA VEZ POR SESION (216). Esa funcion cuenta
  `status IN ('vigente','expirada')`, pero el unico indice parcial por sesion cubre solo `vigente`, asi que cada ejecucion recorria
  toda `reservations` (~26 mil lecturas de buffer por llamada del tablero).

  Cambio (mismo resultado exacto, mismas reglas de seguridad):
  1. Un indice parcial que cubre exactamente ese filtro (`session_reserved_count`, difusiones, reserva).
  2. El tablero obtiene todos los conteos en UNA sola agregacion en lugar de 216 llamadas.
  No se modifican `reserve_session`, `check_in`, sellos, cupos ni autorizacion (`require_participant`, SECURITY DEFINER, STABLE).
*/

CREATE INDEX IF NOT EXISTS reservations_session_counted
  ON public.reservations (session_id) WHERE status IN ('vigente', 'expirada');

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
        'capacity', s.capacity, 'reserved', coalesce(c.n, 0), 'remaining', greatest(s.capacity - coalesce(c.n, 0), 0),
        'enrollment_closes_at', session_enrollment_deadline(s.starts_at, s.ends_at),
        'enrollment_open', now() <= session_enrollment_deadline(s.starts_at, s.ends_at),
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
      -- Mismo conteo que session_reserved_count() (vigente + expirada), calculado UNA vez para todas las sesiones.
      LEFT JOIN (SELECT rc.session_id, count(*)::int AS n FROM reservations rc
                 WHERE rc.status IN ('vigente', 'expirada') GROUP BY rc.session_id) c ON c.session_id = s.id
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
$function$;
