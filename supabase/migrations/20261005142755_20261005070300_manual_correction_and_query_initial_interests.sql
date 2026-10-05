/*
# Fase 8A — Alta manual, corrección y consulta de intereses iniciales

## Cambios

### 1. create_participant_manual
- Acepta `initial_career_id_2` (opcional) para la segunda carrera.
- Después del INSERT, llama a `sync_initial_interests` para guardar ambas carreras
  en `initial_interests` con prioridad 1 y 2.
- `participants.initial_career_id` se sincroniza con preference 1.
- Marca `initial_career_id` y `initial_career_id_2` en manual_overrides.

### 2. update_participant
- Acepta `initial_career_id` y `initial_career_id_2` para corrección.
- Si cambia initial_career_id, actualiza preference 1 en initial_interests.
- Si cambia initial_career_id_2, actualiza preference 2.
- Trackea ambos campos en manual_overrides.
- Mantiene la consistencia: si preference 1 desaparece, preference 2 sube a 1.

### 3. get_participant
- Retorna `initial_interests` como array de {preference, career_id, career_name, career_raw}.
- Mantiene `initial_career_id` por compatibilidad.

### 4. get_my_initial_interests (nueva)
- Retorna los intereses iniciales del participante autenticado.
- SECURITY DEFINER, revocada de anon.

### 5. Seguridad
- Todas las funciones revocadas de PUBLIC y anon.
- Grants a authenticated según el patrón existente.
*/

-- ============================================================
-- create_participant_manual: acepta initial_career_id_2
-- ============================================================
CREATE OR REPLACE FUNCTION create_participant_manual(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := btrim(coalesce(p->>'full_name', ''));
  v_career uuid := nullif(p->>'initial_career_id', '')::uuid;
  v_career2 uuid := nullif(p->>'initial_career_id_2', '')::uuid;
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_id uuid;
  v_career_ids uuid[];
BEGIN
  PERFORM require_operativo();
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF coalesce((p->>'consent_confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF v_career IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career) THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF v_career2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career2) THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF v_career IS NULL AND v_career2 IS NOT NULL THEN RAISE EXCEPTION 'CAREER_2_REQUIRES_CAREER_1'; END IF;
  IF v_career IS NOT NULL AND v_career2 = v_career THEN RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE edition_id = v_ed AND email = v_email) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, origin,
    manual_consent_captured_by, manual_consent_at, manual_consent_version, created_by, is_demo, manual_overrides)
  VALUES (v_ed, v_email, v_name, check_birth_date(nullif(p->>'birth_date', '')::date), clean_phone(p->>'phone'),
    nullif(left(btrim(coalesce(p->>'high_school', '')), 200), ''), v_career, 'manual',
    auth.uid(), now(), (SELECT privacy_notice_version FROM editions WHERE id = v_ed), auth.uid(),
    coalesce((p->>'is_demo')::boolean, false),
    jsonb_build_object('full_name', v_now, 'birth_date', v_now, 'phone', v_now, 'high_school', v_now,
      'initial_career_id', v_now, 'initial_career_id_2', v_now))
  RETURNING id INTO v_id;

  -- Sync initial_interests
  v_career_ids := ARRAY_remove(ARRAY[v_career, v_career2], NULL);
  IF array_length(v_career_ids, 1) > 0 THEN
    PERFORM sync_initial_interests(v_id, v_career_ids, NULL);
  END IF;

  PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id,
    'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(
      jsonb_build_object('full_name', 1, 'birth_date', 1, 'phone', 1, 'high_school', 1,
        'initial_career_id', 1, 'initial_career_id_2', 1)) k)));
  RETURN v_id;
END;
$$;

-- ============================================================
-- update_participant: acepta initial_career_id_2
-- ============================================================
CREATE OR REPLACE FUNCTION update_participant(p_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur participants%ROWTYPE;
  n participants%ROWTYPE;
  v_fields text[] := '{}';
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_ov jsonb;
  v_career2 uuid;
  v_existing_career1 uuid;
  v_existing_career2 uuid;
  v_new_career1 uuid;
  v_new_career2 uuid;
  v_career_ids uuid[];
BEGIN
  PERFORM require_operativo();
  SELECT * INTO cur FROM participants WHERE id = p_id AND edition_id = active_edition_id() FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  n := cur;

  -- Standard field updates
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

  -- Validate career 2 if provided
  IF p ? 'initial_career_id_2' THEN
    v_career2 := nullif(p->>'initial_career_id_2', '')::uuid;
    IF v_career2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career2) THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
    -- career 2 can't be the same as career 1
    IF v_career2 IS NOT NULL AND v_career2 = coalesce(n.initial_career_id, cur.initial_career_id) THEN
      RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
    END IF;
    -- career 2 requires career 1
    IF v_career2 IS NOT NULL AND coalesce(n.initial_career_id, cur.initial_career_id) IS NULL THEN
      RAISE EXCEPTION 'CAREER_2_REQUIRES_CAREER_1';
    END IF;
  END IF;

  -- Detect changes
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

  -- Detect career 2 change
  SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
  IF p ? 'initial_career_id_2' AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
    v_fields := v_fields || 'initial_career_id_2'::text;
  END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f, v_now), '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f WHERE f <> 'email';

  UPDATE participants SET email = n.email, full_name = n.full_name, birth_date = n.birth_date, phone = n.phone,
    high_school = n.high_school, initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  -- Sync initial_interests if career 1 or 2 changed
  IF v_fields @> ARRAY['initial_career_id']::text[] OR v_fields @> ARRAY['initial_career_id_2']::text[] THEN
    SELECT career_id INTO v_existing_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
    v_new_career1 := coalesce(n.initial_career_id, v_existing_career1);
    IF p ? 'initial_career_id_2' THEN
      v_new_career2 := v_career2;
    ELSE
      v_new_career2 := v_existing_career2;
    END IF;

    -- If career 1 is being cleared but career 2 exists, promote career 2 to 1
    IF v_new_career1 IS NULL AND v_new_career2 IS NOT NULL THEN
      v_new_career1 := v_new_career2;
      v_new_career2 := NULL;
    END IF;

    v_career_ids := ARRAY_remove(ARRAY[v_new_career1, v_new_career2], NULL);
    IF array_length(v_career_ids, 1) > 0 THEN
      PERFORM sync_initial_interests(cur.id, v_career_ids, NULL);
    ELSE
      -- Both cleared: remove all initial_interests
      DELETE FROM initial_interests WHERE participant_id = cur.id;
      UPDATE participants SET initial_career_id = NULL, updated_at = now() WHERE id = cur.id;
    END IF;
  END IF;

  PERFORM write_audit('participant.updated', jsonb_build_object('participant_id', cur.id, 'fields', to_jsonb(v_fields)));
END;
$$;

-- ============================================================
-- get_participant: retorna initial_interests
-- ============================================================
CREATE OR REPLACE FUNCTION get_participant(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p participants%ROWTYPE; v jsonb;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v := jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'birth_date', p.birth_date, 'phone', p.phone,
    'high_school', p.high_school, 'initial_career_id', p.initial_career_id, 'initial_career_raw', p.initial_career_raw,
    'origin', p.origin, 'is_demo', p.is_demo,
    'forms_consent', p.forms_consent, 'forms_consent_at', p.forms_consent_at,
    'manual_consent_at', p.manual_consent_at,
    'manual_consent_by', (SELECT full_name FROM staff_members WHERE user_id = p.manual_consent_captured_by),
    'manual_overrides', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('at', val->>'at',
        'cleared', coalesce((val->>'cleared')::boolean, false),
        'by', (SELECT full_name FROM staff_members WHERE user_id::text = val->>'by'))), '{}'::jsonb)
      FROM jsonb_each(p.manual_overrides) AS t(k, val)),
    'initial_interests', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'preference', ii.preference,
        'career_id', ii.career_id,
        'career_name', c.name,
        'career_code', c.code,
        'career_raw', ii.career_raw
      ) ORDER BY ii.preference), '[]'::jsonb)
      FROM initial_interests ii
      JOIN careers c ON c.id = ii.career_id
      WHERE ii.participant_id = p.id),
    'email_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('email', h.email, 'changed_at', h.changed_at,
        'reason', h.reason, 'changed_by', (SELECT full_name FROM staff_members WHERE user_id = h.changed_by)) ORDER BY h.changed_at DESC), '[]'::jsonb)
      FROM participant_email_history h WHERE h.participant_id = p.id),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = p.id AND status = 'pending'),
    'has_logged_in', p.auth_user_id IS NOT NULL,
    'platform_consent_at', (SELECT platform_consent_at FROM participant_profiles WHERE participant_id = p.id),
    'attendances', (SELECT count(*) FROM attendances WHERE participant_id = p.id),
    'access', access_lock_state(p.email),
    'created_at', p.created_at, 'updated_at', p.updated_at
  );
  IF is_coordinacion() THEN
    v := v || jsonb_build_object('forms_extra', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('label', e.value->>'label', 'value', e.value->>'value')
        ORDER BY (e.value->>'pos')::int NULLS LAST, e.value->>'label'), '[]'::jsonb)
      FROM jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e));
  END IF;
  PERFORM write_audit('participant.viewed', jsonb_build_object('participant_id', p.id));
  RETURN v;
END;
$$;

-- ============================================================
-- get_my_initial_interests: el alumno consulta sus intereses iniciales
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_initial_interests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(true);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'preference', ii.preference,
      'career_id', ii.career_id,
      'career_name', c.name,
      'career_code', c.code
    ) ORDER BY ii.preference)
    FROM initial_interests ii
    JOIN careers c ON c.id = ii.career_id
    WHERE ii.participant_id = v_pid
  ), '[]'::jsonb);
END;
$$;

-- ============================================================
-- Grants
-- ============================================================
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'search_participants(text)', 'get_participant(uuid)',
    'create_participant_manual(jsonb)', 'update_participant(uuid, jsonb)',
    'access_diagnosis(text)', 'clear_access_lock(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;

  REVOKE EXECUTE ON FUNCTION get_my_initial_interests() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION get_my_initial_interests() TO authenticated;
END $$;
