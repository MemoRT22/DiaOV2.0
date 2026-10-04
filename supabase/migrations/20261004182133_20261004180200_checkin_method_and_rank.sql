/*
# Check-in: método real (QR / código manual) y rango actual en la respuesta

## Resumen
1. `resolve_credential(text)` ahora devuelve `(session_id, method)`: `qr` si coincidió el hash del
   token QR, `codigo_manual` si coincidió el hash del código manual. El navegador NO envía el método;
   el servidor lo infiere de la credencial que efectivamente coincidió.
2. `check_in()` guarda ese método en `attendances.method` y en la auditoría `attendance.checked_in`.
   Si la asistencia ya existía, la respuesta es idempotente y devuelve el método original sin modificarlo.
3. Nueva función central `participant_rank_level(participant)`: calcula el rango (sellos + divisiones)
   con las reglas de `rank_levels`. La usan `my_progress()` (Pasaporte) y `check_in()`, así que ambos
   muestran exactamente el mismo rango.
4. La respuesta de `check_in()` agrega `level` (rango actual) y `method`.

## Seguridad
- `resolve_credential` y `participant_rank_level` revocadas para PUBLIC/anon/authenticated.
- `check_in` y `my_progress` conservan su permiso solo para authenticated.
*/

DROP FUNCTION IF EXISTS public.resolve_credential(text);

CREATE FUNCTION public.resolve_credential(p_credential text, OUT session_id uuid, OUT method text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  SELECT sc.session_id, 'qr' INTO session_id, method
  FROM session_credentials sc
  WHERE sc.qr_token_hash = extensions.digest(p_credential, 'sha256');
  IF session_id IS NOT NULL THEN RETURN; END IF;

  SELECT sc.session_id, 'codigo_manual' INTO session_id, method
  FROM session_credentials sc
  WHERE sc.manual_code_hash = extensions.digest(lower(p_credential), 'sha256');
END;
$$;

CREATE OR REPLACE FUNCTION public.participant_rank_level(p_pid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(max(rl.level), 1)
  FROM rank_levels rl
  JOIN participants p ON p.edition_id = rl.edition_id
  WHERE p.id = p_pid
    AND rl.required_attendances <= my_stamp_count(p_pid)
    AND rl.required_divisions <= (
      SELECT count(DISTINCT a.division_id)
      FROM attendances at JOIN activities a ON a.id = at.activity_id
      WHERE at.participant_id = p_pid);
$$;

CREATE OR REPLACE FUNCTION public.my_progress()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  FROM attendances at JOIN activities a2 ON a2.id = at.activity_id
  WHERE at.participant_id = v_pid;
  SELECT count(*) INTO v_reserved FROM reservations WHERE participant_id = v_pid AND status = 'vigente';

  v_level := participant_rank_level(v_pid);
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
  v_s activity_sessions%ROWTYPE;
  v_a activities%ROWTYPE;
  v_existing attendances%ROWTYPE;
  v_reservation_id uuid;
  v_att_id uuid;
  v_already boolean := false;
  v_credits int;
  v_method text;
BEGIN
  IF p_credential IS NULL OR btrim(p_credential) = '' THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;

  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;

  SELECT * INTO v_match FROM resolve_credential(btrim(p_credential));
  IF v_match.session_id IS NULL THEN RAISE EXCEPTION 'INVALID_CREDENTIAL'; END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = v_match.session_id;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;

  IF v_a.edition_id IS DISTINCT FROM v_ed.id OR v_a.is_demo IS DISTINCT FROM v_p.is_demo THEN
    RAISE EXCEPTION 'INVALID_CREDENTIAL';
  END IF;
  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
  IF now() < v_s.ends_at - make_interval(mins => v_ed.checkin_open_before_minutes) THEN
    RAISE EXCEPTION 'CHECKIN_TOO_EARLY';
  END IF;
  IF now() > v_s.ends_at + make_interval(mins => v_ed.checkin_close_after_minutes) THEN
    RAISE EXCEPTION 'CHECKIN_TOO_LATE';
  END IF;

  SELECT id INTO v_reservation_id FROM reservations
  WHERE participant_id = v_pid AND session_id = v_s.id AND status = 'vigente';
  IF v_reservation_id IS NULL THEN RAISE EXCEPTION 'NO_RESERVATION'; END IF;

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
      'session_id', v_s.id, 'participant_id', v_pid, 'method', v_method));
  END IF;

  RETURN jsonb_build_object(
    'already_registered', v_already,
    'attendance_id', v_att_id,
    'session_id', v_s.id,
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

REVOKE ALL ON FUNCTION public.resolve_credential(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.participant_rank_level(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(text) TO authenticated;
