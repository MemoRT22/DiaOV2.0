/*
# Fase 8B — RPCs de Staff/Coordinación por actividad

## 1. activity_checkin_overview()
Reemplaza session_checkin_overview(). Agrupa por actividad, muestra el taller
con sus sesiones y conteos agregados.

## 2. activity_credential_display(p_activity)
Reemplaza session_credential_display(p_session). Devuelve QR + código + título
del taller + lista de horarios.

## 3. regenerate_activity_credential(p_activity, p_reason)
Reemplaza regenerate_session_credential. Solo Coordinación.

## 4. session_to_activity(p_session)
Función helper para deep-link: resuelve session_id → activity_id.
*/

-- ============================================================
-- 1. activity_checkin_overview()
-- ============================================================
CREATE OR REPLACE FUNCTION public.activity_checkin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid;
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_ed := active_edition_id();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'activity_id', a.id,
      'title', a.title,
      'location', a.location,
      'sessions', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'session_id', s.id,
          'starts_at', s.starts_at,
          'ends_at', s.ends_at,
          'status', s.status,
          'capacity', s.capacity,
          'reserved', session_reserved_count(s.id),
          'attended', (SELECT count(*) FROM attendances WHERE session_id = s.id)
        ) ORDER BY s.starts_at), '[]'::jsonb)
        FROM activity_sessions s WHERE s.activity_id = a.id
      ),
      'total_reserved', (SELECT count(*) FROM reservations r WHERE r.activity_id = a.id AND r.status = 'vigente'),
      'total_attended', (SELECT count(*) FROM attendances at WHERE at.activity_id = a.id)
    ) ORDER BY a.title)
    FROM activities a
    WHERE a.edition_id = v_ed
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.activity_checkin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_checkin_overview() TO authenticated;

-- ============================================================
-- 2. activity_credential_display(p_activity)
-- ============================================================
CREATE OR REPLACE FUNCTION public.activity_credential_display(p_activity uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ed uuid;
  v_a activities%ROWTYPE;
  v_ac activity_credentials%ROWTYPE;
  v_token text;
  v_code text;
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_ed := active_edition_id();
  SELECT * INTO v_a FROM activities WHERE id = p_activity;
  IF v_a.edition_id IS DISTINCT FROM v_ed THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT * INTO v_ac FROM activity_credentials WHERE activity_id = p_activity;
  IF v_ac.activity_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_token := extensions.pgp_sym_decrypt(v_ac.qr_token_encrypted, credential_encryption_key());
  v_code := extensions.pgp_sym_decrypt(v_ac.manual_code_encrypted, credential_encryption_key());

  PERFORM write_audit('checkin.credential_displayed', jsonb_build_object('activity_id', p_activity));

  RETURN jsonb_build_object(
    'activity_id', p_activity,
    'qr_token', v_token,
    'manual_code', v_code,
    'title', v_a.title,
    'location', v_a.location,
    'sessions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'status', s.status,
        'capacity', s.capacity,
        'reserved', session_reserved_count(s.id),
        'attended', (SELECT count(*) FROM attendances WHERE session_id = s.id)
      ) ORDER BY s.starts_at), '[]'::jsonb)
      FROM activity_sessions s WHERE s.activity_id = p_activity
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activity_credential_display(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_credential_display(uuid) TO authenticated;

-- ============================================================
-- 3. regenerate_activity_credential(p_activity, p_reason)
-- ============================================================
CREATE OR REPLACE FUNCTION public.regenerate_activity_credential(p_activity uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ed uuid;
  v_a activities%ROWTYPE;
  v_new jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  v_ed := active_edition_id();
  SELECT * INTO v_a FROM activities WHERE id = p_activity;
  IF v_a.edition_id IS DISTINCT FROM v_ed THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_new := rotate_activity_credential(p_activity);

  PERFORM write_audit('checkin.credential_regenerated', jsonb_build_object(
    'activity_id', p_activity, 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('activity_id', p_activity,
    'qr_token', v_new->>'qr_token', 'manual_code', v_new->>'manual_code');
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_activity_credential(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_activity_credential(uuid, text) TO authenticated;

-- ============================================================
-- 4. session_to_activity(p_session) — helper para deep-link
-- ============================================================
CREATE OR REPLACE FUNCTION public.session_to_activity(p_session uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT activity_id FROM activity_sessions WHERE id = p_session;
$$;

REVOKE ALL ON FUNCTION public.session_to_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_to_activity(uuid) TO authenticated;

-- ============================================================
-- 5. Reemplazar session_checkin_overview y session_credential_display
--    con stubs que delegan para compatibilidad
-- ============================================================
CREATE OR REPLACE FUNCTION public.session_checkin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN activity_checkin_overview();
END;
$$;
REVOKE ALL ON FUNCTION public.session_checkin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_checkin_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.session_credential_display(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_activity uuid;
BEGIN
  SELECT session_to_activity INTO v_activity FROM public.session_to_activity(p_session);
  IF v_activity IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN activity_credential_display(v_activity);
END;
$$;
REVOKE ALL ON FUNCTION public.session_credential_display(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_credential_display(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_session_credential(p_session uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_activity uuid;
BEGIN
  SELECT session_to_activity INTO v_activity FROM public.session_to_activity(p_session);
  IF v_activity IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN regenerate_activity_credential(v_activity, p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.regenerate_session_credential(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_session_credential(uuid, text) TO authenticated;
