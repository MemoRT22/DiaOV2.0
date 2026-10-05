/*
# Fase 8B — QR único por taller

## 1. Nueva tabla activity_credentials
- Una credencial por actividad (no por sesión).
- QR token + código manual, hashes bytea, valores cifrados con clave de Vault.
- RLS habilitada, sin grants a anon/authenticated.

## 2. Migración de session_credentials → activity_credentials
- Para cada actividad con sesiones, crear una credencial única.
- Truncar session_credentials para que las credenciales antiguas dejen de funcionar.

## 3. Trigger automático en activities (no en activity_sessions)
- Eliminar trigger activity_sessions_ensure_credential.
- Nuevo trigger activities_ensure_credential AFTER INSERT.

## 4. Reescribir resolve_credential y check_in
- resolve_credential ahora devuelve (activity_id, method).
- check_in: credencial → activity → reservación vigente → sesión → asistencia.
*/

-- ============================================================
-- 1. Tabla activity_credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_credentials (
  activity_id uuid PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  qr_token_hash bytea NOT NULL,
  manual_code_hash bytea NOT NULL,
  qr_token_encrypted bytea NOT NULL,
  manual_code_encrypted bytea NOT NULL,
  rotated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_credentials_qr_token_hash_key
  ON activity_credentials (qr_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS activity_credentials_manual_code_hash_key
  ON activity_credentials (manual_code_hash);

ALTER TABLE activity_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity_credentials FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Función rotate_activity_credential
-- ============================================================
CREATE OR REPLACE FUNCTION public.rotate_activity_credential(p_activity uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text; v_code text; v_key text := credential_encryption_key();
  v_attempt int;
BEGIN
  FOR v_attempt IN 1..10 LOOP
    v_token := generate_qr_token();
    v_code := generate_manual_code();
    BEGIN
      INSERT INTO activity_credentials (activity_id, qr_token_hash, manual_code_hash, qr_token_encrypted, manual_code_encrypted)
      VALUES (p_activity,
              extensions.digest(v_token, 'sha256'),
              extensions.digest(lower(v_code), 'sha256'),
              extensions.pgp_sym_encrypt(v_token, v_key),
              extensions.pgp_sym_encrypt(v_code, v_key))
      ON CONFLICT (activity_id) DO UPDATE SET
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

REVOKE ALL ON FUNCTION public.rotate_activity_credential(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. ensure_activity_credential + trigger en activities
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_activity_credential(p_activity uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM activity_credentials WHERE activity_id = p_activity) THEN RETURN; END IF;
  PERFORM rotate_activity_credential(p_activity);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_activity_credential(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trigger_ensure_activity_credential()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM ensure_activity_credential(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_ensure_activity_credential() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activity_sessions_ensure_credential ON activity_sessions;
DROP FUNCTION IF EXISTS public.trigger_ensure_credential();

DROP TRIGGER IF EXISTS activities_ensure_credential ON activities;
CREATE TRIGGER activities_ensure_credential
AFTER INSERT ON activities
FOR EACH ROW EXECUTE FUNCTION trigger_ensure_activity_credential();

-- ============================================================
-- 4. Migrar credenciales existentes: una por actividad
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT a.id AS activity_id FROM activities a JOIN activity_sessions s ON s.activity_id = a.id LOOP
    PERFORM ensure_activity_credential(r.activity_id);
  END LOOP;
END $$;

-- Truncar session_credentials: las credenciales por sesión ya no son válidas
TRUNCATE TABLE session_credentials;

-- ============================================================
-- 5. Reescribir resolve_credential: activity_id + method
-- ============================================================
DROP FUNCTION IF EXISTS public.resolve_credential(text);
DROP FUNCTION IF EXISTS public.resolve_credential(text, OUT uuid, OUT text);

CREATE FUNCTION public.resolve_credential(p_credential text, OUT activity_id uuid, OUT method text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  SELECT ac.activity_id, 'qr' INTO activity_id, method
  FROM activity_credentials ac
  WHERE ac.qr_token_hash = extensions.digest(p_credential, 'sha256');
  IF activity_id IS NOT NULL THEN RETURN; END IF;

  SELECT ac.activity_id, 'codigo_manual' INTO activity_id, method
  FROM activity_credentials ac
  WHERE ac.manual_code_hash = extensions.digest(lower(p_credential), 'sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_credential(text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6. Reescribir check_in: taller → reservación → sesión → asistencia
-- ============================================================
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
  v_already boolean := false;
  v_credits int;
  v_method text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_res_count int;
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

  -- Find the participant's vigente reservation for this activity
  SELECT id, session_id INTO v_reservation_id, v_session_id
  FROM reservations
  WHERE participant_id = v_pid AND activity_id = v_match.activity_id AND status = 'vigente';

  IF v_reservation_id IS NULL THEN RAISE EXCEPTION 'NO_RESERVATION'; END IF;

  -- Safety: fail if more than one vigente reservation for the same activity (data inconsistency)
  SELECT count(*) INTO v_res_count
  FROM reservations
  WHERE participant_id = v_pid AND activity_id = v_match.activity_id AND status = 'vigente';
  IF v_res_count > 1 THEN
    PERFORM write_audit('checkin.duplicate_reservation', jsonb_build_object(
      'participant_id', v_pid, 'activity_id', v_match.activity_id, 'count', v_res_count));
    RAISE EXCEPTION 'DUPLICATE_RESERVATION';
  END IF;

  SELECT * INTO v_s FROM activity_sessions WHERE id = v_session_id;

  -- Session must not be cancelled
  IF v_s.status = 'cancelada' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;

  -- Time window based on the reserved session
  v_window_start := v_s.ends_at - make_interval(mins => v_ed.checkin_open_before_minutes);
  v_window_end := v_s.ends_at + make_interval(mins => v_ed.checkin_close_after_minutes);
  IF now() < v_window_start THEN RAISE EXCEPTION 'CHECKIN_TOO_EARLY'; END IF;
  IF now() > v_window_end THEN RAISE EXCEPTION 'CHECKIN_TOO_LATE'; END IF;

  -- Lock participant row
  PERFORM 1 FROM participants WHERE id = v_pid FOR NO KEY UPDATE;

  -- Idempotency
  SELECT * INTO v_existing FROM attendances WHERE participant_id = v_pid AND session_id = v_s.id;
  IF v_existing.id IS NOT NULL THEN
    v_already := true;
    v_att_id := v_existing.id;
    v_credits := v_existing.credits_granted;
    v_method := v_existing.method;
  ELSE
    v_credits := coalesce(v_s.credits, 1);
    v_method := v_match.method;
    INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method, reservation_id)
    VALUES (v_pid, v_s.id, v_s.activity_id, v_credits, v_method, v_reservation_id)
    RETURNING id INTO v_att_id;
    PERFORM write_audit('attendance.checked_in', jsonb_build_object(
      'session_id', v_s.id, 'activity_id', v_s.activity_id, 'participant_id', v_pid, 'method', v_method));
  END IF;

  RETURN jsonb_build_object(
    'already_registered', v_already,
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

REVOKE ALL ON FUNCTION public.check_in(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(text) TO authenticated;

-- ============================================================
-- 7. Limpiar funciones antiguas de sesión
-- ============================================================
DROP FUNCTION IF EXISTS public.ensure_session_credential(uuid);
DROP FUNCTION IF EXISTS public.rotate_session_credential(uuid);
