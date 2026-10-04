/*
# Historial de correos y protecciones manuales reales

1. Nueva tabla
- `participant_email_history`: correos anteriores de un participante (solo para reconocerlo en importaciones).
  - `participant_id`, `edition_id`, `email` (correo anterior), `changed_by`, `changed_at`, `reason` (opcional).
  - Único por edición + correo: un correo histórico pertenece a un solo participante.
  - Nunca se usa para iniciar sesión.

2. Reglas de unicidad
- Un correo no puede ser vigente para un participante e histórico para otro en la misma edición (trigger en ambas tablas).

3. Funciones modificadas
- `create_participant_manual`: solo protege los campos capturados con valor.
- `update_participant`: guarda el correo anterior en el historial (con motivo opcional `email_reason`),
  marca protección solo si el valor cambió; borrar un dato queda como decisión explícita (`cleared: true`).
- `get_participant`: incluye historial de correos; información adicional de Forms solo para Coordinación.

4. Limpieza conservadora
- Se retiran solo protecciones de altas manuales marcadas al momento del alta, con campo vacío y sin edición posterior
  auditada de ese campo. Todo lo demás se conserva.

5. Seguridad
- RLS activado sin políticas: la tabla solo se consulta mediante funciones del servidor.
*/

CREATE TABLE IF NOT EXISTS participant_email_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  edition_id uuid NOT NULL REFERENCES editions(id),
  email text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS participant_email_history_email_key ON participant_email_history (edition_id, email);
CREATE INDEX IF NOT EXISTS participant_email_history_participant_idx ON participant_email_history (participant_id);
ALTER TABLE participant_email_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION guard_participant_email_unique()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'participants' THEN
    IF EXISTS (SELECT 1 FROM participant_email_history h
               WHERE h.edition_id = NEW.edition_id AND h.email = NEW.email AND h.participant_id <> NEW.id) THEN
      RAISE EXCEPTION 'EMAIL_EXISTS';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM participants p
               WHERE p.edition_id = NEW.edition_id AND p.email = NEW.email AND p.id <> NEW.participant_id) THEN
      RAISE EXCEPTION 'EMAIL_EXISTS';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participants_email_unique_guard ON participants;
CREATE TRIGGER participants_email_unique_guard BEFORE INSERT OR UPDATE OF email ON participants
  FOR EACH ROW EXECUTE FUNCTION guard_participant_email_unique();
DROP TRIGGER IF EXISTS email_history_unique_guard ON participant_email_history;
CREATE TRIGGER email_history_unique_guard BEFORE INSERT OR UPDATE ON participant_email_history
  FOR EACH ROW EXECUTE FUNCTION guard_participant_email_unique();

CREATE OR REPLACE FUNCTION participant_by_email(p_edition uuid, p_email text, OUT participant_id uuid, OUT via_alias boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, false FROM participants WHERE edition_id = p_edition AND email = p_email
  UNION ALL
  SELECT h.participant_id, true FROM participant_email_history h
  WHERE h.edition_id = p_edition AND h.email = p_email
    AND NOT EXISTS (SELECT 1 FROM participants WHERE edition_id = p_edition AND email = p_email)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION email_in_use(p_edition uuid, p_email text, p_except uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM participants WHERE edition_id = p_edition AND email = p_email AND id IS DISTINCT FROM p_except)
      OR EXISTS (SELECT 1 FROM participant_email_history WHERE edition_id = p_edition AND email = p_email
                 AND participant_id IS DISTINCT FROM p_except);
$$;

CREATE OR REPLACE FUNCTION create_participant_manual(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := btrim(coalesce(p->>'full_name', ''));
  v_career uuid := nullif(p->>'initial_career_id', '')::uuid;
  v_birth date := check_birth_date(nullif(p->>'birth_date', '')::date);
  v_phone text := clean_phone(p->>'phone');
  v_school text := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), '');
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_ov jsonb;
  v_id uuid;
BEGIN
  PERFORM require_operativo();
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF coalesce((p->>'consent_confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF v_career IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career) THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF email_in_use(v_ed, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  v_ov := jsonb_build_object('full_name', v_now);
  IF v_birth IS NOT NULL THEN v_ov := v_ov || jsonb_build_object('birth_date', v_now); END IF;
  IF v_phone IS NOT NULL THEN v_ov := v_ov || jsonb_build_object('phone', v_now); END IF;
  IF v_school IS NOT NULL THEN v_ov := v_ov || jsonb_build_object('high_school', v_now); END IF;
  IF v_career IS NOT NULL THEN v_ov := v_ov || jsonb_build_object('initial_career_id', v_now); END IF;

  INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, origin,
    manual_consent_captured_by, manual_consent_at, manual_consent_version, created_by, is_demo, manual_overrides)
  VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, 'manual',
    auth.uid(), now(), (SELECT privacy_notice_version FROM editions WHERE id = v_ed), auth.uid(),
    coalesce((p->>'is_demo')::boolean, false), v_ov)
  RETURNING id INTO v_id;

  PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id,
    'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_ov) k)));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_participant(p_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur participants%ROWTYPE;
  n participants%ROWTYPE;
  v_fields text[] := '{}';
  v_cleared text[] := '{}';
  v_reason text := nullif(left(btrim(coalesce(p->>'email_reason', '')), 300), '');
  v_ov jsonb;
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
  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f,
      jsonb_build_object('by', auth.uid(), 'at', now()) || CASE WHEN f = ANY(v_cleared) THEN '{"cleared": true}'::jsonb ELSE '{}'::jsonb END),
    '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f;

  IF n.email IS DISTINCT FROM cur.email THEN
    INSERT INTO participant_email_history (participant_id, edition_id, email, changed_by, reason)
    VALUES (cur.id, cur.edition_id, cur.email, auth.uid(), v_reason)
    ON CONFLICT (edition_id, email) DO NOTHING;
  END IF;

  UPDATE participants SET email = n.email, full_name = n.full_name, birth_date = n.birth_date, phone = n.phone,
    high_school = n.high_school, initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  PERFORM write_audit('participant.updated', jsonb_build_object('participant_id', cur.id, 'fields', to_jsonb(v_fields),
    'cleared', to_jsonb(v_cleared), 'email_changed', n.email IS DISTINCT FROM cur.email, 'reason_given', v_reason IS NOT NULL));
END;
$$;

CREATE OR REPLACE FUNCTION get_participant(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p participants%ROWTYPE; v jsonb;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v := jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'birth_date', p.birth_date, 'phone', p.phone,
    'high_school', p.high_school, 'initial_career_id', p.initial_career_id, 'origin', p.origin, 'is_demo', p.is_demo,
    'forms_consent', p.forms_consent, 'forms_consent_at', p.forms_consent_at,
    'manual_consent_at', p.manual_consent_at,
    'manual_consent_by', (SELECT full_name FROM staff_members WHERE user_id = p.manual_consent_captured_by),
    'manual_overrides', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('at', val->>'at',
        'cleared', coalesce((val->>'cleared')::boolean, false),
        'by', (SELECT full_name FROM staff_members WHERE user_id::text = val->>'by'))), '{}'::jsonb)
      FROM jsonb_each(p.manual_overrides) AS t(k, val)),
    'email_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('email', h.email, 'changed_at', h.changed_at,
        'reason', h.reason, 'changed_by', (SELECT full_name FROM staff_members WHERE user_id = h.changed_by)) ORDER BY h.changed_at DESC), '[]'::jsonb)
      FROM participant_email_history h WHERE h.participant_id = p.id),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = p.id AND status = 'pending'),
    'has_logged_in', p.auth_user_id IS NOT NULL,
    'platform_consent_at', (SELECT platform_consent_at FROM participant_profiles WHERE participant_id = p.id),
    'attendances', (SELECT count(*) FROM attendances WHERE participant_id = p.id),
    'access', access_lock_state(p.email),
    'created_at', p.created_at, 'updated_at', p.updated_at
  );
  IF is_coordinacion() THEN
    v := v || jsonb_build_object('forms_extra', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('label', e.value->>'label', 'value', e.value->>'value')
        ORDER BY (e.value->>'pos')::int NULLS LAST, e.value->>'label'), '[]'::jsonb)
      FROM jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e));
  END IF;
  PERFORM write_audit('participant.viewed', jsonb_build_object('participant_id', p.id));
  RETURN v;
END;
$$;

DO $$
DECLARE r record; f text; v_removed int := 0;
BEGIN
  FOR r IN SELECT * FROM participants WHERE origin = 'manual' AND manual_overrides <> '{}'::jsonb LOOP
    FOREACH f IN ARRAY ARRAY['birth_date', 'phone', 'high_school', 'initial_career_id'] LOOP
      CONTINUE WHEN NOT (r.manual_overrides ? f);
      CONTINUE WHEN (r.manual_overrides->f ? 'cleared');
      CONTINUE WHEN abs(extract(epoch FROM ((r.manual_overrides->f->>'at')::timestamptz - r.created_at))) > 5;
      CONTINUE WHEN CASE f WHEN 'birth_date' THEN r.birth_date IS NOT NULL WHEN 'phone' THEN r.phone IS NOT NULL
        WHEN 'high_school' THEN r.high_school IS NOT NULL ELSE r.initial_career_id IS NOT NULL END;
      CONTINUE WHEN EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'participant.updated'
        AND a.detail->>'participant_id' = r.id::text AND a.detail->'fields' ? f);
      UPDATE participants SET manual_overrides = manual_overrides - f WHERE id = r.id;
      v_removed := v_removed + 1;
    END LOOP;
  END LOOP;
  IF v_removed > 0 THEN
    PERFORM set_config('request.jwt.claims', '{}', true);
    INSERT INTO audit_log (edition_id, actor_user_id, action, detail)
    VALUES (active_edition_id(), NULL, 'participants.empty_overrides_cleaned', jsonb_build_object('count', v_removed));
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['guard_participant_email_unique()', 'participant_by_email(uuid, text)', 'email_in_use(uuid, text, uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
