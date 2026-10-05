/*
# Fase 8A — Importación del padrón: soporte para segunda carrera de interés

## Cambios
- `process_participant_import` ahora acepta `p_career_map_2` (jsonb) para mapear
  la segunda carrera no reconocida.
- El CSV puede traer una columna `career_2` explícita, o si la columna `career`
  contiene dos valores separados por coma/punto y coma, se dividen.
- Resolución de la segunda carrera con el mismo flujo que la primera:
  - Match directo por código o nombre
  - Fallback a p_career_map_2 (mapeo manual de Coordinación)
  - Detección de no reconocidas
  - Segunda vacía es válida (una sola carrera es suficiente)
- Al insertar/actualizar, se llama a `sync_initial_interests` para guardar ambas
  carreras en `initial_interests` con prioridad 1 y 2.
- `participants.initial_career_id` se sincroniza con preference 1.
- Se devuelve `unmatched_careers_2` para la vista previa de la segunda carrera.

## Funciones afectadas
- `process_participant_import` — nueva firma con parámetro adicional `p_career_map_2`
- `preview_participant_import` — pasa `p_career_map_2`
- `commit_participant_import` — pasa `p_career_map_2`

## Seguridad
- Sin cambios en grants: preview/commit solo para authenticated (validan Coordinación).
- process_participant_import sigue sin permisos para roles del API.
*/

DROP FUNCTION IF EXISTS process_participant_import(jsonb, boolean, uuid, jsonb);
DROP FUNCTION IF EXISTS preview_participant_import(jsonb, boolean, jsonb);
DROP FUNCTION IF EXISTS commit_participant_import(jsonb, text, boolean, jsonb);

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
  v_existing_career2 uuid;
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

    -- Parse career 1: from 'career' field. If it contains a separator, split into career + career_2
    v_career_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career', ''), '\s+', ' ', 'g')), 200);
    v_career2_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career_2', ''), '\s+', ' ', 'g')), 200);

    -- If career_2 column is present, use it. Otherwise, try splitting career by comma/semicolon
    IF v_career2_raw_orig <> '' THEN
      v_career_raw := v_career_raw_orig;
      v_career2_raw := v_career2_raw_orig;
    ELSIF v_career_raw_orig ~ '[,;]' THEN
      v_career_raw := left(btrim(split_part(v_career_raw_orig, ',', 1)), 200);
      v_career2_raw := left(btrim(split_part(v_career_raw_orig, ',', 2)), 200);
      -- Also try semicolon
      IF v_career2_raw = '' AND v_career_raw_orig ~ ';' THEN
        v_career_raw := left(btrim(split_part(v_career_raw_orig, ';', 1)), 200);
        v_career2_raw := left(btrim(split_part(v_career_raw_orig, ';', 2)), 200);
      END IF;
      -- Clean up the first part in case it also had the separator
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

    -- Resolve career 2 (same logic, different map)
    IF v_career2_raw <> '' THEN
      -- Don't resolve career 2 if it's the same text as career 1 (avoid duplicate)
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
        -- If career 2 resolved to same career as career 1, drop it
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
        'key', v_ckey,
        'value', coalesce(v_unmatched->v_ckey->>'value', v_career_raw),
        'count', coalesce((v_unmatched->v_ckey->>'count')::int, 0) + 1,
        'target', v_ctarget));
    END IF;

    IF v_ckey2 IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched2 := jsonb_set(v_unmatched2, ARRAY[v_ckey2], jsonb_build_object(
        'key', v_ckey2,
        'value', coalesce(v_unmatched2->v_ckey2->>'value', v_career2_raw),
        'count', coalesce((v_unmatched2->v_ckey2->>'count')::int, 0) + 1,
        'target', v_ctarget2));
    END IF;

    IF v_status = 'new' THEN
      IF v_apply THEN
        INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, initial_career_raw, origin,
          import_batch_id, forms_consent, forms_consent_at, forms_consent_version, created_by, is_demo, extra)
        VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, nullif(v_career_raw, ''), 'forms', p_batch, true,
          coalesce(v_at, now()), v_ver, auth.uid(), p_is_demo,
          CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END)
        RETURNING id INTO v_match.participant_id;

        -- Sync initial_interests
        v_career_ids := ARRAY_remove(ARRAY[v_career, v_career2], NULL);
        v_career_raws := ARRAY[
          CASE WHEN v_career IS NOT NULL THEN nullif(v_career_raw, '') ELSE NULL END,
          CASE WHEN v_career2 IS NOT NULL THEN nullif(v_career2_raw, '') ELSE NULL END
        ];
        IF array_length(v_career_ids, 1) > 0 THEN
          PERFORM sync_initial_interests(v_match.participant_id, v_career_ids, v_career_raws);
        END IF;
      END IF;
    ELSIF v_status = 'pending' THEN
      -- Check if career 2 changed vs existing
      SELECT ii.career_id INTO v_existing_career2
        FROM initial_interests ii
        WHERE ii.participant_id = cur.id AND ii.preference = 2;

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
      v_old_forms := coalesce(cur.extra->'forms', '{}'::jsonb);
      v_extra_changed := EXISTS (SELECT 1 FROM jsonb_each(v_extra) e
        WHERE (v_old_forms->e.key->>'value') IS DISTINCT FROM (e.value->>'value'));
      v_status := CASE WHEN array_length(v_conf, 1) IS NOT NULL THEN 'conflict'
        WHEN v_upd <> '{}'::jsonb OR v_extra_changed THEN 'update' ELSE 'unchanged' END;

      -- Check if career 2 is different from existing
      IF v_career2 IS DISTINCT FROM v_existing_career2 THEN
        v_status := CASE WHEN v_status = 'unchanged' THEN 'update' ELSE v_status END;
      END IF;

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

        -- Sync initial_interests (only if career 1 is not protected by manual_overrides)
        IF NOT (cur.manual_overrides ? 'initial_career_id') THEN
          v_career_ids := ARRAY_remove(ARRAY[
            CASE WHEN v_upd ? 'initial_career_id' THEN v_career ELSE cur.initial_career_id END,
            v_career2
          ], NULL);
          v_career_raws := ARRAY[
            CASE WHEN v_career IS NOT NULL OR cur.initial_career_id IS NOT NULL THEN coalesce(nullif(v_career_raw, ''), cur.initial_career_raw) ELSE NULL END,
            CASE WHEN v_career2 IS NOT NULL THEN nullif(v_career2_raw, '') ELSE NULL END
          ];
          IF array_length(v_career_ids, 1) > 0 THEN
            PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
          ELSIF v_career2 IS NOT NULL THEN
            -- career 1 was nulled by import but career 2 exists — keep existing career 1
            SELECT career_id INTO v_career FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
            IF v_career IS NOT NULL THEN
              PERFORM sync_initial_interests(cur.id, ARRAY[v_career, v_career2], v_career_raws);
            END IF;
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
    'counts', v_counts,
    'rows', v_results,
    'unmatched_careers', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched) u),
    'unmatched_careers_2', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched2) u)
  );
END;
$$;

CREATE OR REPLACE FUNCTION preview_participant_import(
  p_rows jsonb,
  p_is_demo boolean DEFAULT false,
  p_career_map jsonb DEFAULT '{}'::jsonb,
  p_career_map_2 jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN process_participant_import(p_rows, coalesce(p_is_demo, false), NULL, p_career_map, p_career_map_2);
END;
$$;

CREATE OR REPLACE FUNCTION commit_participant_import(
  p_rows jsonb,
  p_file_name text,
  p_is_demo boolean DEFAULT false,
  p_career_map jsonb DEFAULT '{}'::jsonb,
  p_career_map_2 jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_res jsonb; v_mapped jsonb;
BEGIN
  PERFORM require_coordinacion();
  INSERT INTO import_batches (edition_id, kind, file_name, is_demo, created_by)
  VALUES (active_edition_id(), 'participants', left(coalesce(p_file_name, ''), 200), coalesce(p_is_demo, false), auth.uid())
  RETURNING id INTO v_batch;
  v_res := process_participant_import(p_rows, coalesce(p_is_demo, false), v_batch, p_career_map, p_career_map_2);
  UPDATE import_batches SET counts = v_res->'counts' WHERE id = v_batch;
  PERFORM write_audit('participants.imported', jsonb_build_object('batch_id', v_batch, 'counts', v_res->'counts',
    'file_name', left(coalesce(p_file_name, ''), 200), 'is_demo', coalesce(p_is_demo, false)));
  SELECT jsonb_agg(jsonb_build_object('value', u->>'value', 'rows', (u->>'count')::int,
    'career_id', CASE WHEN u->>'target' = 'none' THEN NULL ELSE u->>'target' END,
    'career', CASE WHEN u->>'target' = 'none' THEN 'Sin carrera' ELSE (SELECT name FROM careers WHERE id::text = u->>'target') END))
  INTO v_mapped FROM jsonb_array_elements(v_res->'unmatched_careers') u;
  IF v_mapped IS NOT NULL THEN
    PERFORM write_audit('participants.career_mapped', jsonb_build_object('batch_id', v_batch, 'mappings', v_mapped));
  END IF;
  RETURN v_res || jsonb_build_object('batch_id', v_batch);
END;
$$;

REVOKE ALL ON FUNCTION process_participant_import(jsonb, boolean, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION preview_participant_import(jsonb, boolean, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION commit_participant_import(jsonb, text, boolean, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_participant_import(jsonb, boolean, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION commit_participant_import(jsonb, text, boolean, jsonb, jsonb) TO authenticated;
