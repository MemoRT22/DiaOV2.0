/*
# Importación de participantes (CSV de Forms) y conflictos

1. Funciones (solo Coordinación)
- `preview_participant_import(rows, is_demo)`: revisa en el servidor cada fila sin guardar nada.
- `commit_participant_import(rows, file_name, is_demo)`: vuelve a revisar y aplica todo en una sola operación
  (si algo falla, no se guarda nada). Devuelve el resumen y registra el lote.
- `list_import_conflicts()` y `resolve_import_conflict(id, accept)`: Coordinación decide entre el dato importado y la corrección manual.

2. Reglas
1. Correo inválido, nombre vacío, sin consentimiento o fecha inválida: la fila se omite con error.
2. Correo repetido en el archivo: se usa la última aparición; las anteriores se omiten.
3. Teléfono inválido o carrera desconocida: se importa sin ese dato y con aviso.
4. Un dato vacío en el archivo nunca borra un dato existente.
5. Si el campo fue corregido a mano y el archivo trae otro valor, se crea un conflicto pendiente en lugar de pisarlo.
6. No se mezclan registros de prueba con reales.
*/

CREATE OR REPLACE FUNCTION fold_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(btrim(regexp_replace(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION process_participant_import(p_rows jsonb, p_is_demo boolean, p_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  v_apply boolean := p_batch IS NOT NULL;
  r record; cur participants%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
  v_email text; v_name text; v_birth date; v_phone text; v_school text; v_career uuid; v_career_raw text; v_at timestamptz;
  v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN
    SELECT x.value AS j, x.ord,
      max(x.ord) OVER (PARTITION BY lower(btrim(coalesce(x.value->>'email', '')))) AS last_ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord
  LOOP
    v_errors := '{}'; v_warn := '{}'; v_conf := '{}'; v_upd := '{}'::jsonb;
    v_email := lower(btrim(coalesce(r.j->>'email', '')));
    v_name := left(btrim(coalesce(r.j->>'full_name', '')), 150);
    v_school := nullif(left(btrim(coalesce(r.j->>'high_school', '')), 200), '');
    v_birth := NULL; v_phone := NULL; v_career := NULL; v_at := NULL;
    v_career_raw := btrim(coalesce(r.j->>'career', ''));

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
      SELECT * INTO cur FROM participants WHERE edition_id = v_ed AND email = v_email;
      IF cur.id IS NOT NULL AND cur.is_demo <> p_is_demo THEN
        v_errors := v_errors || (CASE WHEN cur.is_demo THEN 'Ya existe como registro de prueba' ELSE 'Ya existe como registro real' END)::text;
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
          import_batch_id, forms_consent, forms_consent_at, forms_consent_version, created_by, is_demo)
        VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, 'forms', p_batch, true,
          coalesce(v_at, now()), v_ver, auth.uid(), p_is_demo);
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
      v_status := CASE WHEN array_length(v_conf, 1) IS NOT NULL THEN 'conflict' WHEN v_upd <> '{}'::jsonb THEN 'update' ELSE 'unchanged' END;
      IF v_apply THEN
        UPDATE participants SET
          full_name = coalesce(v_upd->>'full_name', full_name),
          birth_date = CASE WHEN v_upd ? 'birth_date' THEN (v_upd->>'birth_date')::date ELSE birth_date END,
          phone = coalesce(v_upd->>'phone', phone),
          high_school = coalesce(v_upd->>'high_school', high_school),
          initial_career_id = CASE WHEN v_upd ? 'initial_career_id' THEN (v_upd->>'initial_career_id')::uuid ELSE initial_career_id END,
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
      'updated_fields', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_upd) k),
      'conflict_fields', to_jsonb(v_conf));
  END LOOP;

  RETURN jsonb_build_object('counts', v_counts, 'rows', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION preview_participant_import(p_rows jsonb, p_is_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN process_participant_import(p_rows, coalesce(p_is_demo, false), NULL);
END;
$$;

CREATE OR REPLACE FUNCTION commit_participant_import(p_rows jsonb, p_file_name text, p_is_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_res jsonb;
BEGIN
  PERFORM require_coordinacion();
  INSERT INTO import_batches (edition_id, kind, file_name, is_demo, created_by)
  VALUES (active_edition_id(), 'participants', left(coalesce(p_file_name, ''), 200), coalesce(p_is_demo, false), auth.uid())
  RETURNING id INTO v_batch;
  v_res := process_participant_import(p_rows, coalesce(p_is_demo, false), v_batch);
  UPDATE import_batches SET counts = v_res->'counts' WHERE id = v_batch;
  PERFORM write_audit('participants.imported', jsonb_build_object('batch_id', v_batch, 'counts', v_res->'counts',
    'file_name', left(coalesce(p_file_name, ''), 200), 'is_demo', coalesce(p_is_demo, false)));
  RETURN v_res || jsonb_build_object('batch_id', v_batch);
END;
$$;

CREATE OR REPLACE FUNCTION list_import_conflicts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN coalesce((SELECT jsonb_agg(row_to_json(x) ORDER BY x.created_at) FROM (
    SELECT c.id, c.participant_id, c.field, c.created_at, p.full_name, p.email,
      CASE c.field WHEN 'initial_career_id' THEN (SELECT name FROM careers WHERE id::text = c.imported_value) ELSE c.imported_value END AS imported_value,
      CASE c.field
        WHEN 'full_name' THEN p.full_name WHEN 'birth_date' THEN p.birth_date::text WHEN 'phone' THEN p.phone
        WHEN 'high_school' THEN p.high_school ELSE (SELECT name FROM careers WHERE id = p.initial_career_id) END AS current_value,
      (SELECT full_name FROM staff_members WHERE user_id::text = p.manual_overrides->c.field->>'by') AS corrected_by,
      p.manual_overrides->c.field->>'at' AS corrected_at
    FROM participant_import_conflicts c JOIN participants p ON p.id = c.participant_id
    WHERE c.status = 'pending' AND p.edition_id = active_edition_id()
  ) x), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION resolve_import_conflict(p_id uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c participant_import_conflicts%ROWTYPE;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO c FROM participant_import_conflicts WHERE id = p_id AND status = 'pending' FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_accept THEN
    UPDATE participants SET
      full_name = CASE WHEN c.field = 'full_name' THEN c.imported_value ELSE full_name END,
      birth_date = CASE WHEN c.field = 'birth_date' THEN c.imported_value::date ELSE birth_date END,
      phone = CASE WHEN c.field = 'phone' THEN c.imported_value ELSE phone END,
      high_school = CASE WHEN c.field = 'high_school' THEN c.imported_value ELSE high_school END,
      initial_career_id = CASE WHEN c.field = 'initial_career_id' THEN c.imported_value::uuid ELSE initial_career_id END,
      manual_overrides = manual_overrides - c.field,
      updated_at = now()
    WHERE id = c.participant_id;
  END IF;
  UPDATE participant_import_conflicts SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'kept' END,
    resolved_by = auth.uid(), resolved_at = now() WHERE id = c.id;
  PERFORM write_audit('participants.conflict_resolved', jsonb_build_object('participant_id', c.participant_id,
    'field', c.field, 'accepted_import', p_accept));
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['preview_participant_import(jsonb, boolean)', 'commit_participant_import(jsonb, text, boolean)',
    'list_import_conflicts()', 'resolve_import_conflict(uuid, boolean)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE EXECUTE ON FUNCTION process_participant_import(jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION fold_text(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION access_lock_state(text) TO service_role;
  GRANT EXECUTE ON FUNCTION email_hash(text) TO service_role;
END $$;
