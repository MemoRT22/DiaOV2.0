-- Una decisión de Coordinación publica de forma atómica. El estado approved heredado sigue siendo publicable.
CREATE OR REPLACE FUNCTION public.publish_workshop_submission_internal(
  p_actor uuid,
  p_submission_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ed public.editions%ROWTYPE;
  v_submission public.workshop_submissions%ROWTYPE;
  v_act uuid;
  v_session_starts timestamptz;
  v_session_ends timestamptz;
  v_step interval;
  v_sessions_count int := 0;
  v_careers_count int := 0;
  v_divs_count int := 0;
  v_div_array uuid[];
  v_from_status text;
  v_to_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_members m
    JOIN public.staff_roles r ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO v_ed FROM public.editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_ed.id FOR UPDATE;

  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF (v_submission.status = 'published' AND v_submission.published_activity_id IS NULL) OR
     (v_submission.status <> 'published' AND v_submission.published_activity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PUBLISH_STATE_INCONSISTENT';
  END IF;

  IF v_submission.status = 'published' AND v_submission.published_activity_id IS NOT NULL THEN
    SELECT count(*) INTO v_sessions_count FROM public.activity_sessions WHERE activity_id = v_submission.published_activity_id;
    SELECT count(*) INTO v_careers_count FROM public.activity_careers WHERE activity_id = v_submission.published_activity_id;
    SELECT count(*) INTO v_divs_count FROM public.activity_divisions WHERE activity_id = v_submission.published_activity_id;

    RETURN jsonb_build_object(
      'submission_id', v_submission.id,
      'status', 'published',
      'activity_id', v_submission.published_activity_id,
      'session_count', v_sessions_count,
      'career_count', v_careers_count,
      'division_count', v_divs_count,
      'credential_created', true
    );
  END IF;

  IF v_submission.status NOT IN ('submitted', 'in_review', 'changes_requested', 'approved') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  v_from_status := v_submission.status;
  v_to_status := 'published';

  INSERT INTO public.activities (
    edition_id, title, description, location, is_demo, activity_type, experience_category, division_id
  ) VALUES (
    v_ed.id,
    v_submission.title,
    v_submission.student_pitch,
    nullif(btrim(v_submission.building || ' ' || v_submission.room_space), ''),
    v_submission.is_demo,
    v_submission.activity_type,
    v_submission.experience_category,
    NULL
  ) RETURNING id INTO v_act;

  IF v_submission.activity_type = 'academica' THEN
    INSERT INTO public.activity_careers (activity_id, career_id)
    SELECT v_act, career_id FROM public.workshop_submission_careers WHERE submission_id = p_submission_id;
    GET DIAGNOSTICS v_careers_count = ROW_COUNT;

    SELECT array_agg(DISTINCT c.division_id) INTO v_div_array
    FROM public.workshop_submission_careers sc
    JOIN public.careers c ON c.id = sc.career_id
    WHERE sc.submission_id = p_submission_id;

    IF v_div_array IS NOT NULL THEN
      IF array_length(v_div_array, 1) = 1 THEN
        UPDATE public.activities SET division_id = v_div_array[1] WHERE id = v_act;
      END IF;

      INSERT INTO public.activity_divisions (activity_id, division_id)
      SELECT v_act, unnest(v_div_array);
      GET DIAGNOSTICS v_divs_count = ROW_COUNT;
    END IF;
  END IF;

  v_session_starts := (v_ed.event_date + v_submission.operating_start_time) AT TIME ZONE 'America/Cancun';
  v_session_ends := (v_ed.event_date + v_submission.operating_end_time) AT TIME ZONE 'America/Cancun';
  v_step := (v_submission.session_duration_minutes || ' minutes')::interval;

  WHILE v_session_starts < v_session_ends LOOP
    INSERT INTO public.activity_sessions (
      activity_id, starts_at, ends_at, capacity, is_demo, status
    ) VALUES (
      v_act, v_session_starts, v_session_starts + v_step, v_submission.capacity_per_session, v_submission.is_demo, 'activa'
    );
    v_sessions_count := v_sessions_count + 1;
    v_session_starts := v_session_starts + v_step;
  END LOOP;

  PERFORM public.rotate_activity_credential(v_act);

  UPDATE public.workshop_submissions
  SET status = v_to_status, published_activity_id = v_act, reviewed_at = now(), reviewed_by = p_actor
  WHERE id = p_submission_id;

  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_ed.id, p_actor, 'workshop_submission.published',
    jsonb_build_object(
      'submission_id', p_submission_id,
      'activity_id', v_act,
      'session_count', v_sessions_count,
      'career_count', v_careers_count,
      'division_count', v_divs_count,
      'from_status', v_from_status,
      'to_status', v_to_status
    )
  );

  RETURN jsonb_build_object(
    'submission_id', p_submission_id,
    'status', 'published',
    'activity_id', v_act,
    'session_count', v_sessions_count,
    'career_count', v_careers_count,
    'division_count', v_divs_count,
    'credential_created', true
  );
END;
$$;
REVOKE ALL ON FUNCTION public.publish_workshop_submission_internal(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publish_workshop_submission_internal(uuid, uuid)
TO service_role;


-- Bandeja paginada por estados humanos. Nunca incorpora activities manuales.
CREATE OR REPLACE FUNCTION public.workshop_admin_list_internal(
  p_status text DEFAULT NULL, p_type text DEFAULT NULL, p_search text DEFAULT NULL, p_page integer DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total int;
  v_items jsonb;
  v_counts jsonb;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'published', 'archived') THEN RAISE EXCEPTION 'INVALID_FILTER'; END IF;
  IF p_type IS NOT NULL AND p_type NOT IN ('academica', 'vida_universitaria') THEN RAISE EXCEPTION 'INVALID_FILTER'; END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000 OR length(coalesce(v_search, '')) > 120 THEN RAISE EXCEPTION 'INVALID_FILTER'; END IF;
  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  SELECT count(*) INTO v_total FROM public.workshop_submissions s
  WHERE s.edition_id = v_edition AND s.status <> 'draft'
    AND (p_status IS NULL OR CASE p_status WHEN 'pending' THEN s.status IN ('submitted','in_review','changes_requested','approved') ELSE s.status = p_status END)
    AND (p_type IS NULL OR s.activity_type = p_type)
    AND (v_search IS NULL OR position(lower(v_search) in lower(s.title)) > 0
      OR position(lower(v_search) in lower(s.facilitator_name)) > 0
      OR position(lower(v_search) in lower(s.facilitator_email)) > 0);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'status', s.status, 'submitted_at', s.submitted_at,
    'title', s.title, 'activity_type', s.activity_type, 'experience_category', s.experience_category,
    'facilitator_name', s.facilitator_name, 'session_duration_minutes', s.session_duration_minutes,
    'capacity_per_session', s.capacity_per_session, 'building', s.building, 'room_space', s.room_space,
    'career_count', (SELECT count(*) FROM public.workshop_submission_careers sc WHERE sc.submission_id = s.id),
    'career_names', (SELECT coalesce(jsonb_agg(c.name ORDER BY c.name), '[]'::jsonb)
      FROM public.workshop_submission_careers sc JOIN public.careers c ON c.id = sc.career_id WHERE sc.submission_id = s.id)
  ) ORDER BY s.submitted_at DESC, s.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT * FROM public.workshop_submissions s WHERE s.edition_id = v_edition AND s.status <> 'draft'
      AND (p_status IS NULL OR CASE p_status WHEN 'pending' THEN s.status IN ('submitted','in_review','changes_requested','approved') ELSE s.status = p_status END)
      AND (p_type IS NULL OR s.activity_type = p_type)
      AND (v_search IS NULL OR position(lower(v_search) in lower(s.title)) > 0
        OR position(lower(v_search) in lower(s.facilitator_name)) > 0
        OR position(lower(v_search) in lower(s.facilitator_email)) > 0)
    ORDER BY s.submitted_at DESC, s.id DESC LIMIT 25 OFFSET (p_page - 1) * 25
  ) s;

  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status IN ('submitted','in_review','changes_requested','approved')),
    'published', count(*) FILTER (WHERE status = 'published'),
    'archived', count(*) FILTER (WHERE status = 'archived')
  ) INTO v_counts FROM public.workshop_submissions WHERE edition_id = v_edition AND status <> 'draft';
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'page', p_page, 'page_size', 25, 'counts', v_counts);
END;
$$;
REVOKE ALL ON FUNCTION public.workshop_admin_list_internal(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_admin_list_internal(text, text, text, integer) TO service_role;

-- La propuesta conserva el contenido editorial; se añade una lectura operacional de su proyección publicada.
CREATE OR REPLACE FUNCTION public.workshop_admin_get_internal(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_submission public.workshop_submissions%ROWTYPE;
  v_careers jsonb;
  v_sessions jsonb := '[]'::jsonb;
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
  IF v_submission.published_activity_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'capacity', s.capacity, 'reserved', public.session_reserved_count(s.id),
      'location', coalesce(s.location, a.location), 'status', s.status
    ) ORDER BY s.starts_at, s.id), '[]'::jsonb) INTO v_sessions
    FROM public.activity_sessions s
    JOIN public.activities a ON a.id = s.activity_id AND a.edition_id = v_edition
    WHERE s.activity_id = v_submission.published_activity_id;
  END IF;
  RETURN to_jsonb(v_submission) || jsonb_build_object('careers', v_careers, 'sessions', v_sessions);
END;
$$;
REVOKE ALL ON FUNCTION public.workshop_admin_get_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_admin_get_internal(uuid) TO service_role;

-- Edición previa a publicación. La fila, contenido y relaciones de carrera cambian en la misma transacción.
CREATE OR REPLACE FUNCTION public.workshop_admin_edit_internal(p_actor uuid, p_submission_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_submission public.workshop_submissions%ROWTYPE;
  v_career_ids uuid[];
  v_type text;
  v_category text;
  v_allowed constant text[] := ARRAY[
    'facilitator_name','facilitator_email','activity_type','experience_category','title','student_pitch',
    'objective','takeaway','keywords','session_duration_minutes','capacity_per_session','building',
    'room_space','requirements','notes','career_ids'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members m JOIN public.staff_roles r
    ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR
    EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k <> ALL(v_allowed)) OR
    jsonb_typeof(p_payload->'career_ids') IS DISTINCT FROM 'array' OR
    jsonb_typeof(p_payload->'keywords') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_edition FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_submission.status NOT IN ('submitted','in_review','changes_requested','approved')
    OR v_submission.published_activity_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
  v_type := p_payload->>'activity_type';
  v_category := nullif(btrim(p_payload->>'experience_category'), '');
  IF v_type IS NULL OR v_type NOT IN ('academica','vida_universitaria') OR
    (v_type = 'academica' AND v_category IS NOT NULL) OR
    (v_type = 'vida_universitaria' AND (v_category IS NULL OR v_category NOT IN
      ('liderazgo','deportiva','artistica_cultural','vida_universitaria','otra'))
    ) THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  BEGIN
    v_career_ids := ARRAY(SELECT jsonb_array_elements_text(p_payload->'career_ids')::uuid);
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_CAREER'; END;
  IF (v_type = 'academica' AND cardinality(v_career_ids) = 0) OR
    (v_type = 'vida_universitaria' AND cardinality(v_career_ids) <> 0) THEN RAISE EXCEPTION 'CAREERS_REQUIRED'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_career_ids) x) <> cardinality(v_career_ids) THEN RAISE EXCEPTION 'DUPLICATE_CAREER'; END IF;
  IF (SELECT count(*) FROM public.careers c JOIN public.divisions d ON d.id = c.division_id
    WHERE c.id = ANY(v_career_ids) AND c.is_active AND NOT c.is_demo AND NOT d.is_demo) <> cardinality(v_career_ids)
    THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;

  UPDATE public.workshop_submissions SET
    facilitator_name = p_payload->>'facilitator_name', facilitator_email = p_payload->>'facilitator_email',
    activity_type = v_type, experience_category = v_category, title = p_payload->>'title',
    student_pitch = p_payload->>'student_pitch', objective = nullif(btrim(p_payload->>'objective'), ''),
    takeaway = p_payload->>'takeaway', keywords = ARRAY(SELECT jsonb_array_elements_text(p_payload->'keywords')),
    session_duration_minutes = (p_payload->>'session_duration_minutes')::int,
    capacity_per_session = (p_payload->>'capacity_per_session')::int,
    building = p_payload->>'building', room_space = p_payload->>'room_space',
    requirements = nullif(btrim(p_payload->>'requirements'), ''), notes = nullif(btrim(p_payload->>'notes'), '')
  WHERE id = p_submission_id;
  DELETE FROM public.workshop_submission_careers WHERE submission_id = p_submission_id;
  INSERT INTO public.workshop_submission_careers(submission_id, career_id)
    SELECT p_submission_id, x FROM unnest(v_career_ids) x;
  INSERT INTO public.audit_log(edition_id, actor_user_id, action, detail)
    VALUES(v_edition, p_actor, 'workshop_submission.edited',
      jsonb_build_object('submission_id', p_submission_id, 'career_count', cardinality(v_career_ids)));
  RETURN jsonb_build_object('id', p_submission_id, 'status', v_submission.status);
END;
$$;
REVOKE ALL ON FUNCTION public.workshop_admin_edit_internal(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_admin_edit_internal(uuid, uuid, jsonb) TO service_role;
