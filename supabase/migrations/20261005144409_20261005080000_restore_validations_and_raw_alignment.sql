/*
# Fase 8A — Correcciones: restaurar validaciones previas + raw alignment + overrides carrera 2

## 1. create_participant_manual
Restaura todas las validaciones previamente aprobadas:
- fecha de nacimiento obligatoria (BIRTH_DATE_REQUIRED)
- teléfono obligatorio y válido (PHONE_REQUIRED, INVALID_PHONE)
- preparatoria obligatoria (HIGH_SCHOOL_REQUIRED)
- primera carrera obligatoria (CAREER_REQUIRED)
- carrera activa y compatible demo/real
- consentimiento obligatorio
- validación de correo mediante email_in_use()
Y añade soporte para initial_career_id_2 opcional con sync_initial_interests.

## 2. update_participant
Restaura completamente:
- email_in_use() al cambiar correo
- inserción en participant_email_history con email_reason
- tracking de campos modificados
- manual_overrides con marca cleared: true
- auditoría existente
E integra initial_career_id_2 con el mismo sistema de overrides.

## 3. sync_initial_interests
- Corrige validación demo/real: usa el is_demo del participante correctamente.
- Los arrays p_career_ids y p_career_raws deben quedar alineados (sin ARRAY_remove).

## 4. process_participant_import
- Corrige alineación de raw values con career_ids.
- initial_career_id_2 se protege con manual_overrides igual que initial_career_id.
- Si Staff corrigió carrera 2, la importación no la pisa (genera conflicto).
*/

-- ============================================================
-- 1. sync_initial_interests: alineación correcta de raw values
-- ============================================================
CREATE OR REPLACE FUNCTION sync_initial_interests(
  p_participant_id uuid,
  p_career_ids uuid[],
  p_career_raws text[] DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
  v_c1 uuid; v_c2 uuid; v_r1 text; v_r2 text;
  v_is_demo boolean;
  v_p participants%ROWTYPE;
BEGIN
  IF v_n > 2 THEN RAISE EXCEPTION 'TOO_MANY_INITIAL_INTERESTS'; END IF;
  IF v_n > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN
    RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
  END IF;

  SELECT * INTO v_p FROM participants WHERE id = p_participant_id;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_is_demo := v_p.is_demo;

  -- Validate careers exist, are active, and match demo/real environment
  IF v_n > 0 THEN
    IF (SELECT count(*) FROM careers WHERE id = ANY(p_career_ids) AND is_active) <> v_n THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
    IF EXISTS (
      SELECT 1 FROM careers c
      WHERE c.id = ANY(p_career_ids) AND NOT v_is_demo AND c.is_demo
    ) THEN RAISE EXCEPTION 'CAREER_ENVIRONMENT_MISMATCH'; END IF;
  END IF;

  -- Extract values preserving alignment (NO ARRAY_remove — raws stay matched to careers)
  v_c1 := CASE WHEN v_n >= 1 THEN p_career_ids[1] ELSE NULL END;
  v_c2 := CASE WHEN v_n >= 2 THEN p_career_ids[2] ELSE NULL END;
  v_r1 := CASE WHEN p_career_raws IS NOT NULL AND array_length(p_career_raws, 1) >= 1 THEN nullif(p_career_raws[1], '') ELSE NULL END;
  v_r2 := CASE WHEN p_career_raws IS NOT NULL AND array_length(p_career_raws, 1) >= 2 THEN nullif(p_career_raws[2], '') ELSE NULL END;

  -- Atomic replace
  DELETE FROM initial_interests WHERE participant_id = p_participant_id;

  IF v_c1 IS NOT NULL THEN
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
    VALUES (p_participant_id, 1, v_c1, v_r1);
  END IF;
  IF v_c2 IS NOT NULL THEN
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
    VALUES (p_participant_id, 2, v_c2, v_r2);
  END IF;

  -- Sync participants.initial_career_id with preference 1
  UPDATE participants SET
    initial_career_id = v_c1,
    initial_career_raw = v_r1,
    updated_at = now()
  WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION sync_initial_interests(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. create_participant_manual: todas las validaciones previas + carrera 2
-- ============================================================
CREATE OR REPLACE FUNCTION create_participant_manual(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := btrim(coalesce(p->>'full_name', ''));
  v_birth date;
  v_phone text;
  v_school text := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), '');
  v_career uuid;
  v_career2 uuid;
  v_demo boolean := coalesce((p->>'is_demo')::boolean, false);
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_ov jsonb;
  v_id uuid;
  v_career_ids uuid[];
  v_career_raws text[];
BEGIN
  PERFORM require_operativo();
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF coalesce(p->>'birth_date', '') = '' THEN RAISE EXCEPTION 'BIRTH_DATE_REQUIRED'; END IF;
  v_birth := check_birth_date((p->>'birth_date')::date);
  IF btrim(coalesce(p->>'phone', '')) = '' THEN RAISE EXCEPTION 'PHONE_REQUIRED'; END IF;
  v_phone := clean_phone(p->>'phone');
  IF v_phone IS NULL THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF v_school IS NULL THEN RAISE EXCEPTION 'HIGH_SCHOOL_REQUIRED'; END IF;
  IF coalesce(p->>'initial_career_id', '') = '' THEN RAISE EXCEPTION 'CAREER_REQUIRED'; END IF;
  SELECT id INTO v_career FROM careers
  WHERE id::text = p->>'initial_career_id' AND is_active AND (v_demo OR NOT is_demo);
  IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  -- Second career optional
  IF coalesce(p->>'initial_career_id_2', '') <> '' THEN
    SELECT id INTO v_career2 FROM careers
    WHERE id::text = p->>'initial_career_id_2' AND is_active AND (v_demo OR NOT is_demo);
    IF v_career2 IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
    IF v_career2 = v_career THEN RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST'; END IF;
  END IF;
  IF coalesce((p->>'consent_confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF email_in_use(v_ed, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  v_ov := jsonb_build_object('full_name', v_now, 'birth_date', v_now, 'phone', v_now, 'high_school', v_now,
    'initial_career_id', v_now);
  IF v_career2 IS NOT NULL THEN
    v_ov := v_ov || jsonb_build_object('initial_career_id_2', v_now);
  END IF;

  INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, origin,
    manual_consent_captured_by, manual_consent_at, manual_consent_version, created_by, is_demo, manual_overrides)
  VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, 'manual',
    auth.uid(), now(), (SELECT privacy_notice_version FROM editions WHERE id = v_ed), auth.uid(), v_demo, v_ov)
  RETURNING id INTO v_id;

  -- Sync initial_interests
  v_career_ids := ARRAY[v_career, v_career2];
  v_career_raws := ARRAY[NULL, NULL];
  PERFORM sync_initial_interests(v_id, v_career_ids, v_career_raws);

  PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id,
    'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_ov) k)));
  RETURN v_id;
END;
$$;

-- ============================================================
-- 3. update_participant: restaurar lógica previa + carrera 2
-- ============================================================
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

  -- Career 2 validation
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

  -- Detect changes (standard fields)
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

  -- Detect career 2 change
  SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
  IF p ? 'initial_career_id_2' AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
    v_fields := v_fields || 'initial_career_id_2'::text;
    IF v_career2 IS NULL THEN v_cleared := v_cleared || 'initial_career_id_2'::text; END IF;
  END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  -- Build manual_overrides (same logic as before, now including initial_career_id_2)
  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f,
      jsonb_build_object('by', auth.uid(), 'at', now()) || CASE WHEN f = ANY(v_cleared) THEN '{"cleared": true}'::jsonb ELSE '{}'::jsonb END),
    '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f WHERE f <> 'email';

  -- Insert email history if email changed
  IF n.email IS DISTINCT FROM cur.email THEN
    INSERT INTO participant_email_history (participant_id, edition_id, email, changed_by, reason)
    VALUES (cur.id, cur.edition_id, cur.email, auth.uid(), v_reason)
    ON CONFLICT (edition_id, email) DO NOTHING;
  END IF;

  UPDATE participants SET email = n.email, full_name = n.full_name, birth_date = n.birth_date, phone = n.phone,
    high_school = n.high_school, initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  -- Sync initial_interests if career 1 or 2 changed
  IF v_fields @> ARRAY['initial_career_id']::text[] OR v_fields @> ARRAY['initial_career_id_2']::text[] THEN
    SELECT career_id INTO v_new_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
    v_new_career1 := coalesce(n.initial_career_id, v_new_career1);
    IF p ? 'initial_career_id_2' THEN
      v_new_career2 := v_career2;
    ELSE
      v_new_career2 := v_existing_career2;
    END IF;

    -- If career 1 cleared but career 2 exists, promote career 2 to 1
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

-- ============================================================
-- 4. process_participant_import: raw alignment + manual_overrides for career 2
-- ============================================================
CREATE OR REPLACE FUNCTION process_participant_import(
  p_rows jsonb,
  p_is_demo boolean,
  p_batch uuid,
  p_career_map jsonb,
  p_career_map_2 jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  v_apply boolean := p_batch IS NOT NULL;
  v_map jsonb := CASE WHEN jsonb_typeof(p_career_map) = 'object' THEN p_career_map ELSE '{}'::jsonb END;
  v_map2 jsonb := CASE WHEN jsonb_typeof(p_career_map_2) = 'object' THEN p_career_map_2 ELSE '{}'::jsonb END;
  r record; cur participants%ROWTYPE; v_match record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
  v_email text; v_name text; v_birth date; v_phone text; v_school text;
  v_career uuid; v_career_raw text; v_career2 uuid; v_career2_raw text;
  v_at timestamptz;
  v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
  v_extra jsonb; v_old_forms jsonb; v_extra_changed boolean; v_alias text; v_alert text;
  v_ckey text; v_ctarget text; v_cname text;
  v_ckey2 text; v_ctarget2 text; v_cname2 text;
  v_unmatched jsonb := '{}'::jsonb;
  v_unmatched2 jsonb := '{}'::jsonb;
  v_career_raw_orig text; v_career2_raw_orig text;
  v_career_ids uuid[]; v_career_raws text[];
  v_existing_career1 uuid; v_existing_career2 uuid;
  v_has_c2_override boolean;
BEGIN
  IF (SELECT roster_status FROM editions WHERE id = v_ed) = 'oficial' THEN RAISE EXCEPTION 'ROSTER_OFFICIAL'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN
    SELECT x.value AS j, x.ord,
      max(x.ord) OVER (PARTITION BY lower(btrim(coalesce(x.value->>'email', '')))) AS last_ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord
  LOOP
    v_errors := '{}'; v_warn := '{}'; v_conf := '{}'; v_upd := '{}'::jsonb; v_alias := NULL; v_alert := NULL;
    v_extra_changed := false; v_ckey := NULL; v_ctarget := NULL; v_ckey2 := NULL; v_ctarget2 := NULL;
    v_email := lower(btrim(coalesce(r.j->>'email', '')));
    v_name := left(btrim(coalesce(r.j->>'full_name', '')), 150);
    v_school := nullif(left(btrim(coalesce(r.j->>'high_school', '')), 200), '');
    v_birth := NULL; v_phone := NULL; v_career := NULL; v_career2 := NULL; v_at := NULL;
    v_career_raw := NULL; v_career2_raw := NULL;

    v_career_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career', ''), '\s+', ' ', 'g')), 200);
    v_career2_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career_2', ''), '\s+', ' ', 'g')), 200);

    IF v_career2_raw_orig <> '' THEN
      v_career_raw := v_career_raw_orig;
      v_career2_raw := v_career2_raw_orig;
    ELSIF v_career_raw_orig ~ '[,;]' THEN
      v_career_raw := left(btrim(split_part(v_career_raw_orig, ',', 1)), 200);
      v_career2_raw := left(btrim(split_part(v_career_raw_orig, ',', 2)), 200);
      IF v_career2_raw = '' AND v_career_raw_orig ~ ';' THEN
        v_career_raw := left(btrim(split_part(v_career_raw_orig, ';', 1)), 200);
        v_career2_raw := left(btrim(split_part(v_career_raw_orig, ';', 2)), 200);
      END IF;
      v_career_raw := left(btrim(regexp_replace(v_career_raw, '\s+', ' ', 'g')), 200);
      v_career2_raw := left(btrim(regexp_replace(v_career2_raw, '\s+', ' ', 'g')), 200);
    ELSE
      v_career_raw := v_career_raw_orig;
    END IF;

    v_extra := normalize_forms_extra(r.j->'extra');

    IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN v_errors := v_errors || 'Correo inválido'::text; END IF;
    IF length(v_name) < 3 THEN v_errors := v_errors || 'Falta el nombre'::text; END IF;
    IF coalesce((r.j->>'consent')::boolean, false) IS NOT TRUE THEN v_errors := v_errors || 'Sin consentimiento de privacidad'::text; END IF;
    IF coalesce(r.j->>'birth_date', '') <> '' THEN
      BEGIN v_birth := check_birth_date((r.j->>'birth_date')::date);
      EXCEPTION WHEN others THEN v_errors := v_errors || 'Fecha de nacimiento inválida'::text; END;
    END IF;
    BEGIN v_phone := clean_phone(r.j->>'phone');
    EXCEPTION WHEN others THEN v_warn := v_warn || 'Teléfono inválido, se omitió'::text; END;

    -- Resolve career 1
    IF v_career_raw <> '' THEN
      SELECT id INTO v_career FROM careers
      WHERE (upper(code) = upper(v_career_raw) OR fold_text(name) = fold_text(v_career_raw))
        AND is_active AND (p_is_demo OR NOT is_demo)
      ORDER BY (upper(code) = upper(v_career_raw)) DESC, (is_demo = p_is_demo) DESC LIMIT 1;
      IF v_career IS NULL THEN
        v_ckey := fold_text(v_career_raw);
        v_ctarget := v_map->>v_ckey;
        IF v_ctarget = 'none' THEN
          v_warn := v_warn || ('Carrera no reconocida "' || v_career_raw || '": se carga sin carrera inicial por decisión de Coordinación')::text;
        ELSIF v_ctarget IS NOT NULL THEN
          SELECT id, name INTO v_career, v_cname FROM careers
          WHERE id::text = v_ctarget AND is_active AND (p_is_demo OR NOT is_demo);
          IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
          v_warn := v_warn || ('Carrera no reconocida "' || v_career_raw || '": relacionada con ' || v_cname)::text;
        ELSE
          v_warn := v_warn || ('Carrera no reconocida "' || v_career_raw || '": relaciónala con una carrera oficial antes de cargar')::text;
        END IF;
      END IF;
    END IF;

    -- Resolve career 2
    IF v_career2_raw <> '' THEN
      IF fold_text(v_career2_raw) = fold_text(v_career_raw) THEN
        v_career2_raw := '';
      ELSE
        SELECT id INTO v_career2 FROM careers
        WHERE (upper(code) = upper(v_career2_raw) OR fold_text(name) = fold_text(v_career2_raw))
          AND is_active AND (p_is_demo OR NOT is_demo)
        ORDER BY (upper(code) = upper(v_career2_raw)) DESC, (is_demo = p_is_demo) DESC LIMIT 1;
        IF v_career2 IS NULL THEN
          v_ckey2 := fold_text(v_career2_raw);
          v_ctarget2 := v_map2->>v_ckey2;
          IF v_ctarget2 = 'none' THEN
            v_warn := v_warn || ('Segunda carrera no reconocida "' || v_career2_raw || '": se omite por decisión de Coordinación')::text;
            v_career2_raw := '';
          ELSIF v_ctarget2 IS NOT NULL THEN
            SELECT id, name INTO v_career2, v_cname2 FROM careers
            WHERE id::text = v_ctarget2 AND is_active AND (p_is_demo OR NOT is_demo);
            IF v_career2 IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
            v_warn := v_warn || ('Segunda carrera no reconocida "' || v_career2_raw || '": relacionada con ' || v_cname2)::text;
          ELSE
            v_warn := v_warn || ('Segunda carrera no reconocida "' || v_career2_raw || '": relaciónala con una carrera oficial antes de cargar')::text;
          END IF;
        END IF;
        IF v_career2 IS NOT NULL AND v_career2 = v_career THEN
          v_career2 := NULL;
          v_career2_raw := '';
          v_warn := v_warn || 'La segunda carrera es igual a la primera: se omite'::text;
        END IF;
      END IF;
    END IF;

    IF coalesce(r.j->>'submitted_at', '') <> '' THEN
      BEGIN v_at := (r.j->>'submitted_at')::timestamptz; EXCEPTION WHEN others THEN v_at := NULL; END;
    END IF;

    cur := NULL;
    IF array_length(v_errors, 1) IS NULL THEN
      SELECT * INTO v_match FROM participant_by_email(v_ed, v_email);
      IF v_match.participant_id IS NOT NULL THEN
        SELECT * INTO cur FROM participants WHERE id = v_match.participant_id;
        IF v_match.via_alias THEN v_alias := v_email; END IF;
      END IF;
      IF cur.id IS NOT NULL AND cur.is_demo <> p_is_demo THEN
        v_errors := v_errors || (CASE WHEN cur.is_demo THEN 'Ya existe como registro de prueba' ELSE 'Ya existe como registro real' END)::text;
      END IF;
      IF v_alias IS NOT NULL AND v_birth IS NOT NULL AND cur.birth_date IS NOT NULL AND v_birth <> cur.birth_date
        AND fold_text(v_name) <> fold_text(cur.full_name) THEN
        v_alert := 'El nombre y la fecha de nacimiento no coinciden con el participante reconocido por correo anterior. Verifica que sea la misma persona.';
      END IF;
    END IF;

    IF r.ord <> r.last_ord AND v_email <> '' THEN
      v_status := 'duplicate';
    ELSIF array_length(v_errors, 1) IS NOT NULL THEN
      v_status := 'error';
    ELSE
      v_status := CASE WHEN cur.id IS NULL THEN 'new' ELSE 'pending' END;
    END IF;

    IF v_ckey IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched := jsonb_set(v_unmatched, ARRAY[v_ckey], jsonb_build_object(
        'key', v_ckey, 'value', coalesce(v_unmatched->v_ckey->>'value', v_career_raw),
        'count', coalesce((v_unmatched->v_ckey->>'count')::int, 0) + 1, 'target', v_ctarget));
    END IF;
    IF v_ckey2 IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched2 := jsonb_set(v_unmatched2, ARRAY[v_ckey2], jsonb_build_object(
        'key', v_ckey2, 'value', coalesce(v_unmatched2->v_ckey2->>'value', v_career2_raw),
        'count', coalesce((v_unmatched2->v_ckey2->>'count')::int, 0) + 1, 'target', v_ctarget2));
    END IF;

    IF v_status = 'new' THEN
      IF v_apply THEN
        INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, initial_career_raw, origin,
          import_batch_id, forms_consent, forms_consent_at, forms_consent_version, created_by, is_demo, extra)
        VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, nullif(v_career_raw, ''), 'forms', p_batch, true,
          coalesce(v_at, now()), v_ver, auth.uid(), p_is_demo,
          CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END)
        RETURNING id INTO v_match.participant_id;

        -- Sync initial_interests with aligned raws
        v_career_ids := ARRAY[v_career, v_career2];
        v_career_raws := ARRAY[nullif(v_career_raw, ''), nullif(v_career2_raw, '')];
        PERFORM sync_initial_interests(v_match.participant_id, v_career_ids, v_career_raws);
      END IF;
    ELSIF v_status = 'pending' THEN
      -- Check existing initial_interests
      SELECT career_id INTO v_existing_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
      SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
      v_has_c2_override := cur.manual_overrides ? 'initial_career_id_2';

      v_nv := jsonb_strip_nulls(jsonb_build_object('full_name', v_name, 'birth_date', v_birth::text, 'phone', v_phone,
        'high_school', v_school, 'initial_career_id', v_career::text));
      v_cv := jsonb_build_object('full_name', cur.full_name, 'birth_date', cur.birth_date::text, 'phone', cur.phone,
        'high_school', cur.high_school, 'initial_career_id', cur.initial_career_id::text);
      FOR f IN SELECT jsonb_object_keys(v_nv) LOOP
        CONTINUE WHEN (v_nv->>f) IS NOT DISTINCT FROM (v_cv->>f);
        IF cur.manual_overrides ? f THEN
          v_conf := v_conf || f;
          IF v_apply THEN
            INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value)
            VALUES (cur.id, p_batch, f, v_nv->>f)
            ON CONFLICT (participant_id, field) WHERE status = 'pending'
            DO UPDATE SET imported_value = EXCLUDED.imported_value, batch_id = EXCLUDED.batch_id, created_at = now();
          END IF;
        ELSE
          v_upd := v_upd || jsonb_build_object(f, v_nv->f);
        END IF;
      END LOOP;

      -- Career 2 conflict detection: if staff overrode career 2 and import has a different value
      IF v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
        v_conf := v_conf || 'initial_career_id_2';
        IF v_apply THEN
          INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value)
          VALUES (cur.id, p_batch, 'initial_career_id_2', v_career2::text)
          ON CONFLICT (participant_id, field) WHERE status = 'pending'
          DO UPDATE SET imported_value = EXCLUDED.imported_value, batch_id = EXCLUDED.batch_id, created_at = now();
        END IF;
      END IF;

      v_old_forms := coalesce(cur.extra->'forms', '{}'::jsonb);
      v_extra_changed := EXISTS (SELECT 1 FROM jsonb_each(v_extra) e
        WHERE (v_old_forms->e.key->>'value') IS DISTINCT FROM (e.value->>'value'));

      -- Check if career 2 changed and is not a conflict
      IF NOT v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
        v_status := CASE WHEN v_status = 'unchanged' THEN 'update' ELSE v_status END;
      END IF;

      v_status := CASE WHEN array_length(v_conf, 1) IS NOT NULL THEN 'conflict'
        WHEN v_upd <> '{}'::jsonb OR v_extra_changed
          OR (NOT v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2)
        THEN 'update' ELSE 'unchanged' END;

      IF v_apply THEN
        UPDATE participants SET
          full_name = coalesce(v_upd->>'full_name', full_name),
          birth_date = CASE WHEN v_upd ? 'birth_date' THEN (v_upd->>'birth_date')::date ELSE birth_date END,
          phone = coalesce(v_upd->>'phone', phone),
          high_school = coalesce(v_upd->>'high_school', high_school),
          initial_career_id = CASE WHEN v_upd ? 'initial_career_id' THEN (v_upd->>'initial_career_id')::uuid ELSE initial_career_id END,
          initial_career_raw = coalesce(nullif(v_career_raw, ''), initial_career_raw),
          extra = CASE WHEN v_extra = '{}'::jsonb THEN extra
            ELSE coalesce(extra, '{}'::jsonb) || jsonb_build_object('forms', v_old_forms || v_extra) END,
          forms_consent = true,
          forms_consent_at = coalesce(forms_consent_at, v_at, now()),
          forms_consent_version = coalesce(forms_consent_version, v_ver),
          import_batch_id = p_batch,
          updated_at = now()
        WHERE id = cur.id;

        -- Sync initial_interests (aligned raws, respect manual_overrides)
        IF NOT (cur.manual_overrides ? 'initial_career_id') THEN
          -- Determine final career 1 and 2
          v_career_ids := ARRAY[
            CASE WHEN v_upd ? 'initial_career_id' THEN v_career ELSE coalesce(v_existing_career1, cur.initial_career_id) END,
            CASE WHEN v_has_c2_override THEN v_existing_career2 ELSE v_career2 END
          ];
          v_career_raws := ARRAY[
            coalesce(nullif(v_career_raw, ''), cur.initial_career_raw),
            CASE WHEN v_has_c2_override THEN (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2)
                 ELSE nullif(v_career2_raw, '') END
          ];
          -- Only sync if at least one career is non-null
          IF v_career_ids[1] IS NOT NULL OR v_career_ids[2] IS NOT NULL THEN
            PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
          END IF;
        END IF;
      END IF;
    END IF;

    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb((v_counts->>v_status)::int + 1));
    v_results := v_results || jsonb_build_object('row', coalesce((r.j->>'row')::int, r.ord), 'email', v_email, 'name', v_name,
      'status', v_status, 'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warn),
      'updated_fields', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_upd) k)
        || CASE WHEN v_extra_changed THEN '["forms_extra"]'::jsonb ELSE '[]'::jsonb END,
      'conflict_fields', to_jsonb(v_conf),
      'note', CASE WHEN v_alias IS NOT NULL AND v_status NOT IN ('duplicate', 'error')
        THEN 'Reconocido por correo anterior: ' || v_alias || ' (correo vigente: ' || cur.email || ')' END,
      'alert', CASE WHEN v_status NOT IN ('duplicate', 'error') THEN v_alert END,
      'career_unresolved', v_ckey IS NOT NULL AND v_ctarget IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'career_2_unresolved', v_ckey2 IS NOT NULL AND v_ctarget2 IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'extra_count', (SELECT count(*) FROM jsonb_object_keys(v_extra)));
  END LOOP;

  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_CAREERS';
  END IF;
  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched2) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_CAREERS';
  END IF;

  RETURN jsonb_build_object(
    'counts', v_counts, 'rows', v_results,
    'unmatched_careers', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched) u),
    'unmatched_careers_2', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched2) u)
  );
END;
$$;

-- ============================================================
-- 5. Grants
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
  REVOKE ALL ON FUNCTION process_participant_import(jsonb, boolean, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION sync_initial_interests(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;
END $$;
