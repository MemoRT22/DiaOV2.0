/*
# Mover la clave de cifrado de credenciales a Supabase Vault

## Resumen
La clave que protege los QR y códigos manuales recuperables estaba escrita en una migración
anterior. Se considera comprometida y se retira.

1. Se genera una clave nueva aleatoria (32 bytes, `gen_random_bytes`) DENTRO de la base de datos y
   se guarda en Supabase Vault con el nombre `diaov_checkin_credential_key`. El valor nunca aparece
   en este archivo ni en el repositorio.
2. Las credenciales existentes se descifran con la clave anterior (leída por última vez a través de
   la función vigente, sin volver a escribir el literal) y se vuelven a cifrar con la nueva clave
   (pgp_sym_encrypt de pgcrypto; sin criptografía propia).
3. `credential_encryption_key()` se reemplaza: ahora lee la clave desde `vault.decrypted_secrets`.
   La clave anterior deja de usarse por completo.

## Seguridad
- `credential_encryption_key()` sigue revocada para PUBLIC, anon y authenticated; solo la usan
  funciones internas SECURITY DEFINER.
- El esquema `vault` no está expuesto por la Data API.
- `session_credentials` sigue sin privilegios para anon/authenticated.

## Notas
1. Idempotente: si el secreto ya existe, no se vuelve a cifrar.
2. Los hashes de búsqueda (SHA-256) no cambian, por lo que los QR y códigos actuales siguen siendo válidos.
*/

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
