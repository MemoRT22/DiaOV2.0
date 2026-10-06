-- Acceso de participantes con correo + contraseña: fase CONTRACT (destructiva).
--
-- NO aplicar antes de publicar el frontend nuevo ni antes de redesplegar la Edge Function `student-access` SIN la ruta
-- de compatibilidad (`legacy.ts`). Orden de despliegue:
--   1. Migración EXPAND (20261006191413 y 20261006192044): ya aplicadas, compatibles con el frontend anterior.
--   2. Edge Functions `student-access` (compatible) y `participant-admin`.
--   3. Publicar el frontend nuevo.
--   4. Esta migración + redesplegar `student-access` sin `legacy.ts`.
--
-- Qué retira: fecha de nacimiento, bloqueo por intentos fallidos (access_attempts, access_lock_state, clear_access_lock),
-- el alta manual (create_participant_manual) y las claves de compatibilidad de las lecturas de Participantes.

-- Los conflictos de importación ya no pueden referirse a la fecha de nacimiento.
DELETE FROM public.participant_import_conflicts WHERE field = 'birth_date';
ALTER TABLE public.participant_import_conflicts DROP CONSTRAINT IF EXISTS participant_import_conflicts_field_check;
ALTER TABLE public.participant_import_conflicts ADD CONSTRAINT participant_import_conflicts_field_check
  CHECK (field IN ('full_name', 'phone', 'high_school', 'high_school_grade', 'entry_period', 'initial_career_id', 'initial_career_id_2'));

-- Lecturas sin claves de compatibilidad (deben redefinirse ANTES de borrar lo que consultaban).
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
        (SELECT count(*) FROM participant_import_conflicts k WHERE k.participant_id = p.id AND k.status = 'pending')::int AS pending_conflicts
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

-- Alta manual: los participantes nuevos llegan por la importación oficial o se registran solos.
DROP FUNCTION IF EXISTS public.create_participant_manual(jsonb);

-- Bloqueo por intentos fallidos: sin fecha de nacimiento ya no hay nada que adivinar.
DROP FUNCTION IF EXISTS public.clear_access_lock(uuid);
DROP FUNCTION IF EXISTS public.access_lock_state(text);
DROP TABLE IF EXISTS public.access_attempts;

-- Fecha de nacimiento.
ALTER TABLE public.participants DROP COLUMN IF EXISTS birth_date;
DROP FUNCTION IF EXISTS public.check_birth_date(date);
