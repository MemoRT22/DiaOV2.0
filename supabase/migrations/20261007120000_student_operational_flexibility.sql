-- Flexibilidad operativa del alumno (Día OV es un evento presencial: los talleres no empiezan ni terminan como un reloj).
--
-- Principio: automatizar el camino feliz, permitir excepciones naturales y bloquear solo lo que produciría inconsistencias reales.
--
-- Reglas que se FLEXIBILIZAN
--   * check_in: la hora programada deja de autorizar. Ya no existen CHECKIN_TOO_EARLY ni CHECKIN_TOO_LATE; el instructor decide
--     cuándo muestra el QR. Basta una reservación válida (no cancelada) de la actividad, credencial válida y no tener ya asistencia.
--   * Reservar una sesión que ya comenzó: se permite mientras now() < ends_at (SESSION_STARTED desaparece; ahora es SESSION_ENDED).
--   * Cancelar / cambiar una reservación ya iniciada: se permite mientras now() < ends_at y no exista asistencia
--     (SESSION_STARTED / CURRENT_SESSION_STARTED desaparecen; ahora SESSION_ENDED / CURRENT_SESSION_ENDED / ALREADY_ATTENDED).
--   * Traslado: travel_buffer_minutes deja de bloquear; solo el SOLAPAMIENTO REAL de horarios es SCHEDULE_CONFLICT. El buffer se
--     usa únicamente para advertir (tight_transfer_with en my_reservation_board).
--   * Mismo taller en otro horario: la reservación anterior deja de "ocupar" el taller cuando su sesión termina (ya no
--     ends_at + checkin_close_after_minutes). Si no tiene asistencia, pasa a `expirada` al reservar la nueva y se conserva como historial.
--
-- Reglas que se MANTIENEN (duras): consentimiento, demo/real, edición, capacidad (sin overbooking), máximo de compromisos activos,
-- solapamiento real, no doble asistencia/sello por actividad, credencial válida, sesión cancelada, reservación requerida para check-in,
-- ventana global reservations_open_at / reservations_close_at para reservas nuevas.
--
-- `editions.checkin_open_before_minutes` y `checkin_close_after_minutes` se conservan (no hay migración destructiva). Ya no autorizan
-- check-in. checkin_close_after_minutes sigue siendo leída por event_operations_overview (Centro de Operación: marca de atención de
-- sesiones recién terminadas) y se sigue exponiendo en my_reservation_board por compatibilidad con frontends en caché.

-- ============================================================
-- 1. Qué se puede reservar
-- ============================================================
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

  -- Solo el solapamiento temporal REAL bloquea. Sesiones consecutivas o con poco traslado son válidas (el buffer es solo una advertencia).
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions o ON o.id = r.session_id
             WHERE r.participant_id = p_pid AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND (now() < o.ends_at
                    OR EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id))
               AND o.starts_at < v_s.ends_at AND v_s.starts_at < o.ends_at) THEN
    RAISE EXCEPTION 'SCHEDULE_CONFLICT';
  END IF;

  IF session_reserved_count(p_session) >= v_s.capacity THEN RAISE EXCEPTION 'SESSION_FULL'; END IF;
  RETURN v_s;
END;
$function$;

-- Una reservación vigente cuya sesión terminó sin asistencia se archiva como `expirada` (historial) al reservar otro horario del mismo taller.
CREATE OR REPLACE FUNCTION public.expire_past_reservation(p_pid uuid, p_activity_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_r record;
BEGIN
  FOR v_r IN
    SELECT r.id, r.session_id
    FROM reservations r
    JOIN activity_sessions s ON s.id = r.session_id
    WHERE r.participant_id = p_pid
      AND r.activity_id = p_activity_id
      AND r.status = 'vigente'
      AND now() >= s.ends_at
      AND NOT EXISTS (
        SELECT 1 FROM attendances a
        WHERE a.participant_id = p_pid AND a.activity_id = p_activity_id
      )
    FOR UPDATE OF r
  LOOP
    UPDATE reservations SET status = 'expirada', ended_at = now() WHERE id = v_r.id;
    PERFORM write_audit('reservations.expired', jsonb_build_object(
      'reservation_id', v_r.id, 'session_id', v_r.session_id,
      'participant_id', p_pid, 'activity_id', p_activity_id));
  END LOOP;
END;
$function$;

-- ============================================================
-- 2. Cancelar y cambiar: mientras la sesión no termine y no haya asistencia
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pid uuid := require_participant(true); v_sid uuid; v_end timestamptz; v_r reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;
  SELECT session_id INTO v_sid FROM reservations WHERE id = p_reservation AND participant_id = v_pid;
  IF v_sid IS NULL THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  SELECT ends_at INTO v_end FROM activity_sessions WHERE id = v_sid FOR NO KEY UPDATE;
  SELECT * INTO v_r FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF v_r.status <> 'vigente' THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM attendances WHERE participant_id = v_pid AND activity_id = v_r.activity_id) THEN
    RAISE EXCEPTION 'ALREADY_ATTENDED';
  END IF;
  IF now() >= v_end THEN RAISE EXCEPTION 'SESSION_ENDED'; END IF;
  UPDATE reservations SET status = 'cancelada_alumno', ended_at = now() WHERE id = p_reservation;
  PERFORM broadcast_availability(v_sid);
  RETURN jsonb_build_object('reservation_id', p_reservation, 'session_id', v_sid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.change_reservation(p_reservation uuid, p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid uuid := require_participant(true); v_old_session uuid; v_r reservations%ROWTYPE;
  v_s activity_sessions%ROWTYPE; v_new uuid;
BEGIN
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;
  SELECT session_id INTO v_old_session FROM reservations WHERE id = p_reservation AND participant_id = v_pid;
  IF v_old_session IS NULL THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF v_old_session = p_session THEN RAISE EXCEPTION 'ALREADY_RESERVED'; END IF;
  PERFORM 1 FROM activity_sessions WHERE id IN (v_old_session, p_session) ORDER BY id FOR NO KEY UPDATE;
  SELECT * INTO v_r FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF v_r.status <> 'vigente' THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM attendances WHERE participant_id = v_pid AND activity_id = v_r.activity_id) THEN
    RAISE EXCEPTION 'ALREADY_ATTENDED';
  END IF;
  IF now() >= (SELECT ends_at FROM activity_sessions WHERE id = v_old_session) THEN
    RAISE EXCEPTION 'CURRENT_SESSION_ENDED';
  END IF;
  -- Atómico: si el destino falla (cupo, conflicto, ventana…), la excepción revierte todo y se conserva la reservación anterior.
  v_s := assert_reservable(v_pid, p_session, p_reservation);
  PERFORM expire_past_reservation(v_pid, v_s.activity_id);
  UPDATE reservations SET status = 'cambiada', ended_at = now() WHERE id = p_reservation;
  BEGIN
    INSERT INTO reservations (participant_id, session_id, activity_id)
    VALUES (v_pid, p_session, v_s.activity_id) RETURNING id INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_RESERVED';
  END;
  UPDATE reservations SET replaced_by = v_new WHERE id = p_reservation;
  PERFORM broadcast_availability(v_old_session);
  PERFORM broadcast_availability(p_session);
  RETURN jsonb_build_object('reservation_id', v_new, 'session_id', p_session, 'replaced', p_reservation);
END;
$function$;

-- ============================================================
-- 3. Check-in: sin dependencia del horario programado
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_in(p_credential text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_ed editions%ROWTYPE;
  v_match record;
  v_a activities%ROWTYPE;
  v_s activity_sessions%ROWTYPE;
  v_existing attendances%ROWTYPE;
  v_reservation_id uuid;
  v_session_id uuid;
  v_att_id uuid;
  v_credits int;
  v_method text;
BEGIN
  IF p_credential IS NULL OR btrim(p_credential) = '' THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;
  SELECT * INTO v_match FROM resolve_credential(btrim(p_credential));
  IF v_match.activity_id IS NULL THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;
  SELECT * INTO v_a FROM activities WHERE id = v_match.activity_id;
  IF v_a.edition_id IS DISTINCT FROM v_ed.id OR v_a.is_demo IS DISTINCT FROM v_p.is_demo THEN
    RAISE EXCEPTION 'INVALID_CREDENTIAL';
  END IF;

  -- Serializa los escaneos del mismo participante: una actividad otorga asistencia/sellos una sola vez.
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;

  -- Idempotencia POR ACTIVIDAD
  SELECT * INTO v_existing FROM attendances
  WHERE participant_id = v_pid AND activity_id = v_match.activity_id;
  IF v_existing.id IS NOT NULL THEN
    SELECT * INTO v_s FROM activity_sessions WHERE id = v_existing.session_id;
    RETURN jsonb_build_object(
      'already_registered', true,
      'attendance_id', v_existing.id,
      'session_id', v_existing.session_id,
      'activity_id', v_match.activity_id,
      'title', v_a.title,
      'starts_at', v_s.starts_at,
      'ends_at', v_s.ends_at,
      'credits_granted', v_existing.credits_granted,
      'method', v_existing.method,
      'stamps', my_stamp_count(v_pid),
      'attended_workshops', my_attended_workshop_count(v_pid),
      'level', participant_rank_level(v_pid)
    );
  END IF;

  -- La credencial es por actividad: elegir de forma determinista la sesión reservada más razonable respecto del momento real.
  --   1) sesión en curso; 2) la sesión pasada más reciente; 3) la futura más cercana. Nunca canceladas.
  SELECT r.id, r.session_id INTO v_reservation_id, v_session_id
  FROM reservations r
  JOIN activity_sessions s ON s.id = r.session_id
  WHERE r.participant_id = v_pid
    AND r.activity_id = v_match.activity_id
    AND r.status IN ('vigente', 'expirada')
    AND s.status <> 'cancelada'
  ORDER BY
    CASE WHEN now() >= s.starts_at AND now() < s.ends_at THEN 0
         WHEN now() >= s.ends_at THEN 1
         ELSE 2 END,
    CASE WHEN now() >= s.ends_at THEN s.ends_at END DESC NULLS LAST,
    CASE WHEN now() < s.starts_at THEN s.starts_at END ASC NULLS LAST,
    s.starts_at DESC, r.created_at DESC, r.id
  LIMIT 1;

  IF v_reservation_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM reservations r JOIN activity_sessions s ON s.id = r.session_id
               WHERE r.participant_id = v_pid AND r.activity_id = v_match.activity_id
                 AND r.status IN ('vigente', 'expirada', 'cancelada_sesion') AND s.status = 'cancelada') THEN
      RAISE EXCEPTION 'SESSION_CANCELLED';
    END IF;
    RAISE EXCEPTION 'NO_RESERVATION';
  END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = v_session_id;

  v_credits := coalesce(v_s.credits, 1);
  v_method := v_match.method;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method, reservation_id)
  VALUES (v_pid, v_s.id, v_s.activity_id, v_credits, v_method, v_reservation_id)
  RETURNING id INTO v_att_id;
  PERFORM write_audit('attendance.checked_in', jsonb_build_object(
    'session_id', v_s.id, 'activity_id', v_s.activity_id, 'participant_id', v_pid, 'method', v_method));

  RETURN jsonb_build_object(
    'already_registered', false,
    'attendance_id', v_att_id,
    'session_id', v_s.id,
    'activity_id', v_s.activity_id,
    'title', v_a.title,
    'starts_at', v_s.starts_at,
    'ends_at', v_s.ends_at,
    'credits_granted', v_credits,
    'method', v_method,
    'stamps', my_stamp_count(v_pid),
    'attended_workshops', my_attended_workshop_count(v_pid),
    'level', participant_rank_level(v_pid)
  );
END;
$function$;

-- ============================================================
-- 4. Tablero: conflicto REAL vs traslado ajustado
-- ============================================================
-- Contrato (sessions[*]):
--   conflicts_with       uuid[]  reservaciones propias que se SOLAPAN realmente con la sesión (bloquea).
--   tight_transfer_with  uuid[]  reservaciones propias contiguas o a menos de travel_buffer_minutes, sin solaparse (solo advertencia).
--   started / ended / in_progress  banderas derivadas del reloj del servidor (en curso = started AND NOT ended).
-- reservations[*].derived_status: completed | expired | cancelled | ended (terminó sin asistencia, aún puede registrarla) |
--   in_progress | active.  `expired` ya solo significa "archivada al reservar otro horario del mismo taller".
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
        'division_id', a.division_id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
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
            AND (now() < o.ends_at
                 OR EXISTS (SELECT 1 FROM attendances a2 WHERE a2.participant_id = v_pid AND a2.activity_id = r.activity_id))
            AND o.starts_at < s.ends_at AND s.starts_at < o.ends_at), '[]'::jsonb),
        'tight_transfer_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r
          JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
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
