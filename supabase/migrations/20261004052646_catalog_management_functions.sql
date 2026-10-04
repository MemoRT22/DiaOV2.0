/*
# Catálogo editable por Coordinación

1. Funciones (solo Coordinación, todas auditadas)
- `save_division`, `save_career`, `save_activity`, `save_session`: crean o actualizan (si traen `id`).
- `delete_session`, `delete_activity`: solo si no tienen asistencias registradas.

2. Reglas
1. Los códigos de división y carrera son estables y únicos (se guardan en mayúsculas).
2. La marca de prueba se fija al crear y no cambia.
3. Las carreras no se borran, se desactivan.
*/

CREATE OR REPLACE FUNCTION save_division(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_code text := upper(btrim(coalesce(p->>'code', '')));
  v_name text := btrim(coalesce(p->>'name', ''));
BEGIN
  PERFORM require_coordinacion();
  IF v_code !~ '^[A-Z0-9_-]{2,40}$' THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 120 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF EXISTS (SELECT 1 FROM divisions WHERE code = v_code AND id IS DISTINCT FROM v_id) THEN RAISE EXCEPTION 'CODE_EXISTS'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO divisions (code, name, sort_order, is_demo)
    VALUES (v_code, v_name, coalesce((p->>'sort_order')::int, 0), coalesce((p->>'is_demo')::boolean, false)) RETURNING id INTO v_id;
  ELSE
    UPDATE divisions SET code = v_code, name = v_name, sort_order = coalesce((p->>'sort_order')::int, sort_order) WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('catalog.division_saved', jsonb_build_object('id', v_id, 'code', v_code));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION save_career(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_code text := upper(btrim(coalesce(p->>'code', '')));
  v_name text := btrim(coalesce(p->>'name', '')); v_div uuid := nullif(p->>'division_id', '')::uuid;
BEGIN
  PERFORM require_coordinacion();
  IF v_code !~ '^[A-Z0-9_-]{2,40}$' THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF NOT EXISTS (SELECT 1 FROM divisions WHERE id = v_div) THEN RAISE EXCEPTION 'INVALID_DIVISION'; END IF;
  IF EXISTS (SELECT 1 FROM careers WHERE code = v_code AND id IS DISTINCT FROM v_id) THEN RAISE EXCEPTION 'CODE_EXISTS'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO careers (code, name, division_id, is_active, is_demo)
    VALUES (v_code, v_name, v_div, coalesce((p->>'is_active')::boolean, true), coalesce((p->>'is_demo')::boolean, false))
    RETURNING id INTO v_id;
  ELSE
    UPDATE careers SET code = v_code, name = v_name, division_id = v_div,
      is_active = coalesce((p->>'is_active')::boolean, is_active) WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('catalog.career_saved', jsonb_build_object('id', v_id, 'code', v_code));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION save_activity(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_title text := btrim(coalesce(p->>'title', ''));
  v_div uuid := nullif(p->>'division_id', '')::uuid; v_ed uuid := active_edition_id();
BEGIN
  PERFORM require_coordinacion();
  IF length(v_title) < 2 OR length(v_title) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF NOT EXISTS (SELECT 1 FROM divisions WHERE id = v_div) THEN RAISE EXCEPTION 'INVALID_DIVISION'; END IF;
  IF EXISTS (SELECT 1 FROM activities WHERE edition_id = v_ed AND division_id = v_div AND lower(title) = lower(v_title)
             AND id IS DISTINCT FROM v_id) THEN RAISE EXCEPTION 'ACTIVITY_EXISTS'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (v_ed, v_div, v_title, left(coalesce(p->>'description', ''), 1000), left(coalesce(p->>'location', ''), 150),
      coalesce((p->>'is_demo')::boolean, false)) RETURNING id INTO v_id;
  ELSE
    UPDATE activities SET division_id = v_div, title = v_title, description = left(coalesce(p->>'description', ''), 1000),
      location = left(coalesce(p->>'location', ''), 150) WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('catalog.activity_saved', jsonb_build_object('id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION save_session(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_act uuid := nullif(p->>'activity_id', '')::uuid;
  v_start timestamptz := (p->>'starts_at')::timestamptz; v_end timestamptz := (p->>'ends_at')::timestamptz;
  v_cap int := (p->>'capacity')::int; v_demo boolean;
BEGIN
  PERFORM require_coordinacion();
  SELECT is_demo INTO v_demo FROM activities WHERE id = v_act AND edition_id = active_edition_id();
  IF v_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN RAISE EXCEPTION 'INVALID_TIMES'; END IF;
  IF v_cap IS NULL OR v_cap < 1 OR v_cap > 2000 THEN RAISE EXCEPTION 'INVALID_CAPACITY'; END IF;
  IF EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act AND starts_at = v_start AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'SESSION_EXISTS';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo)
    VALUES (v_act, v_start, v_end, v_cap, v_demo) RETURNING id INTO v_id;
  ELSE
    UPDATE activity_sessions SET starts_at = v_start, ends_at = v_end, capacity = v_cap WHERE id = v_id AND activity_id = v_act;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('catalog.session_saved', jsonb_build_object('id', v_id, 'activity_id', v_act));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_session(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  IF EXISTS (SELECT 1 FROM attendances WHERE session_id = p_id) THEN RAISE EXCEPTION 'HAS_ATTENDANCES'; END IF;
  DELETE FROM activity_sessions s USING activities a
  WHERE s.id = p_id AND a.id = s.activity_id AND a.edition_id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM write_audit('catalog.session_deleted', jsonb_build_object('id', p_id));
END;
$$;

CREATE OR REPLACE FUNCTION delete_activity(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  IF EXISTS (SELECT 1 FROM attendances at JOIN activity_sessions s ON s.id = at.session_id WHERE s.activity_id = p_id) THEN
    RAISE EXCEPTION 'HAS_ATTENDANCES';
  END IF;
  DELETE FROM activity_sessions WHERE activity_id = p_id;
  DELETE FROM activities WHERE id = p_id AND edition_id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM write_audit('catalog.activity_deleted', jsonb_build_object('id', p_id));
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['save_division(jsonb)', 'save_career(jsonb)', 'save_activity(jsonb)', 'save_session(jsonb)',
    'delete_session(uuid)', 'delete_activity(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
