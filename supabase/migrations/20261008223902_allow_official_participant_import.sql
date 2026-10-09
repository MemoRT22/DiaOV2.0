-- Fase 6B: mantener vigente la importación CSV tras declarar el padrón oficial.
-- Solo se retira el guard ROSTER_OFFICIAL; el resto de la función coincide con
-- 20261006214840_high_schools_catalog.sql. No modifica datos existentes.

CREATE OR REPLACE FUNCTION public.process_participant_import(p_rows jsonb, p_is_demo boolean, p_batch uuid, p_career_map jsonb, p_career_map_2 jsonb, p_high_school_map jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  v_apply boolean := p_batch IS NOT NULL;
  v_map jsonb := CASE WHEN jsonb_typeof(p_career_map) = 'object' THEN p_career_map ELSE '{}'::jsonb END;
  v_map2 jsonb := CASE WHEN jsonb_typeof(p_career_map_2) = 'object' THEN p_career_map_2 ELSE '{}'::jsonb END;
  v_school_map jsonb := CASE WHEN jsonb_typeof(p_high_school_map) = 'object' THEN p_high_school_map ELSE '{}'::jsonb END;
  r record; cur participants%ROWTYPE; v_match record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
  v_email text; v_name text; v_phone text; v_school text; v_grade text; v_period text; v_consent boolean;
  v_career uuid; v_career_raw text; v_career2 uuid; v_career2_raw text;
  v_at timestamptz;
  v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
  v_extra jsonb; v_old_forms jsonb; v_extra_changed boolean; v_alias text;
  v_ckey text; v_ctarget text; v_cname text;
  v_ckey2 text; v_ctarget2 text; v_cname2 text;
  v_unmatched jsonb := '{}'::jsonb;
  v_unmatched2 jsonb := '{}'::jsonb;
  v_unmatched_schools jsonb := '{}'::jsonb;
  v_school_raw text; v_school_id uuid; v_school_key text; v_school_target text;
  v_career_raw_orig text; v_career2_raw_orig text;
  v_career_ids uuid[]; v_career_raws text[];
  v_existing_career1 uuid; v_existing_career2 uuid;
  v_has_c2_override boolean;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN
    SELECT x.value AS j, x.ord,
      max(x.ord) OVER (PARTITION BY lower(btrim(coalesce(x.value->>'email', '')))) AS last_ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord
  LOOP
    v_errors := '{}'; v_warn := '{}'; v_conf := '{}'; v_upd := '{}'::jsonb; v_alias := NULL;
    v_extra_changed := false; v_ckey := NULL; v_ctarget := NULL; v_ckey2 := NULL; v_ctarget2 := NULL;
    v_email := lower(btrim(coalesce(r.j->>'email', '')));
    v_name := left(btrim(regexp_replace(coalesce(r.j->>'full_name', ''), '\s+', ' ', 'g')), 150);
    v_school_raw := nullif(left(btrim(regexp_replace(coalesce(r.j->>'high_school', ''), '\s+', ' ', 'g')), 200), '');
    v_school := v_school_raw; v_school_id := NULL; v_school_key := NULL; v_school_target := NULL;
    v_phone := NULL; v_career := NULL; v_career2 := NULL; v_at := NULL;
    v_career_raw := NULL; v_career2_raw := NULL;
    v_grade := nullif(btrim(coalesce(r.j->>'high_school_grade', '')), '');
    v_period := nullif(btrim(coalesce(r.j->>'entry_period', '')), '');
    v_consent := CASE WHEN jsonb_typeof(r.j->'consent') = 'boolean' THEN (r.j->>'consent')::boolean ELSE NULL END;

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
    IF v_consent IS FALSE THEN v_errors := v_errors || 'Sin consentimiento de privacidad'::text; END IF;
    BEGIN v_phone := clean_phone(r.j->>'phone');
    EXCEPTION WHEN others THEN v_warn := v_warn || 'Teléfono inválido, se omitió'::text; END;
    IF v_grade IS NOT NULL AND v_grade NOT IN ('1', '2', '3', 'graduado') THEN
      v_warn := v_warn || ('Grado de preparatoria no reconocido "' || left(v_grade, 40) || '", se omitió')::text; v_grade := NULL;
    END IF;
    IF v_period IS NOT NULL AND v_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN
      v_warn := v_warn || ('Periodo de ingreso no reconocido "' || left(v_period, 40) || '", se omitió')::text; v_period := NULL;
    END IF;

    -- Solo coincidencia normalizada exacta; las decisiones manuales usan IDs oficiales activos.
    IF v_school_raw IS NOT NULL THEN
      SELECT id, name INTO v_school_id, v_school FROM public.high_schools
      WHERE is_active AND public.fold_text(name) = public.fold_text(v_school_raw);
      IF v_school_id IS NULL THEN
        v_school_key := public.fold_text(v_school_raw);
        v_school_target := v_school_map->>v_school_key;
        IF v_school_target IS NOT NULL THEN
          SELECT id, name INTO v_school_id, v_school FROM public.high_schools
          WHERE id::text = v_school_target AND is_active;
          IF v_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
          v_warn := v_warn || ('Preparatoria no reconocida "' || v_school_raw || '": relacionada con ' || v_school)::text;
        ELSE
          v_warn := v_warn || ('Preparatoria no reconocida "' || v_school_raw || '": relaciónala antes de cargar')::text;
        END IF;
      END IF;
    END IF;

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

    -- Resolve career 2 (the official Forms has none; kept for files that still bring it)
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
    END IF;

    IF r.ord <> r.last_ord AND v_email <> '' THEN
      v_status := 'duplicate';
    ELSIF array_length(v_errors, 1) IS NOT NULL THEN
      v_status := 'error';
    ELSE
      v_status := CASE WHEN cur.id IS NULL THEN 'new' ELSE 'pending' END;
    END IF;

    IF v_school_key IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched_schools := jsonb_set(v_unmatched_schools, ARRAY[v_school_key], jsonb_build_object(
        'key', v_school_key, 'value', coalesce(v_unmatched_schools->v_school_key->>'value', v_school_raw),
        'count', coalesce((v_unmatched_schools->v_school_key->>'count')::int, 0) + 1,
        'rows', coalesce((v_unmatched_schools->v_school_key->>'count')::int, 0) + 1, 'target', v_school_target));
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
        INSERT INTO participants (edition_id, email, full_name, phone, high_school, high_school_id, high_school_grade, entry_period,
          initial_career_id, initial_career_raw, origin, import_batch_id, forms_consent, forms_consent_at, forms_consent_version,
          created_by, is_demo, extra)
        VALUES (v_ed, v_email, v_name, v_phone, v_school, v_school_id, v_grade, v_period, v_career, nullif(v_career_raw, ''), 'forms', p_batch,
          v_consent, CASE WHEN v_consent THEN coalesce(v_at, now()) END, CASE WHEN v_consent THEN v_ver END,
          auth.uid(), p_is_demo,
          CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END)
        RETURNING id INTO v_match.participant_id;

        v_career_ids := ARRAY[v_career, v_career2];
        v_career_raws := ARRAY[nullif(v_career_raw, ''), nullif(v_career2_raw, '')];
        PERFORM sync_initial_interests(v_match.participant_id, v_career_ids, v_career_raws);
      END IF;
    ELSIF v_status = 'pending' THEN
      SELECT career_id INTO v_existing_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
      SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
      v_has_c2_override := cur.manual_overrides ? 'initial_career_id_2';
      -- A file without a second career (the official Forms has none) never erases an existing one.
      IF v_career2_raw_orig = '' AND NOT (v_career_raw_orig ~ '[,;]') THEN
        v_career2 := v_existing_career2;
        v_career2_raw := (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2);
      END IF;

      v_nv := jsonb_strip_nulls(jsonb_build_object('full_name', v_name, 'phone', v_phone, 'high_school', v_school,
        'initial_career_id', v_career::text, 'high_school_grade', v_grade, 'entry_period', v_period));
      v_cv := jsonb_build_object('full_name', cur.full_name, 'phone', cur.phone, 'high_school', cur.high_school,
        'initial_career_id', cur.initial_career_id::text, 'high_school_grade', cur.high_school_grade, 'entry_period', cur.entry_period);
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

      v_status := CASE WHEN array_length(v_conf, 1) IS NOT NULL THEN 'conflict'
                       WHEN v_upd <> '{}'::jsonb OR v_extra_changed
                         OR (NOT v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2)
                       THEN 'update' ELSE 'unchanged' END;

      IF v_apply THEN
        UPDATE participants SET
          full_name = coalesce(v_upd->>'full_name', full_name),
          phone = coalesce(v_upd->>'phone', phone),
          high_school = coalesce(v_upd->>'high_school', high_school),
          high_school_id = CASE WHEN v_upd ? 'high_school' OR (high_school_id IS NULL AND NOT (cur.manual_overrides ? 'high_school'))
            THEN coalesce(v_school_id, high_school_id) ELSE high_school_id END,
          high_school_grade = coalesce(v_upd->>'high_school_grade', high_school_grade),
          entry_period = coalesce(v_upd->>'entry_period', entry_period),
          initial_career_id = CASE WHEN v_upd ? 'initial_career_id' THEN (v_upd->>'initial_career_id')::uuid ELSE initial_career_id END,
          initial_career_raw = coalesce(nullif(v_career_raw, ''), initial_career_raw),
          extra = CASE WHEN v_extra = '{}'::jsonb THEN extra
                  ELSE coalesce(extra, '{}'::jsonb) || jsonb_build_object('forms', v_old_forms || v_extra) END,
          forms_consent = coalesce(v_consent, forms_consent),
          forms_consent_at = CASE WHEN v_consent THEN coalesce(forms_consent_at, v_at, now()) ELSE forms_consent_at END,
          forms_consent_version = CASE WHEN v_consent THEN coalesce(forms_consent_version, v_ver) ELSE forms_consent_version END,
          import_batch_id = p_batch,
          updated_at = now()
        WHERE id = cur.id;

        IF NOT (cur.manual_overrides ? 'initial_career_id') THEN
          v_career_ids := ARRAY[
            CASE WHEN v_upd ? 'initial_career_id' THEN v_career ELSE coalesce(v_existing_career1, cur.initial_career_id) END,
            CASE WHEN v_has_c2_override THEN v_existing_career2 ELSE v_career2 END
          ];
          v_career_raws := ARRAY[
            coalesce(nullif(v_career_raw, ''), cur.initial_career_raw),
            CASE WHEN v_has_c2_override THEN (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2)
                 ELSE nullif(v_career2_raw, '') END
          ];
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
      'alert', NULL,
      'high_school_unresolved', v_school_key IS NOT NULL AND v_school_target IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'career_unresolved', v_ckey IS NOT NULL AND v_ctarget IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'career_2_unresolved', v_ckey2 IS NOT NULL AND v_ctarget2 IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'extra_count', (SELECT count(*) FROM jsonb_object_keys(v_extra)));
  END LOOP;

  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched_schools) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_HIGH_SCHOOLS';
  END IF;
  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_CAREERS';
  END IF;
  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched2) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_CAREERS';
  END IF;

  RETURN jsonb_build_object(
    'counts', v_counts, 'rows', v_results,
    'unmatched_high_schools', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched_schools) u),
    'unmatched_careers', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched) u),
    'unmatched_careers_2', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched2) u)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_participant_import(jsonb, boolean, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
