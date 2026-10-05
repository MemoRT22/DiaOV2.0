/*
# Fase 8B fix — check_in: SESSION_CANCELLED antes que NO_RESERVATION

## Problema
Cuando una sesión se cancela, el trigger after_session_change cancela las reservaciones
vigentes (status → cancelada_sesion). check_in busca solo status='vigente', así que
devuelve NO_RESERVATION en lugar de SESSION_CANCELLED.

## Solución
Si no hay reservación vigente, buscar si existe una reservación cancelada_sesion
para esa actividad. Si existe y la sesión está cancelada, raisear SESSION_CANCELLED.
*/

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
  v_res_count int;
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

  -- Find the participant's vigente reservation for this activity
  SELECT id, session_id INTO v_reservation_id, v_session_id
  FROM reservations
  WHERE participant_id = v_pid AND activity_id = v_match.activity_id AND status = 'vigente';

  IF v_reservation_id IS NULL THEN
    -- Check if there was a reservation cancelled by session cancellation
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

  -- Safety: fail if more than one vigente reservation for the same activity
  SELECT count(*) INTO v_res_count
  FROM reservations
  WHERE participant_id = v_pid AND activity_id = v_match.activity_id AND status = 'vigente';
  IF v_res_count > 1 THEN
    PERFORM write_audit('checkin.duplicate_reservation', jsonb_build_object(
      'participant_id', v_pid, 'activity_id', v_match.activity_id, 'count', v_res_count));
    RAISE EXCEPTION 'DUPLICATE_RESERVATION';
  END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = v_session_id;

  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;

  v_window_start := v_s.ends_at - make_interval(mins => v_ed.checkin_open_before_minutes);
  v_window_end := v_s.ends_at + make_interval(mins => v_ed.checkin_close_after_minutes);
  IF now() < v_window_start THEN RAISE EXCEPTION 'CHECKIN_TOO_EARLY'; END IF;
  IF now() > v_window_end THEN RAISE EXCEPTION 'CHECKIN_TOO_LATE'; END IF;

  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;

  SELECT * INTO v_existing FROM attendances WHERE participant_id = v_pid AND session_id = v_s.id;
  IF v_existing.id IS NOT NULL THEN
    v_already := true;
    v_att_id := v_existing.id;
    v_credits := v_existing.credits_granted;
    v_method := v_existing.method;
  ELSE
    v_credits := coalesce(v_s.credits, 1);
    v_method := v_match.method;
    INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method, reservation_id)
    VALUES (v_pid, v_s.id, v_s.activity_id, v_credits, v_method, v_reservation_id)
    RETURNING id INTO v_att_id;
    PERFORM write_audit('attendance.checked_in', jsonb_build_object(
      'session_id', v_s.id, 'activity_id', v_s.activity_id, 'participant_id', v_pid, 'method', v_method));
  END IF;

  RETURN jsonb_build_object(
    'already_registered', v_already,
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
