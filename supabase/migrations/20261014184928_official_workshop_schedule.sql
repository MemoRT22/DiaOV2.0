/*
  Calendario oficial de talleres del Dia OV 2026.

  Solo cambia publicaciones y futuros cambios de duracion. No actualiza, elimina ni
  regenera las sesiones que ya estan publicadas al aplicar la migracion.

  starts_at / ends_at son la duracion academica efectiva. El traslado queda entre
  bloques y conserva su tratamiento actual como advertencia, no como conflicto.
*/

CREATE OR REPLACE FUNCTION public.official_workshop_session_slots(
  p_event_date date,
  p_duration_minutes integer
)
RETURNS TABLE(slot_number integer, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_event_date IS NULL THEN RAISE EXCEPTION 'INVALID_EVENT_DATE'; END IF;

  IF p_duration_minutes = 15 THEN
    RETURN QUERY SELECT v.slot_number,
      (p_event_date + v.starts_at) AT TIME ZONE 'America/Cancun',
      (p_event_date + v.ends_at) AT TIME ZONE 'America/Cancun'
    FROM (VALUES
      (1, TIME '10:00', TIME '10:15'), (2, TIME '10:25', TIME '10:40'),
      (3, TIME '10:50', TIME '11:05'), (4, TIME '11:15', TIME '11:30'),
      (5, TIME '11:40', TIME '11:55'), (6, TIME '12:05', TIME '12:20')
    ) AS v(slot_number, starts_at, ends_at) ORDER BY v.slot_number;
  ELSIF p_duration_minutes = 30 THEN
    RETURN QUERY SELECT v.slot_number,
      (p_event_date + v.starts_at) AT TIME ZONE 'America/Cancun',
      (p_event_date + v.ends_at) AT TIME ZONE 'America/Cancun'
    FROM (VALUES
      (1, TIME '10:00', TIME '10:30'), (2, TIME '10:40', TIME '11:10'),
      (3, TIME '11:20', TIME '11:50'), (4, TIME '12:00', TIME '12:30')
    ) AS v(slot_number, starts_at, ends_at) ORDER BY v.slot_number;
  ELSIF p_duration_minutes = 60 THEN
    RETURN QUERY SELECT v.slot_number,
      (p_event_date + v.starts_at) AT TIME ZONE 'America/Cancun',
      (p_event_date + v.ends_at) AT TIME ZONE 'America/Cancun'
    FROM (VALUES
      (1, TIME '10:00', TIME '11:00'), (2, TIME '11:20', TIME '12:20')
    ) AS v(slot_number, starts_at, ends_at) ORDER BY v.slot_number;
  ELSE
    RAISE EXCEPTION 'INVALID_DURATION';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.official_workshop_session_slots(date, integer)
FROM PUBLIC, anon, authenticated, service_role;

-- Unico punto que materializa el calendario para un taller nuevo.
CREATE OR REPLACE FUNCTION public.create_official_workshop_sessions_internal(
  p_activity_id uuid,
  p_event_date date,
  p_duration_minutes integer,
  p_capacity integer,
  p_is_demo boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.activity_sessions(activity_id, starts_at, ends_at, capacity, is_demo, status)
  SELECT p_activity_id, slot.starts_at, slot.ends_at, p_capacity, p_is_demo, 'activa'
  FROM public.official_workshop_session_slots(p_event_date, p_duration_minutes) slot
  ORDER BY slot.slot_number;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_official_workshop_sessions_internal(uuid, date, integer, integer, boolean)
FROM PUBLIC, anon, authenticated, service_role;

-- Un cambio permitido de duracion conserva los IDs que pueden reutilizarse. Si existe
-- cualquier reservacion o asistencia, no mueve ni elimina una sola fila.
CREATE OR REPLACE FUNCTION public.sync_official_workshop_sessions_internal(
  p_activity_id uuid,
  p_event_date date,
  p_duration_minutes integer,
  p_capacity integer,
  p_is_demo boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_existing_count integer;
  v_target_count integer;
  v_reused_count integer;
  v_index integer;
  v_slot record;
BEGIN
  PERFORM 1 FROM public.activity_sessions s
  WHERE s.activity_id = p_activity_id
  ORDER BY s.starts_at, s.id
  FOR UPDATE;

  SELECT array_agg(s.id ORDER BY s.starts_at, s.id), count(*)::integer
  INTO v_ids, v_existing_count
  FROM public.activity_sessions s
  WHERE s.activity_id = p_activity_id;

  IF v_existing_count = 0 THEN RAISE EXCEPTION 'PUBLISH_STATE_INCONSISTENT'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.activity_sessions s
    WHERE s.activity_id = p_activity_id
      AND (EXISTS (SELECT 1 FROM public.reservations r WHERE r.session_id = s.id)
        OR EXISTS (SELECT 1 FROM public.attendances a WHERE a.session_id = s.id))
  ) THEN RAISE EXCEPTION 'SESSION_SCHEDULE_LOCKED'; END IF;

  SELECT count(*)::integer INTO v_target_count
  FROM public.official_workshop_session_slots(p_event_date, p_duration_minutes);
  v_reused_count := least(v_existing_count, v_target_count);

  -- Los excedentes no tienen relaciones (comprobado arriba). Los IDs restantes se conservan.
  IF v_existing_count > v_target_count THEN
    DELETE FROM public.activity_sessions s
    WHERE s.id = ANY(v_ids[(v_target_count + 1):v_existing_count]);
  END IF;

  IF v_reused_count > 0 THEN
    FOR v_index IN 1..v_reused_count LOOP
      SELECT slot.starts_at, slot.ends_at INTO v_slot
      FROM public.official_workshop_session_slots(p_event_date, p_duration_minutes) slot
      WHERE slot.slot_number = v_index;
      UPDATE public.activity_sessions
      SET starts_at = v_slot.starts_at, ends_at = v_slot.ends_at, capacity = p_capacity
      WHERE id = v_ids[v_index];
    END LOOP;
  END IF;

  INSERT INTO public.activity_sessions(activity_id, starts_at, ends_at, capacity, is_demo, status)
  SELECT p_activity_id, slot.starts_at, slot.ends_at, p_capacity, p_is_demo, 'activa'
  FROM public.official_workshop_session_slots(p_event_date, p_duration_minutes) slot
  WHERE slot.slot_number > v_existing_count
  ORDER BY slot.slot_number;

  RETURN v_target_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_official_workshop_sessions_internal(uuid, date, integer, integer, boolean)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_workshop_submission_internal(
  p_actor uuid,
  p_submission_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ed public.editions%ROWTYPE;
  v_submission public.workshop_submissions%ROWTYPE;
  v_act uuid;
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
      'submission_id', v_submission.id, 'status', 'published',
      'activity_id', v_submission.published_activity_id, 'session_count', v_sessions_count,
      'career_count', v_careers_count, 'division_count', v_divs_count,
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
    v_ed.id, v_submission.title, v_submission.student_pitch,
    nullif(btrim(v_submission.building || ' ' || v_submission.room_space), ''),
    v_submission.is_demo, v_submission.activity_type, v_submission.experience_category, NULL
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

  v_sessions_count := public.create_official_workshop_sessions_internal(
    v_act, v_ed.event_date, v_submission.session_duration_minutes,
    v_submission.capacity_per_session, v_submission.is_demo
  );

  PERFORM public.rotate_activity_credential(v_act);
  UPDATE public.workshop_submissions
  SET status = v_to_status, published_activity_id = v_act, reviewed_at = now(), reviewed_by = p_actor
  WHERE id = p_submission_id;

  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_ed.id, p_actor, 'workshop_submission.published',
    jsonb_build_object(
      'submission_id', p_submission_id, 'activity_id', v_act,
      'session_count', v_sessions_count, 'career_count', v_careers_count,
      'division_count', v_divs_count, 'from_status', v_from_status, 'to_status', v_to_status
    ));

  RETURN jsonb_build_object(
    'submission_id', p_submission_id, 'status', 'published', 'activity_id', v_act,
    'session_count', v_sessions_count, 'career_count', v_careers_count,
    'division_count', v_divs_count, 'credential_created', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_workshop_submission_internal(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_workshop_submission_internal(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.workshop_admin_edit_internal(p_actor uuid, p_submission_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ed public.editions%ROWTYPE;
  v_submission public.workshop_submissions%ROWTYPE;
  v_activity public.activities%ROWTYPE;
  v_session record;
  v_career_ids uuid[];
  v_type text;
  v_category text;
  v_duration int;
  v_capacity int;
  v_division_ids uuid[];
  v_division_id uuid;
  v_sessions int := 0;
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

  SELECT * INTO v_ed FROM public.editions WHERE is_active LIMIT 1;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_ed.id FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_submission.status NOT IN ('submitted','in_review','changes_requested','approved','published') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;
  IF (v_submission.status = 'published') IS DISTINCT FROM (v_submission.published_activity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PUBLISH_STATE_INCONSISTENT';
  END IF;

  v_type := p_payload->>'activity_type';
  v_category := nullif(btrim(p_payload->>'experience_category'), '');
  IF v_type IS NULL OR v_type NOT IN ('academica','vida_universitaria') OR
    (v_type = 'academica' AND v_category IS NOT NULL) OR
    (v_type = 'vida_universitaria' AND (v_category IS NULL OR v_category NOT IN
      ('liderazgo','deportiva','artistica_cultural','vida_universitaria','otra')))
    THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;
  IF coalesce(p_payload->>'session_duration_minutes', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_DURATION';
  END IF;
  v_duration := (p_payload->>'session_duration_minutes')::int;
  IF (v_type = 'academica' AND v_duration NOT IN (30,60)) OR
     (v_type = 'vida_universitaria' AND v_duration NOT IN (15,30,60)) THEN
    RAISE EXCEPTION 'INVALID_DURATION';
  END IF;
  IF coalesce(p_payload->>'capacity_per_session', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;
  v_capacity := (p_payload->>'capacity_per_session')::int;
  IF v_capacity < 1 OR v_capacity > 10000 THEN RAISE EXCEPTION 'INVALID_PAYLOAD'; END IF;

  BEGIN
    v_career_ids := ARRAY(SELECT jsonb_array_elements_text(p_payload->'career_ids')::uuid);
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_CAREER'; END;
  IF (v_type = 'academica' AND cardinality(v_career_ids) = 0) OR
    (v_type = 'vida_universitaria' AND cardinality(v_career_ids) <> 0) THEN RAISE EXCEPTION 'CAREERS_REQUIRED'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_career_ids) x) <> cardinality(v_career_ids) THEN
    RAISE EXCEPTION 'DUPLICATE_CAREER';
  END IF;
  IF (SELECT count(*) FROM public.careers c JOIN public.divisions d ON d.id = c.division_id
    WHERE c.id = ANY(v_career_ids) AND c.is_active AND NOT c.is_demo AND NOT d.is_demo) <> cardinality(v_career_ids)
    THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;

  IF v_submission.status = 'published' THEN
    SELECT * INTO v_activity FROM public.activities
      WHERE id = v_submission.published_activity_id AND edition_id = v_ed.id FOR UPDATE;
    IF v_activity.id IS NULL THEN RAISE EXCEPTION 'PUBLISH_STATE_INCONSISTENT'; END IF;
    -- Reservation creation locks the same session row before inserting, so this check is serialized.
    FOR v_session IN SELECT id FROM public.activity_sessions
      WHERE activity_id = v_activity.id ORDER BY starts_at, id FOR UPDATE LOOP
      v_sessions := v_sessions + 1;
      IF v_duration <> v_submission.session_duration_minutes THEN
        IF EXISTS (SELECT 1 FROM public.reservations r WHERE r.session_id = v_session.id) OR
           EXISTS (SELECT 1 FROM public.attendances a WHERE a.session_id = v_session.id) THEN
          RAISE EXCEPTION 'SESSION_SCHEDULE_LOCKED';
        END IF;
      ELSIF public.session_reserved_count(v_session.id) > v_capacity THEN
        RAISE EXCEPTION 'CAPACITY_BELOW_RESERVED';
      END IF;
    END LOOP;
    IF v_sessions = 0 THEN RAISE EXCEPTION 'PUBLISH_STATE_INCONSISTENT'; END IF;
  END IF;

  UPDATE public.workshop_submissions SET
    facilitator_name = p_payload->>'facilitator_name', facilitator_email = p_payload->>'facilitator_email',
    activity_type = v_type, experience_category = v_category, title = p_payload->>'title',
    student_pitch = p_payload->>'student_pitch', objective = nullif(btrim(p_payload->>'objective'), ''),
    takeaway = p_payload->>'takeaway', keywords = ARRAY(SELECT jsonb_array_elements_text(p_payload->'keywords')),
    session_duration_minutes = v_duration, capacity_per_session = v_capacity,
    building = p_payload->>'building', room_space = p_payload->>'room_space',
    requirements = nullif(btrim(p_payload->>'requirements'), ''), notes = nullif(btrim(p_payload->>'notes'), '')
  WHERE id = p_submission_id;
  DELETE FROM public.workshop_submission_careers WHERE submission_id = p_submission_id;
  INSERT INTO public.workshop_submission_careers(submission_id, career_id)
    SELECT p_submission_id, x FROM unnest(v_career_ids) x;

  IF v_submission.status = 'published' THEN
    SELECT array_agg(DISTINCT c.division_id ORDER BY c.division_id) INTO v_division_ids
      FROM public.careers c WHERE c.id = ANY(v_career_ids);
    v_division_id := CASE WHEN cardinality(v_division_ids) = 1 THEN v_division_ids[1] ELSE NULL END;
    UPDATE public.activities SET
      title = p_payload->>'title', description = p_payload->>'student_pitch',
      location = nullif(btrim((p_payload->>'building') || ' ' || (p_payload->>'room_space')), ''),
      activity_type = v_type, experience_category = v_category, division_id = v_division_id
    WHERE id = v_activity.id;
    DELETE FROM public.activity_careers WHERE activity_id = v_activity.id;
    INSERT INTO public.activity_careers(activity_id, career_id)
      SELECT v_activity.id, x FROM unnest(v_career_ids) x;
    DELETE FROM public.activity_divisions WHERE activity_id = v_activity.id;
    INSERT INTO public.activity_divisions(activity_id, division_id)
      SELECT v_activity.id, x FROM unnest(coalesce(v_division_ids, '{}'::uuid[])) x;

    IF v_duration <> v_submission.session_duration_minutes THEN
      PERFORM public.sync_official_workshop_sessions_internal(
        v_activity.id, v_ed.event_date, v_duration, v_capacity, v_activity.is_demo
      );
    ELSE
      -- Preserve session IDs, official times, status, and location overrides.
      UPDATE public.activity_sessions SET capacity = v_capacity WHERE activity_id = v_activity.id
        AND capacity IS DISTINCT FROM v_capacity;
    END IF;
    INSERT INTO public.audit_log(edition_id, actor_user_id, action, detail)
      VALUES(v_ed.id, p_actor, 'workshop_submission.published_edited',
        jsonb_build_object('submission_id', p_submission_id, 'activity_id', v_activity.id,
          'duration_changed', v_duration <> v_submission.session_duration_minutes));
  ELSE
    INSERT INTO public.audit_log(edition_id, actor_user_id, action, detail)
      VALUES(v_ed.id, p_actor, 'workshop_submission.edited',
        jsonb_build_object('submission_id', p_submission_id, 'career_count', cardinality(v_career_ids)));
  END IF;
  RETURN jsonb_build_object('id', p_submission_id, 'status', v_submission.status);
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_admin_edit_internal(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_admin_edit_internal(uuid, uuid, jsonb) TO service_role;
