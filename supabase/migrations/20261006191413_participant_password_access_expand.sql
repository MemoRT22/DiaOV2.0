/*
# Acceso del participante con correo + contraseña y autorregistro (fase EXPAND, compatible)

El participante entra con su correo y una contraseña que vive únicamente en Supabase Auth. Esta migración es
ADITIVA y compatible con el frontend y la Edge Function que ya están publicados; el retiro de lo que queda sin
consumidores (fecha de nacimiento, bloqueo propio de accesos, alta manual) va en
`20261007030100_participant_password_access_contract`, que se aplica DESPUÉS de publicar el frontend nuevo.

Modelo
- `participants.password_configured_at`: marca que el participante ya tiene una cuenta con contraseña utilizable
  (nunca guarda la contraseña ni su hash; solo cuándo se configuró). Sin esta marca el correo cae en «crear contraseña».
- `participants.high_school_grade` ('1', '2', '3', 'graduado') y `participants.entry_period` ('2027-01', '2027-08',
  '2028-01', '2028-08'): campos estructurales del Forms oficial, con valores estables.
- `participants.origin` admite `self_service`.
- `participant_profiles.platform_consent_source` ('self_service' | 'platform'): de dónde viene la aceptación de la
  plataforma. Es un concepto distinto de `forms_consent*` (lo aceptado en el Forms).
- Nombre y apellidos: `full_name` sigue siendo la representación única; la importación y el autorregistro unen
  Nombre + Apellidos de forma determinista.

Funciones internas (solo `service_role`, las orquesta la Edge Function `student-access`; el navegador nunca las llama)
- `participant_access_state_internal(email)`: `password_login` | `password_setup` | `self_registration`, sin datos personales.
- `register_self_service_internal(payload)`: valida y crea participante + perfil + interés inicial + aceptación en una transacción.
- `participant_link_auth_internal(participante, usuario_auth)`: vincula la identidad y marca la contraseña como configurada.
- `discard_self_service_registration_internal(participante)`: compensación si Auth falla; no toca registros ya terminados.
- `participant_password_audit_internal(actor, participante)`: audita `participant.password_reset` SIN la contraseña.
- `preparation_participant_auth_ids(edición)`: identidades Auth de participantes por la relación real
  `participants.auth_user_id` (correo real o sintético antiguo), nunca de Staff; la usan el preview y el reset de UX-2.

Cambios de contrato (con compatibilidad)
- `process_participant_import`: ya no usa fecha de nacimiento; entiende grado y periodo; el consentimiento es opcional si el
  archivo no trae esa columna; un archivo sin segunda carrera ya no borra la que existía.
- `update_participant`: grado y periodo con las reglas de correcciones manuales; ignora `birth_date`.
- `get_participant`, `search_participants`, `export_participants`, `coordination_summary`: sin fecha de nacimiento
  (se conservan las claves `access`, `access_locked`, `has_birth_date = true` y `missing_birth_date = 0` solo para que el
  frontend anterior no marque falsos problemas; el retiro las elimina).
- `list_import_conflicts` / `resolve_import_conflict`: soportan los campos nuevos; los conflictos pendientes de fecha de
  nacimiento se cierran como conservados.
- `create_participant_manual` (solo frontend anterior): ya no exige fecha de nacimiento.
- Preparation Reset (UX-2): localiza identidades por `participants.auth_user_id`; semántica visible sin cambios.
*/

-- ---------------------------------------------------------------------------------------------------------
-- 1. Esquema
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS high_school_grade text,
  ADD COLUMN IF NOT EXISTS entry_period text,
  ADD COLUMN IF NOT EXISTS password_configured_at timestamptz;

ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_high_school_grade_check;
ALTER TABLE public.participants ADD CONSTRAINT participants_high_school_grade_check
  CHECK (high_school_grade IS NULL OR high_school_grade IN ('1', '2', '3', 'graduado'));
ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_entry_period_check;
ALTER TABLE public.participants ADD CONSTRAINT participants_entry_period_check
  CHECK (entry_period IS NULL OR entry_period IN ('2027-01', '2027-08', '2028-01', '2028-08'));
ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_origin_check;
ALTER TABLE public.participants ADD CONSTRAINT participants_origin_check
  CHECK (origin IN ('forms', 'manual', 'demo', 'self_service'));

ALTER TABLE public.participant_profiles ADD COLUMN IF NOT EXISTS platform_consent_source text;
ALTER TABLE public.participant_profiles DROP CONSTRAINT IF EXISTS participant_profiles_consent_source_check;
ALTER TABLE public.participant_profiles ADD CONSTRAINT participant_profiles_consent_source_check
  CHECK (platform_consent_source IS NULL OR platform_consent_source IN ('self_service', 'platform'));

-- Quien ya inició sesión con el flujo anterior conserva su identidad, pero todavía no tiene contraseña utilizable:
-- queda sin password_configured_at y creará su contraseña en el primer acceso nuevo.

-- Los conflictos pendientes de fecha de nacimiento ya no tienen decisión que tomar.
UPDATE public.participant_import_conflicts
SET status = 'kept', resolved_at = now()
WHERE field = 'birth_date' AND status = 'pending';

-- ---------------------------------------------------------------------------------------------------------
-- 2. Aceptación de la plataforma con su fuente
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_platform_notice()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pid uuid := require_participant(false);
BEGIN
  UPDATE participant_profiles pp
  SET platform_consent_at = now(), platform_consent_version = e.privacy_notice_version,
      platform_consent_source = 'platform', updated_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = v_pid AND p.id = v_pid;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Funciones internas del acceso (solo service_role)
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.participant_access_state_internal(p_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email text := lower(btrim(coalesce(p_email, ''))); v_configured timestamptz; v_found boolean;
BEGIN
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  SELECT true, p.password_configured_at INTO v_found, v_configured
  FROM participants p WHERE p.edition_id = active_edition_id() AND p.email = v_email;
  IF v_found IS NULL THEN RETURN 'self_registration'; END IF;
  RETURN CASE WHEN v_configured IS NULL THEN 'password_setup' ELSE 'password_login' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_self_service_internal(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed editions%ROWTYPE;
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_first text := left(btrim(regexp_replace(coalesce(p->>'first_name', ''), '\s+', ' ', 'g')), 75);
  v_last text := left(btrim(regexp_replace(coalesce(p->>'last_name', ''), '\s+', ' ', 'g')), 75);
  v_name text;
  v_phone text;
  v_school text := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), '');
  v_grade text := nullif(btrim(coalesce(p->>'high_school_grade', '')), '');
  v_period text := nullif(btrim(coalesce(p->>'entry_period', '')), '');
  v_career uuid;
  v_id uuid;
BEGIN
  SELECT * INTO v_ed FROM editions WHERE is_active;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF v_first = '' OR v_last = '' THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  v_name := v_first || ' ' || v_last;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  BEGIN v_phone := clean_phone(p->>'phone'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_PHONE'; END;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'PHONE_REQUIRED'; END IF;
  IF v_school IS NULL THEN RAISE EXCEPTION 'HIGH_SCHOOL_REQUIRED'; END IF;
  IF v_grade IS NULL OR v_grade NOT IN ('1', '2', '3', 'graduado') THEN RAISE EXCEPTION 'INVALID_GRADE'; END IF;
  IF v_period IS NULL OR v_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  SELECT id INTO v_career FROM careers WHERE id::text = p->>'initial_career_id' AND is_active AND NOT is_demo;
  IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF coalesce((p->>'consent_accepted')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF email_in_use(v_ed.id, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  BEGIN
    INSERT INTO participants (edition_id, email, full_name, phone, high_school, high_school_grade, entry_period,
                              initial_career_id, origin, is_demo)
    VALUES (v_ed.id, v_email, v_name, v_phone, v_school, v_grade, v_period, v_career, 'self_service', false)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMAIL_EXISTS';
  END;

  PERFORM sync_initial_interests(v_id, ARRAY[v_career, NULL]::uuid[], ARRAY[NULL, NULL]::text[]);
  UPDATE participant_profiles
  SET platform_consent_at = now(), platform_consent_version = v_ed.privacy_notice_version,
      platform_consent_source = 'self_service', updated_at = now()
  WHERE participant_id = v_id;
  INSERT INTO audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_ed.id, NULL, 'participant.self_registered', jsonb_build_object('participant_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.participant_link_auth_internal(p_participant uuid, p_auth_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE participants SET auth_user_id = p_auth_user, password_configured_at = coalesce(password_configured_at, now()),
                          updated_at = now()
  WHERE id = p_participant AND edition_id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_self_service_registration_internal(p_participant uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM participants
  WHERE id = p_participant AND origin = 'self_service' AND password_configured_at IS NULL AND auth_user_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.participant_password_audit_internal(p_actor uuid, p_participant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM staff_members s JOIN staff_roles r ON r.user_id = s.user_id
    WHERE s.user_id = p_actor AND s.is_active AND r.role IN ('coordinacion', 'staff')
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  INSERT INTO audit_log (edition_id, actor_user_id, action, detail)
  VALUES (active_edition_id(), p_actor, 'participant.password_reset', jsonb_build_object('participant_id', p_participant));
END;
$$;

CREATE OR REPLACE FUNCTION public.preparation_participant_auth_ids(p_edition uuid)
RETURNS TABLE (auth_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id
  FROM public.participants p
  JOIN auth.users u ON u.id = p.auth_user_id
  WHERE p.edition_id = p_edition
    AND NOT EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.staff_roles r WHERE r.user_id = u.id)
    AND (coalesce(u.raw_app_meta_data->>'kind', '') = 'participant'
         OR lower(u.email) = ('p.' || p.id::text || '@participantes.diaov.invalid'));
$$;

REVOKE ALL ON FUNCTION public.participant_access_state_internal(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_self_service_internal(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.participant_link_auth_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_self_service_registration_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.participant_password_audit_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preparation_participant_auth_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.participant_access_state_internal(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_self_service_internal(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.participant_link_auth_internal(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_self_service_registration_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.participant_password_audit_internal(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.preparation_participant_auth_ids(uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Preparation Reset (UX-2): identidades por la relación real, nunca por el formato del correo
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preparation_reset_preview_internal(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ed uuid; v_mode text; v_last timestamptz; v_counts jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_members s JOIN public.staff_roles r ON r.user_id = s.user_id
    WHERE s.user_id = p_actor AND s.is_active AND r.role = 'coordinacion'
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT id, mode, last_preparation_reset_at INTO v_ed, v_mode, v_last
    FROM public.editions WHERE is_active;
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  SELECT jsonb_build_object(
    'participants', (SELECT count(*) FROM public.participants WHERE edition_id = v_ed),
    'proposals', (SELECT count(*) FROM public.workshop_submissions WHERE edition_id = v_ed),
    'activities', (SELECT count(*) FROM public.activities WHERE edition_id = v_ed),
    'sessions', (SELECT count(*) FROM public.activity_sessions s JOIN public.activities a ON a.id=s.activity_id WHERE a.edition_id=v_ed),
    'reservations', (SELECT count(*) FROM public.reservations r JOIN public.participants p ON p.id=r.participant_id
      JOIN public.activities a ON a.id=r.activity_id WHERE p.edition_id=v_ed OR a.edition_id=v_ed),
    'attendances', (SELECT count(*) FROM public.attendances t JOIN public.participants p ON p.id=t.participant_id
      JOIN public.activity_sessions s ON s.id=t.session_id JOIN public.activities a ON a.id=s.activity_id
      WHERE p.edition_id=v_ed OR a.edition_id=v_ed),
    'interests', (SELECT count(*) FROM public.initial_interests i JOIN public.participants p ON p.id=i.participant_id WHERE p.edition_id=v_ed)
      + (SELECT count(*) FROM public.post_event_interests i JOIN public.participants p ON p.id=i.participant_id WHERE p.edition_id=v_ed),
    'imports', (SELECT count(*) FROM public.import_batches WHERE edition_id=v_ed),
    'raffle_results', (SELECT count(*) FROM public.raffle_winners WHERE edition_id=v_ed),
    'temporary_catalog', (SELECT count(*) FROM public.careers c WHERE c.is_demo AND NOT EXISTS (
      SELECT 1 FROM public.participants p WHERE p.initial_career_id=c.id AND p.edition_id<>v_ed) AND NOT EXISTS (
      SELECT 1 FROM public.initial_interests i JOIN public.participants p ON p.id=i.participant_id WHERE i.career_id=c.id AND p.edition_id<>v_ed) AND NOT EXISTS (
      SELECT 1 FROM public.post_event_interests i JOIN public.participants p ON p.id=i.participant_id WHERE i.career_id=c.id AND p.edition_id<>v_ed) AND NOT EXISTS (
      SELECT 1 FROM public.workshop_submission_careers sc JOIN public.workshop_submissions w ON w.id=sc.submission_id WHERE sc.career_id=c.id AND w.edition_id<>v_ed) AND NOT EXISTS (
      SELECT 1 FROM public.activity_careers ac JOIN public.activities a ON a.id=ac.activity_id WHERE ac.career_id=c.id AND a.edition_id<>v_ed))
      + (SELECT count(*) FROM public.divisions d WHERE d.is_demo AND NOT EXISTS (SELECT 1 FROM public.careers c WHERE c.division_id=d.id AND NOT c.is_demo)
        AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.division_id=d.id AND a.edition_id<>v_ed)
        AND NOT EXISTS (SELECT 1 FROM public.workshop_submissions w WHERE w.division_id=d.id AND w.edition_id<>v_ed))
      + (SELECT count(*) FROM public.raffle_prizes WHERE edition_id=v_ed AND is_demo)
      + (SELECT count(*) FROM public.raffle_categories WHERE edition_id=v_ed AND is_demo),
    'temporary_staff', (SELECT count(*) FROM public.staff_members WHERE is_demo AND lower(coalesce(email,'')) <> 'ena.perez@anahuac.mx'),
    'auth_identities', (SELECT count(*) FROM public.preparation_participant_auth_ids(v_ed))
  ) INTO v_counts;

  RETURN jsonb_build_object('edition_id',v_ed,'mode',v_mode,'counts',v_counts,
    'last_reset_at',v_last,
    'auth_cleanup_pending',(SELECT count(*) FROM public.preparation_auth_cleanup WHERE edition_id=v_ed AND status IN ('pending','failed')),
    'theme_ready',EXISTS(SELECT 1 FROM public.theme_versions WHERE edition_id=v_ed AND status='published'),
    'temporary_records_remaining',
      (SELECT count(*) FROM public.participants WHERE is_demo AND edition_id=v_ed)
      + (SELECT count(*) FROM public.activity_sessions s JOIN public.activities a ON a.id=s.activity_id WHERE s.is_demo AND a.edition_id=v_ed)
      + (SELECT count(*) FROM public.activities WHERE is_demo AND edition_id=v_ed)
      + (SELECT count(*) FROM public.careers WHERE is_demo)
      + (SELECT count(*) FROM public.divisions WHERE is_demo)
      + (SELECT count(*) FROM public.staff_members WHERE is_demo));
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_preparation_internal(p_actor uuid, p_phrase text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ed uuid; v_mode text; v_preview jsonb; v_run uuid := gen_random_uuid(); v_now timestamptz := clock_timestamp();
BEGIN
  IF p_phrase IS DISTINCT FROM 'REINICIAR PREPARACIÓN' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
  -- Serializes resets and operation-real activation on the active edition.
  SELECT id, mode INTO v_ed, v_mode FROM public.editions WHERE is_active FOR UPDATE;
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF v_mode <> 'preparacion' THEN RAISE EXCEPTION 'RESET_DISABLED'; END IF;
  v_preview := public.preparation_reset_preview_internal(p_actor);

  INSERT INTO public.preparation_auth_cleanup(auth_user_id,edition_id,reset_id)
    SELECT i.auth_user_id,v_ed,v_run FROM public.preparation_participant_auth_ids(v_ed) i
    ON CONFLICT (auth_user_id) DO NOTHING;

  -- Explicit order for RESTRICT FKs. Cascades remove participant profiles, interests and proposal careers.
  DELETE FROM public.raffle_winners WHERE edition_id=v_ed;
  DELETE FROM public.attendances t USING public.activity_sessions s, public.activities a
    WHERE t.session_id=s.id AND s.activity_id=a.id AND a.edition_id=v_ed;
  DELETE FROM public.reservations r USING public.activities a WHERE r.activity_id=a.id AND a.edition_id=v_ed;
  DELETE FROM public.participant_import_conflicts c USING public.import_batches b
    WHERE c.batch_id=b.id AND b.edition_id=v_ed;
  DELETE FROM public.participants WHERE edition_id=v_ed;
  DELETE FROM public.participant_email_history WHERE edition_id=v_ed;
  DELETE FROM public.participant_import_conflicts c USING public.import_batches b
    WHERE c.batch_id=b.id AND b.edition_id=v_ed;
  DELETE FROM public.import_batches WHERE edition_id=v_ed;
  DELETE FROM public.workshop_submissions WHERE edition_id=v_ed;
  DELETE FROM public.activity_sessions s USING public.activities a WHERE s.activity_id=a.id AND a.edition_id=v_ed;
  DELETE FROM public.activities WHERE edition_id=v_ed;

  DELETE FROM public.raffle_prizes WHERE edition_id=v_ed AND is_demo;
  DELETE FROM public.raffle_categories c WHERE c.edition_id=v_ed AND c.is_demo
    AND NOT EXISTS(SELECT 1 FROM public.raffle_prizes p WHERE p.category_id=c.id);
  DELETE FROM public.careers c WHERE c.is_demo
    AND NOT EXISTS(SELECT 1 FROM public.participants p WHERE p.initial_career_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM public.initial_interests i WHERE i.career_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM public.post_event_interests i WHERE i.career_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM public.workshop_submission_careers sc WHERE sc.career_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM public.activity_careers ac WHERE ac.career_id=c.id);
  DELETE FROM public.divisions d WHERE d.is_demo
    AND NOT EXISTS(SELECT 1 FROM public.careers c WHERE c.division_id=d.id)
    AND NOT EXISTS(SELECT 1 FROM public.activities a WHERE a.division_id=d.id)
    AND NOT EXISTS(SELECT 1 FROM public.activity_divisions ad WHERE ad.division_id=d.id)
    AND NOT EXISTS(SELECT 1 FROM public.workshop_submissions w WHERE w.division_id=d.id);
  DELETE FROM public.staff_members WHERE is_demo AND lower(coalesce(email,'')) <> 'ena.perez@anahuac.mx';

  UPDATE public.editions SET last_preparation_reset_at=v_now WHERE id=v_ed;
  INSERT INTO public.audit_log(edition_id,actor_user_id,action,detail)
    VALUES(v_ed,p_actor,'preparation.reset',jsonb_build_object('reset_id',v_run,'counts',v_preview->'counts',
      'auth_cleanup_queued',(SELECT count(*) FROM public.preparation_auth_cleanup WHERE edition_id=v_ed AND status IN ('pending','failed'))));
  RETURN jsonb_build_object('reset_id',v_run,'edition_id',v_ed,'reset_at',v_now,'counts',v_preview->'counts');
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Lectura administrativa sin fecha de nacimiento, con grado, periodo y estado de acceso
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_participant(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p participants%ROWTYPE; v jsonb;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v := jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
    'high_school', p.high_school, 'high_school_grade', p.high_school_grade, 'entry_period', p.entry_period,
    'initial_career_id', p.initial_career_id, 'initial_career_raw', p.initial_career_raw,
    'origin', p.origin, 'is_demo', p.is_demo,
    'forms_consent', p.forms_consent, 'forms_consent_at', p.forms_consent_at,
    'manual_consent_at', p.manual_consent_at,
    'manual_consent_by', (SELECT full_name FROM staff_members WHERE user_id = p.manual_consent_captured_by),
    'manual_overrides', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('at', val->>'at',
      'cleared', coalesce((val->>'cleared')::boolean, false),
      'by', (SELECT full_name FROM staff_members WHERE user_id::text = val->>'by'))), '{}'::jsonb)
      FROM jsonb_each(p.manual_overrides) AS t(k, val)),
    'initial_interests', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'preference', ii.preference, 'career_id', ii.career_id, 'career_name', c.name, 'career_code', c.code,
      'career_raw', ii.career_raw) ORDER BY ii.preference), '[]'::jsonb)
      FROM initial_interests ii JOIN careers c ON c.id = ii.career_id WHERE ii.participant_id = p.id),
    'email_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('email', h.email, 'changed_at', h.changed_at,
      'reason', h.reason, 'changed_by', (SELECT full_name FROM staff_members WHERE user_id = h.changed_by)) ORDER BY h.changed_at DESC), '[]'::jsonb)
      FROM participant_email_history h WHERE h.participant_id = p.id),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = p.id AND status = 'pending'),
    'has_logged_in', p.auth_user_id IS NOT NULL,
    'access_configured', p.password_configured_at IS NOT NULL,
    'password_configured_at', p.password_configured_at,
    'platform_consent_at', (SELECT platform_consent_at FROM participant_profiles WHERE participant_id = p.id),
    'platform_consent_source', (SELECT platform_consent_source FROM participant_profiles WHERE participant_id = p.id),
    'attendances', (SELECT count(*) FROM attendances WHERE participant_id = p.id),
    -- Compatibilidad con el frontend anterior (el contrato las retira):
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

CREATE OR REPLACE FUNCTION public.search_participants(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q text := lower(btrim(coalesce(p_query, ''))); d text;
BEGIN
  PERFORM require_operativo();
  IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
  d := regexp_replace(q, '[^0-9]', '', 'g');
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT p.id, p.full_name, p.email, p.phone, p.high_school, p.origin, p.is_demo,
        c.name AS career_name, p.auth_user_id IS NOT NULL AS has_logged_in,
        p.password_configured_at IS NOT NULL AS access_configured,
        (SELECT count(*) FROM participant_import_conflicts k WHERE k.participant_id = p.id AND k.status = 'pending')::int AS pending_conflicts,
        -- Compatibilidad con el frontend anterior (el contrato las retira):
        true AS has_birth_date,
        coalesce((access_lock_state(p.email)->>'locked')::boolean, false) AS access_locked
      FROM participants p LEFT JOIN careers c ON c.id = p.initial_career_id
      WHERE p.edition_id = active_edition_id()
        AND (lower(p.full_name) LIKE '%' || q || '%' OR p.email LIKE '%' || q || '%'
          OR (length(d) >= 4 AND p.phone LIKE '%' || d || '%'))
      ORDER BY p.full_name LIMIT 50
    ) x), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.coordination_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  PERFORM require_coordinacion();
  RETURN jsonb_build_object(
    'participants_total', (SELECT count(*) FROM participants WHERE edition_id = v_ed),
    'participants_forms', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'forms'),
    'participants_manual', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'manual'),
    'participants_self_service', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'self_service'),
    'participants_demo', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND is_demo),
    'missing_birth_date', 0,
    'platform_consents', (SELECT count(*) FROM participant_profiles pp JOIN participants p ON p.id = pp.participant_id
      WHERE p.edition_id = v_ed AND pp.platform_consent_at IS NOT NULL),
    'activities', (SELECT count(*) FROM activities WHERE edition_id = v_ed),
    'sessions', (SELECT count(*) FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.edition_id = v_ed),
    'attendances', (SELECT count(*) FROM attendances at JOIN participants p ON p.id = at.participant_id WHERE p.edition_id = v_ed),
    'with_interests', (SELECT count(DISTINCT i.participant_id) FROM post_event_interests i JOIN participants p ON p.id = i.participant_id
      WHERE p.edition_id = v_ed),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts c JOIN participants p ON p.id = c.participant_id
      WHERE p.edition_id = v_ed AND c.status = 'pending'),
    'theme_locked', theme_is_locked(v_ed)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_import_conflicts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN coalesce((SELECT jsonb_agg(row_to_json(x) ORDER BY x.created_at) FROM (
    SELECT c.id, c.participant_id, c.field, c.created_at, p.full_name, p.email,
      CASE c.field WHEN 'initial_career_id' THEN (SELECT name FROM careers WHERE id::text = c.imported_value) ELSE c.imported_value END AS imported_value,
      CASE c.field
        WHEN 'full_name' THEN p.full_name WHEN 'phone' THEN p.phone
        WHEN 'high_school' THEN p.high_school WHEN 'high_school_grade' THEN p.high_school_grade
        WHEN 'entry_period' THEN p.entry_period
        ELSE (SELECT name FROM careers WHERE id = p.initial_career_id) END AS current_value,
      (SELECT full_name FROM staff_members WHERE user_id::text = p.manual_overrides->c.field->>'by') AS corrected_by,
      p.manual_overrides->c.field->>'at' AS corrected_at
    FROM participant_import_conflicts c JOIN participants p ON p.id = c.participant_id
    WHERE c.status = 'pending' AND p.edition_id = active_edition_id()
  ) x), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_import_conflict(p_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c participant_import_conflicts%ROWTYPE;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO c FROM participant_import_conflicts WHERE id = p_id AND status = 'pending' FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_accept THEN
    UPDATE participants SET
      full_name = CASE WHEN c.field = 'full_name' THEN c.imported_value ELSE full_name END,
      phone = CASE WHEN c.field = 'phone' THEN c.imported_value ELSE phone END,
      high_school = CASE WHEN c.field = 'high_school' THEN c.imported_value ELSE high_school END,
      high_school_grade = CASE WHEN c.field = 'high_school_grade' THEN c.imported_value ELSE high_school_grade END,
      entry_period = CASE WHEN c.field = 'entry_period' THEN c.imported_value ELSE entry_period END,
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

-- ---------------------------------------------------------------------------------------------------------
-- 6. Edición administrativa: grado y periodo, sin fecha de nacimiento
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_participant(p_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur participants%ROWTYPE;
  n participants%ROWTYPE;
  v_fields text[] := '{}';
  v_cleared text[] := '{}';
  v_reason text := nullif(left(btrim(coalesce(p->>'email_reason', '')), 300), '');
  v_ov jsonb;
  v_career2 uuid;
  v_existing_career2 uuid;
  v_new_career1 uuid;
  v_new_career2 uuid;
  v_career_ids uuid[];
  v_career_raws text[];
  v_demo boolean;
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
  IF p ? 'phone' THEN n.phone := clean_phone(p->>'phone'); END IF;
  IF p ? 'high_school' THEN n.high_school := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), ''); END IF;
  IF p ? 'high_school_grade' THEN n.high_school_grade := nullif(btrim(coalesce(p->>'high_school_grade', '')), '');
    IF n.high_school_grade IS NOT NULL AND n.high_school_grade NOT IN ('1', '2', '3', 'graduado') THEN RAISE EXCEPTION 'INVALID_GRADE'; END IF;
  END IF;
  IF p ? 'entry_period' THEN n.entry_period := nullif(btrim(coalesce(p->>'entry_period', '')), '');
    IF n.entry_period IS NOT NULL AND n.entry_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  END IF;
  IF p ? 'initial_career_id' THEN n.initial_career_id := nullif(p->>'initial_career_id', '')::uuid;
    IF n.initial_career_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = n.initial_career_id) THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
  END IF;

  IF p ? 'initial_career_id_2' THEN
    v_career2 := nullif(p->>'initial_career_id_2', '')::uuid;
    IF v_career2 IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career2 AND is_active) THEN
        RAISE EXCEPTION 'INVALID_CAREER';
      END IF;
      v_demo := cur.is_demo;
      IF NOT v_demo AND EXISTS (SELECT 1 FROM careers WHERE id = v_career2 AND is_demo) THEN
        RAISE EXCEPTION 'CAREER_ENVIRONMENT_MISMATCH';
      END IF;
      IF v_career2 = coalesce(n.initial_career_id, cur.initial_career_id) THEN
        RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
      END IF;
      IF coalesce(n.initial_career_id, cur.initial_career_id) IS NULL THEN
        RAISE EXCEPTION 'CAREER_2_REQUIRES_CAREER_1';
      END IF;
    END IF;
  END IF;

  IF n.email IS DISTINCT FROM cur.email THEN
    IF email_in_use(cur.edition_id, n.email, cur.id) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;
    v_fields := v_fields || 'email'::text;
  END IF;
  IF n.full_name IS DISTINCT FROM cur.full_name THEN v_fields := v_fields || 'full_name'::text; END IF;
  IF n.phone IS DISTINCT FROM cur.phone THEN v_fields := v_fields || 'phone'::text;
    IF n.phone IS NULL THEN v_cleared := v_cleared || 'phone'::text; END IF; END IF;
  IF n.high_school IS DISTINCT FROM cur.high_school THEN v_fields := v_fields || 'high_school'::text;
    IF n.high_school IS NULL THEN v_cleared := v_cleared || 'high_school'::text; END IF; END IF;
  IF n.high_school_grade IS DISTINCT FROM cur.high_school_grade THEN v_fields := v_fields || 'high_school_grade'::text;
    IF n.high_school_grade IS NULL THEN v_cleared := v_cleared || 'high_school_grade'::text; END IF; END IF;
  IF n.entry_period IS DISTINCT FROM cur.entry_period THEN v_fields := v_fields || 'entry_period'::text;
    IF n.entry_period IS NULL THEN v_cleared := v_cleared || 'entry_period'::text; END IF; END IF;
  IF n.initial_career_id IS DISTINCT FROM cur.initial_career_id THEN v_fields := v_fields || 'initial_career_id'::text;
    IF n.initial_career_id IS NULL THEN v_cleared := v_cleared || 'initial_career_id'::text; END IF; END IF;

  SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
  IF p ? 'initial_career_id_2' AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
    v_fields := v_fields || 'initial_career_id_2'::text;
    IF v_career2 IS NULL THEN v_cleared := v_cleared || 'initial_career_id_2'::text; END IF;
  END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f,
    jsonb_build_object('by', auth.uid(), 'at', now()) || CASE WHEN f = ANY(v_cleared) THEN '{"cleared": true}'::jsonb ELSE '{}'::jsonb END),
    '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f WHERE f <> 'email';

  IF n.email IS DISTINCT FROM cur.email THEN
    INSERT INTO participant_email_history (participant_id, edition_id, email, changed_by, reason)
    VALUES (cur.id, cur.edition_id, cur.email, auth.uid(), v_reason)
    ON CONFLICT (edition_id, email) DO NOTHING;
  END IF;

  UPDATE participants SET email = n.email, full_name = n.full_name, phone = n.phone,
    high_school = n.high_school, high_school_grade = n.high_school_grade, entry_period = n.entry_period,
    initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  IF v_fields @> ARRAY['initial_career_id']::text[] OR v_fields @> ARRAY['initial_career_id_2']::text[] THEN
    IF p ? 'initial_career_id' THEN
      v_new_career1 := n.initial_career_id;
    ELSE
      SELECT career_id INTO v_new_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
    END IF;
    IF p ? 'initial_career_id_2' THEN
      v_new_career2 := v_career2;
    ELSE
      v_new_career2 := v_existing_career2;
    END IF;
    IF v_new_career1 IS NULL AND v_new_career2 IS NOT NULL THEN
      v_new_career1 := v_new_career2;
      v_new_career2 := NULL;
    END IF;
    v_career_ids := ARRAY[v_new_career1, v_new_career2];
    v_career_raws := ARRAY[
      (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 1),
      CASE WHEN p ? 'initial_career_id_2' THEN NULL ELSE (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2) END
    ];
    IF v_new_career1 IS NOT NULL OR v_new_career2 IS NOT NULL THEN
      PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
    ELSE
      DELETE FROM initial_interests WHERE participant_id = cur.id;
      UPDATE participants SET initial_career_id = NULL, initial_career_raw = NULL, updated_at = now() WHERE id = cur.id;
    END IF;
  END IF;

  PERFORM write_audit('participant.updated', jsonb_build_object('participant_id', cur.id, 'fields', to_jsonb(v_fields),
    'cleared', to_jsonb(v_cleared), 'email_changed', n.email IS DISTINCT FROM cur.email, 'reason_given', v_reason IS NOT NULL));
END;
$$;

-- Solo frontend anterior: el alta manual ya no exige fecha de nacimiento (el contrato la retira).
CREATE OR REPLACE FUNCTION public.create_participant_manual(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := btrim(coalesce(p->>'full_name', ''));
  v_phone text;
  v_school text := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), '');
  v_career uuid;
  v_career2 uuid;
  v_demo boolean := coalesce((p->>'is_demo')::boolean, false);
  v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_ov jsonb;
  v_id uuid;
BEGIN
  PERFORM require_operativo();
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF btrim(coalesce(p->>'phone', '')) = '' THEN RAISE EXCEPTION 'PHONE_REQUIRED'; END IF;
  v_phone := clean_phone(p->>'phone');
  IF v_phone IS NULL THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  IF v_school IS NULL THEN RAISE EXCEPTION 'HIGH_SCHOOL_REQUIRED'; END IF;
  IF coalesce(p->>'initial_career_id', '') = '' THEN RAISE EXCEPTION 'CAREER_REQUIRED'; END IF;
  SELECT id INTO v_career FROM careers WHERE id::text = p->>'initial_career_id' AND is_active AND (v_demo OR NOT is_demo);
  IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF coalesce(p->>'initial_career_id_2', '') <> '' THEN
    SELECT id INTO v_career2 FROM careers WHERE id::text = p->>'initial_career_id_2' AND is_active AND (v_demo OR NOT is_demo);
    IF v_career2 IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
    IF v_career2 = v_career THEN RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST'; END IF;
  END IF;
  IF coalesce((p->>'consent_confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF email_in_use(v_ed, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  v_ov := jsonb_build_object('full_name', v_now, 'phone', v_now, 'high_school', v_now, 'initial_career_id', v_now);
  IF v_career2 IS NOT NULL THEN v_ov := v_ov || jsonb_build_object('initial_career_id_2', v_now); END IF;

  INSERT INTO participants (edition_id, email, full_name, phone, high_school, initial_career_id, origin,
    manual_consent_captured_by, manual_consent_at, manual_consent_version, created_by, is_demo, manual_overrides)
  VALUES (v_ed, v_email, v_name, v_phone, v_school, v_career, 'manual',
    auth.uid(), now(), (SELECT privacy_notice_version FROM editions WHERE id = v_ed), auth.uid(), v_demo, v_ov)
  RETURNING id INTO v_id;
  PERFORM sync_initial_interests(v_id, ARRAY[v_career, v_career2], ARRAY[NULL, NULL]);
  PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id,
    'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_ov) k)));
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Exportación con grado y periodo, sin fecha de nacimiento
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_participants(p_reason text, p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed editions%ROWTYPE; v_rows jsonb; v_n int; v_cols jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  SELECT * INTO v_ed FROM editions WHERE id = active_edition_id();

  SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.full_name), '[]'::jsonb), count(*) INTO v_rows, v_n FROM (
    SELECT p.full_name, p.email, p.phone, p.high_school, p.high_school_grade, p.entry_period,
      ii1.career_name AS initial_career, ii1.career_code AS initial_career_code, ii1.division_name AS initial_division,
      ii1.career_name AS initial_career_1, ii1.career_code AS initial_career_1_code,
      ii2.career_name AS initial_career_2, ii2.career_code AS initial_career_2_code,
      ii1.career_raw AS initial_career_received,
      ii2.career_raw AS initial_career_2_received,
      p.origin, p.is_demo, p.forms_consent, p.forms_consent_at, p.manual_consent_at,
      pp.platform_consent_at, pp.platform_consent_source, p.auth_user_id IS NOT NULL AS logged_in,
      p.password_configured_at IS NOT NULL AS access_configured,
      (SELECT name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id WHERE i.participant_id = p.id AND i.preference = 1) AS interest_1,
      (SELECT name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id WHERE i.participant_id = p.id AND i.preference = 2) AS interest_2,
      (SELECT name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id WHERE i.participant_id = p.id AND i.preference = 3) AS interest_3,
      (SELECT count(*) FROM attendances a WHERE a.participant_id = p.id) AS attendances,
      (SELECT string_agg(h.email, ', ' ORDER BY h.changed_at) FROM participant_email_history h WHERE h.participant_id = p.id) AS previous_emails,
      (SELECT coalesce(jsonb_object_agg(e.key, e.value->>'value'), '{}'::jsonb)
        FROM jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e) AS forms_extra,
      p.created_at
    FROM participants p
    LEFT JOIN LATERAL (
      SELECT c.name AS career_name, c.code AS career_code, d.name AS division_name, ii.career_raw
      FROM initial_interests ii
      JOIN careers c ON c.id = ii.career_id
      LEFT JOIN divisions d ON d.id = c.division_id
      WHERE ii.participant_id = p.id AND ii.preference = 1
    ) ii1 ON true
    LEFT JOIN LATERAL (
      SELECT c.name AS career_name, c.code AS career_code, ii.career_raw
      FROM initial_interests ii
      JOIN careers c ON c.id = ii.career_id
      WHERE ii.participant_id = p.id AND ii.preference = 2
    ) ii2 ON true
    LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
    WHERE p.edition_id = v_ed.id AND (coalesce(p_include_demo, false) OR NOT p.is_demo)
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label) ORDER BY k.pos, k.label, k.key), '[]'::jsonb)
  INTO v_cols FROM (
    SELECT DISTINCT ON (e.key) e.key, e.value->>'label' AS label, coalesce((e.value->>'pos')::int, 99999) AS pos
    FROM participants p, jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e
    WHERE p.edition_id = v_ed.id AND (coalesce(p_include_demo, false) OR NOT p.is_demo)
    ORDER BY e.key, coalesce((e.value->>'pos')::int, 99999), e.value->>'label'
  ) k;

  PERFORM write_audit('participants.exported', jsonb_build_object('count', v_n, 'reason', left(btrim(p_reason), 300),
    'include_demo', coalesce(p_include_demo, false)));
  RETURN jsonb_build_object('edition', v_ed.name, 'edition_code', v_ed.code, 'generated_at', now(),
    'generated_by', (SELECT full_name FROM staff_members WHERE user_id = auth.uid()), 'count', v_n, 'rows', v_rows,
    'extra_columns', v_cols, 'roster_status', v_ed.roster_status);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Importación del Forms oficial
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_participant_import(p_rows jsonb, p_is_demo boolean, p_batch uuid, p_career_map jsonb, p_career_map_2 jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  v_apply boolean := p_batch IS NOT NULL;
  v_map jsonb := CASE WHEN jsonb_typeof(p_career_map) = 'object' THEN p_career_map ELSE '{}'::jsonb END;
  v_map2 jsonb := CASE WHEN jsonb_typeof(p_career_map_2) = 'object' THEN p_career_map_2 ELSE '{}'::jsonb END;
  r record; cur participants%ROWTYPE; v_match record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
  v_email text; v_name text; v_phone text; v_school text; v_grade text; v_period text; v_consent boolean;
  v_career uuid; v_career_raw text; v_career2 uuid; v_career2_raw text;
  v_at timestamptz;
  v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
  v_extra jsonb; v_old_forms jsonb; v_extra_changed boolean; v_alias text;
  v_ckey text; v_ctarget text; v_cname text;
  v_ckey2 text; v_ctarget2 text; v_cname2 text;
  v_unmatched jsonb := '{}'::jsonb;
  v_unmatched2 jsonb := '{}'::jsonb;
  v_career_raw_orig text; v_career2_raw_orig text;
  v_career_ids uuid[]; v_career_raws text[];
  v_existing_career1 uuid; v_existing_career2 uuid;
  v_has_c2_override boolean;
BEGIN
  IF (SELECT roster_status FROM editions WHERE id = v_ed) = 'oficial' THEN RAISE EXCEPTION 'ROSTER_OFFICIAL'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN
    SELECT x.value AS j, x.ord,
      max(x.ord) OVER (PARTITION BY lower(btrim(coalesce(x.value->>'email', '')))) AS last_ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord
  LOOP
    v_errors := '{}'; v_warn := '{}'; v_conf := '{}'; v_upd := '{}'::jsonb; v_alias := NULL;
    v_extra_changed := false; v_ckey := NULL; v_ctarget := NULL; v_ckey2 := NULL; v_ctarget2 := NULL;
    v_email := lower(btrim(coalesce(r.j->>'email', '')));
    v_name := left(btrim(regexp_replace(coalesce(r.j->>'full_name', ''), '\s+', ' ', 'g')), 150);
    v_school := nullif(left(btrim(coalesce(r.j->>'high_school', '')), 200), '');
    v_phone := NULL; v_career := NULL; v_career2 := NULL; v_at := NULL;
    v_career_raw := NULL; v_career2_raw := NULL;
    v_grade := nullif(btrim(coalesce(r.j->>'high_school_grade', '')), '');
    v_period := nullif(btrim(coalesce(r.j->>'entry_period', '')), '');
    v_consent := CASE WHEN jsonb_typeof(r.j->'consent') = 'boolean' THEN (r.j->>'consent')::boolean ELSE NULL END;

    v_career_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career', ''), '\s+', ' ', 'g')), 200);
    v_career2_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career_2', ''), '\s+', ' ', 'g')), 200);

    IF v_career2_raw_orig <> '' THEN
      v_career_raw := v_career_raw_orig;
      v_career2_raw := v_career2_raw_orig;
    ELSIF v_career_raw_orig ~ '[,;]' THEN
      v_career_raw := left(btrim(split_part(v_career_raw_orig, ',', 1)), 200);
      v_career2_raw := left(btrim(split_part(v_career_raw_orig, ',', 2)), 200);
      IF v_career2_raw = '' AND v_career_raw_orig ~ ';' THEN
        v_career_raw := left(btrim(split_part(v_career_raw_orig, ';', 1)), 200);
        v_career2_raw := left(btrim(split_part(v_career_raw_orig, ';', 2)), 200);
      END IF;
      v_career_raw := left(btrim(regexp_replace(v_career_raw, '\s+', ' ', 'g')), 200);
      v_career2_raw := left(btrim(regexp_replace(v_career2_raw, '\s+', ' ', 'g')), 200);
    ELSE
      v_career_raw := v_career_raw_orig;
    END IF;

    v_extra := normalize_forms_extra(r.j->'extra');

    IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN v_errors := v_errors || 'Correo inválido'::text; END IF;
    IF length(v_name) < 3 THEN v_errors := v_errors || 'Falta el nombre'::text; END IF;
    IF v_consent IS FALSE THEN v_errors := v_errors || 'Sin consentimiento de privacidad'::text; END IF;
    BEGIN v_phone := clean_phone(r.j->>'phone');
    EXCEPTION WHEN others THEN v_warn := v_warn || 'Teléfono inválido, se omitió'::text; END;
    IF v_grade IS NOT NULL AND v_grade NOT IN ('1', '2', '3', 'graduado') THEN
      v_warn := v_warn || ('Grado de preparatoria no reconocido "' || left(v_grade, 40) || '", se omitió')::text; v_grade := NULL;
    END IF;
    IF v_period IS NOT NULL AND v_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN
      v_warn := v_warn || ('Periodo de ingreso no reconocido "' || left(v_period, 40) || '", se omitió')::text; v_period := NULL;
    END IF;

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

    -- Resolve career 2 (the official Forms has none; kept for files that still bring it)
    IF v_career2_raw <> '' THEN
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
        'key', v_ckey, 'value', coalesce(v_unmatched->v_ckey->>'value', v_career_raw),
        'count', coalesce((v_unmatched->v_ckey->>'count')::int, 0) + 1, 'target', v_ctarget));
    END IF;
    IF v_ckey2 IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched2 := jsonb_set(v_unmatched2, ARRAY[v_ckey2], jsonb_build_object(
        'key', v_ckey2, 'value', coalesce(v_unmatched2->v_ckey2->>'value', v_career2_raw),
        'count', coalesce((v_unmatched2->v_ckey2->>'count')::int, 0) + 1, 'target', v_ctarget2));
    END IF;

    IF v_status = 'new' THEN
      IF v_apply THEN
        INSERT INTO participants (edition_id, email, full_name, phone, high_school, high_school_grade, entry_period,
          initial_career_id, initial_career_raw, origin, import_batch_id, forms_consent, forms_consent_at, forms_consent_version,
          created_by, is_demo, extra)
        VALUES (v_ed, v_email, v_name, v_phone, v_school, v_grade, v_period, v_career, nullif(v_career_raw, ''), 'forms', p_batch,
          v_consent, CASE WHEN v_consent THEN coalesce(v_at, now()) END, CASE WHEN v_consent THEN v_ver END,
          auth.uid(), p_is_demo,
          CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END)
        RETURNING id INTO v_match.participant_id;

        v_career_ids := ARRAY[v_career, v_career2];
        v_career_raws := ARRAY[nullif(v_career_raw, ''), nullif(v_career2_raw, '')];
        PERFORM sync_initial_interests(v_match.participant_id, v_career_ids, v_career_raws);
      END IF;
    ELSIF v_status = 'pending' THEN
      SELECT career_id INTO v_existing_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
      SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
      v_has_c2_override := cur.manual_overrides ? 'initial_career_id_2';
      -- A file without a second career (the official Forms has none) never erases an existing one.
      IF v_career2_raw_orig = '' AND NOT (v_career_raw_orig ~ '[,;]') THEN
        v_career2 := v_existing_career2;
        v_career2_raw := (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2);
      END IF;

      v_nv := jsonb_strip_nulls(jsonb_build_object('full_name', v_name, 'phone', v_phone, 'high_school', v_school,
        'initial_career_id', v_career::text, 'high_school_grade', v_grade, 'entry_period', v_period));
      v_cv := jsonb_build_object('full_name', cur.full_name, 'phone', cur.phone, 'high_school', cur.high_school,
        'initial_career_id', cur.initial_career_id::text, 'high_school_grade', cur.high_school_grade, 'entry_period', cur.entry_period);
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

      IF v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
        v_conf := v_conf || 'initial_career_id_2';
        IF v_apply THEN
          INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value)
          VALUES (cur.id, p_batch, 'initial_career_id_2', v_career2::text)
          ON CONFLICT (participant_id, field) WHERE status = 'pending'
          DO UPDATE SET imported_value = EXCLUDED.imported_value, batch_id = EXCLUDED.batch_id, created_at = now();
        END IF;
      END IF;

      v_old_forms := coalesce(cur.extra->'forms', '{}'::jsonb);
      v_extra_changed := EXISTS (SELECT 1 FROM jsonb_each(v_extra) e
        WHERE (v_old_forms->e.key->>'value') IS DISTINCT FROM (e.value->>'value'));

      v_status := CASE WHEN array_length(v_conf, 1) IS NOT NULL THEN 'conflict'
                       WHEN v_upd <> '{}'::jsonb OR v_extra_changed
                         OR (NOT v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2)
                       THEN 'update' ELSE 'unchanged' END;

      IF v_apply THEN
        UPDATE participants SET
          full_name = coalesce(v_upd->>'full_name', full_name),
          phone = coalesce(v_upd->>'phone', phone),
          high_school = coalesce(v_upd->>'high_school', high_school),
          high_school_grade = coalesce(v_upd->>'high_school_grade', high_school_grade),
          entry_period = coalesce(v_upd->>'entry_period', entry_period),
          initial_career_id = CASE WHEN v_upd ? 'initial_career_id' THEN (v_upd->>'initial_career_id')::uuid ELSE initial_career_id END,
          initial_career_raw = coalesce(nullif(v_career_raw, ''), initial_career_raw),
          extra = CASE WHEN v_extra = '{}'::jsonb THEN extra
                  ELSE coalesce(extra, '{}'::jsonb) || jsonb_build_object('forms', v_old_forms || v_extra) END,
          forms_consent = coalesce(v_consent, forms_consent),
          forms_consent_at = CASE WHEN v_consent THEN coalesce(forms_consent_at, v_at, now()) ELSE forms_consent_at END,
          forms_consent_version = CASE WHEN v_consent THEN coalesce(forms_consent_version, v_ver) ELSE forms_consent_version END,
          import_batch_id = p_batch,
          updated_at = now()
        WHERE id = cur.id;

        IF NOT (cur.manual_overrides ? 'initial_career_id') THEN
          v_career_ids := ARRAY[
            CASE WHEN v_upd ? 'initial_career_id' THEN v_career ELSE coalesce(v_existing_career1, cur.initial_career_id) END,
            CASE WHEN v_has_c2_override THEN v_existing_career2 ELSE v_career2 END
          ];
          v_career_raws := ARRAY[
            coalesce(nullif(v_career_raw, ''), cur.initial_career_raw),
            CASE WHEN v_has_c2_override THEN (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2)
                 ELSE nullif(v_career2_raw, '') END
          ];
          IF v_career_ids[1] IS NOT NULL OR v_career_ids[2] IS NOT NULL THEN
            PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
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
      'alert', NULL,
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
    'counts', v_counts, 'rows', v_results,
    'unmatched_careers', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched) u),
    'unmatched_careers_2', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched2) u)
  );
END;
$$;
