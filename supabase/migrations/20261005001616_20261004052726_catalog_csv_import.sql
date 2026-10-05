CREATE OR REPLACE FUNCTION process_catalog_import(p_kind text, p_rows jsonb, p_is_demo boolean, p_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed editions%ROWTYPE; v_apply boolean := p_batch IS NOT NULL; r record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'error',0);
  v_errors text[]; v_status text; v_div uuid; v_div_raw text; v_code text; v_name text; v_active boolean;
  v_car careers%ROWTYPE; v_act activities%ROWTYPE; v_ses activity_sessions%ROWTYPE;
  v_start timestamptz; v_end timestamptz; v_cap int; v_desc text; v_loc text; v_act_id uuid;
BEGIN
  SELECT * INTO v_ed FROM editions WHERE id = active_edition_id();
  IF p_kind NOT IN ('careers', 'workshops') OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 2000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN SELECT x.value AS j, x.ord FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) LOOP
    v_errors := '{}'; v_status := NULL; v_div := NULL;
    v_div_raw := btrim(coalesce(r.j->>'division', ''));
    SELECT id INTO v_div FROM divisions WHERE upper(code) = upper(v_div_raw) OR fold_text(name) = fold_text(v_div_raw) LIMIT 1;
    IF v_div IS NULL THEN v_errors := v_errors || 'División no encontrada'::text; END IF;

    IF p_kind = 'careers' THEN
      v_code := upper(btrim(coalesce(r.j->>'code', '')));
      v_name := btrim(coalesce(r.j->>'name', ''));
      v_active := coalesce((r.j->>'active')::boolean, true);
      IF v_code !~ '^[A-Z0-9_-]{2,40}$' THEN v_errors := v_errors || 'Código inválido'::text; END IF;
      IF length(v_name) < 2 THEN v_errors := v_errors || 'Falta el nombre'::text; END IF;
      SELECT * INTO v_car FROM careers WHERE code = v_code;
      IF v_car.id IS NOT NULL AND v_car.is_demo <> p_is_demo THEN v_errors := v_errors || 'Mezcla prueba y real'::text; END IF;
      IF array_length(v_errors, 1) IS NOT NULL THEN v_status := 'error';
      ELSIF v_car.id IS NULL THEN v_status := 'new';
        IF v_apply THEN INSERT INTO careers (code, name, division_id, is_active, is_demo) VALUES (v_code, left(v_name, 150), v_div, v_active, p_is_demo); END IF;
      ELSIF v_car.name = v_name AND v_car.division_id = v_div AND v_car.is_active = v_active THEN v_status := 'unchanged';
      ELSE v_status := 'update';
        IF v_apply THEN UPDATE careers SET name = left(v_name, 150), division_id = v_div, is_active = v_active WHERE id = v_car.id; END IF;
      END IF;
    ELSE
      v_name := btrim(coalesce(r.j->>'title', ''));
      v_desc := left(btrim(coalesce(r.j->>'description', '')), 1000);
      v_loc := left(btrim(coalesce(r.j->>'location', '')), 150);
      v_start := NULL; v_end := NULL; v_cap := NULL;
      IF length(v_name) < 2 THEN v_errors := v_errors || 'Falta el nombre del taller'::text; END IF;
      BEGIN
        v_start := ((v_ed.event_date + (r.j->>'start')::time) AT TIME ZONE v_ed.timezone);
        v_end := ((v_ed.event_date + (r.j->>'end')::time) AT TIME ZONE v_ed.timezone);
      EXCEPTION WHEN others THEN v_start := NULL; END;
      IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN v_errors := v_errors || 'Horario inválido'::text; END IF;
      BEGIN v_cap := (r.j->>'capacity')::int; EXCEPTION WHEN others THEN v_cap := NULL; END;
      IF v_cap IS NULL OR v_cap < 1 OR v_cap > 2000 THEN v_errors := v_errors || 'Cupo inválido'::text; END IF;

      v_act := NULL; v_ses := NULL;
      IF array_length(v_errors, 1) IS NULL THEN
        SELECT * INTO v_act FROM activities WHERE edition_id = v_ed.id AND division_id = v_div AND lower(title) = lower(v_name);
        IF v_act.id IS NOT NULL AND v_act.is_demo <> p_is_demo THEN v_errors := v_errors || 'Mezcla prueba y real'::text; END IF;
        IF v_act.id IS NOT NULL THEN SELECT * INTO v_ses FROM activity_sessions WHERE activity_id = v_act.id AND starts_at = v_start; END IF;
      END IF;

      IF array_length(v_errors, 1) IS NOT NULL THEN v_status := 'error';
      ELSE
        v_status := CASE
          WHEN v_act.id IS NULL OR v_ses.id IS NULL THEN 'new'
          WHEN v_act.description = v_desc AND v_act.location = v_loc AND v_ses.ends_at = v_end AND v_ses.capacity = v_cap THEN 'unchanged'
          ELSE 'update' END;
        IF v_apply THEN
          IF v_act.id IS NULL THEN
            INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
            VALUES (v_ed.id, v_div, left(v_name, 150), v_desc, v_loc, p_is_demo) RETURNING id INTO v_act_id;
          ELSE
            v_act_id := v_act.id;
            UPDATE activities SET description = CASE WHEN v_desc <> '' THEN v_desc ELSE description END,
              location = CASE WHEN v_loc <> '' THEN v_loc ELSE location END WHERE id = v_act_id;
          END IF;
          INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo)
          VALUES (v_act_id, v_start, v_end, v_cap, p_is_demo)
          ON CONFLICT (activity_id, starts_at) DO UPDATE SET ends_at = EXCLUDED.ends_at, capacity = EXCLUDED.capacity;
        END IF;
      END IF;
    END IF;

    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb((v_counts->>v_status)::int + 1));
    v_results := v_results || jsonb_build_object('row', coalesce((r.j->>'row')::int, r.ord),
      'label', coalesce(nullif(v_name, ''), '(sin nombre)') || CASE WHEN p_kind = 'workshops' THEN ' · ' || coalesce(r.j->>'start', '') ELSE '' END,
      'status', v_status, 'errors', to_jsonb(v_errors), 'warnings', '[]'::jsonb);
  END LOOP;
  RETURN jsonb_build_object('counts', v_counts, 'rows', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION preview_catalog_import(p_kind text, p_rows jsonb, p_is_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN process_catalog_import(p_kind, p_rows, coalesce(p_is_demo, false), NULL);
END;
$$;

CREATE OR REPLACE FUNCTION commit_catalog_import(p_kind text, p_rows jsonb, p_file_name text, p_is_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_res jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF p_kind NOT IN ('careers', 'workshops') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO import_batches (edition_id, kind, file_name, is_demo, created_by)
  VALUES (active_edition_id(), p_kind, left(coalesce(p_file_name, ''), 200), coalesce(p_is_demo, false), auth.uid())
  RETURNING id INTO v_batch;
  v_res := process_catalog_import(p_kind, p_rows, coalesce(p_is_demo, false), v_batch);
  UPDATE import_batches SET counts = v_res->'counts' WHERE id = v_batch;
  PERFORM write_audit('catalog.imported', jsonb_build_object('kind', p_kind, 'batch_id', v_batch, 'counts', v_res->'counts',
    'file_name', left(coalesce(p_file_name, ''), 200)));
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION process_catalog_import(text, jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preview_catalog_import(text, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION commit_catalog_import(text, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_catalog_import(text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION commit_catalog_import(text, jsonb, text, boolean) TO authenticated;