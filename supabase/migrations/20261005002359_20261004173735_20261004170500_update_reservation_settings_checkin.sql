CREATE OR REPLACE FUNCTION update_reservation_settings(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open timestamptz := nullif(p->>'reservations_open_at', '')::timestamptz;
  v_close timestamptz := nullif(p->>'reservations_close_at', '')::timestamptz;
  v_max int := (p->>'max_reservations')::int;
  v_buffer int := (p->>'travel_buffer_minutes')::int;
  v_checkin_open int := coalesce((p->>'checkin_open_before_minutes')::int, 5);
  v_checkin_close int := coalesce((p->>'checkin_close_after_minutes')::int, 20);
BEGIN
  PERFORM require_coordinacion();
  IF v_max IS NULL OR v_max < 1 OR v_max > 20 THEN RAISE EXCEPTION 'INVALID_MAX_RESERVATIONS'; END IF;
  IF v_buffer IS NULL OR v_buffer < 0 OR v_buffer > 120 THEN RAISE EXCEPTION 'INVALID_BUFFER'; END IF;
  IF v_checkin_open IS NULL OR v_checkin_open < 0 OR v_checkin_open > 120 THEN RAISE EXCEPTION 'INVALID_CHECKIN_WINDOW'; END IF;
  IF v_checkin_close IS NULL OR v_checkin_close < 0 OR v_checkin_close > 120 THEN RAISE EXCEPTION 'INVALID_CHECKIN_WINDOW'; END IF;
  IF v_close IS NOT NULL AND (v_open IS NULL OR v_close <= v_open) THEN RAISE EXCEPTION 'INVALID_WINDOW'; END IF;
  UPDATE editions SET reservations_open_at = v_open, reservations_close_at = v_close,
    max_reservations = v_max, travel_buffer_minutes = v_buffer,
    checkin_open_before_minutes = v_checkin_open, checkin_close_after_minutes = v_checkin_close
  WHERE id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  PERFORM write_audit('reservations.settings_updated', jsonb_build_object('reservations_open_at', v_open,
    'reservations_close_at', v_close, 'max_reservations', v_max, 'travel_buffer_minutes', v_buffer,
    'checkin_open_before_minutes', v_checkin_open, 'checkin_close_after_minutes', v_checkin_close));
END;
$$;
REVOKE EXECUTE ON FUNCTION update_reservation_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_reservation_settings(jsonb) TO authenticated;