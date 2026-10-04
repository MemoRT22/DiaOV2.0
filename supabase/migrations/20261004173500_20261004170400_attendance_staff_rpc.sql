-- Operational overview for Coordinación and Staff: sessions with counts
CREATE OR REPLACE FUNCTION session_checkin_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid;
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_ed := active_edition_id();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'session_id', s.id,
      'activity_id', a.id,
      'title', a.title,
      'starts_at', s.starts_at,
      'ends_at', s.ends_at,
      'location', coalesce(nullif(s.location, ''), a.location),
      'status', s.status,
      'credits', s.credits,
      'capacity', s.capacity,
      'reserved', session_reserved_count(s.id),
      'attended', (SELECT count(*) FROM attendances WHERE session_id = s.id)
    ) ORDER BY s.starts_at, a.title)
    FROM activity_sessions s
    JOIN activities a ON a.id = s.activity_id
    WHERE a.edition_id = v_ed
  ), '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION session_checkin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION session_checkin_overview() TO authenticated;

-- Display credential for showing QR + manual code (Coordinación and Staff)
CREATE OR REPLACE FUNCTION session_credential_display(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_ed uuid;
  v_s activity_sessions%ROWTYPE;
  v_a activities%ROWTYPE;
  v_sc session_credentials%ROWTYPE;
  v_token text;
  v_code text;
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_ed := active_edition_id();
  SELECT * INTO v_s FROM activity_sessions WHERE id = p_session;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;
  IF v_a.edition_id IS DISTINCT FROM v_ed THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT * INTO v_sc FROM session_credentials WHERE session_id = p_session;
  IF v_sc.session_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_token := extensions.pgp_sym_decrypt(v_sc.qr_token_encrypted, credential_encryption_key());
  v_code := extensions.pgp_sym_decrypt(v_sc.manual_code_encrypted, credential_encryption_key());

  PERFORM write_audit('checkin.credential_displayed', jsonb_build_object('session_id', p_session));

  RETURN jsonb_build_object(
    'session_id', p_session,
    'qr_token', v_token,
    'manual_code', v_code,
    'title', v_a.title,
    'starts_at', v_s.starts_at,
    'ends_at', v_s.ends_at,
    'location', coalesce(nullif(v_s.location, ''), v_a.location)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION session_credential_display(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION session_credential_display(uuid) TO authenticated;

-- Regenerate credential (Coordinación only)
CREATE OR REPLACE FUNCTION regenerate_session_credential(p_session uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_ed uuid;
  v_s activity_sessions%ROWTYPE;
  v_a activities%ROWTYPE;
  v_token text;
  v_code text;
  v_key text;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  v_ed := active_edition_id();
  SELECT * INTO v_s FROM activity_sessions WHERE id = p_session;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;
  IF v_a.edition_id IS DISTINCT FROM v_ed THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_token := generate_qr_token();
  v_code := generate_manual_code();
  v_key := credential_encryption_key();

  UPDATE session_credentials
  SET qr_token_hash = extensions.digest(v_token, 'sha256'),
      manual_code_hash = extensions.digest(lower(v_code), 'sha256'),
      qr_token_encrypted = extensions.pgp_sym_encrypt(v_token, v_key),
      manual_code_encrypted = extensions.pgp_sym_encrypt(v_code, v_key),
      rotated_at = now()
  WHERE session_id = p_session;

  PERFORM write_audit('checkin.credential_regenerated', jsonb_build_object(
    'session_id', p_session, 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('session_id', p_session, 'qr_token', v_token, 'manual_code', v_code);
END;
$$;
REVOKE EXECUTE ON FUNCTION regenerate_session_credential(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION regenerate_session_credential(uuid, text) TO authenticated;