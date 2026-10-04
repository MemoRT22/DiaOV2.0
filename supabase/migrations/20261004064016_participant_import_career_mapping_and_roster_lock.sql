/*
# Importación del padrón: mapeo de carreras y bloqueo por padrón oficial

1. Cambios
- `process_participant_import` recibe `p_career_map` (jsonb: {texto_normalizado: uuid_carrera | "none"}).
  - Carrera reconocida por código/nombre: se usa directamente.
  - Carrera no reconocida y mapeada: se usa la carrera oficial activa elegida por Coordinación.
  - Marcada "none": se carga sin carrera inicial (decisión explícita).
  - Sin mapear: la fila muestra advertencia y la carga (commit) se rechaza con UNRESOLVED_CAREERS.
  - Se guarda el texto original en `participants.initial_career_raw`.
  - Devuelve `unmatched_careers` [{key, value, count, target}] para la vista previa.
- Con el padrón oficial (`editions.roster_status = 'oficial'`) la vista previa y la carga se rechazan con ROSTER_OFFICIAL.
- `commit_participant_import` audita los mapeos aplicados (`participants.career_mapped`).

2. Seguridad
- Se reemplazan las firmas antiguas; preview/commit solo para authenticated (validan Coordinación).
- `process_participant_import` sigue sin permisos para roles del API.
*/

DROP FUNCTION IF EXISTS preview_participant_import(jsonb, boolean);
DROP FUNCTION IF EXISTS commit_participant_import(jsonb, text, boolean);
DROP FUNCTION IF EXISTS process_participant_import(jsonb, boolean, uuid);

CREATE OR REPLACE FUNCTION process_participant_import(p_rows jsonb, p_is_demo boolean, p_batch uuid, p_career_map jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
v_ed uuid := active_edition_id();
v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
v_apply boolean := p_batch IS NOT NULL;
v_map jsonb := CASE WHEN jsonb_typeof(p_career_map) = 'object' THEN p_career_map ELSE '{}'::jsonb END;
r record; cur participants%ROWTYPE; v_match record;
v_results jsonb := '[]'::jsonb;
v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
v_email text; v_name text; v_birth date; v_phone text; v_school text; v_career uuid; v_career_raw text; v_at timestamptz;
v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
v_extra jsonb; v_old_forms jsonb; v_extra_changed boolean; v_alias text; v_alert text;
v_ckey text; v_ctarget text; v_unmatched jsonb := '{}'::jsonb; v_cname text;
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
v_extra_changed := false; v_ckey := NULL; v_ctarget := NULL;
v_email := lower(btrim(coalesce(r.j->>'email', '')));
v_name := left(btrim(coalesce(r.j->>'full_name', '')), 150);
v_school := nullif(left(btrim(coalesce(r.j->>'high_school', '')), 200), '');
v_birth := NULL; v_phone := NULL; v_career := NULL; v_at := NULL;
v_career_raw := left(btrim(regexp_replace(coalesce(r.j->>'career', ''), '\s+', ' ', 'g')), 200);
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

IF v_status = 'new' THEN
IF v_apply THEN
INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, initial_career_raw, origin,
import_batch_id, forms_consent, forms_consent_at, forms_consent_version, created_by, is_demo, extra)
VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, nullif(v_career_raw, ''), 'forms', p_batch, true,
coalesce(v_at, now()), v_ver, auth.uid(), p_is_demo,
CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END);
END IF;
ELSIF v_status = 'pending' THEN
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
initial_career_raw = coalesce(nullif(v_career_raw, ''), initial_career_raw),
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
'career_unresolved', v_ckey IS NOT NULL AND v_ctarget IS NULL AND v_status NOT IN ('duplicate', 'error'),
'extra_count', (SELECT count(*) FROM jsonb_object_keys(v_extra)));
END LOOP;

IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched) u WHERE u.value->>'target' IS NULL) THEN
RAISE EXCEPTION 'UNRESOLVED_CAREERS';
END IF;

RETURN jsonb_build_object('counts', v_counts, 'rows', v_results,
'unmatched_careers', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched) u));
END;
$$;

CREATE OR REPLACE FUNCTION preview_participant_import(p_rows jsonb, p_is_demo boolean DEFAULT false, p_career_map jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
PERFORM require_coordinacion();
RETURN process_participant_import(p_rows, coalesce(p_is_demo, false), NULL, p_career_map);
END;
$$;

CREATE OR REPLACE FUNCTION commit_participant_import(p_rows jsonb, p_file_name text, p_is_demo boolean DEFAULT false, p_career_map jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_res jsonb; v_mapped jsonb;
BEGIN
PERFORM require_coordinacion();
INSERT INTO import_batches (edition_id, kind, file_name, is_demo, created_by)
VALUES (active_edition_id(), 'participants', left(coalesce(p_file_name, ''), 200), coalesce(p_is_demo, false), auth.uid())
RETURNING id INTO v_batch;
v_res := process_participant_import(p_rows, coalesce(p_is_demo, false), v_batch, p_career_map);
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

REVOKE ALL ON FUNCTION process_participant_import(jsonb, boolean, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION preview_participant_import(jsonb, boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION commit_participant_import(jsonb, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_participant_import(jsonb, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION commit_participant_import(jsonb, text, boolean, jsonb) TO authenticated;
