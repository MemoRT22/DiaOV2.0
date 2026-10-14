-- Día OV 2026: asistencia operativa cuando el facilitador entrega QR/codigo, sin ventana horaria.
-- Se preservan credenciales por actividad, reserva vigente/expirada, aislamiento DEMO,
-- sesion no cancelada, idempotencia, sellos por duracion oficial y auditoria.
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
  v_now timestamptz := statement_timestamp();
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

  -- La credencial se muestra al terminar el taller: la asistencia no se limita por reloj.
  -- Seleccionar la reservacion elegible de forma determinista, incluso si ha expirado.
  SELECT r.id, r.session_id INTO v_reservation_id, v_session_id
  FROM reservations r
  JOIN activity_sessions s ON s.id = r.session_id
  WHERE r.participant_id = v_pid
    AND r.activity_id = v_match.activity_id
    AND r.status IN ('vigente', 'expirada')
    AND s.status <> 'cancelada'
    AND s.is_demo = v_p.is_demo
  ORDER BY
    CASE WHEN v_now >= s.starts_at AND v_now < s.ends_at THEN 0
         WHEN v_now >= s.ends_at THEN 1 ELSE 2 END,
    CASE WHEN v_now >= s.ends_at THEN s.ends_at END DESC NULLS LAST,
    CASE WHEN v_now < s.starts_at THEN s.starts_at END ASC NULLS LAST,
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

  -- Sellos según la duración oficial de la sesión; nunca los decide el cliente ni el método de registro.
  -- Se responde con lo que quedó guardado (el trigger de `attendances` es quien fija el snapshot).
  v_method := v_match.method;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method, reservation_id)
  VALUES (v_pid, v_s.id, v_s.activity_id, session_stamp_credits(v_s.starts_at, v_s.ends_at), v_method, v_reservation_id)
  RETURNING id, credits_granted INTO v_att_id, v_credits;
  PERFORM write_audit('attendance.checked_in', jsonb_build_object(
    'session_id', v_s.id, 'activity_id', v_s.activity_id, 'participant_id', v_pid, 'method', v_method,
    'credits_granted', v_credits, 'session_starts_at', v_s.starts_at, 'session_ends_at', v_s.ends_at));

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

REVOKE ALL ON FUNCTION public.check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(text) TO authenticated;
