DO $$
DECLARE v_old text; v_new text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'diaov_checkin_credential_key') THEN
    v_new := encode(extensions.gen_random_bytes(32), 'base64');
    PERFORM vault.create_secret(v_new, 'diaov_checkin_credential_key',
      'Clave de cifrado de credenciales de check-in (QR y código manual)');
    v_old := public.credential_encryption_key();
    UPDATE public.session_credentials SET
      qr_token_encrypted = extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(qr_token_encrypted, v_old), v_new),
      manual_code_encrypted = extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(manual_code_encrypted, v_old), v_new);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.credential_encryption_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
  WHERE name = 'diaov_checkin_credential_key';
  IF v_key IS NULL THEN RAISE EXCEPTION 'CREDENTIAL_KEY_MISSING'; END IF;
  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.credential_encryption_key() FROM PUBLIC, anon, authenticated;