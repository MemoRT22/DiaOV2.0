/*
  Sellos por asistencia: se calculan con la duración oficial de la sesión.

  Regla oficial de Día OV 2026
  - Sesión de exactamente 60 minutos: 2 sellos.
  - Cualquier otra duración: 1 sello.

  Causa raíz que corrige
  - `check_in` copiaba `activity_sessions.credits` a `attendances.credits_granted`, pero ninguna de las rutas que crean
    sesiones (publicación de talleres, importación de catálogo) escribía `credits`: todas las sesiones quedaban con el
    valor por defecto de la columna (1), sin importar su duración. Al editar un taller publicado se heredaba ese mismo 1.

  Qué cambia
  - `session_stamp_credits(starts_at, ends_at)`: única definición de la regla.
  - Trigger `activity_sessions_set_credits`: `activity_sessions.credits` deja de ser un dato que cada ruta debe recordar
    escribir y pasa a derivarse siempre del horario (creación, edición, publicación e importación incluidas). Un valor
    enviado por cualquier cliente o función se ignora.
  - `check_in`: acredita `session_stamp_credits` de la sesión reservada (QR y código manual comparten esta ruta). El
    snapshot `attendances.credits_granted`, la idempotencia por actividad, la autorización, la elección de sesión y la
    validez temporal no cambian.
  - Sesiones existentes: se recalcula `credits` (solo esa columna; no dispara avisos de disponibilidad ni toca
    reservaciones). Idempotente.
  - Marca de auditoría `attendance.credit_rule_installed`: deja constancia del momento exacto en que la regla entró en
    vigor. La conciliación de asistencias anteriores (migración aparte) se limita a lo registrado antes de esa marca.

  Qué NO cambia
  - Las asistencias ya registradas no se modifican aquí.
*/

CREATE OR REPLACE FUNCTION public.session_stamp_credits(p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (CASE WHEN extract(epoch FROM (p_ends_at - p_starts_at)) = 3600 THEN 2 ELSE 1 END)::smallint;
$$;

REVOKE ALL ON FUNCTION public.session_stamp_credits(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_session_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.credits := public.session_stamp_credits(NEW.starts_at, NEW.ends_at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_session_credits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activity_sessions_set_credits ON public.activity_sessions;
CREATE TRIGGER activity_sessions_set_credits
  BEFORE INSERT OR UPDATE ON public.activity_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_session_credits();

-- Sesiones ya creadas: mismo cálculo. Solo cambia `credits`, así que no se emiten avisos de disponibilidad.
UPDATE public.activity_sessions
SET credits = public.session_stamp_credits(starts_at, ends_at)
WHERE credits IS DISTINCT FROM public.session_stamp_credits(starts_at, ends_at);

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

  -- Sellos según la duración oficial de la sesión; nunca los decide el cliente ni el método de registro.
  v_credits := session_stamp_credits(v_s.starts_at, v_s.ends_at);
  v_method := v_match.method;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method, reservation_id)
  VALUES (v_pid, v_s.id, v_s.activity_id, v_credits, v_method, v_reservation_id)
  RETURNING id INTO v_att_id;
  PERFORM write_audit('attendance.checked_in', jsonb_build_object(
    'session_id', v_s.id, 'activity_id', v_s.activity_id, 'participant_id', v_pid, 'method', v_method,
    'credits_granted', v_credits));

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

-- Constancia de entrada en vigor (una sola vez). La conciliación de asistencias anteriores usa esta marca como límite.
INSERT INTO public.audit_log (edition_id, action, detail)
SELECT e.id, 'attendance.credit_rule_installed',
  jsonb_build_object('rule', '60 minutos = 2 sellos; otra duración = 1 sello')
FROM public.editions e
WHERE e.is_active
  AND NOT EXISTS (SELECT 1 FROM public.audit_log a WHERE a.action = 'attendance.credit_rule_installed' AND a.edition_id = e.id);
