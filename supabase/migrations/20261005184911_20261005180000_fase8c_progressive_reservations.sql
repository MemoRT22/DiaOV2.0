/*
# Fase 8C — Reservaciones progresivas y ruta activa
*/

-- ========== 1. Relax reservations constraints for 'expirada' ==========
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('vigente', 'cancelada_alumno', 'cambiada', 'cancelada_sesion', 'expirada'));

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_ended_consistent;
ALTER TABLE reservations ADD CONSTRAINT reservations_ended_consistent
  CHECK ((status IN ('vigente')) = (ended_at IS NULL));

-- ========== 2. Unique attendance per activity ==========
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM attendances GROUP BY participant_id, activity_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'DUPLICATE_ATTENDANCES_EXIST';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS attendances_one_per_activity
  ON attendances (participant_id, activity_id);

-- ========== 3. active_reservation_count ==========
CREATE OR REPLACE FUNCTION active_reservation_count(p_pid uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM reservations r
  JOIN activity_sessions s ON s.id = r.session_id
  WHERE r.participant_id = p_pid
    AND r.status = 'vigente'
    AND now() < s.ends_at
    AND NOT EXISTS (
      SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id
    );
$$;
REVOKE ALL ON FUNCTION active_reservation_count(uuid) FROM PUBLIC, anon, authenticated;

-- ========== 4. expire_past_reservation (internal) ==========
CREATE OR REPLACE FUNCTION expire_past_reservation(p_pid uuid, p_activity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION expire_past_reservation(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ========== 5. assert_reservable ==========
CREATE OR REPLACE FUNCTION assert_reservable(p_pid uuid, p_session uuid, p_exclude uuid)
RETURNS activity_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p participants%ROWTYPE; v_ed editions%ROWTYPE; v_s activity_sessions%ROWTYPE; v_a activities%ROWTYPE;
  v_win text; v_buffer interval; v_active int;
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
  IF now() >= v_s.starts_at THEN RAISE EXCEPTION 'SESSION_STARTED'; END IF;

  -- ALREADY_ATTENDED
  IF EXISTS (SELECT 1 FROM attendances WHERE participant_id = p_pid AND activity_id = v_s.activity_id) THEN
    RAISE EXCEPTION 'ALREADY_ATTENDED';
  END IF;

  -- SAME_WORKSHOP: only active reservations count
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions s2 ON s2.id = r.session_id
             WHERE r.participant_id = p_pid AND r.activity_id = v_s.activity_id
               AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND now() < s2.ends_at
               AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id)) THEN
    RAISE EXCEPTION 'SAME_WORKSHOP';
  END IF;

  -- MAX_RESERVATIONS: count active commitments, minus the one being replaced (if still active)
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

  -- Schedule conflict: only against active reservations
  v_buffer := make_interval(mins => v_ed.travel_buffer_minutes);
  IF EXISTS (SELECT 1 FROM reservations r
             JOIN activity_sessions o ON o.id = r.session_id
             WHERE r.participant_id = p_pid AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND now() < o.ends_at
               AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = p_pid AND a.activity_id = r.activity_id)
               AND o.starts_at < v_s.ends_at + v_buffer AND v_s.starts_at < o.ends_at + v_buffer) THEN
    RAISE EXCEPTION 'SCHEDULE_CONFLICT';
  END IF;

  IF session_reserved_count(p_session) >= v_s.capacity THEN RAISE EXCEPTION 'SESSION_FULL'; END IF;
  RETURN v_s;
END;
$$;
REVOKE ALL ON FUNCTION assert_reservable(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ========== 6. reserve_session ==========
CREATE OR REPLACE FUNCTION reserve_session(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(true); v_s activity_sessions%ROWTYPE; v_id uuid;
BEGIN
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;
  PERFORM 1 FROM activity_sessions WHERE id = p_session FOR NO KEY UPDATE;
  v_s := assert_reservable(v_pid, p_session, NULL);
  PERFORM expire_past_reservation(v_pid, v_s.activity_id);
  BEGIN
    INSERT INTO reservations (participant_id, session_id, activity_id)
    VALUES (v_pid, p_session, v_s.activity_id) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_RESERVED';
  END;
  PERFORM broadcast_availability(p_session);
  RETURN jsonb_build_object('reservation_id', v_id, 'session_id', p_session);
END;
$$;
REVOKE ALL ON FUNCTION reserve_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_session(uuid) TO authenticated;

-- ========== 7. change_reservation ==========
CREATE OR REPLACE FUNCTION change_reservation(p_reservation uuid, p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF now() >= (SELECT starts_at FROM activity_sessions WHERE id = v_old_session) THEN
    RAISE EXCEPTION 'CURRENT_SESSION_STARTED';
  END IF;
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
$$;
REVOKE ALL ON FUNCTION change_reservation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION change_reservation(uuid, uuid) TO authenticated;

-- ========== 8. check_in ==========
CREATE OR REPLACE FUNCTION public.check_in(p_credential text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  v_already boolean := false;
  v_credits int;
  v_method text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_cancelled_session uuid;
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

  -- Idempotency: check existing attendance BY ACTIVITY
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

  -- Find reservation: vigente or expirada (session ended but within check-in window)
  SELECT id, session_id INTO v_reservation_id, v_session_id
  FROM reservations
  WHERE participant_id = v_pid
    AND activity_id = v_match.activity_id
    AND status IN ('vigente', 'expirada')
  ORDER BY CASE WHEN status = 'vigente' THEN 0 ELSE 1 END, created_at DESC
  LIMIT 1;

  IF v_reservation_id IS NULL THEN
    SELECT session_id INTO v_cancelled_session
    FROM reservations
    WHERE participant_id = v_pid AND activity_id = v_match.activity_id AND status = 'cancelada_sesion'
    LIMIT 1;
    IF v_cancelled_session IS NOT NULL THEN
      SELECT * INTO v_s FROM activity_sessions WHERE id = v_cancelled_session;
      IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
    END IF;
    RAISE EXCEPTION 'NO_RESERVATION';
  END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = v_session_id;
  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;

  v_window_start := v_s.ends_at - make_interval(mins => v_ed.checkin_open_before_minutes);
  v_window_end := v_s.ends_at + make_interval(mins => v_ed.checkin_close_after_minutes);
  IF now() < v_window_start THEN RAISE EXCEPTION 'CHECKIN_TOO_EARLY'; END IF;
  IF now() > v_window_end THEN RAISE EXCEPTION 'CHECKIN_TOO_LATE'; END IF;

  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;

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
$$;
REVOKE ALL ON FUNCTION public.check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(text) TO authenticated;

-- ========== 9. my_reservation_board ==========
CREATE OR REPLACE FUNCTION my_reservation_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'active_reservation_count', active_reservation_count(v_pid),
    'travel_buffer_minutes', v_ed.travel_buffer_minutes,
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
            AND now() < o.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = v_pid AND a.activity_id = r.activity_id)
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

-- ========== 10. my_progress ==========
CREATE OR REPLACE FUNCTION my_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(false);
  v_ed editions%ROWTYPE; v_stamps int; v_attended int; v_reserved int;
  v_divs uuid[]; v_level int; v_next rank_levels%ROWTYPE; v_consent boolean;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  v_stamps := my_stamp_count(v_pid);
  v_attended := my_attended_workshop_count(v_pid);
  SELECT coalesce(array_agg(DISTINCT a2.division_id), '{}') INTO v_divs
  FROM attendances at
  JOIN activity_sessions s ON s.id = at.session_id
  JOIN activities a2 ON a2.id = at.activity_id
  WHERE at.participant_id = v_pid;
  v_reserved := active_reservation_count(v_pid);
  SELECT coalesce(max(level), 1) INTO v_level FROM rank_levels
  WHERE edition_id = v_ed.id AND required_attendances <= v_stamps
    AND required_divisions <= coalesce(array_length(v_divs, 1), 0);
  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;
  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version
  INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;
  RETURN jsonb_build_object(
    'level', v_level,
    'stamps', v_stamps,
    'attended_workshops', v_attended,
    'reserved_workshops', v_reserved,
    'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object('level', v_next.level,
      'required_attendances', v_next.required_attendances, 'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'interests_prompt', v_attended >= v_ed.interests_prompt_min_attendances
      OR (v_ed.interests_prompt_at IS NOT NULL AND now() >= v_ed.interests_prompt_at),
    'interests_open', v_ed.interests_close_at IS NULL OR now() < v_ed.interests_close_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION my_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_progress() TO authenticated;