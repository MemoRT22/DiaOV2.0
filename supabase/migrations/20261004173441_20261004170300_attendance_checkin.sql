-- Internal: resolve a credential (QR token or manual code) to a session_id
CREATE OR REPLACE FUNCTION resolve_credential(p_credential text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_session_id uuid;
BEGIN
  -- Try as QR token (longer hex string)
  SELECT sc.session_id INTO v_session_id
  FROM session_credentials sc
  WHERE sc.qr_token_hash = extensions.digest(p_credential, 'sha256')
  LIMIT 1;
  IF v_session_id IS NOT NULL THEN RETURN v_session_id; END IF;

  -- Try as manual code (6 chars, case-insensitive)
  SELECT sc.session_id INTO v_session_id
  FROM session_credentials sc
  WHERE sc.manual_code_hash = extensions.digest(lower(p_credential), 'sha256')
  LIMIT 1;
  RETURN v_session_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION resolve_credential(text) FROM PUBLIC, anon, authenticated;

-- The single check-in function for students. Accepts QR token OR manual code.
-- Validates: identity, privacy notice, credential, edition, demo/real match,
-- session not cancelled, time window, reservation, idempotency.
CREATE OR REPLACE FUNCTION check_in(p_credential text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_ed editions%ROWTYPE;
  v_session_id uuid;
  v_s activity_sessions%ROWTYPE;
  v_a activities%ROWTYPE;
  v_existing attendances%ROWTYPE;
  v_reservation_id uuid;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_att_id uuid;
BEGIN
  IF p_credential IS NULL OR btrim(p_credential) = '' THEN
    RAISE EXCEPTION 'INVALID_CREDENTIAL';
  END IF;
  p_credential := btrim(p_credential);

  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;

  -- Resolve credential to session
  v_session_id := resolve_credential(p_credential);
  IF v_session_id IS NULL THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = v_session_id;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;

  -- Session must belong to active edition and match demo/real
  IF v_a.edition_id IS DISTINCT FROM v_ed.id OR v_a.is_demo IS DISTINCT FROM v_p.is_demo THEN
    RAISE EXCEPTION 'INVALID_CREDENTIAL';
  END IF;

  -- Session must not be cancelled (oculta is OK if reservation exists)
  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;

  -- Time window: open_before minutes before ends_at, close_after minutes after ends_at
  v_window_start := v_s.ends_at - make_interval(mins => v_ed.checkin_open_before_minutes);
  v_window_end := v_s.ends_at + make_interval(mins => v_ed.checkin_close_after_minutes);
  IF now() < v_window_start THEN RAISE EXCEPTION 'CHECKIN_TOO_EARLY'; END IF;
  IF now() > v_window_end THEN RAISE EXCEPTION 'CHECKIN_TOO_LATE'; END IF;

  -- Must have a vigente reservation for this session
  SELECT id INTO v_reservation_id FROM reservations
  WHERE participant_id = v_pid AND session_id = v_session_id AND status = 'vigente';
  IF v_reservation_id IS NULL THEN RAISE EXCEPTION 'NO_RESERVATION'; END IF;

  -- Lock participant row to serialize concurrent check-ins
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;

  -- Idempotency: check existing attendance
  SELECT * INTO v_existing FROM attendances WHERE participant_id = v_pid AND session_id = v_session_id;
  IF v_existing.id IS NOT NULL THEN
    -- Already registered: return informative response, not an error
    RETURN jsonb_build_object(
      'already_registered', true,
      'session_id', v_session_id,
      'title', v_a.title,
      'starts_at', v_s.starts_at,
      'ends_at', v_s.ends_at,
      'credits_granted', v_existing.credits_granted,
      'stamps', my_stamp_count(v_pid),
      'attended_workshops', my_attended_workshop_count(v_pid)
    );
  END IF;

  -- Register attendance with credit snapshot
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method, reservation_id)
  VALUES (v_pid, v_session_id, v_s.activity_id, coalesce(v_s.credits, 1), 'qr', v_reservation_id)
  RETURNING id INTO v_att_id;

  PERFORM write_audit('attendance.checked_in', jsonb_build_object(
    'session_id', v_session_id, 'participant_id', v_pid, 'method', 'qr'));

  RETURN jsonb_build_object(
    'already_registered', false,
    'attendance_id', v_att_id,
    'session_id', v_session_id,
    'title', v_a.title,
    'starts_at', v_s.starts_at,
    'ends_at', v_s.ends_at,
    'credits_granted', coalesce(v_s.credits, 1),
    'stamps', my_stamp_count(v_pid),
    'attended_workshops', my_attended_workshop_count(v_pid)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_in(text) TO authenticated;

-- Internal: count total stamps (sum of credits_granted) for a participant
CREATE OR REPLACE FUNCTION my_stamp_count(p_pid uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(credits_granted), 0)::int FROM attendances WHERE participant_id = p_pid;
$$;
REVOKE EXECUTE ON FUNCTION my_stamp_count(uuid) FROM PUBLIC, anon, authenticated;

-- Internal: count attended workshops (distinct sessions) for a participant
CREATE OR REPLACE FUNCTION my_attended_workshop_count(p_pid uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM attendances WHERE participant_id = p_pid;
$$;
REVOKE EXECUTE ON FUNCTION my_attended_workshop_count(uuid) FROM PUBLIC, anon, authenticated;

-- Updated my_progress: counts stamps (sum of credits) for rank, plus attended workshops
CREATE OR REPLACE FUNCTION my_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(false);
  v_ed editions%ROWTYPE;
  v_stamps int;
  v_attended int;
  v_reserved int;
  v_divs uuid[];
  v_level int;
  v_next rank_levels%ROWTYPE;
  v_consent boolean;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  v_stamps := my_stamp_count(v_pid);
  v_attended := my_attended_workshop_count(v_pid);
  SELECT coalesce(array_agg(DISTINCT a2.division_id), '{}') INTO v_divs
  FROM attendances at
  JOIN activity_sessions s ON s.id = at.session_id
  JOIN activities a2 ON a2.id = at.activity_id
  WHERE at.participant_id = v_pid;
  SELECT count(*) INTO v_reserved FROM reservations WHERE participant_id = v_pid AND status = 'vigente';

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