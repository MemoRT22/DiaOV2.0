/*
# Temática por edición, Rangos de Explorador y acciones protegidas

1. Nuevas tablas
- `theme_versions`: configuración de temática por edición (identidad visual, vocabulario, narrativa, recursos) en `config` (jsonb).
  Estados: `draft` (borrador, máximo uno por edición), `published` (publicada, máximo una), `archived` (versiones anteriores).
- `rank_levels`: los 5 niveles internos de progreso por edición con sus requisitos (asistencias y divisiones distintas).
  Los nombres visibles viven en la temática, no aquí. `is_provisional` indica reglas aún no oficiales.

2. Funciones (todas validan al que llama con auth.uid())
- Aspirante: `my_progress`, `accept_platform_notice`, `save_post_event_interests`.
- Coordinación: `save_theme_draft`, `publish_theme_draft`, `restore_theme_version`, `emergency_unlock_theme`, `relock_theme`,
  `update_rank_rules`, `coordination_summary`, `demo_purge_preview`, `purge_demo_data`, `activate_real_operation`.

3. Seguridad
- RLS activado en ambas tablas. Cualquiera lee la temática publicada y las reglas de rango; solo Coordinación ve borradores e historial.
- Sin escrituras directas desde el navegador: todo pasa por las funciones, que revisan rol, modo de operación y bloqueo.

4. Notas importantes
1. En operación real la temática está bloqueada en el servidor salvo un desbloqueo de emergencia de 30 minutos con motivo y auditoría.
2. La limpieza solo borra registros marcados como prueba, solo en preparación, y se niega si hay datos reales ligados a datos de prueba.
3. Activar la operación real exige que no queden datos de prueba y que exista una temática publicada. Es irreversible.
*/

CREATE TABLE IF NOT EXISTS theme_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  version int,
  config jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS theme_versions_one_draft ON theme_versions (edition_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS theme_versions_one_published ON theme_versions (edition_id) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS theme_versions_version ON theme_versions (edition_id, version) WHERE version IS NOT NULL;

CREATE TABLE IF NOT EXISTS rank_levels (
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
  required_attendances int NOT NULL CHECK (required_attendances >= 0),
  required_divisions int NOT NULL CHECK (required_divisions >= 0),
  is_provisional boolean NOT NULL DEFAULT true,
  PRIMARY KEY (edition_id, level)
);

ALTER TABLE theme_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_levels ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON theme_versions, rank_levels FROM anon, authenticated;

DROP POLICY IF EXISTS "Public reads published theme" ON theme_versions;
CREATE POLICY "Public reads published theme" ON theme_versions FOR SELECT TO anon, authenticated
USING (status = 'published');

DROP POLICY IF EXISTS "Coordinacion reads all theme versions" ON theme_versions;
CREATE POLICY "Coordinacion reads all theme versions" ON theme_versions FOR SELECT TO authenticated
USING (is_coordinacion());

DROP POLICY IF EXISTS "Public reads rank levels" ON rank_levels;
CREATE POLICY "Public reads rank levels" ON rank_levels FOR SELECT TO anon, authenticated USING (true);

-- Internal helpers
CREATE OR REPLACE FUNCTION require_coordinacion()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_coordinacion() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION theme_is_locked(p_edition uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mode = 'operacion_real' AND (theme_unlock_until IS NULL OR theme_unlock_until < now())
  FROM editions WHERE id = p_edition;
$$;

CREATE OR REPLACE FUNCTION write_audit(p_action text, p_detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO audit_log (edition_id, actor_user_id, action, detail)
  VALUES (active_edition_id(), auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$$;

REVOKE EXECUTE ON FUNCTION require_coordinacion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION write_audit(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Participant: progress
CREATE OR REPLACE FUNCTION my_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := current_participant_id();
  v_ed editions%ROWTYPE;
  v_att int;
  v_divs uuid[];
  v_level int;
  v_next rank_levels%ROWTYPE;
  v_consent boolean;
BEGIN
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;

  SELECT count(*), coalesce(array_agg(DISTINCT a2.division_id), '{}')
    INTO v_att, v_divs
  FROM attendances a
  JOIN activity_sessions s ON s.id = a.session_id
  JOIN activities a2 ON a2.id = s.activity_id
  WHERE a.participant_id = v_pid;

  SELECT coalesce(max(level), 1) INTO v_level FROM rank_levels
  WHERE edition_id = v_ed.id AND required_attendances <= v_att AND required_divisions <= coalesce(array_length(v_divs, 1), 0);

  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;

  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version
    INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;

  RETURN jsonb_build_object(
    'level', v_level,
    'attendances', v_att,
    'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object(
      'level', v_next.level,
      'required_attendances', v_next.required_attendances,
      'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'interests_prompt', v_att >= v_ed.interests_prompt_min_attendances
      OR (v_ed.interests_prompt_at IS NOT NULL AND now() >= v_ed.interests_prompt_at),
    'interests_open', v_ed.interests_close_at IS NULL OR now() < v_ed.interests_close_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION accept_platform_notice()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := current_participant_id();
BEGIN
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE participant_profiles pp
  SET platform_consent_at = now(),
      platform_consent_version = e.privacy_notice_version,
      updated_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = v_pid AND p.id = v_pid;
END;
$$;

CREATE OR REPLACE FUNCTION save_post_event_interests(p_career_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := current_participant_id();
  v_close timestamptz;
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
BEGIN
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT e.interests_close_at INTO v_close FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  IF v_close IS NOT NULL AND now() >= v_close THEN RAISE EXCEPTION 'INTERESTS_CLOSED'; END IF;
  IF v_n > 3 THEN RAISE EXCEPTION 'TOO_MANY_INTERESTS'; END IF;
  IF v_n > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN
    RAISE EXCEPTION 'DUPLICATE_INTEREST';
  END IF;
  IF v_n > 0 AND (SELECT count(*) FROM careers WHERE id = ANY(p_career_ids) AND is_active) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END IF;

  DELETE FROM post_event_interests WHERE participant_id = v_pid;
  INSERT INTO post_event_interests (participant_id, preference, career_id)
  SELECT v_pid, ord::smallint, cid FROM unnest(p_career_ids) WITH ORDINALITY AS t(cid, ord);
END;
$$;

-- Theme management
CREATE OR REPLACE FUNCTION validate_theme_config(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_path text;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN RAISE EXCEPTION 'INVALID_THEME'; END IF;
  IF octet_length(p_config::text) > 200000 THEN RAISE EXCEPTION 'THEME_TOO_LARGE'; END IF;
  IF p_config ? 'assets' THEN
    IF jsonb_typeof(p_config->'assets') <> 'object' THEN RAISE EXCEPTION 'INVALID_THEME'; END IF;
    FOR v_path IN SELECT value FROM jsonb_each_text(p_config->'assets') LOOP
      IF v_path <> '' AND v_path !~ '^(/assets/|https://)' THEN RAISE EXCEPTION 'INVALID_ASSET_PATH'; END IF;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION save_theme_draft(p_config jsonb, p_note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_id uuid;
BEGIN
  PERFORM require_coordinacion();
  IF theme_is_locked(v_ed) THEN RAISE EXCEPTION 'THEME_LOCKED'; END IF;
  PERFORM validate_theme_config(p_config);

  UPDATE theme_versions SET config = p_config, note = left(coalesce(p_note, ''), 500), updated_at = now()
  WHERE edition_id = v_ed AND status = 'draft' RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    INSERT INTO theme_versions (edition_id, status, config, note, created_by)
    VALUES (v_ed, 'draft', p_config, left(coalesce(p_note, ''), 500), auth.uid()) RETURNING id INTO v_id;
  END IF;
  PERFORM write_audit('theme.draft_saved', jsonb_build_object('theme_version_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION publish_theme_draft()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_draft uuid; v_ver int;
BEGIN
  PERFORM require_coordinacion();
  IF theme_is_locked(v_ed) THEN RAISE EXCEPTION 'THEME_LOCKED'; END IF;
  SELECT id INTO v_draft FROM theme_versions WHERE edition_id = v_ed AND status = 'draft' FOR UPDATE;
  IF v_draft IS NULL THEN RAISE EXCEPTION 'NO_DRAFT'; END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM theme_versions WHERE edition_id = v_ed;
  UPDATE theme_versions SET status = 'archived', updated_at = now() WHERE edition_id = v_ed AND status = 'published';
  UPDATE theme_versions SET status = 'published', version = v_ver, published_at = now(), published_by = auth.uid(), updated_at = now()
  WHERE id = v_draft;
  PERFORM write_audit('theme.published', jsonb_build_object('version', v_ver));
  RETURN v_ver;
END;
$$;

CREATE OR REPLACE FUNCTION restore_theme_version(p_version_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cfg jsonb; v_ver int; v_id uuid;
BEGIN
  PERFORM require_coordinacion();
  SELECT config, version INTO v_cfg, v_ver FROM theme_versions
  WHERE id = p_version_id AND edition_id = active_edition_id() AND status <> 'draft';
  IF v_cfg IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_id := save_theme_draft(v_cfg, 'Restaurada desde la versión ' || v_ver);
  PERFORM write_audit('theme.restored_to_draft', jsonb_build_object('from_version', v_ver));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION emergency_unlock_theme(p_phrase text, p_reason text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_until timestamptz := now() + interval '30 minutes';
BEGIN
  PERFORM require_coordinacion();
  IF (SELECT mode FROM editions WHERE id = v_ed) <> 'operacion_real' THEN RAISE EXCEPTION 'NOT_IN_REAL_OPERATION'; END IF;
  IF p_phrase IS DISTINCT FROM 'DESBLOQUEAR TEMÁTICA' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  UPDATE editions SET theme_unlock_until = v_until WHERE id = v_ed;
  PERFORM write_audit('theme.emergency_unlock', jsonb_build_object('reason', left(p_reason, 500), 'until', v_until));
  RETURN v_until;
END;
$$;

CREATE OR REPLACE FUNCTION relock_theme()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  UPDATE editions SET theme_unlock_until = NULL WHERE id = active_edition_id();
  PERFORM write_audit('theme.relocked', '{}'::jsonb);
END;
$$;

-- Rank rules
CREATE OR REPLACE FUNCTION update_rank_rules(p_rules jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); r record; v_prev_att int := -1; v_prev_div int := -1;
BEGIN
  PERFORM require_coordinacion();
  IF (SELECT mode FROM editions WHERE id = v_ed) = 'operacion_real' THEN RAISE EXCEPTION 'LOCKED_IN_REAL_OPERATION'; END IF;
  IF jsonb_typeof(p_rules) <> 'array' OR jsonb_array_length(p_rules) <> 5 THEN RAISE EXCEPTION 'INVALID_RULES'; END IF;

  FOR r IN
    SELECT (x->>'level')::int AS level, (x->>'required_attendances')::int AS att, (x->>'required_divisions')::int AS divs
    FROM jsonb_array_elements(p_rules) x ORDER BY (x->>'level')::int
  LOOP
    IF r.level IS NULL OR r.att IS NULL OR r.divs IS NULL OR r.att < 0 OR r.divs < 0 OR r.att > 50 OR r.divs > r.att THEN
      RAISE EXCEPTION 'INVALID_RULES';
    END IF;
    IF r.level = 1 AND (r.att <> 0 OR r.divs <> 0) THEN RAISE EXCEPTION 'INVALID_RULES'; END IF;
    IF r.att < v_prev_att OR r.divs < v_prev_div OR (r.level > 1 AND r.att = v_prev_att AND r.divs = v_prev_div) THEN
      RAISE EXCEPTION 'INVALID_RULES';
    END IF;
    v_prev_att := r.att; v_prev_div := r.divs;
    INSERT INTO rank_levels (edition_id, level, required_attendances, required_divisions, is_provisional)
    VALUES (v_ed, r.level, r.att, r.divs, false)
    ON CONFLICT (edition_id, level) DO UPDATE
      SET required_attendances = EXCLUDED.required_attendances, required_divisions = EXCLUDED.required_divisions, is_provisional = false;
  END LOOP;
  PERFORM write_audit('ranks.updated', jsonb_build_object('rules', p_rules));
END;
$$;

-- Coordination overview
CREATE OR REPLACE FUNCTION coordination_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  PERFORM require_coordinacion();
  RETURN jsonb_build_object(
    'participants_total', (SELECT count(*) FROM participants WHERE edition_id = v_ed),
    'participants_forms', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'forms'),
    'participants_manual', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'manual'),
    'participants_demo', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND is_demo),
    'platform_consents', (SELECT count(*) FROM participant_profiles pp JOIN participants p ON p.id = pp.participant_id
                          WHERE p.edition_id = v_ed AND pp.platform_consent_at IS NOT NULL),
    'activities', (SELECT count(*) FROM activities WHERE edition_id = v_ed),
    'sessions', (SELECT count(*) FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.edition_id = v_ed),
    'attendances', (SELECT count(*) FROM attendances at JOIN participants p ON p.id = at.participant_id WHERE p.edition_id = v_ed),
    'with_interests', (SELECT count(DISTINCT i.participant_id) FROM post_event_interests i JOIN participants p ON p.id = i.participant_id
                       WHERE p.edition_id = v_ed),
    'theme_locked', theme_is_locked(v_ed)
  );
END;
$$;

-- Demo data cleanup
CREATE OR REPLACE FUNCTION demo_purge_preview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_blockers jsonb := '[]'::jsonb; v_n int;
BEGIN
  PERFORM require_coordinacion();

  SELECT count(*) INTO v_n FROM participants p JOIN careers c ON c.id = p.initial_career_id WHERE NOT p.is_demo AND c.is_demo;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_object('kind', 'real_participant_demo_career', 'count', v_n); END IF;
  SELECT count(*) INTO v_n FROM post_event_interests i JOIN participants p ON p.id = i.participant_id JOIN careers c ON c.id = i.career_id
    WHERE NOT p.is_demo AND c.is_demo;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_object('kind', 'real_interest_demo_career', 'count', v_n); END IF;
  SELECT count(*) INTO v_n FROM careers c JOIN divisions d ON d.id = c.division_id WHERE NOT c.is_demo AND d.is_demo;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_object('kind', 'real_career_demo_division', 'count', v_n); END IF;
  SELECT count(*) INTO v_n FROM activities a JOIN divisions d ON d.id = a.division_id WHERE NOT a.is_demo AND d.is_demo;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_object('kind', 'real_activity_demo_division', 'count', v_n); END IF;
  SELECT count(*) INTO v_n FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE NOT s.is_demo AND a.is_demo;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_object('kind', 'real_session_demo_activity', 'count', v_n); END IF;
  SELECT count(*) INTO v_n FROM attendances at JOIN participants p ON p.id = at.participant_id JOIN activity_sessions s ON s.id = at.session_id
    WHERE NOT p.is_demo AND s.is_demo;
  IF v_n > 0 THEN v_blockers := v_blockers || jsonb_build_object('kind', 'real_attendance_demo_session', 'count', v_n); END IF;
  IF EXISTS (SELECT 1 FROM staff_members WHERE user_id = auth.uid() AND is_demo) THEN
    v_blockers := v_blockers || jsonb_build_object('kind', 'caller_is_demo_account', 'count', 1);
  END IF;

  RETURN jsonb_build_object(
    'mode', (SELECT mode FROM editions WHERE id = active_edition_id()),
    'counts', jsonb_build_object(
      'participants', (SELECT count(*) FROM participants WHERE is_demo),
      'attendances', (SELECT count(*) FROM attendances at JOIN participants p ON p.id = at.participant_id WHERE p.is_demo)
                   + (SELECT count(*) FROM attendances at JOIN activity_sessions s ON s.id = at.session_id JOIN participants p ON p.id = at.participant_id
                      WHERE s.is_demo AND NOT p.is_demo),
      'sessions', (SELECT count(*) FROM activity_sessions WHERE is_demo),
      'activities', (SELECT count(*) FROM activities WHERE is_demo),
      'careers', (SELECT count(*) FROM careers WHERE is_demo),
      'divisions', (SELECT count(*) FROM divisions WHERE is_demo),
      'staff', (SELECT count(*) FROM staff_members WHERE is_demo)
    ),
    'blockers', v_blockers
  );
END;
$$;

CREATE OR REPLACE FUNCTION purge_demo_data(p_phrase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_preview jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF (SELECT mode FROM editions WHERE id = active_edition_id()) <> 'preparacion' THEN RAISE EXCEPTION 'PURGE_DISABLED'; END IF;
  IF p_phrase IS DISTINCT FROM 'BORRAR DATOS DE PRUEBA' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
  v_preview := demo_purge_preview();
  IF jsonb_array_length(v_preview->'blockers') > 0 THEN RAISE EXCEPTION 'PURGE_BLOCKED'; END IF;

  DELETE FROM participants WHERE is_demo;
  DELETE FROM activity_sessions WHERE is_demo;
  DELETE FROM activities WHERE is_demo;
  DELETE FROM careers WHERE is_demo;
  DELETE FROM divisions WHERE is_demo;
  DELETE FROM staff_members WHERE is_demo;

  PERFORM write_audit('demo.purged', v_preview->'counts');
  RETURN v_preview->'counts';
END;
$$;

CREATE OR REPLACE FUNCTION activate_real_operation(p_phrase text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_demo int;
BEGIN
  PERFORM require_coordinacion();
  IF p_phrase IS DISTINCT FROM 'ACTIVAR OPERACIÓN REAL' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
  IF (SELECT mode FROM editions WHERE id = v_ed) <> 'preparacion' THEN RAISE EXCEPTION 'ALREADY_REAL'; END IF;
  SELECT (SELECT count(*) FROM participants WHERE is_demo) + (SELECT count(*) FROM activity_sessions WHERE is_demo)
       + (SELECT count(*) FROM activities WHERE is_demo) + (SELECT count(*) FROM careers WHERE is_demo)
       + (SELECT count(*) FROM divisions WHERE is_demo) + (SELECT count(*) FROM staff_members WHERE is_demo)
    INTO v_demo;
  IF v_demo > 0 THEN RAISE EXCEPTION 'DEMO_DATA_REMAINS'; END IF;
  IF NOT EXISTS (SELECT 1 FROM theme_versions WHERE edition_id = v_ed AND status = 'published') THEN
    RAISE EXCEPTION 'NO_PUBLISHED_THEME';
  END IF;
  UPDATE editions SET mode = 'operacion_real', real_operation_at = now(), theme_unlock_until = NULL WHERE id = v_ed;
  PERFORM write_audit('edition.real_operation_activated', '{}'::jsonb);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'my_progress()', 'accept_platform_notice()', 'save_post_event_interests(uuid[])',
    'save_theme_draft(jsonb, text)', 'publish_theme_draft()', 'restore_theme_version(uuid)',
    'emergency_unlock_theme(text, text)', 'relock_theme()', 'update_rank_rules(jsonb)',
    'coordination_summary()', 'demo_purge_preview()', 'purge_demo_data(text)', 'activate_real_operation(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION theme_is_locked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION validate_theme_config(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION guard_is_demo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_participant_profile() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION active_edition_id() FROM PUBLIC, anon;
