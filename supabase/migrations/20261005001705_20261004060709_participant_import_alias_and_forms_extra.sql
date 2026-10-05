CREATE OR REPLACE FUNCTION normalize_forms_extra(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  e record; v_out jsonb := '{}'::jsonb; v_label text; v_base_label text; v_base_key text; v_key text;
  v_n int; v_count int := 0; v_val text; v_pos int;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN RETURN '{}'::jsonb; END IF;
  FOR e IN SELECT x.value AS j, x.ord FROM jsonb_array_elements(p) WITH ORDINALITY AS x(value, ord)
           ORDER BY CASE WHEN (x.value->>'col') ~ '^\d{1,4}$' THEN (x.value->>'col')::int ELSE 10000 + x.ord::int END
  LOOP
    EXIT WHEN v_count >= 60;
    CONTINUE WHEN jsonb_typeof(e.j) <> 'object';
    v_count := v_count + 1;
    v_pos := CASE WHEN (e.j->>'col') ~ '^\d{1,4}$' THEN (e.j->>'col')::int ELSE 10000 + e.ord::int END;
    v_label := btrim(regexp_replace(regexp_replace(coalesce(e.j->>'header', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
    IF v_label = '' THEN v_label := 'Columna sin título ' || v_pos; END IF;
    IF length(v_label) > 80 THEN
      v_label := coalesce(nullif(regexp_replace(left(v_label, 80), '\s+\S*$', ''), ''), left(v_label, 80)) || '…';
    END IF;
    v_base_label := v_label;
    v_base_key := fold_text(v_label);
    v_key := v_base_key; v_n := 1;
    WHILE v_out ? v_key LOOP
      v_n := v_n + 1;
      v_key := v_base_key || ' (' || v_n || ')';
      v_label := v_base_label || ' (' || v_n || ')';
    END LOOP;
    v_val := left(btrim(regexp_replace(coalesce(e.j->>'value', ''), '[[:cntrl:]&&[^\n]]', '', 'g')), 1000);
    v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('label', v_label, 'value', v_val, 'pos', v_pos));
  END LOOP;
  RETURN (SELECT coalesce(jsonb_object_agg(k, val), '{}'::jsonb) FROM jsonb_each(v_out) AS t(k, val) WHERE val->>'value' <> '');
END;
$$;

CREATE OR REPLACE FUNCTION process_participant_import(p_rows jsonb, p_is_demo boolean, p_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  v_apply boolean := p_batch IS NOT NULL;
  r record; cur participants%ROWTYPE; v_match record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
  v_email text; v_name text; v_birth date; v_phone text; v_school text; v_career uuid; v_career_raw text; v_at timestamptz;
  v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
  v_extra jsonb; v_old_forms jsonb; v_extra_changed boolean; v_alias text; v_alert text;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN
    SELECT x.value AS j, x.ord,
      max(x.ord) OVER (PARTITION BY lower(btrim(coalesce(x.value->>'email', '')))) AS last_ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord
  LOOP
    v_errors := '{}'; v_warn := '{}'; v_conf := '{}'; v_upd := '{}'::jsonb; v_alias := NULL; v_alert := NULL;
    v_extra_changed := false;
    v_email := lower(btrim(coalesce(r.j->>'email', '')));
    v_name := left(btrim(coalesce(r.j->>'full_name', '')), 150);
    v_school := nullif(left(btrim(coalesce(r.j->>'high_school', '')), 200), '');
    v_birth := NULL; v_phone := NULL; v_career := NULL; v_at := NULL;
    v_career_raw := btrim(coalesce(r.j->>'career', ''));
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
    IF v_career_raw <> '' THEN
      SELECT id INTO v_career FROM careers
      WHERE upper(code) = upper(v_career_raw) OR fold_text(name) = fold_text(v_career_raw)
      ORDER BY (upper(code) = upper(v_career_raw)) DESC LIMIT 1;
      IF v_career IS NULL THEN v_warn := v_warn || 'Carrera no encontrada en el catálogo'::text; END IF;
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
    ELSIF cur.id IS NULL THEN
      v_status := 'new';
      IF v_apply THEN
        INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, origin,
          import_batch_id, forms_consent, forms_consent_at, forms_consent_version, created_by, is_demo, extra)
        VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, 'forms', p_batch, true,
          coalesce(v_at, now()), v_ver, auth.uid(), p_is_demo,
          CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END);
      END IF;
    ELSE
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
      IF v_apply THEN
        UPDATE participants SET
          full_name = coalesce(v_upd->>'full_name', full_name),
          birth_date = CASE WHEN v_upd ? 'birth_date' THEN (v_upd->>'birth_date')::date ELSE birth_date END,
          phone = coalesce(v_upd->>'phone', phone),
          high_school = coalesce(v_upd->>'high_school', high_school),
          initial_career_id = CASE WHEN v_upd ? 'initial_career_id' THEN (v_upd->>'initial_career_id')::uuid ELSE initial_career_id END,
          extra = CASE WHEN v_extra = '{}'::jsonb THEN extra
            ELSE coalesce(extra, '{}'::jsonb) || jsonb_build_object('forms', v_old_forms || v_extra) END,
          forms_consent = true,
          forms_consent_at = coalesce(forms_consent_at, v_at, now()),
          forms_consent_version = coalesce(forms_consent_version, v_ver),
          import_batch_id = p_batch,
          updated_at = now()
        WHERE id = cur.id;
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
      'extra_count', (SELECT count(*) FROM jsonb_object_keys(v_extra)));
  END LOOP;

  RETURN jsonb_build_object('counts', v_counts, 'rows', v_results);
END;
$$;

REVOKE EXECUTE ON FUNCTION process_participant_import(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION normalize_forms_extra(jsonb) FROM PUBLIC, anon, authenticated;