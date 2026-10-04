/*
# Códigos manuales con aleatoriedad segura y credenciales únicas

## Resumen
1. `generate_manual_code()` ahora usa `gen_random_bytes` (pgcrypto, criptográficamente seguro) en
   lugar de `random()`. El alfabeto tiene 32 símbolos, así que `byte % 32` es uniforme.
2. Nueva función interna `rotate_session_credential(session)`: genera token QR + código, los guarda
   (hash SHA-256 + valor cifrado con la clave de Vault) y, si choca con otra credencial existente,
   reintenta con valores nuevos (hasta 10 veces; si no, `CREDENTIAL_GENERATION_FAILED`).
3. `ensure_session_credential` (alta de sesión) y `regenerate_session_credential` (Coordinación)
   usan esa misma función.
4. Se agregan índices UNIQUE sobre `session_credentials.manual_code_hash` y
   `session_credentials.qr_token_hash`. Antes, cualquier duplicado existente se regenera.

## Seguridad
- `rotate_session_credential` y `generate_manual_code` quedan revocadas para PUBLIC/anon/authenticated.
- Ningún cambio de RLS; la tabla sigue sin acceso por Data API.

## Notas
1. Con la restricción en base de datos, `resolve_credential` nunca puede resolver un código a dos sesiones.
*/

CREATE OR REPLACE FUNCTION public.generate_manual_code()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(x.b, i) % 32) + 1, 1), '' ORDER BY i)
  FROM (SELECT extensions.gen_random_bytes(6) AS b) x, generate_series(0, 5) i;
$$;

CREATE OR REPLACE FUNCTION public.rotate_session_credential(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text; v_code text; v_key text := credential_encryption_key();
BEGIN
  FOR v_attempt IN 1..10 LOOP
    v_token := generate_qr_token();
    v_code := generate_manual_code();
    BEGIN
      INSERT INTO session_credentials (session_id, qr_token_hash, manual_code_hash, qr_token_encrypted, manual_code_encrypted)
      VALUES (p_session, extensions.digest(v_token, 'sha256'), extensions.digest(lower(v_code), 'sha256'),
              extensions.pgp_sym_encrypt(v_token, v_key), extensions.pgp_sym_encrypt(v_code, v_key))
      ON CONFLICT (session_id) DO UPDATE SET
        qr_token_hash = EXCLUDED.qr_token_hash,
        manual_code_hash = EXCLUDED.manual_code_hash,
        qr_token_encrypted = EXCLUDED.qr_token_encrypted,
        manual_code_encrypted = EXCLUDED.manual_code_encrypted,
        rotated_at = now();
      RETURN jsonb_build_object('qr_token', v_token, 'manual_code', v_code);
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'CREDENTIAL_GENERATION_FAILED';
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_session_credential(p_session uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM session_credentials WHERE session_id = p_session) THEN RETURN; END IF;
  PERFORM rotate_session_credential(p_session);
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_session_credential(p_session uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ed uuid;
  v_s activity_sessions%ROWTYPE;
  v_a activities%ROWTYPE;
  v_new jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  v_ed := active_edition_id();
  SELECT * INTO v_s FROM activity_sessions WHERE id = p_session;
  SELECT * INTO v_a FROM activities WHERE id = v_s.activity_id;
  IF v_a.edition_id IS DISTINCT FROM v_ed THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_new := rotate_session_credential(p_session);

  PERFORM write_audit('checkin.credential_regenerated', jsonb_build_object(
    'session_id', p_session, 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('session_id', p_session,
    'qr_token', v_new->>'qr_token', 'manual_code', v_new->>'manual_code');
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT session_id FROM (SELECT session_id, row_number() OVER (PARTITION BY manual_code_hash ORDER BY session_id) rn FROM public.session_credentials) x WHERE rn > 1
    UNION
    SELECT session_id FROM (SELECT session_id, row_number() OVER (PARTITION BY qr_token_hash ORDER BY session_id) rn FROM public.session_credentials) y WHERE rn > 1
  LOOP
    PERFORM public.rotate_session_credential(r.session_id);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS session_credentials_manual_code_hash_key ON public.session_credentials (manual_code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS session_credentials_qr_token_hash_key ON public.session_credentials (qr_token_hash);

REVOKE ALL ON FUNCTION public.generate_manual_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_session_credential(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_session_credential(uuid) FROM PUBLIC, anon, authenticated;
