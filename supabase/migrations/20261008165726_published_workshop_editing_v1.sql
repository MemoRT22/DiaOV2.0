-- A 15-minute slot belongs exclusively to Vida Universitaria, including direct database writes.
ALTER TABLE public.workshop_submissions DROP CONSTRAINT workshop_submissions_duration_check;
ALTER TABLE public.workshop_submissions ADD CONSTRAINT workshop_submissions_duration_check CHECK (
  (activity_type = 'academica' AND session_duration_minutes IN (30, 60)) OR
  (activity_type = 'vida_universitaria' AND session_duration_minutes IN (15, 30, 60))
);

-- The existing service-role RPC remains the sole save operation for pending and published workshops.
-- PostgreSQL commits the editorial row, projection, relationships, sessions, and audit together.
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
  v_start timestamptz;
  v_end timestamptz;
  v_step interval;
  v_credits smallint := 1;
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
    FOR v_session IN SELECT id, credits FROM public.activity_sessions
      WHERE activity_id = v_activity.id ORDER BY starts_at, id FOR UPDATE LOOP
      v_sessions := v_sessions + 1;
      IF v_sessions = 1 THEN v_credits := v_session.credits; END IF;
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
      DELETE FROM public.activity_sessions WHERE activity_id = v_activity.id;
      v_start := (v_ed.event_date + TIME '10:00') AT TIME ZONE 'America/Cancun';
      v_end := (v_ed.event_date + TIME '12:00') AT TIME ZONE 'America/Cancun';
      v_step := make_interval(mins => v_duration);
      WHILE v_start + v_step <= v_end LOOP
        INSERT INTO public.activity_sessions(activity_id, starts_at, ends_at, capacity, is_demo, status, credits)
          VALUES (v_activity.id, v_start, v_start + v_step, v_capacity, v_activity.is_demo, 'activa', v_credits);
        v_start := v_start + v_step;
      END LOOP;
    ELSE
      -- Keep session IDs, status, times, and location overrides intact.
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
