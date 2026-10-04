/*
# Ubicación y estado administrativo por sesión

1. Cambios en `activity_sessions`
- `location` (text): ubicación propia de cada horario. Se rellena con la ubicación de su actividad para los existentes.
- `status` (text): estado administrativo explícito: `activa`, `oculta` o `cancelada` (por defecto `activa`).
  No se guardan estados calculables (llena, en curso, finalizada, disponible): se derivarán de cupo, hora y reservas.

2. Seguridad
- Lectura pública solo de sesiones `activa`. Staff y Coordinación (activos) leen todas.

3. Funciones
- `save_session`: acepta `location` y `status`; si la ubicación viene vacía se usa la de la actividad.
- `process_catalog_import` (talleres): la ubicación y el estado son por horario; la ubicación de la actividad
  solo se fija al crearla. Estado vacío = se conserva (o `activa` si es nuevo); "publicada" equivale a `activa`.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_sessions' AND column_name = 'location') THEN
    ALTER TABLE activity_sessions ADD COLUMN location text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_sessions' AND column_name = 'status') THEN
    ALTER TABLE activity_sessions ADD COLUMN status text NOT NULL DEFAULT 'activa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_sessions_status_check') THEN
    ALTER TABLE activity_sessions ADD CONSTRAINT activity_sessions_status_check CHECK (status IN ('activa', 'oculta', 'cancelada'));
  END IF;
END $$;

UPDATE activity_sessions s SET location = a.location
FROM activities a WHERE a.id = s.activity_id AND s.location = '' AND coalesce(a.location, '') <> '';

DROP POLICY IF EXISTS "Public can read sessions" ON activity_sessions;
DROP POLICY IF EXISTS "Public can read active sessions" ON activity_sessions;
CREATE POLICY "Public can read active sessions" ON activity_sessions FOR SELECT
  TO anon, authenticated USING (status = 'activa');
DROP POLICY IF EXISTS "Operativos read all sessions" ON activity_sessions;
CREATE POLICY "Operativos read all sessions" ON activity_sessions FOR SELECT
  TO authenticated USING (is_operativo());

CREATE OR REPLACE FUNCTION session_status_from_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE fold_text(p)
    WHEN 'activa' THEN 'activa' WHEN 'activo' THEN 'activa' WHEN 'publicada' THEN 'activa' WHEN 'publicado' THEN 'activa'
    WHEN 'oculta' THEN 'oculta' WHEN 'oculto' THEN 'oculta'
    WHEN 'cancelada' THEN 'cancelada' WHEN 'cancelado' THEN 'cancelada'
    ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION save_session(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_act uuid := nullif(p->>'activity_id', '')::uuid;
  v_start timestamptz := (p->>'starts_at')::timestamptz; v_end timestamptz := (p->>'ends_at')::timestamptz;
  v_cap int := (p->>'capacity')::int; v_demo boolean; v_act_loc text;
  v_loc text := left(btrim(coalesce(p->>'location', '')), 150);
  v_status text := coalesce(session_status_from_text(coalesce(p->>'status', 'activa')), 'invalid');
BEGIN
  PERFORM require_coordinacion();
  SELECT is_demo, location INTO v_demo, v_act_loc FROM activities WHERE id = v_act AND edition_id = active_edition_id();
  IF v_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN RAISE EXCEPTION 'INVALID_TIMES'; END IF;
  IF v_cap IS NULL OR v_cap < 1 OR v_cap > 2000 THEN RAISE EXCEPTION 'INVALID_CAPACITY'; END IF;
  IF v_status = 'invalid' THEN RAISE EXCEPTION 'INVALID_SESSION_STATUS'; END IF;
  IF v_loc = '' THEN v_loc := coalesce(v_act_loc, ''); END IF;
  IF EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act AND starts_at = v_start AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'SESSION_EXISTS';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo)
    VALUES (v_act, v_start, v_end, v_cap, v_loc, v_status, v_demo) RETURNING id INTO v_id;
  ELSE
    UPDATE activity_sessions SET starts_at = v_start, ends_at = v_end, capacity = v_cap, location = v_loc, status = v_status
    WHERE id = v_id AND activity_id = v_act;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('catalog.session_saved', jsonb_build_object('id', v_id, 'activity_id', v_act, 'status', v_status));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION process_catalog_import(p_kind text, p_rows jsonb, p_is_demo boolean, p_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed editions%ROWTYPE; v_apply boolean := p_batch IS NOT NULL; r record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'error',0);
  v_errors text[]; v_status text; v_div uuid; v_div_raw text; v_code text; v_name text; v_active boolean;
  v_car careers%ROWTYPE; v_act activities%ROWTYPE; v_ses activity_sessions%ROWTYPE;
  v_start timestamptz; v_end timestamptz; v_cap int; v_desc text; v_loc text; v_act_id uuid;
  v_sstatus_raw text; v_sstatus text;
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
      v_sstatus_raw := btrim(coalesce(r.j->>'status', ''));
      v_sstatus := CASE WHEN v_sstatus_raw = '' THEN NULL ELSE session_status_from_text(v_sstatus_raw) END;
      v_start := NULL; v_end := NULL; v_cap := NULL;
      IF length(v_name) < 2 THEN v_errors := v_errors || 'Falta el nombre del taller'::text; END IF;
      IF v_sstatus_raw <> '' AND v_sstatus IS NULL THEN v_errors := v_errors || 'Estado inválido (usa activa, oculta o cancelada)'::text; END IF;
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
        IF v_loc = '' THEN v_loc := coalesce(nullif(v_ses.location, ''), v_act.location, ''); END IF;
        v_sstatus := coalesce(v_sstatus, v_ses.status, 'activa');
        v_status := CASE
          WHEN v_act.id IS NULL OR v_ses.id IS NULL THEN 'new'
          WHEN (v_desc = '' OR v_act.description = v_desc) AND v_ses.location = v_loc AND v_ses.status = v_sstatus
            AND v_ses.ends_at = v_end AND v_ses.capacity = v_cap THEN 'unchanged'
          ELSE 'update' END;
        IF v_apply THEN
          IF v_act.id IS NULL THEN
            INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
            VALUES (v_ed.id, v_div, left(v_name, 150), v_desc, v_loc, p_is_demo) RETURNING id INTO v_act_id;
          ELSE
            v_act_id := v_act.id;
            IF v_desc <> '' THEN UPDATE activities SET description = v_desc WHERE id = v_act_id; END IF;
          END IF;
          INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo)
          VALUES (v_act_id, v_start, v_end, v_cap, v_loc, v_sstatus, p_is_demo)
          ON CONFLICT (activity_id, starts_at) DO UPDATE SET ends_at = EXCLUDED.ends_at, capacity = EXCLUDED.capacity,
            location = EXCLUDED.location, status = EXCLUDED.status;
        END IF;
      END IF;
    END IF;

    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb((v_counts->>v_status)::int + 1));
    v_results := v_results || jsonb_build_object('row', coalesce((r.j->>'row')::int, r.ord),
      'label', coalesce(nullif(v_name, ''), '(sin nombre)') || CASE WHEN p_kind = 'workshops' THEN ' · ' || coalesce(r.j->>'start', '')
        || CASE WHEN coalesce(v_loc, '') <> '' THEN ' · ' || v_loc ELSE '' END ELSE '' END,
      'status', v_status, 'errors', to_jsonb(v_errors), 'warnings', '[]'::jsonb);
  END LOOP;
  RETURN jsonb_build_object('counts', v_counts, 'rows', v_results);
END;
$$;

REVOKE EXECUTE ON FUNCTION process_catalog_import(text, jsonb, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION session_status_from_text(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION save_session(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_session(jsonb) TO authenticated;
