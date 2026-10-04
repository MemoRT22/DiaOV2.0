/*
# Gestión de participantes para staff y Coordinación

1. Funciones (requieren rol staff o coordinacion, activas)
- `search_participants(query)`: búsqueda por nombre, correo o teléfono (máx. 50).
- `get_participant(id)`: expediente completo, origen de cada dato, conflictos pendientes y estado de acceso. Se audita la consulta.
- `create_participant_manual(data)`: alta manual con consentimiento obligatorio. Correo repetido -> EMAIL_EXISTS.
- `update_participant(id, data)`: corrige datos aunque el alumno ya haya usado la plataforma. Cada campo cambiado queda
  marcado como corrección manual (las importaciones no lo pisan).
- `access_diagnosis(email)`: explica por qué un aspirante no puede entrar.
- `clear_access_lock(id)`: retira el bloqueo temporal por intentos fallidos.

2. Auditoría
- Se registra quién, cuándo, participante y campos cambiados. Nunca los valores personales.

3. Notas
1. El bloqueo cuenta intentos fallidos en 15 minutos desde el último acceso correcto o desbloqueo.
2. Retirar el bloqueo agrega un registro de desbloqueo; no borra el historial.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'access_attempts' AND column_name = 'cleared') THEN
    ALTER TABLE access_attempts ADD COLUMN cleared boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION email_hash(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION access_lock_state(p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH h AS (SELECT email_hash(p_email) AS v),
  base AS (
    SELECT greatest(now() - interval '15 minutes',
      coalesce((SELECT max(created_at) FROM access_attempts, h WHERE email_hash = h.v AND (succeeded OR cleared)), '-infinity')) AS since
  ),
  f AS (
    SELECT count(*) AS n, max(created_at) AS last_at FROM access_attempts, h, base
    WHERE email_hash = h.v AND NOT succeeded AND NOT cleared AND created_at > base.since
  )
  SELECT jsonb_build_object('failed', f.n, 'locked', f.n >= 5,
    'locked_until', CASE WHEN f.n >= 5 THEN f.last_at + interval '15 minutes' END,
    'last_success', (SELECT max(created_at) FROM access_attempts, h WHERE email_hash = h.v AND succeeded))
  FROM f;
$$;

CREATE OR REPLACE FUNCTION clean_phone(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v text;
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  v := regexp_replace(p, '[^0-9]', '', 'g');
  IF length(v) < 10 OR length(v) > 15 THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  RETURN CASE WHEN btrim(p) LIKE '+%' THEN '+' || v ELSE v END;
END;
$$;

CREATE OR REPLACE FUNCTION check_birth_date(p date)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p IS NOT NULL AND (p < date '1950-01-01' OR p > current_date) THEN RAISE EXCEPTION 'INVALID_BIRTH_DATE'; END IF;
  RETURN p;
END;
$$;

CREATE OR REPLACE FUNCTION search_participants(p_query text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := lower(btrim(coalesce(p_query, ''))); d text;
BEGIN
  PERFORM require_operativo();
  IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
  d := regexp_replace(q, '[^0-9]', '', 'g');
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT p.id, p.full_name, p.email, p.phone, p.high_school, p.origin, p.is_demo,
             c.name AS career_name, p.birth_date IS NOT NULL AS has_birth_date, p.auth_user_id IS NOT NULL AS has_logged_in
      FROM participants p LEFT JOIN careers c ON c.id = p.initial_career_id
      WHERE p.edition_id = active_edition_id()
        AND (lower(p.full_name) LIKE '%' || q || '%' OR p.email LIKE '%' || q || '%'
             OR (length(d) >= 4 AND p.phone LIKE '%' || d || '%'))
      ORDER BY p.full_name LIMIT 50
    ) x), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION get_participant(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p participants%ROWTYPE; v jsonb;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v := jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'birth_date', p.birth_date, 'phone', p.phone,
    'high_school', p.high_school, 'initial_career_id', p.initial_career_id, 'origin', p.origin, 'is_demo', p.is_demo,
    'forms_consent', p.forms_consent, 'forms_consent_at', p.forms_consent_at,
    'manual_consent_at', p.manual_consent_at,
    'manual_consent_by', (SELECT full_name FROM staff_members WHERE user_id = p.manual_consent_captured_by),
    'manual_overrides', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('at', val->>'at',
        'by', (SELECT full_name FROM staff_members WHERE user_id::text = val->>'by'))), '{}'::jsonb)
      FROM jsonb_each(p.manual_overrides) AS t(k, val)),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = p.id AND status = 'pending'),
    'has_logged_in', p.auth_user_id IS NOT NULL,
    'platform_consent_at', (SELECT platform_consent_at FROM participant_profiles WHERE participant_id = p.id),
    'attendances', (SELECT count(*) FROM attendances WHERE participant_id = p.id),
    'access', access_lock_state(p.email),
    'created_at', p.created_at, 'updated_at', p.updated_at
  );
  PERFORM write_audit('participant.viewed', jsonb_build_object('participant_id', p.id));
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION create_participant_manual(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := btrim(coalesce(p->>'full_name', ''));
  v_career uuid := nullif(p->>'initial_career_id', '')::uuid;
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_id uuid;
BEGIN
  PERFORM require_operativo();
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF coalesce((p->>'consent_confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF v_career IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career) THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE edition_id = v_ed AND email = v_email) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, origin,
    manual_consent_captured_by, manual_consent_at, manual_consent_version, created_by, is_demo, manual_overrides)
  VALUES (v_ed, v_email, v_name, check_birth_date(nullif(p->>'birth_date', '')::date), clean_phone(p->>'phone'),
    nullif(left(btrim(coalesce(p->>'high_school', '')), 200), ''), v_career, 'manual',
    auth.uid(), now(), (SELECT privacy_notice_version FROM editions WHERE id = v_ed), auth.uid(),
    coalesce((p->>'is_demo')::boolean, false),
    jsonb_build_object('full_name', v_now, 'birth_date', v_now, 'phone', v_now, 'high_school', v_now, 'initial_career_id', v_now))
  RETURNING id INTO v_id;

  PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_participant(p_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur participants%ROWTYPE;
  n participants%ROWTYPE;
  v_fields text[] := '{}';
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_ov jsonb;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO cur FROM participants WHERE id = p_id AND edition_id = active_edition_id() FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  n := cur;
  IF p ? 'email' THEN n.email := lower(btrim(coalesce(p->>'email', '')));
    IF n.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(n.email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  END IF;
  IF p ? 'full_name' THEN n.full_name := btrim(coalesce(p->>'full_name', ''));
    IF length(n.full_name) < 3 OR length(n.full_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  END IF;
  IF p ? 'birth_date' THEN n.birth_date := check_birth_date(nullif(p->>'birth_date', '')::date); END IF;
  IF p ? 'phone' THEN n.phone := clean_phone(p->>'phone'); END IF;
  IF p ? 'high_school' THEN n.high_school := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), ''); END IF;
  IF p ? 'initial_career_id' THEN n.initial_career_id := nullif(p->>'initial_career_id', '')::uuid;
    IF n.initial_career_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = n.initial_career_id) THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
  END IF;

  IF n.email IS DISTINCT FROM cur.email THEN
    IF EXISTS (SELECT 1 FROM participants WHERE edition_id = cur.edition_id AND email = n.email AND id <> cur.id) THEN
      RAISE EXCEPTION 'EMAIL_EXISTS';
    END IF;
    v_fields := v_fields || 'email'::text;
  END IF;
  IF n.full_name IS DISTINCT FROM cur.full_name THEN v_fields := v_fields || 'full_name'::text; END IF;
  IF n.birth_date IS DISTINCT FROM cur.birth_date THEN v_fields := v_fields || 'birth_date'::text; END IF;
  IF n.phone IS DISTINCT FROM cur.phone THEN v_fields := v_fields || 'phone'::text; END IF;
  IF n.high_school IS DISTINCT FROM cur.high_school THEN v_fields := v_fields || 'high_school'::text; END IF;
  IF n.initial_career_id IS DISTINCT FROM cur.initial_career_id THEN v_fields := v_fields || 'initial_career_id'::text; END IF;
  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f, v_now), '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f WHERE f <> 'email';

  UPDATE participants SET email = n.email, full_name = n.full_name, birth_date = n.birth_date, phone = n.phone,
    high_school = n.high_school, initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  PERFORM write_audit('participant.updated', jsonb_build_object('participant_id', cur.id, 'fields', to_jsonb(v_fields)));
END;
$$;

CREATE OR REPLACE FUNCTION access_diagnosis(p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text := lower(btrim(coalesce(p_email, ''))); p participants%ROWTYPE;
BEGIN
  PERFORM require_operativo();
  IF v_email = '' THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  SELECT * INTO p FROM participants WHERE edition_id = active_edition_id() AND email = v_email;
  PERFORM write_audit('participant.access_checked', jsonb_build_object('participant_id', p.id, 'found', p.id IS NOT NULL));
  RETURN jsonb_build_object(
    'found', p.id IS NOT NULL,
    'participant_id', p.id,
    'full_name', p.full_name,
    'has_birth_date', p.birth_date IS NOT NULL,
    'has_logged_in', p.auth_user_id IS NOT NULL,
    'access', access_lock_state(v_email)
  );
END;
$$;

CREATE OR REPLACE FUNCTION clear_access_lock(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  PERFORM require_operativo();
  SELECT email INTO v_email FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF v_email IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  INSERT INTO access_attempts (email_hash, succeeded, cleared) VALUES (email_hash(v_email), false, true);
  PERFORM write_audit('participant.access_unlocked', jsonb_build_object('participant_id', p_id));
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['search_participants(text)', 'get_participant(uuid)', 'create_participant_manual(jsonb)',
    'update_participant(uuid, jsonb)', 'access_diagnosis(text)', 'clear_access_lock(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['email_hash(text)', 'access_lock_state(text)', 'clean_phone(text)', 'check_birth_date(date)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
