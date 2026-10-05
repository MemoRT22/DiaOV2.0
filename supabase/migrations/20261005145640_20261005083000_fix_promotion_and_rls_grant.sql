/*
# Fase 8A — Fix: update_participant promoción de carrera 2 y RLS grant

## 1. update_participant: promoción cuando se limpia carrera 1
Cuando el campo initial_career_id se proporciona explícitamente como vacío,
n.initial_career_id es NULL. El código usaba coalesce(n.initial_career_id, v_existing_career1)
que mantenía la carrera existente en lugar de respetar el borrado.
Ahora: si el campo se proporcionó, se usa directamente (NULL = borrado explícito).

## 2. current_participant_id: grant explícito a authenticated
Aunque has_function_privilege muestra true, el grant explícito asegura
que la RLS policy funcione en todos los contextos.
*/

CREATE OR REPLACE FUNCTION update_participant(p_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur participants%ROWTYPE;
  n participants%ROWTYPE;
  v_fields text[] := '{}';
  v_cleared text[] := '{}';
  v_reason text := nullif(left(btrim(coalesce(p->>'email_reason', '')), 300), '');
  v_ov jsonb;
  v_career2 uuid;
  v_existing_career2 uuid;
  v_new_career1 uuid;
  v_new_career2 uuid;
  v_career_ids uuid[];
  v_career_raws text[];
  v_demo boolean;
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

  IF p ? 'initial_career_id_2' THEN
    v_career2 := nullif(p->>'initial_career_id_2', '')::uuid;
    IF v_career2 IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career2 AND is_active) THEN
        RAISE EXCEPTION 'INVALID_CAREER';
      END IF;
      v_demo := cur.is_demo;
      IF NOT v_demo AND EXISTS (SELECT 1 FROM careers WHERE id = v_career2 AND is_demo) THEN
        RAISE EXCEPTION 'CAREER_ENVIRONMENT_MISMATCH';
      END IF;
      IF v_career2 = coalesce(n.initial_career_id, cur.initial_career_id) THEN
        RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
      END IF;
      IF coalesce(n.initial_career_id, cur.initial_career_id) IS NULL THEN
        RAISE EXCEPTION 'CAREER_2_REQUIRES_CAREER_1';
      END IF;
    END IF;
  END IF;

  IF n.email IS DISTINCT FROM cur.email THEN
    IF email_in_use(cur.edition_id, n.email, cur.id) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;
    v_fields := v_fields || 'email'::text;
  END IF;
  IF n.full_name IS DISTINCT FROM cur.full_name THEN v_fields := v_fields || 'full_name'::text; END IF;
  IF n.birth_date IS DISTINCT FROM cur.birth_date THEN v_fields := v_fields || 'birth_date'::text;
    IF n.birth_date IS NULL THEN v_cleared := v_cleared || 'birth_date'::text; END IF; END IF;
  IF n.phone IS DISTINCT FROM cur.phone THEN v_fields := v_fields || 'phone'::text;
    IF n.phone IS NULL THEN v_cleared := v_cleared || 'phone'::text; END IF; END IF;
  IF n.high_school IS DISTINCT FROM cur.high_school THEN v_fields := v_fields || 'high_school'::text;
    IF n.high_school IS NULL THEN v_cleared := v_cleared || 'high_school'::text; END IF; END IF;
  IF n.initial_career_id IS DISTINCT FROM cur.initial_career_id THEN v_fields := v_fields || 'initial_career_id'::text;
    IF n.initial_career_id IS NULL THEN v_cleared := v_cleared || 'initial_career_id'::text; END IF; END IF;

  SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
  IF p ? 'initial_career_id_2' AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
    v_fields := v_fields || 'initial_career_id_2'::text;
    IF v_career2 IS NULL THEN v_cleared := v_cleared || 'initial_career_id_2'::text; END IF;
  END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f,
      jsonb_build_object('by', auth.uid(), 'at', now()) || CASE WHEN f = ANY(v_cleared) THEN '{"cleared": true}'::jsonb ELSE '{}'::jsonb END),
    '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f WHERE f <> 'email';

  IF n.email IS DISTINCT FROM cur.email THEN
    INSERT INTO participant_email_history (participant_id, edition_id, email, changed_by, reason)
    VALUES (cur.id, cur.edition_id, cur.email, auth.uid(), v_reason)
    ON CONFLICT (edition_id, email) DO NOTHING;
  END IF;

  UPDATE participants SET email = n.email, full_name = n.full_name, birth_date = n.birth_date, phone = n.phone,
    high_school = n.high_school, initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  -- Sync initial_interests
  IF v_fields @> ARRAY['initial_career_id']::text[] OR v_fields @> ARRAY['initial_career_id_2']::text[] THEN
    -- Determine final career 1: if initial_career_id was provided, use it directly (NULL = explicit clear)
    -- Otherwise keep existing
    IF p ? 'initial_career_id' THEN
      v_new_career1 := n.initial_career_id;
    ELSE
      SELECT career_id INTO v_new_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
    END IF;

    -- Determine final career 2
    IF p ? 'initial_career_id_2' THEN
      v_new_career2 := v_career2;
    ELSE
      v_new_career2 := v_existing_career2;
    END IF;

    -- If career 1 is NULL but career 2 exists, promote career 2 to 1
    IF v_new_career1 IS NULL AND v_new_career2 IS NOT NULL THEN
      v_new_career1 := v_new_career2;
      v_new_career2 := NULL;
    END IF;

    v_career_ids := ARRAY[v_new_career1, v_new_career2];
    v_career_raws := ARRAY[
      (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 1),
      CASE WHEN p ? 'initial_career_id_2' THEN NULL ELSE (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2) END
    ];
    IF v_new_career1 IS NOT NULL OR v_new_career2 IS NOT NULL THEN
      PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
    ELSE
      DELETE FROM initial_interests WHERE participant_id = cur.id;
      UPDATE participants SET initial_career_id = NULL, initial_career_raw = NULL, updated_at = now() WHERE id = cur.id;
    END IF;
  END IF;

  PERFORM write_audit('participant.updated', jsonb_build_object('participant_id', cur.id, 'fields', to_jsonb(v_fields),
    'cleared', to_jsonb(v_cleared), 'email_changed', n.email IS DISTINCT FROM cur.email, 'reason_given', v_reason IS NOT NULL));
END;
$$;

-- Explicit grant for current_participant_id to authenticated (used by RLS policy on initial_interests)
REVOKE EXECUTE ON FUNCTION current_participant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_participant_id() TO authenticated;
