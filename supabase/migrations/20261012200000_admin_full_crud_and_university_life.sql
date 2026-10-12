/*
  CRUD administrativo completo (talleres, alumnos, divisiones) y tipo de misión en el catálogo del alumno.

  Contexto: Día OV 2026 sigue en pruebas. Coordinación necesita poder eliminar definitivamente lo que crea, con sus
  datos dependientes, sin bloqueos del tipo HAS_RESERVATIONS / HAS_ATTENDANCES. Nada de esto se ejecuta solo: cada
  eliminación la inicia Coordinación desde el panel, sobre un registro concreto, y queda en auditoría.

  Qué agrega
  1. Talleres (mismo modelo unificado `workshop_submissions` → `activities` → `activity_sessions`):
     - `workshop_admin_create_internal`: alta desde el panel; opcionalmente publica en la misma transacción.
     - `workshop_admin_delete_internal`: elimina el taller en cualquier estado junto con actividad, sesiones,
       reservaciones, asistencias y credenciales.
     - `workshop_admin_get_internal`: además informa `dependents` (qué se eliminaría).
     - `workshop_admin_legacy_list_internal` / `workshop_admin_activity_delete_internal`: los talleres que existen
       solo como actividad (datos de prueba anteriores al flujo de expedientes) también se consultan y eliminan
       uno por uno; no se les inventa un expediente.
  2. Alumnos:
     - `admin_create_participant`: alta manual por Coordinación. NO registra consentimiento: el Aviso de Privacidad lo
       acepta el propio participante al entrar.
     - `participant_delete_preview` / `participant_delete_plan_internal` / `participant_delete_internal`: eliminación
       definitiva con todo lo suyo. La identidad de Auth la retira la Edge Function y solo si es de participante.
  3. Divisiones:
     - `division_delete_preview` / `delete_division`: eliminación con limpieza coherente de carreras, intereses y
       asociaciones; los talleres que comparten otras divisiones se conservan con ellas.
  4. Catálogo del alumno:
     - `my_reservation_board()` expone `activity_type` y `experience_category` por sesión (campos nuevos; nada cambia
       en reservaciones, cupos, progreso, credenciales ni sellos).

  Qué NO cambia: reglas de reservación y check-in, sellos por duración, reglas y operación del sorteo.
*/

-- =====================================================================================================================
-- 1. Talleres
-- =====================================================================================================================

-- Núcleo de la eliminación de un taller. Sin control de acceso: solo lo llaman las operaciones de Coordinación de
-- este archivo. Bloquea la actividad y sus sesiones antes de borrar, de modo que una reservación o un check-in
-- simultáneos esperan y después simplemente ya no encuentran la sesión (nunca queda una fila colgando).
CREATE OR REPLACE FUNCTION public.workshop_delete_cascade_internal(p_submission_id uuid, p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session uuid;
  v_sessions int := 0; v_reservations int := 0; v_attendances int := 0; v_participants int := 0;
BEGIN
  IF p_activity_id IS NOT NULL THEN
    PERFORM 1 FROM public.activities WHERE id = p_activity_id FOR UPDATE;
    PERFORM 1 FROM public.activity_sessions WHERE activity_id = p_activity_id ORDER BY id FOR UPDATE;

    SELECT count(DISTINCT x.participant_id) INTO v_participants FROM (
      SELECT participant_id FROM public.reservations WHERE activity_id = p_activity_id
      UNION SELECT participant_id FROM public.attendances WHERE activity_id = p_activity_id
        OR session_id IN (SELECT id FROM public.activity_sessions WHERE activity_id = p_activity_id)) x;

    -- Las pantallas abiertas de los alumnos vuelven a consultar su catálogo al confirmarse la eliminación.
    FOR v_session IN SELECT id FROM public.activity_sessions WHERE activity_id = p_activity_id LOOP
      PERFORM public.broadcast_availability(v_session, 'session_changed');
    END LOOP;

    DELETE FROM public.attendances
    WHERE activity_id = p_activity_id
       OR session_id IN (SELECT id FROM public.activity_sessions WHERE activity_id = p_activity_id);
    GET DIAGNOSTICS v_attendances = ROW_COUNT;
    DELETE FROM public.reservations
    WHERE activity_id = p_activity_id
       OR session_id IN (SELECT id FROM public.activity_sessions WHERE activity_id = p_activity_id);
    GET DIAGNOSTICS v_reservations = ROW_COUNT;
    -- `session_credentials` (heredada) cae en cascada con la sesión.
    DELETE FROM public.activity_sessions WHERE activity_id = p_activity_id;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
  END IF;

  -- El expediente primero: así nunca existe, ni un instante, un «publicado» sin actividad.
  IF p_submission_id IS NOT NULL THEN
    DELETE FROM public.workshop_submissions WHERE id = p_submission_id;   -- cascada: workshop_submission_careers
  END IF;
  IF p_activity_id IS NOT NULL THEN
    DELETE FROM public.activities WHERE id = p_activity_id;   -- cascada: activity_careers, activity_divisions, activity_credentials
  END IF;

  RETURN jsonb_build_object('sessions', v_sessions, 'reservations', v_reservations,
    'attendances', v_attendances, 'participants', v_participants);
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_delete_cascade_internal(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workshop_admin_delete_internal(p_actor uuid, p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ed public.editions%ROWTYPE;
  v_submission public.workshop_submissions%ROWTYPE;
  v_removed jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members m JOIN public.staff_roles r
    ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_ed FROM public.editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_ed.id FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_removed := public.workshop_delete_cascade_internal(v_submission.id, v_submission.published_activity_id);

  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_ed.id, p_actor, 'workshop_submission.deleted', jsonb_build_object(
    'submission_id', v_submission.id, 'activity_id', v_submission.published_activity_id,
    'title', v_submission.title, 'activity_type', v_submission.activity_type,
    'from_status', v_submission.status, 'is_demo', v_submission.is_demo, 'removed', v_removed));

  RETURN jsonb_build_object('submission_id', v_submission.id, 'deleted', true, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_admin_delete_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Alta desde el panel con la MISMA validación y el mismo camino que el formulario público; con `p_publish` el taller
-- queda publicado en la misma transacción (si la publicación falla, no queda nada a medias).
CREATE OR REPLACE FUNCTION public.workshop_admin_create_internal(p_actor uuid, p_payload jsonb, p_publish boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created jsonb; v_id uuid; v_published jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members m JOIN public.staff_roles r
    ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  v_created := public.create_workshop_submission_internal(p_payload);
  v_id := (v_created->>'submission_id')::uuid;
  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  SELECT edition_id, p_actor, 'workshop_submission.created_by_admin',
    jsonb_build_object('submission_id', v_id, 'publish', coalesce(p_publish, false))
  FROM public.workshop_submissions WHERE id = v_id;

  IF coalesce(p_publish, false) THEN
    v_published := public.publish_workshop_submission_internal(p_actor, v_id);
  END IF;
  RETURN jsonb_build_object('submission_id', v_id,
    'status', coalesce(v_published->>'status', v_created->>'status'),
    'activity_id', v_published->>'activity_id', 'session_count', v_published->'session_count');
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_admin_create_internal(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- El expediente informa además qué se eliminaría junto con el taller (para la confirmación del panel).
CREATE OR REPLACE FUNCTION public.workshop_admin_get_internal(p_submission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_edition uuid;
  v_submission public.workshop_submissions%ROWTYPE;
  v_careers jsonb;
  v_reviewer text;
  v_sessions jsonb := '[]'::jsonb;
  v_dependents jsonb := jsonb_build_object('sessions', 0, 'reservations', 0, 'attendances', 0, 'participants', 0);
BEGIN
  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_edition AND status <> 'draft';
  IF v_submission.id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'career_id', c.id, 'career_name', c.name, 'division_id', d.id,
    'division_name', d.name, 'division_code', d.code
  ) ORDER BY d.sort_order, d.name, c.name), '[]'::jsonb) INTO v_careers
  FROM public.workshop_submission_careers sc
  JOIN public.careers c ON c.id = sc.career_id
  JOIN public.divisions d ON d.id = c.division_id
  WHERE sc.submission_id = v_submission.id;
  SELECT full_name INTO v_reviewer FROM public.staff_members WHERE user_id = v_submission.reviewed_by;
  IF v_submission.published_activity_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'capacity', s.capacity, 'reserved', public.session_reserved_count(s.id),
      'location', coalesce(nullif(s.location, ''), a.location), 'status', s.status
    ) ORDER BY s.starts_at, s.id), '[]'::jsonb) INTO v_sessions
    FROM public.activity_sessions s
    JOIN public.activities a ON a.id = s.activity_id AND a.edition_id = v_edition
    WHERE s.activity_id = v_submission.published_activity_id;
    SELECT jsonb_build_object(
      'sessions', (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_submission.published_activity_id),
      'reservations', (SELECT count(*) FROM public.reservations WHERE activity_id = v_submission.published_activity_id),
      'attendances', (SELECT count(*) FROM public.attendances WHERE activity_id = v_submission.published_activity_id),
      'participants', (SELECT count(DISTINCT x.participant_id) FROM (
        SELECT participant_id FROM public.reservations WHERE activity_id = v_submission.published_activity_id
        UNION SELECT participant_id FROM public.attendances WHERE activity_id = v_submission.published_activity_id) x))
    INTO v_dependents;
  END IF;
  RETURN to_jsonb(v_submission) || jsonb_build_object('careers', v_careers, 'reviewer_name', v_reviewer,
    'sessions', v_sessions, 'dependents', v_dependents);
END;
$$;

-- Talleres que existen solo como actividad, sin expediente (datos de prueba heredados, anteriores al flujo unificado).
-- No aparecen en la bandeja de expedientes; se listan aparte para poder consultarlos y eliminarlos uno por uno.
CREATE OR REPLACE FUNCTION public.workshop_admin_legacy_list_internal()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', a.id, 'title', a.title, 'activity_type', a.activity_type, 'experience_category', a.experience_category,
    'is_demo', a.is_demo, 'location', nullif(a.location, ''), 'created_at', a.created_at,
    'division_names', coalesce((
      SELECT jsonb_agg(d.name ORDER BY d.sort_order, d.name) FROM public.divisions d
      WHERE d.id = a.division_id OR EXISTS (SELECT 1 FROM public.activity_divisions ad WHERE ad.activity_id = a.id AND ad.division_id = d.id)), '[]'::jsonb),
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'capacity', s.capacity,
        'reserved', public.session_reserved_count(s.id), 'status', s.status) ORDER BY s.starts_at, s.id)
      FROM public.activity_sessions s WHERE s.activity_id = a.id), '[]'::jsonb),
    'dependents', jsonb_build_object(
      'sessions', (SELECT count(*) FROM public.activity_sessions s WHERE s.activity_id = a.id),
      'reservations', (SELECT count(*) FROM public.reservations r WHERE r.activity_id = a.id),
      'attendances', (SELECT count(*) FROM public.attendances t WHERE t.activity_id = a.id),
      'participants', (SELECT count(DISTINCT x.participant_id) FROM (
        SELECT participant_id FROM public.reservations WHERE activity_id = a.id
        UNION SELECT participant_id FROM public.attendances WHERE activity_id = a.id) x))
  ) ORDER BY a.is_demo, a.title, a.id), '[]'::jsonb)
  FROM public.activities a
  WHERE a.edition_id = (SELECT id FROM public.editions WHERE is_active LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM public.workshop_submissions w WHERE w.published_activity_id = a.id);
$$;

REVOKE ALL ON FUNCTION public.workshop_admin_legacy_list_internal() FROM PUBLIC, anon, authenticated;

-- Eliminación de un taller por su actividad. Pensada para los que no tienen expediente; si lo tuviera, se elimina
-- junto con él por el mismo camino, de modo que nunca queda un expediente «publicado» sin actividad.
CREATE OR REPLACE FUNCTION public.workshop_admin_activity_delete_internal(p_actor uuid, p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ed public.editions%ROWTYPE;
  v_activity public.activities%ROWTYPE;
  v_submission uuid;
  v_removed jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members m JOIN public.staff_roles r
    ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_ed FROM public.editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id AND edition_id = v_ed.id FOR UPDATE;
  IF v_activity.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT id INTO v_submission FROM public.workshop_submissions WHERE published_activity_id = v_activity.id FOR UPDATE;

  v_removed := public.workshop_delete_cascade_internal(v_submission, v_activity.id);

  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_ed.id, p_actor, 'catalog.activity_deleted', jsonb_build_object(
    'activity_id', v_activity.id, 'submission_id', v_submission, 'title', v_activity.title,
    'activity_type', v_activity.activity_type, 'is_demo', v_activity.is_demo, 'removed', v_removed));

  RETURN jsonb_build_object('activity_id', v_activity.id, 'deleted', true, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_admin_activity_delete_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- =====================================================================================================================
-- 2. Alumnos
-- =====================================================================================================================

-- Alta manual por Coordinación. Solo correo y nombre son obligatorios; lo demás puede completarse después.
-- Es una operación nueva, no el antiguo `create_participant_manual` (retirado): aquel lo usaba Staff y capturaba el
-- consentimiento en nombre del aspirante; este es exclusivo de Coordinación y no captura consentimiento alguno.
-- No se registra consentimiento alguno: el participante acepta el Aviso al entrar a la plataforma y configura su
-- propia contraseña (o Coordinación le genera una desde su expediente). Los campos capturados quedan marcados como
-- corrección manual, igual que cualquier edición, para que una importación posterior de Forms no los reemplace.
CREATE OR REPLACE FUNCTION public.admin_create_participant(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_name text := btrim(regexp_replace(coalesce(p->>'full_name', ''), '\s+', ' ', 'g'));
  v_phone text;
  v_school text; v_school_id uuid;
  v_grade text := nullif(btrim(coalesce(p->>'high_school_grade', '')), '');
  v_period text := nullif(btrim(coalesce(p->>'entry_period', '')), '');
  v_career uuid;
  v_mark jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
  v_ov jsonb;
  v_id uuid;
BEGIN
  PERFORM require_coordinacion();
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF btrim(coalesce(p->>'phone', '')) <> '' THEN
    BEGIN v_phone := clean_phone(p->>'phone'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_PHONE'; END;
    IF v_phone IS NULL THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
  END IF;
  IF coalesce(p->>'high_school_id', '') <> '' THEN
    SELECT id, name INTO v_school_id, v_school FROM public.high_schools WHERE id::text = p->>'high_school_id' AND is_active;
    IF v_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
  END IF;
  IF v_grade IS NOT NULL AND v_grade NOT IN ('1', '2', '3', 'graduado') THEN RAISE EXCEPTION 'INVALID_GRADE'; END IF;
  IF v_period IS NOT NULL AND v_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  IF coalesce(p->>'initial_career_id', '') <> '' THEN
    SELECT id INTO v_career FROM careers WHERE id::text = p->>'initial_career_id' AND is_active AND NOT is_demo;
    IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  END IF;
  -- Sin duplicados: ni otro participante con ese correo ni un correo anterior (alias) de alguien más.
  IF email_in_use(v_ed, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  v_ov := jsonb_build_object('full_name', v_mark)
    || CASE WHEN v_phone IS NOT NULL THEN jsonb_build_object('phone', v_mark) ELSE '{}'::jsonb END
    || CASE WHEN v_school_id IS NOT NULL THEN jsonb_build_object('high_school', v_mark) ELSE '{}'::jsonb END
    || CASE WHEN v_grade IS NOT NULL THEN jsonb_build_object('high_school_grade', v_mark) ELSE '{}'::jsonb END
    || CASE WHEN v_period IS NOT NULL THEN jsonb_build_object('entry_period', v_mark) ELSE '{}'::jsonb END
    || CASE WHEN v_career IS NOT NULL THEN jsonb_build_object('initial_career_id', v_mark) ELSE '{}'::jsonb END;

  BEGIN
    INSERT INTO participants (edition_id, email, full_name, phone, high_school, high_school_id, high_school_grade,
                              entry_period, initial_career_id, origin, created_by, is_demo, manual_overrides)
    VALUES (v_ed, v_email, v_name, v_phone, v_school, v_school_id, v_grade, v_period, v_career, 'manual', auth.uid(), false, v_ov)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMAIL_EXISTS';
  END;
  IF v_career IS NOT NULL THEN
    PERFORM sync_initial_interests(v_id, ARRAY[v_career, NULL]::uuid[], ARRAY[NULL, NULL]::text[]);
  END IF;
  PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id,
    'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_ov) k)));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_participant(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_participant(jsonb) TO authenticated;

-- ¿La identidad de Auth vinculada es de PARTICIPANTE? Nunca una cuenta de Staff o Coordinación, aunque alguien la
-- hubiera vinculado por error: debe estar marcada como participante (o ser el correo sintético del participante) y
-- no tener fila ni rol de personal.
CREATE OR REPLACE FUNCTION public.participant_auth_is_removable(p_participant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.participants p JOIN auth.users u ON u.id = p.auth_user_id
    WHERE p.id = p_participant
      AND NOT EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.staff_roles r WHERE r.user_id = u.id)
      AND (coalesce(u.raw_app_meta_data->>'kind', '') = 'participant'
           OR lower(u.email) = ('p.' || p.id::text || '@participantes.diaov.invalid')));
$$;

REVOKE ALL ON FUNCTION public.participant_auth_is_removable(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Lo que se eliminaría con el alumno (para la confirmación del panel).
CREATE OR REPLACE FUNCTION public.participant_delete_preview(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_p participants%ROWTYPE;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO v_p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'id', v_p.id, 'full_name', v_p.full_name, 'email', v_p.email, 'is_demo', v_p.is_demo,
    'reservations', (SELECT count(*) FROM reservations WHERE participant_id = v_p.id),
    'attendances', (SELECT count(*) FROM attendances WHERE participant_id = v_p.id),
    'stamps', my_stamp_count(v_p.id),
    'initial_interests', (SELECT count(*) FROM initial_interests WHERE participant_id = v_p.id),
    'post_event_interests', (SELECT count(*) FROM post_event_interests WHERE participant_id = v_p.id),
    'email_aliases', (SELECT count(*) FROM participant_email_history WHERE participant_id = v_p.id),
    'import_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = v_p.id),
    'raffle_records', (SELECT count(*) FROM raffle_winners WHERE participant_id = v_p.id),
    'raffle_confirmed', (SELECT count(*) FROM raffle_winners WHERE participant_id = v_p.id AND status = 'confirmado'),
    'has_account', v_p.auth_user_id IS NOT NULL,
    -- Una cuenta vinculada que no es de participante (p. ej. de personal) se desvincula pero NO se elimina.
    'account_will_be_deleted', participant_auth_is_removable(v_p.id));
END;
$$;

REVOKE ALL ON FUNCTION public.participant_delete_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.participant_delete_preview(uuid) TO authenticated;

-- Para la Edge Function: qué identidad de Auth debe retirar antes de eliminar al participante (NULL = ninguna).
CREATE OR REPLACE FUNCTION public.participant_delete_plan_internal(p_actor uuid, p_participant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_p public.participants%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members m JOIN public.staff_roles r
    ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_p FROM public.participants
    WHERE id = p_participant AND edition_id = (SELECT id FROM public.editions WHERE is_active LIMIT 1);
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('participant_id', v_p.id,
    'auth_user_id', CASE WHEN public.participant_auth_is_removable(v_p.id) THEN v_p.auth_user_id END,
    'linked_non_participant_account', v_p.auth_user_id IS NOT NULL AND NOT public.participant_auth_is_removable(v_p.id));
END;
$$;

REVOKE ALL ON FUNCTION public.participant_delete_plan_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Eliminación definitiva del participante y de todo lo suyo. Los registros de sorteo (premios seleccionados,
-- confirmados, no presentados o invalidados) se eliminan con él: el inventario de cada premio se deriva de esas
-- filas, así que queda disponible de nuevo. Los lugares que ocupaba se liberan y se avisa a los demás alumnos.
CREATE OR REPLACE FUNCTION public.participant_delete_internal(p_actor uuid, p_participant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p public.participants%ROWTYPE;
  v_sessions uuid[];
  v_session uuid;
  v_removed jsonb;
  v_winners int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members m JOIN public.staff_roles r
    ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_p FROM public.participants
    WHERE id = p_participant AND edition_id = (SELECT id FROM public.editions WHERE is_active LIMIT 1) FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT array_agg(DISTINCT session_id) INTO v_sessions
  FROM public.reservations WHERE participant_id = v_p.id AND status IN ('vigente', 'expirada');
  v_removed := jsonb_build_object(
    'reservations', (SELECT count(*) FROM public.reservations WHERE participant_id = v_p.id),
    'attendances', (SELECT count(*) FROM public.attendances WHERE participant_id = v_p.id),
    'stamps', public.my_stamp_count(v_p.id),
    'initial_interests', (SELECT count(*) FROM public.initial_interests WHERE participant_id = v_p.id),
    'post_event_interests', (SELECT count(*) FROM public.post_event_interests WHERE participant_id = v_p.id),
    'email_aliases', (SELECT count(*) FROM public.participant_email_history WHERE participant_id = v_p.id),
    'import_conflicts', (SELECT count(*) FROM public.participant_import_conflicts WHERE participant_id = v_p.id));

  DELETE FROM public.raffle_winners WHERE participant_id = v_p.id;
  GET DIAGNOSTICS v_winners = ROW_COUNT;
  -- Cascada: reservaciones, asistencias, intereses iniciales y posteriores, historial de correo, conflictos de
  -- importación y perfil.
  DELETE FROM public.participants WHERE id = v_p.id;

  FOREACH v_session IN ARRAY coalesce(v_sessions, '{}'::uuid[]) LOOP
    PERFORM public.broadcast_availability(v_session);
  END LOOP;

  v_removed := v_removed || jsonb_build_object('raffle_records', v_winners);
  -- Auditoría sin datos personales: identificador, origen y qué se retiró.
  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_p.edition_id, p_actor, 'participant.deleted', jsonb_build_object(
    'participant_id', v_p.id, 'origin', v_p.origin, 'is_demo', v_p.is_demo,
    'had_account', v_p.auth_user_id IS NOT NULL, 'removed', v_removed));

  RETURN jsonb_build_object('participant_id', v_p.id, 'deleted', true, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.participant_delete_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- =====================================================================================================================
-- 3. Divisiones
-- =====================================================================================================================

-- Qué implica eliminar una división. Única fuente tanto para la vista previa como para la eliminación.
--   · Sus carreras se eliminan (una carrera no existe sin división).
--   · Un taller ACADÉMICO que se quedaría sin ninguna carrera ni división no puede seguir siendo válido: se elimina
--     con sus sesiones, reservaciones y asistencias. Vale igual para un expediente (todas sus carreras son de esta
--     división) y para una actividad heredada sin expediente (todas sus divisiones y carreras son de esta).
--   · Un taller que también pertenece a otras divisiones se conserva con ellas; solo pierde esta asociación.
--   · Un taller de Vida Universitaria no necesita división: si tenía esta, simplemente la pierde.
--   · Los intereses (iniciales y posteriores) de los alumnos en esas carreras se retiran; los demás se conservan.
--   · Solo entran en el plan actividades vinculadas a ESTA división (principal, asociada o por sus carreras).
CREATE OR REPLACE FUNCTION public.division_delete_plan_internal(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH career AS (SELECT id, name FROM public.careers WHERE division_id = p_id),
  touched AS (
    SELECT w.id, w.title, w.status, w.activity_type, w.published_activity_id,
           NOT EXISTS (SELECT 1 FROM public.workshop_submission_careers sc
                       WHERE sc.submission_id = w.id AND sc.career_id NOT IN (SELECT id FROM career)) AS only_this_division
    FROM public.workshop_submissions w
    WHERE EXISTS (SELECT 1 FROM public.workshop_submission_careers sc
                  WHERE sc.submission_id = w.id AND sc.career_id IN (SELECT id FROM career))
  ),
  doomed_submission AS (SELECT * FROM touched WHERE only_this_division AND activity_type = 'academica'),
  -- Actividades vinculadas a esta división que no caen ya con su expediente.
  linked_activity AS (
    SELECT a.id, a.title, a.activity_type, a.is_demo,
      EXISTS (SELECT 1 FROM public.workshop_submissions w WHERE w.published_activity_id = a.id) AS has_submission,
      -- ¿Le queda alguna otra división o alguna carrera de otra división?
      (a.division_id IS NOT NULL AND a.division_id <> p_id)
        OR EXISTS (SELECT 1 FROM public.activity_divisions ad WHERE ad.activity_id = a.id AND ad.division_id <> p_id)
        OR EXISTS (SELECT 1 FROM public.activity_careers ac WHERE ac.activity_id = a.id AND ac.career_id NOT IN (SELECT id FROM career))
        AS keeps_something
    FROM public.activities a
    WHERE (a.division_id = p_id
        OR EXISTS (SELECT 1 FROM public.activity_divisions ad WHERE ad.activity_id = a.id AND ad.division_id = p_id)
        OR EXISTS (SELECT 1 FROM public.activity_careers ac WHERE ac.activity_id = a.id AND ac.career_id IN (SELECT id FROM career)))
      AND a.id NOT IN (SELECT published_activity_id FROM doomed_submission WHERE published_activity_id IS NOT NULL)
  ),
  doomed_activity AS (SELECT * FROM linked_activity WHERE NOT has_submission AND activity_type = 'academica' AND NOT keeps_something),
  doomed AS (
    SELECT d.id AS submission_id, d.published_activity_id AS activity_id, d.title, d.status, false AS legacy FROM doomed_submission d
    UNION ALL
    SELECT NULL, a.id, a.title, 'published', true FROM doomed_activity a
  )
  SELECT jsonb_build_object(
    'careers', (SELECT count(*) FROM career),
    'career_names', coalesce((SELECT jsonb_agg(name ORDER BY name) FROM career), '[]'::jsonb),
    'workshops_deleted', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'submission_id', d.submission_id, 'activity_id', d.activity_id, 'title', d.title, 'status', d.status, 'legacy', d.legacy,
        'sessions', (SELECT count(*) FROM public.activity_sessions s WHERE s.activity_id = d.activity_id),
        'reservations', (SELECT count(*) FROM public.reservations r WHERE r.activity_id = d.activity_id),
        'attendances', (SELECT count(*) FROM public.attendances at WHERE at.activity_id = d.activity_id)
      ) ORDER BY d.title, d.activity_id) FROM doomed d), '[]'::jsonb),
    'workshops_kept', (SELECT count(*) FROM touched t WHERE t.id NOT IN (SELECT id FROM doomed_submission)),
    'activities_unlinked', (SELECT count(*) FROM linked_activity l WHERE l.id NOT IN (SELECT id FROM doomed_activity)),
    -- De esas, las que no tienen expediente (talleres heredados que continúan sin esta división).
    'legacy_activities_kept', (SELECT count(*) FROM linked_activity l WHERE NOT l.has_submission AND l.id NOT IN (SELECT id FROM doomed_activity)),
    'participants_initial_interest', (SELECT count(DISTINCT x.pid) FROM (
        SELECT participant_id AS pid FROM public.initial_interests WHERE career_id IN (SELECT id FROM career)
        UNION SELECT id FROM public.participants WHERE initial_career_id IN (SELECT id FROM career)) x),
    'participants_post_event_interest', (SELECT count(DISTINCT participant_id) FROM public.post_event_interests
        WHERE career_id IN (SELECT id FROM career)));
$$;

REVOKE ALL ON FUNCTION public.division_delete_plan_internal(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.division_delete_preview(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_d divisions%ROWTYPE;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO v_d FROM divisions WHERE id = p_id;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('id', v_d.id, 'code', v_d.code, 'name', v_d.name, 'is_demo', v_d.is_demo)
    || division_delete_plan_internal(v_d.id);
END;
$$;

REVOKE ALL ON FUNCTION public.division_delete_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.division_delete_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_division(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d divisions%ROWTYPE;
  v_plan jsonb;
  v_careers uuid[];
  v_item jsonb;
  v_removed jsonb := jsonb_build_object('sessions', 0, 'reservations', 0, 'attendances', 0);
  v_one jsonb;
  v_initial uuid[];
  v_post uuid[];
  v_activities uuid[];
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO v_d FROM divisions WHERE id = p_id FOR UPDATE;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- Las carreras quedan bloqueadas: nadie puede asociarles nada nuevo mientras se limpia.
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_careers
  FROM (SELECT id FROM careers WHERE division_id = v_d.id ORDER BY id FOR UPDATE) c;
  v_plan := division_delete_plan_internal(v_d.id);

  -- 1. Talleres que solo existían por esta división (con expediente o heredados sin él): se eliminan completos.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan->'workshops_deleted') LOOP
    v_one := workshop_delete_cascade_internal(nullif(v_item->>'submission_id', '')::uuid, nullif(v_item->>'activity_id', '')::uuid);
    v_removed := jsonb_build_object(
      'sessions', (v_removed->>'sessions')::int + (v_one->>'sessions')::int,
      'reservations', (v_removed->>'reservations')::int + (v_one->>'reservations')::int,
      'attendances', (v_removed->>'attendances')::int + (v_one->>'attendances')::int);
  END LOOP;

  -- 2. Talleres que continúan con otras divisiones: pierden solo las carreras y la asociación de esta.
  DELETE FROM workshop_submission_careers WHERE career_id = ANY(v_careers);
  UPDATE workshop_submissions SET division_id = NULL WHERE division_id = v_d.id;
  -- Solo las actividades vinculadas a ESTA división; ninguna otra se toca.
  SELECT coalesce(array_agg(a.id), '{}'::uuid[]) INTO v_activities FROM activities a
  WHERE a.division_id = v_d.id OR EXISTS (SELECT 1 FROM activity_divisions ad WHERE ad.activity_id = a.id AND ad.division_id = v_d.id);
  DELETE FROM activity_divisions WHERE division_id = v_d.id;
  -- División «principal» de las actividades que continúan, con la misma regla que al publicar: la única que le
  -- quede, o ninguna si le quedan varias (o ninguna). Una principal distinta de la eliminada no se toca.
  UPDATE activities a SET division_id = (
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(ad.division_id))[1] END
    FROM activity_divisions ad WHERE ad.activity_id = a.id)
  WHERE a.id = ANY(v_activities) AND (a.division_id = v_d.id OR a.division_id IS NULL);

  -- 3. Intereses iniciales: se retiran las carreras de esta división; si queda la segunda opción, pasa a primera.
  SELECT coalesce(array_agg(DISTINCT x.pid), '{}'::uuid[]) INTO v_initial FROM (
    SELECT participant_id AS pid FROM initial_interests WHERE career_id = ANY(v_careers)
    UNION SELECT id FROM participants WHERE initial_career_id = ANY(v_careers)) x;
  DELETE FROM initial_interests WHERE career_id = ANY(v_careers);
  UPDATE initial_interests i SET preference = 1, updated_at = now()
  WHERE i.participant_id = ANY(v_initial) AND i.preference = 2
    AND NOT EXISTS (SELECT 1 FROM initial_interests o WHERE o.participant_id = i.participant_id AND o.preference = 1);
  UPDATE participants p SET
    initial_career_id = (SELECT career_id FROM initial_interests i WHERE i.participant_id = p.id AND i.preference = 1),
    initial_career_raw = (SELECT career_raw FROM initial_interests i WHERE i.participant_id = p.id AND i.preference = 1),
    updated_at = now()
  WHERE p.id = ANY(v_initial);

  -- 4. Intereses posteriores: se retiran y las preferencias restantes se renumeran sin huecos.
  SELECT coalesce(array_agg(DISTINCT participant_id), '{}'::uuid[]) INTO v_post
  FROM post_event_interests WHERE career_id = ANY(v_careers);
  WITH kept AS (
    DELETE FROM post_event_interests WHERE participant_id = ANY(v_post)
    RETURNING participant_id, preference, career_id, created_at
  )
  INSERT INTO post_event_interests (participant_id, preference, career_id, created_at)
  SELECT participant_id, row_number() OVER (PARTITION BY participant_id ORDER BY preference), career_id, created_at
  FROM kept WHERE career_id <> ALL(v_careers);

  -- 5. Carreras (cascada: activity_careers) y, por último, la división.
  DELETE FROM careers WHERE division_id = v_d.id;
  DELETE FROM divisions WHERE id = v_d.id;

  PERFORM write_audit('catalog.division_deleted', jsonb_build_object(
    'id', v_d.id, 'code', v_d.code, 'name', v_d.name, 'is_demo', v_d.is_demo,
    'careers', v_plan->'careers', 'workshops_deleted', jsonb_array_length(v_plan->'workshops_deleted'),
    'workshops_kept', v_plan->'workshops_kept', 'activities_unlinked', v_plan->'activities_unlinked',
    'participants_initial_interest', v_plan->'participants_initial_interest',
    'participants_post_event_interest', v_plan->'participants_post_event_interest', 'removed', v_removed));

  RETURN jsonb_build_object('id', v_d.id, 'deleted', true, 'removed', v_removed) || v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_division(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_division(uuid) TO authenticated;

-- =====================================================================================================================
-- 4. Catálogo del alumno: tipo de misión
-- =====================================================================================================================

-- Mismo tablero de siempre; cada sesión informa además `activity_type` y `experience_category`, para que el alumno
-- pueda filtrar Vida Universitaria por su tipo oficial (no por la ausencia de división). Campos nuevos: un cliente
-- anterior los ignora.
CREATE OR REPLACE FUNCTION public.my_reservation_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := require_participant(true); v_p participants%ROWTYPE; v_ed editions%ROWTYPE;
  v_buffer interval;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_ed FROM editions WHERE id = v_p.edition_id;
  v_buffer := make_interval(mins => v_ed.travel_buffer_minutes);

  RETURN jsonb_build_object(
    'server_time', now(),
    'window', reservation_window(v_ed.reservations_open_at, v_ed.reservations_close_at),
    'opens_at', v_ed.reservations_open_at,
    'closes_at', v_ed.reservations_close_at,
    'max_reservations', v_ed.max_reservations,
    'active_reservation_count', active_reservation_count(v_pid),
    'travel_buffer_minutes', v_ed.travel_buffer_minutes,
    'checkin_close_after_minutes', v_ed.checkin_close_after_minutes,
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'activity_id', s.activity_id, 'title', a.title, 'description', a.description,
        'division_id', a.division_id,
        -- Tipo oficial de la misión y, en Vida Universitaria, su categoría de experiencia.
        'activity_type', a.activity_type, 'experience_category', a.experience_category,
        'division_ids', coalesce((
          SELECT jsonb_agg(d.division_id ORDER BY d.division_id)
          FROM (
            SELECT ad.division_id FROM activity_divisions ad WHERE ad.activity_id = a.id
            UNION
            SELECT a.division_id WHERE a.division_id IS NOT NULL
          ) d), '[]'::jsonb),
        'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'location', coalesce(nullif(s.location, ''), a.location), 'credits', s.credits, 'status', s.status,
        'capacity', s.capacity, 'reserved', c.reserved, 'remaining', greatest(s.capacity - c.reserved, 0),
        'started', now() >= s.starts_at,
        'ended', now() >= s.ends_at,
        'in_progress', now() >= s.starts_at AND now() < s.ends_at,
        'attended', EXISTS (SELECT 1 FROM attendances at WHERE at.participant_id = v_pid AND at.activity_id = s.activity_id),
        'my_reservation_id', (SELECT r.id FROM reservations r WHERE r.session_id = s.id
                              AND r.participant_id = v_pid AND r.status = 'vigente'),
        'conflicts_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r
          JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
            AND now() < o.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a2 WHERE a2.participant_id = v_pid AND a2.activity_id = r.activity_id)
            AND o.starts_at < s.ends_at AND s.starts_at < o.ends_at), '[]'::jsonb),
        'tight_transfer_with', coalesce((
          SELECT jsonb_agg(r.id) FROM reservations r
          JOIN activity_sessions o ON o.id = r.session_id
          WHERE r.participant_id = v_pid AND r.status = 'vigente' AND r.session_id <> s.id
            AND NOT EXISTS (SELECT 1 FROM attendances a3 WHERE a3.participant_id = v_pid AND a3.activity_id = r.activity_id)
            AND ((o.ends_at <= s.starts_at AND s.starts_at < o.ends_at + v_buffer AND now() < o.ends_at)
                 OR (s.ends_at <= o.starts_at AND o.starts_at < s.ends_at + v_buffer AND now() < s.ends_at))), '[]'::jsonb)
      ) ORDER BY s.starts_at, a.title)
      FROM activity_sessions s
      JOIN activities a ON a.id = s.activity_id
      CROSS JOIN LATERAL (SELECT session_reserved_count(s.id) AS reserved) c
      WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
        AND (s.status = 'activa' OR EXISTS (
          SELECT 1 FROM reservations r WHERE r.session_id = s.id AND r.participant_id = v_pid
            AND r.status IN ('vigente', 'cancelada_sesion', 'expirada')))
    ), '[]'::jsonb),
    'reservations', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'session_id', r.session_id, 'activity_id', r.activity_id, 'status', r.status,
        'created_at', r.created_at, 'ended_at', r.ended_at,
        'resolved', r.status = 'cancelada_sesion' AND EXISTS (
          SELECT 1 FROM reservations n WHERE n.participant_id = v_pid AND n.status = 'vigente'
            AND n.created_at > r.ended_at),
        'derived_status',
          CASE
            WHEN EXISTS (SELECT 1 FROM attendances at WHERE at.participant_id = v_pid AND at.activity_id = r.activity_id)
              THEN 'completed'
            WHEN r.status = 'expirada' THEN 'expired'
            WHEN r.status = 'cancelada_sesion' THEN 'cancelled'
            WHEN r.status = 'vigente' AND now() >= s.ends_at THEN 'ended'
            WHEN r.status = 'vigente' AND now() >= s.starts_at THEN 'in_progress'
            WHEN r.status = 'vigente' THEN 'active'
            ELSE r.status
          END,
        'credits_granted', (
          SELECT at.credits_granted FROM attendances at
          WHERE at.participant_id = v_pid AND at.activity_id = r.activity_id LIMIT 1)
      ) ORDER BY s.starts_at)
      FROM reservations r JOIN activity_sessions s ON s.id = r.session_id
      WHERE r.participant_id = v_pid AND r.status IN ('vigente', 'cancelada_sesion', 'expirada')
    ), '[]'::jsonb)
  );
END;
$$;
