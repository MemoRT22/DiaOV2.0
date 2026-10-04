-- Fix: store hashes as bytea (digest returns bytea, not text)
ALTER TABLE session_credentials ALTER COLUMN qr_token_hash TYPE bytea USING qr_token_hash::bytea;
ALTER TABLE session_credentials ALTER COLUMN manual_code_hash TYPE bytea USING manual_code_hash::bytea;

-- Recreate indexes
DROP INDEX IF EXISTS session_credentials_qr_hash_idx;
DROP INDEX IF EXISTS session_credentials_manual_hash_idx;
CREATE INDEX IF NOT EXISTS session_credentials_qr_hash_idx ON session_credentials (qr_token_hash);
CREATE INDEX IF NOT EXISTS session_credentials_manual_hash_idx ON session_credentials (manual_code_hash);

-- Backfill existing credentials with correct bytea hashes
UPDATE session_credentials sc
SET qr_token_hash = extensions.digest(extensions.pgp_sym_decrypt(sc.qr_token_encrypted, credential_encryption_key()), 'sha256'),
    manual_code_hash = extensions.digest(lower(extensions.pgp_sym_decrypt(sc.manual_code_encrypted, credential_encryption_key())), 'sha256');

-- Update ensure_session_credential to use bytea
CREATE OR REPLACE FUNCTION ensure_session_credential(p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_token text;
  v_code text;
  v_key text;
BEGIN
  IF EXISTS (SELECT 1 FROM session_credentials WHERE session_id = p_session) THEN RETURN; END IF;
  v_token := generate_qr_token();
  v_code := generate_manual_code();
  v_key := credential_encryption_key();
  INSERT INTO session_credentials (session_id, qr_token_hash, manual_code_hash, qr_token_encrypted, manual_code_encrypted)
  VALUES (
    p_session,
    extensions.digest(v_token, 'sha256'),
    extensions.digest(lower(v_code), 'sha256'),
    extensions.pgp_sym_encrypt(v_token, v_key),
    extensions.pgp_sym_encrypt(v_code, v_key)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION ensure_session_credential(uuid) FROM PUBLIC, anon, authenticated;

-- Update resolve_credential to compare bytea
CREATE OR REPLACE FUNCTION resolve_credential(p_credential text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_session_id uuid;
BEGIN
  SELECT sc.session_id INTO v_session_id
  FROM session_credentials sc
  WHERE sc.qr_token_hash = extensions.digest(p_credential, 'sha256')
  LIMIT 1;
  IF v_session_id IS NOT NULL THEN RETURN v_session_id; END IF;

  SELECT sc.session_id INTO v_session_id
  FROM session_credentials sc
  WHERE sc.manual_code_hash = extensions.digest(lower(p_credential), 'sha256')
  LIMIT 1;
  RETURN v_session_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION resolve_credential(text) FROM PUBLIC, anon, authenticated;

-- Update regenerate to use bytea
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