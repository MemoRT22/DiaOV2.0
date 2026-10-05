-- Helper: generate a random 6-char manual code without confusable chars (no 0/O/1/I)
CREATE OR REPLACE FUNCTION generate_manual_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  END LOOP;
  RETURN v_code;
END;
$$;
REVOKE EXECUTE ON FUNCTION generate_manual_code() FROM PUBLIC, anon, authenticated;

-- Helper: generate a random 32-byte hex token
CREATE OR REPLACE FUNCTION generate_qr_token()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT encode(extensions.gen_random_bytes(32), 'hex');
$$;
REVOKE EXECUTE ON FUNCTION generate_qr_token() FROM PUBLIC, anon, authenticated;

-- Helper: symmetric key for pgcrypto (fixed application-level key, not a user secret)
CREATE OR REPLACE FUNCTION credential_encryption_key()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'diaov-checkin-key-v1-9f3a7b2c';
$$;
REVOKE EXECUTE ON FUNCTION credential_encryption_key() FROM PUBLIC, anon, authenticated;

-- Ensure a session has credentials; create if missing
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

-- Trigger: auto-create credentials when a session is inserted
CREATE OR REPLACE FUNCTION trigger_ensure_credential()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM ensure_session_credential(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION trigger_ensure_credential() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activity_sessions_ensure_credential ON activity_sessions;
CREATE TRIGGER activity_sessions_ensure_credential
AFTER INSERT ON activity_sessions
FOR EACH ROW EXECUTE FUNCTION trigger_ensure_credential();

-- Backfill credentials for existing sessions
INSERT INTO session_credentials (session_id, qr_token_hash, manual_code_hash, qr_token_encrypted, manual_code_encrypted)
SELECT s.id, extensions.digest(t.token, 'sha256'), extensions.digest(lower(t.code), 'sha256'),
       extensions.pgp_sym_encrypt(t.token, credential_encryption_key()),
       extensions.pgp_sym_encrypt(t.code, credential_encryption_key())
FROM activity_sessions s
CROSS JOIN LATERAL (
  SELECT generate_qr_token() AS token, generate_manual_code() AS code
) t
WHERE NOT EXISTS (SELECT 1 FROM session_credentials sc WHERE sc.session_id = s.id);