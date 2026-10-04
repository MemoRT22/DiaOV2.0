/*
# Motor de reservaciones: funciones transaccionales y avisos de disponibilidad

1. Funciones internas (no ejecutables por anon/authenticated)
- `session_reserved_count(session)`: reservaciones vigentes reales.
- `reservation_window(open, close)`: not_open | open | closed.
- `broadcast_availability(session, event)`: publica {session_id, reserved, remaining, full} en el canal
  privado `availability:<edición>`. El mensaje se escribe dentro de la transacción: solo se entrega si hay commit.
- `assert_reservable(participant, session, exclude)`: todas las reglas de negocio de una reservación.

2. Funciones para aspirantes (authenticated; todas comienzan con require_participant(true))
- `reserve_session(session)`, `change_reservation(reservation, session)`, `cancel_reservation(reservation)`,
  `my_reservation_board()`.
- Orden de bloqueo fijo: participante -> sesiones (por id) -> reservación. Dentro de esos bloqueos se cuentan
  las reservaciones vigentes reales y se escribe; dos solicitudes por el último lugar se serializan sobre la fila
  de la sesión y solo una lo obtiene.

3. Seguridad
- Canal de tiempo real privado: solo lo escuchan participantes autenticados u operativos; nadie puede publicar
  (no hay política INSERT en realtime.messages).
*/

CREATE OR REPLACE FUNCTION session_reserved_count(p_session uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT count(*)::int FROM reservations WHERE session_id = p_session AND status = 'vigente';
$$;

CREATE OR REPLACE FUNCTION reservation_window(p_open timestamptz, p_close timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
SELECT CASE
  WHEN p_open IS NULL OR now() < p_open THEN 'not_open'
  WHEN p_close IS NOT NULL AND now() >= p_close THEN 'closed'
  ELSE 'open' END;
$$;

CREATE OR REPLACE FUNCTION broadcast_availability(p_session uuid, p_event text DEFAULT 'availability')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid; v_cap int; v_res int;
BEGIN
  SELECT a.edition_id, s.capacity INTO v_ed, v_cap
  FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE s.id = p_session;
  IF v_ed IS NULL THEN RETURN; END IF;
  v_res := session_reserved_count(p_session);
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('session_id', p_session, 'reserved', v_res,
                         'remaining', greatest(v_cap - v_res, 0), 'full', v_res >= v_cap),
      p_event, 'availability:' || v_ed::text, true);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'availability broadcast failed: %', SQLERRM;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION assert_reservable(p_pid uuid, p_session uuid, p_exclude uuid)
RETURNS activity_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p participants%ROWTYPE; v_ed editions%ROWTYPE; v_s activity_sessions%ROWTYPE; v_a activities%ROWTYPE;
  v_win text; v_buffer interval;
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

  IF EXISTS (SELECT 1 FROM reservations WHERE participant_id = p_pid AND session_id = p_session
             AND status = 'vigente' AND id IS DISTINCT FROM p_exclude) THEN
    RAISE EXCEPTION 'ALREADY_RESERVED';
  END IF;
  IF EXISTS (SELECT 1 FROM reservations WHERE participant_id = p_pid AND activity_id = v_s.activity_id
             AND status = 'vigente' AND id IS DISTINCT FROM p_exclude) THEN
    RAISE EXCEPTION 'SAME_WORKSHOP';
  END IF;
  IF (SELECT count(*) FROM reservations WHERE participant_id = p_pid AND status = 'vigente'
      AND id IS DISTINCT FROM p_exclude) >= v_ed.max_reservations THEN
    RAISE EXCEPTION 'MAX_RESERVATIONS';
  END IF;

  -- Intervals collide when each one starts before the other ends plus the travel buffer.
  v_buffer := make_interval(mins => v_ed.travel_buffer_minutes);
  IF EXISTS (SELECT 1 FROM reservations r JOIN activity_sessions o ON o.id = r.session_id
             WHERE r.participant_id = p_pid AND r.status = 'vigente' AND r.id IS DISTINCT FROM p_exclude
               AND o.starts_at < v_s.ends_at + v_buffer AND v_s.starts_at < o.ends_at + v_buffer) THEN
    RAISE EXCEPTION 'SCHEDULE_CONFLICT';
  END IF;

  IF session_reserved_count(p_session) >= v_s.capacity THEN RAISE EXCEPTION 'SESSION_FULL'; END IF;
  RETURN v_s;
END;
$$;

CREATE OR REPLACE FUNCTION reserve_session(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := require_participant(true); v_s activity_sessions%ROWTYPE; v_id uuid;
BEGIN
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;
  PERFORM 1 FROM activity_sessions WHERE id = p_session FOR NO KEY UPDATE;
  v_s := assert_reservable(v_pid, p_session, NULL);
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

CREATE OR REPLACE FUNCTION cancel_reservation(p_reservation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := require_participant(true); v_sid uuid; v_start timestamptz; v_r reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;
  SELECT session_id INTO v_sid FROM reservations WHERE id = p_reservation AND participant_id = v_pid;
  IF v_sid IS NULL THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  SELECT starts_at INTO v_start FROM activity_sessions WHERE id = v_sid FOR NO KEY UPDATE;
  SELECT * INTO v_r FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF v_r.status <> 'vigente' THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF now() >= v_start THEN RAISE EXCEPTION 'SESSION_STARTED'; END IF;
  UPDATE reservations SET status = 'cancelada_alumno', ended_at = now() WHERE id = p_reservation;
  PERFORM broadcast_availability(v_sid);
  RETURN jsonb_build_object('reservation_id', p_reservation, 'session_id', v_sid);
END;
$$;

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
    'travel_buffer_minutes', v_ed.travel_buffer_minutes,
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'activity_id', s.activity_id, 'title', a.title, 'description', a.description,
        'division_id', a.division_id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'location', coalesce(nullif(s.location, ''), a.location), 'credits', s.credits, 'status', s.status,
        'capacity', s.capacity, 'reserved', c.reserved, 'remaining', greatest(s.capacity - c.reserved, 0),
        'started', now() >= s.starts_at,
        'my_reservation_id', (SELECT r.id FROM reservations r WHERE r.session_id = s.id
                              AND r.participant_id = v_pid AND r.status = 'vigente'),
        'conflicts_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
            AND o.starts_at < s.ends_at + v_buffer AND s.starts_at < o.ends_at + v_buffer), '[]'::jsonb)
      ) ORDER BY s.starts_at, a.title)
      FROM activity_sessions s
      JOIN activities a ON a.id = s.activity_id
      CROSS JOIN LATERAL (SELECT session_reserved_count(s.id) AS reserved) c
      WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
        AND (s.status = 'activa' OR EXISTS (
          SELECT 1 FROM reservations r WHERE r.session_id = s.id AND r.participant_id = v_pid
            AND r.status IN ('vigente', 'cancelada_sesion')))
    ), '[]'::jsonb),
    'reservations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'session_id', r.session_id, 'activity_id', r.activity_id, 'status', r.status,
        'created_at', r.created_at, 'ended_at', r.ended_at,
        'resolved', r.status = 'cancelada_sesion' AND EXISTS (
          SELECT 1 FROM reservations n WHERE n.participant_id = v_pid AND n.status = 'vigente'
            AND n.created_at > r.ended_at)
      ) ORDER BY s.starts_at)
      FROM reservations r JOIN activity_sessions s ON s.id = r.session_id
      WHERE r.participant_id = v_pid AND r.status IN ('vigente', 'cancelada_sesion')
    ), '[]'::jsonb)
  );
END;
$$;

-- Coordinación: operative counts per session
CREATE OR REPLACE FUNCTION session_reservation_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('session_id', s.id, 'capacity', s.capacity,
      'reserved', c.reserved, 'remaining', greatest(s.capacity - c.reserved, 0)))
    FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
    CROSS JOIN LATERAL (SELECT session_reserved_count(s.id) AS reserved) c
    WHERE a.edition_id = active_edition_id()
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION update_reservation_settings(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open timestamptz := nullif(p->>'reservations_open_at', '')::timestamptz;
  v_close timestamptz := nullif(p->>'reservations_close_at', '')::timestamptz;
  v_max int := (p->>'max_reservations')::int;
  v_buffer int := (p->>'travel_buffer_minutes')::int;
BEGIN
  PERFORM require_coordinacion();
  IF v_max IS NULL OR v_max < 1 OR v_max > 20 THEN RAISE EXCEPTION 'INVALID_MAX_RESERVATIONS'; END IF;
  IF v_buffer IS NULL OR v_buffer < 0 OR v_buffer > 120 THEN RAISE EXCEPTION 'INVALID_BUFFER'; END IF;
  IF v_close IS NOT NULL AND (v_open IS NULL OR v_close <= v_open) THEN RAISE EXCEPTION 'INVALID_WINDOW'; END IF;
  UPDATE editions SET reservations_open_at = v_open, reservations_close_at = v_close,
    max_reservations = v_max, travel_buffer_minutes = v_buffer
  WHERE id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  PERFORM write_audit('reservations.settings_updated', jsonb_build_object('reservations_open_at', v_open,
    'reservations_close_at', v_close, 'max_reservations', v_max, 'travel_buffer_minutes', v_buffer));
END;
$$;

-- Session edits with existing reservations
CREATE OR REPLACE FUNCTION guard_session_reservations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res int;
BEGIN
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.capacity < OLD.capacity OR NEW.location IS DISTINCT FROM OLD.location THEN
    v_res := session_reserved_count(OLD.id);
    IF v_res > 0 THEN
      IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
        RAISE EXCEPTION 'SESSION_TIMES_LOCKED';
      END IF;
      IF NEW.capacity < v_res THEN RAISE EXCEPTION 'CAPACITY_BELOW_RESERVED'; END IF;
      IF NEW.location IS DISTINCT FROM OLD.location
         AND coalesce(current_setting('diaov.location_change', true), '') <> OLD.id::text THEN
        RAISE EXCEPTION 'LOCATION_CHANGE_NEEDS_CONFIRMATION';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION after_session_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    UPDATE reservations SET status = 'cancelada_sesion', ended_at = now()
    WHERE session_id = NEW.id AND status = 'vigente';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      PERFORM write_audit('reservations.cancelled_by_session', jsonb_build_object('session_id', NEW.id, 'reservations', v_n));
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR ROW(NEW.status, NEW.capacity, NEW.location, NEW.starts_at, NEW.ends_at)
     IS DISTINCT FROM ROW(OLD.status, OLD.capacity, OLD.location, OLD.starts_at, OLD.ends_at) THEN
    PERFORM broadcast_availability(NEW.id, 'session_changed');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS activity_sessions_guard_reservations ON activity_sessions;
CREATE TRIGGER activity_sessions_guard_reservations BEFORE UPDATE ON activity_sessions
FOR EACH ROW EXECUTE FUNCTION guard_session_reservations();
DROP TRIGGER IF EXISTS activity_sessions_after_change ON activity_sessions;
CREATE TRIGGER activity_sessions_after_change AFTER INSERT OR UPDATE ON activity_sessions
FOR EACH ROW EXECUTE FUNCTION after_session_change();

CREATE OR REPLACE FUNCTION set_session_location(p_id uuid, p_location text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text; v_loc text := left(btrim(coalesce(p_location, '')), 150); v_res int;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  IF v_loc = '' THEN RAISE EXCEPTION 'LOCATION_REQUIRED'; END IF;
  SELECT s.location INTO v_old FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
  WHERE s.id = p_id AND a.edition_id = active_edition_id() FOR NO KEY UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_res := session_reserved_count(p_id);
  PERFORM set_config('diaov.location_change', p_id::text, true);
  UPDATE activity_sessions SET location = v_loc WHERE id = p_id;
  PERFORM set_config('diaov.location_change', '', true);
  PERFORM write_audit('catalog.session_location_changed', jsonb_build_object('id', p_id, 'from', v_old, 'to', v_loc,
    'reservations', v_res, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('reservations', v_res);
END;
$$;

CREATE OR REPLACE FUNCTION save_session(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_act uuid := nullif(p->>'activity_id', '')::uuid;
v_start timestamptz := (p->>'starts_at')::timestamptz; v_end timestamptz := (p->>'ends_at')::timestamptz;
v_cap int := (p->>'capacity')::int; v_credits int := coalesce((p->>'credits')::int, 1); v_demo boolean; v_act_loc text;
v_loc text := left(btrim(coalesce(p->>'location', '')), 150);
v_status text := coalesce(session_status_from_text(coalesce(p->>'status', 'activa')), 'invalid');
BEGIN
PERFORM require_coordinacion();
SELECT is_demo, location INTO v_demo, v_act_loc FROM activities WHERE id = v_act AND edition_id = active_edition_id();
IF v_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN RAISE EXCEPTION 'INVALID_TIMES'; END IF;
IF v_cap IS NULL OR v_cap < 1 OR v_cap > 2000 THEN RAISE EXCEPTION 'INVALID_CAPACITY'; END IF;
IF v_credits < 1 OR v_credits > 10 THEN RAISE EXCEPTION 'INVALID_CREDITS'; END IF;
IF v_status = 'invalid' THEN RAISE EXCEPTION 'INVALID_SESSION_STATUS'; END IF;
IF v_loc = '' THEN v_loc := coalesce(v_act_loc, ''); END IF;
IF EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act AND starts_at = v_start AND id IS DISTINCT FROM v_id) THEN
RAISE EXCEPTION 'SESSION_EXISTS';
END IF;
IF v_id IS NULL THEN
INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
VALUES (v_act, v_start, v_end, v_cap, v_loc, v_status, v_demo, v_credits) RETURNING id INTO v_id;
ELSE
UPDATE activity_sessions SET starts_at = v_start, ends_at = v_end, capacity = v_cap, location = v_loc, status = v_status,
  credits = v_credits
WHERE id = v_id AND activity_id = v_act;
IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END IF;
PERFORM write_audit('catalog.session_saved', jsonb_build_object('id', v_id, 'activity_id', v_act, 'status', v_status, 'credits', v_credits));
RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_session(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
PERFORM require_coordinacion();
IF EXISTS (SELECT 1 FROM attendances WHERE session_id = p_id) THEN RAISE EXCEPTION 'HAS_ATTENDANCES'; END IF;
IF EXISTS (SELECT 1 FROM reservations WHERE session_id = p_id) THEN RAISE EXCEPTION 'HAS_RESERVATIONS'; END IF;
DELETE FROM activity_sessions s USING activities a
WHERE s.id = p_id AND a.id = s.activity_id AND a.edition_id = active_edition_id();
IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
PERFORM write_audit('catalog.session_deleted', jsonb_build_object('id', p_id));
END;
$$;

CREATE OR REPLACE FUNCTION delete_activity(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
PERFORM require_coordinacion();
IF EXISTS (SELECT 1 FROM attendances at JOIN activity_sessions s ON s.id = at.session_id WHERE s.activity_id = p_id) THEN
RAISE EXCEPTION 'HAS_ATTENDANCES';
END IF;
IF EXISTS (SELECT 1 FROM reservations WHERE activity_id = p_id) THEN RAISE EXCEPTION 'HAS_RESERVATIONS'; END IF;
DELETE FROM activity_sessions WHERE activity_id = p_id;
DELETE FROM activities WHERE id = p_id AND edition_id = active_edition_id();
IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
PERFORM write_audit('catalog.activity_deleted', jsonb_build_object('id', p_id));
END;
$$;

REVOKE ALL ON FUNCTION session_reserved_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reservation_window(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION broadcast_availability(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assert_reservable(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION guard_session_reservations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION after_session_change() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION reserve_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION change_reservation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cancel_reservation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION my_reservation_board() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION session_reservation_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION update_reservation_settings(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_session_location(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION save_session(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION delete_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION delete_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_session(uuid), change_reservation(uuid, uuid), cancel_reservation(uuid),
  my_reservation_board(), session_reservation_counts(), update_reservation_settings(jsonb),
  set_session_location(uuid, text, text), save_session(jsonb), delete_session(uuid), delete_activity(uuid)
TO authenticated;

DROP POLICY IF EXISTS "Availability channel listeners" ON realtime.messages;
CREATE POLICY "Availability channel listeners"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND realtime.topic() = 'availability:' || public.active_edition_id()::text
  AND (public.current_participant_id() IS NOT NULL OR public.is_operativo())
);