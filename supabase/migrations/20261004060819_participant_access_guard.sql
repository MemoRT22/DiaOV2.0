/*
# Regla central de acceso del alumno (identidad, edición y Aviso de Privacidad)

1. Nueva función interna
- `require_participant(require_notice boolean default true) -> uuid`
  - El usuario debe estar autenticado y ligado a un participante de la edición activa (si no: NOT_AUTHORIZED).
  - Si `require_notice` es verdadero, debe haber aceptado la versión vigente del Aviso de Privacidad
    (si no: PRIVACY_NOTICE_REQUIRED).
  - Sin permisos para roles de la API: solo la usan otras funciones del servidor.
  - Las fases siguientes (reservaciones, cambios de ruta, QR/check-in) deben llamarla en lugar de repetir la regla.

2. Funciones del alumno actualizadas
- `save_post_event_interests`: exige aviso vigente.
- `accept_platform_notice` y `my_progress`: exigen identidad y edición activa (no el aviso, porque son el paso que
  lo otorga o lo informa).
*/

CREATE OR REPLACE FUNCTION require_participant(p_require_notice boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_ver text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT p.id, e.privacy_notice_version INTO v_pid, v_ver
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE p.auth_user_id = auth.uid() AND p.edition_id = active_edition_id();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_require_notice AND NOT EXISTS (
    SELECT 1 FROM participant_profiles WHERE participant_id = v_pid
      AND platform_consent_at IS NOT NULL AND platform_consent_version IS NOT DISTINCT FROM v_ver) THEN
    RAISE EXCEPTION 'PRIVACY_NOTICE_REQUIRED';
  END IF;
  RETURN v_pid;
END;
$$;

CREATE OR REPLACE FUNCTION accept_platform_notice()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := require_participant(false);
BEGIN
  UPDATE participant_profiles pp
  SET platform_consent_at = now(), platform_consent_version = e.privacy_notice_version, updated_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = v_pid AND p.id = v_pid;
END;
$$;

CREATE OR REPLACE FUNCTION save_post_event_interests(p_career_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_close timestamptz;
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
BEGIN
  SELECT e.interests_close_at INTO v_close FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  IF v_close IS NOT NULL AND now() >= v_close THEN RAISE EXCEPTION 'INTERESTS_CLOSED'; END IF;
  IF v_n > 3 THEN RAISE EXCEPTION 'TOO_MANY_INTERESTS'; END IF;
  IF v_n > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN RAISE EXCEPTION 'DUPLICATE_INTEREST'; END IF;
  IF v_n > 0 AND (SELECT count(*) FROM careers WHERE id = ANY(p_career_ids) AND is_active) <> v_n THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  DELETE FROM post_event_interests WHERE participant_id = v_pid;
  INSERT INTO post_event_interests (participant_id, preference, career_id)
  SELECT v_pid, ord::smallint, cid FROM unnest(p_career_ids) WITH ORDINALITY AS t(cid, ord);
END;
$$;

CREATE OR REPLACE FUNCTION my_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(false);
  v_ed editions%ROWTYPE; v_att int; v_divs uuid[]; v_level int; v_next rank_levels%ROWTYPE; v_consent boolean;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  SELECT count(*), coalesce(array_agg(DISTINCT a2.division_id), '{}') INTO v_att, v_divs
  FROM attendances a JOIN activity_sessions s ON s.id = a.session_id JOIN activities a2 ON a2.id = s.activity_id
  WHERE a.participant_id = v_pid;
  SELECT coalesce(max(level), 1) INTO v_level FROM rank_levels
  WHERE edition_id = v_ed.id AND required_attendances <= v_att AND required_divisions <= coalesce(array_length(v_divs, 1), 0);
  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;
  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version
  INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;
  RETURN jsonb_build_object(
    'level', v_level, 'attendances', v_att, 'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object('level', v_next.level,
      'required_attendances', v_next.required_attendances, 'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'interests_prompt', v_att >= v_ed.interests_prompt_min_attendances
      OR (v_ed.interests_prompt_at IS NOT NULL AND now() >= v_ed.interests_prompt_at),
    'interests_open', v_ed.interests_close_at IS NULL OR now() < v_ed.interests_close_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION require_participant(boolean) FROM PUBLIC, anon, authenticated;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['accept_platform_notice()', 'save_post_event_interests(uuid[])', 'my_progress()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
