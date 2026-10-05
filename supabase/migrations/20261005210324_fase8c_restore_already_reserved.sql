-- Fase 8C fix: restore ALREADY_RESERVED in assert_reservable (dropped by the first 8C migration).
-- Reserving the same session twice must report ALREADY_RESERVED, not SAME_WORKSHOP.
-- ALREADY_ATTENDED is still evaluated first.

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

  -- ALREADY_RESERVED: same session again (after ALREADY_ATTENDED, which takes priority)
  IF EXISTS (SELECT 1 FROM reservations WHERE participant_id = p_pid AND session_id = p_session
             AND status = 'vigente' AND id IS DISTINCT FROM p_exclude) THEN
    RAISE EXCEPTION 'ALREADY_RESERVED';
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
