/*
# Fase 8C — correcciones: agenda vs. contador, histórico y ventana de check-in

Separa tres conceptos que antes se mezclaban:

1. Compromiso para el límite personal (`max_reservations`):
   reservación `vigente`, antes de `ends_at`, sin asistencia del taller.
   Una asistencia (o llegar a `ends_at`) libera el contador de inmediato.
2. Ocupación de la agenda (SCHEDULE_CONFLICT):
   reservación `vigente` hasta `ends_at + travel_buffer`, CON o SIN asistencia.
   Una asistencia temprana NO libera el horario.
3. Taller bloqueado (SAME_WORKSHOP) / pérdida definitiva:
   una reservación sin asistencia sigue siendo "la del taller" hasta
   `ends_at + checkin_close_after_minutes`. Solo después pasa a `expirada` y
   permite reservar otra sesión del mismo taller. Así nunca coexisten una
   reservación antigua con check-in aún válido y una nueva del mismo taller.

Histórico: `session_reserved_count` cuenta `vigente` + `expirada` (un no-show ocupó
un lugar). Una `expirada` solo existe en sesiones ya terminadas, así que no altera
la capacidad futura. Cancelaciones voluntarias / cambios / sesión cancelada siguen
sin contar.
*/

-- ========== 1. Histórico de lugares reservados ==========
CREATE OR REPLACE FUNCTION session_reserved_count(p_session uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM reservations
  WHERE session_id = p_session AND status IN ('vigente', 'expirada');
$$;
REVOKE ALL ON FUNCTION session_reserved_count(uuid) FROM PUBLIC, anon, authenticated;

-- ========== 2. Pérdida definitiva = ends_at + checkin_close_after_minutes ==========
CREATE OR REPLACE FUNCTION expire_past_reservation(p_pid uuid, p_activity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r record;
BEGIN
  FOR v_r IN
    SELECT r.id, r.session_id
    FROM reservations r
    JOIN activity_sessions s ON s.id = r.session_id
    JOIN participants p ON p.id = r.participant_id
    JOIN editions e ON e.id = p.edition_id
    WHERE r.participant_id = p_pid
      AND r.activity_id = p_activity_id
      AND r.status = 'vigente'
      AND now() > s.ends_at + make_interval(mins => e.checkin_close_after_minutes)
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
$$;
REVOKE ALL ON FUNCTION expire_past_reservation(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ========== 3. assert_reservable ==========
CREATE OR REPLACE FUNCTION assert_reservable(p_pid uuid, p_session uuid, p_exclude uuid)
RETURNS activity_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p participants%ROWTYPE; v_ed editions%ROWTYPE; v_s activity_sessions%ROWTYPE; v_a activities%ROWTYPE;
  v_win text; v_buffer interval; v_close interval; v_active int;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = p_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;
  v_win := reservation_window(v_ed.reservations_open_at, v_ed.reservations_close_at);
  IF v_win = 'not_open' THEN RAISE EXCEPTION 'RESERVATIONS_NOT_OPEN'; END IF;
  IF v_win = 'closed' THEN RAISE EXCEPTION 'RESERVATIONS_CLOSED'; END IF;
  v_buffer := make_interval(mins => v_ed.travel_buffer_minutes);
  v_close := make_interval(mins => v_ed.checkin_close_after_minutes);

  SELECT * INTO v_s FROM activity_sessions WHERE id = p_session;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;
  IF v_s.id IS NULL OR v_a.edition_id IS DISTINCT FROM v_ed.id OR v_a.is_demo IS DISTINCT FROM v_p.is_demo
     OR v_s.status = 'oculta' THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE';
  END IF;
  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
  IF now() >= v_s.starts_at THEN RAISE EXCEPTION 'SESSION_STARTED'; END IF;

  IF EXISTS (SELECT 1 FROM attendances WHERE participant_id = p_pid AND activity_id = v_s.activity_id) THEN
    RAISE EXCEPTION 'ALREADY_ATTENDED';
  END IF;

  -- SAME_WORKSHOP: the old reservation stays "the workshop's" until its check-in window closes.
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions s2 ON s2.id = r.session_id
             WHERE r.participant_id = p_pid AND r.activity_id = v_s.activity_id
               AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND now() <= s2.ends_at + v_close) THEN
    RAISE EXCEPTION 'SAME_WORKSHOP';
  END IF;

  -- MAX_RESERVATIONS: personal commitments only (released at attendance or ends_at).
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

  -- SCHEDULE_CONFLICT: agenda occupancy. A reservation occupies its slot until
  -- ends_at + travel_buffer, with or without attendance. Only a lost one
  -- (no attendance, check-in window closed) frees the agenda.
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions o ON o.id = r.session_id
             WHERE r.participant_id = p_pid AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND now() < o.ends_at + v_buffer
               AND (now() <= o.ends_at + v_close
                    OR EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id))
               AND o.starts_at < v_s.ends_at + v_buffer AND v_s.starts_at < o.ends_at + v_buffer) THEN
    RAISE EXCEPTION 'SCHEDULE_CONFLICT';
  END IF;

  IF session_reserved_count(p_session) >= v_s.capacity THEN RAISE EXCEPTION 'SESSION_FULL'; END IF;
  RETURN v_s;
END;
$$;
REVOKE ALL ON FUNCTION assert_reservable(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ========== 4. my_reservation_board ==========
CREATE OR REPLACE FUNCTION my_reservation_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(true); v_p participants%ROWTYPE; v_ed editions%ROWTYPE;
  v_buffer interval; v_close interval;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;
  v_buffer := make_interval(mins => v_ed.travel_buffer_minutes);
  v_close := make_interval(mins => v_ed.checkin_close_after_minutes);

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
        'attended', EXISTS (SELECT 1 FROM attendances at WHERE at.participant_id = v_pid AND at.activity_id = s.activity_id),
        'my_reservation_id', (SELECT r.id FROM reservations r WHERE r.session_id = s.id
                              AND r.participant_id = v_pid AND r.status = 'vigente'),
        'conflicts_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r
          JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
            AND now() < o.ends_at + v_buffer
            AND (now() <= o.ends_at + v_close
                 OR EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = v_pid AND a.activity_id = r.activity_id))
            AND o.starts_at < s.ends_at + v_buffer AND s.starts_at < o.ends_at + v_buffer), '[]'::jsonb)
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
            -- lost: check-in window closed without attendance (row is expired lazily on next reserve)
            WHEN r.status = 'vigente' AND now() > s.ends_at + v_close THEN 'expired'
            -- ended but check-in still valid: still holds the workshop, no longer counts toward the limit
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
REVOKE ALL ON FUNCTION my_reservation_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_reservation_board() TO authenticated;

-- ========== 5. activity_checkin_overview: histórico por taller ==========
CREATE OR REPLACE FUNCTION activity_checkin_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid;
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_ed := active_edition_id();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'activity_id', a.id,
      'title', a.title,
      'location', a.location,
      'sessions', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'session_id', s.id,
          'starts_at', s.starts_at,
          'ends_at', s.ends_at,
          'status', s.status,
          'capacity', s.capacity,
          'reserved', session_reserved_count(s.id),
          'attended', (SELECT count(*) FROM attendances WHERE session_id = s.id)
        ) ORDER BY s.starts_at), '[]'::jsonb)
        FROM activity_sessions s WHERE s.activity_id = a.id
      ),
      -- places actually held (vigente + expirada/no-show); voluntary cancellations excluded
      'total_reserved', (SELECT count(*) FROM reservations r
                         WHERE r.activity_id = a.id AND r.status IN ('vigente', 'expirada')),
      'total_attended', (SELECT count(*) FROM attendances at WHERE at.activity_id = a.id)
    ) ORDER BY a.title)
    FROM activities a
    WHERE a.edition_id = v_ed
  ), '[]'::jsonb);
END;
$$;

-- ========== 6. event_operations_overview: compromisos realmente activos ==========
CREATE OR REPLACE FUNCTION event_operations_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed           editions%ROWTYPE;
  v_server_time  timestamptz := now();
BEGIN
  IF NOT is_operativo() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACTIVE_EDITION';
  END IF;

  RETURN jsonb_build_object(
    'server_time', v_server_time,
    'mode', v_ed.mode,
    'checkin_close_after_minutes', v_ed.checkin_close_after_minutes,
    'summary', jsonb_build_object(
      'participants_total',
        (SELECT count(*) FROM participants p WHERE p.edition_id = v_ed.id),
      'platform_consents',
        (SELECT count(*) FROM participant_profiles pp
           JOIN participants p ON p.id = pp.participant_id
          WHERE p.edition_id = v_ed.id AND pp.platform_consent_at IS NOT NULL),
      -- 8C: active commitments (vigente, session not ended, no attendance for the workshop)
      'active_reservations',
        (SELECT count(*) FROM reservations r
           JOIN participants p ON p.id = r.participant_id
           JOIN activity_sessions s ON s.id = r.session_id
          WHERE p.edition_id = v_ed.id AND r.status = 'vigente'
            AND v_server_time < s.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a
                             WHERE a.participant_id = r.participant_id AND a.activity_id = r.activity_id)),
      'participants_with_reservations',
        (SELECT count(DISTINCT r.participant_id) FROM reservations r
           JOIN participants p ON p.id = r.participant_id
           JOIN activity_sessions s ON s.id = r.session_id
          WHERE p.edition_id = v_ed.id AND r.status = 'vigente'
            AND v_server_time < s.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a
                             WHERE a.participant_id = r.participant_id AND a.activity_id = r.activity_id)),
      'total_attendances',
        (SELECT count(*) FROM attendances at
           JOIN participants p ON p.id = at.participant_id
          WHERE p.edition_id = v_ed.id),
      'unique_attended_participants',
        (SELECT count(DISTINCT at.participant_id) FROM attendances at
           JOIN participants p ON p.id = at.participant_id
          WHERE p.edition_id = v_ed.id),
      'sessions_total',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id),
      'sessions_upcoming',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'activa'
            AND s.starts_at > v_server_time),
      'sessions_in_progress',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'activa'
            AND s.starts_at <= v_server_time
            AND s.ends_at > v_server_time),
      'sessions_ended',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'activa'
            AND s.ends_at <= v_server_time),
      'sessions_cancelled',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'cancelada')
    ),
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'activity_id', a.id,
        'title', a.title,
        'division_id', a.division_id,
        'division_name', d.name,
        'division_code', d.code,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'location', coalesce(nullif(s.location, ''), a.location),
        'status', s.status,
        'capacity', s.capacity,
        'reserved', cnt.reserved,
        'remaining', greatest(s.capacity - cnt.reserved, 0),
        'attended', cnt.attended,
        'is_demo', a.is_demo
      ) ORDER BY s.starts_at, a.title)
      FROM activity_sessions s
      JOIN activities a ON a.id = s.activity_id
      JOIN divisions d ON d.id = a.division_id
      CROSS JOIN LATERAL (
        SELECT
          session_reserved_count(s.id) AS reserved,
          (SELECT count(*) FROM attendances at WHERE at.session_id = s.id) AS attended
      ) AS cnt
      WHERE a.edition_id = v_ed.id
        AND (v_ed.mode = 'preparacion' OR NOT a.is_demo)
    ), '[]'::jsonb)
  );
END;
$$;
