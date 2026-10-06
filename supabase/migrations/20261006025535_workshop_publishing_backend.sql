-- 1. Modificar activity_type
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_activity_type_check CHECK (activity_type IN ('academica', 'vida_universitaria', 'liderazgo'));

-- 2. Agregar experience_category
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS experience_category text;
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_experience_category_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_experience_category_check CHECK (
  (activity_type = 'vida_universitaria' AND experience_category IN ('liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra'))
  OR (activity_type <> 'vida_universitaria' AND experience_category IS NULL)
);

-- 3. Multi-división
CREATE TABLE IF NOT EXISTS public.activity_divisions (
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  division_id uuid NOT NULL REFERENCES public.divisions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, division_id)
);

ALTER TABLE public.activity_divisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Actividades_divisions visibles públicamente" ON public.activity_divisions;
-- No public read access policy needed
REVOKE ALL ON TABLE public.activity_divisions FROM PUBLIC, anon, authenticated;

INSERT INTO public.activity_divisions (activity_id, division_id, created_at)
SELECT id, division_id, created_at FROM public.activities WHERE division_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.activities ALTER COLUMN division_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION save_activity(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid; v_title text := btrim(coalesce(p->>'title', ''));
  v_div uuid := nullif(p->>'division_id', '')::uuid; v_ed uuid := active_edition_id();
  v_type text := coalesce(p->>'activity_type', 'academica');
BEGIN
  PERFORM require_coordinacion();
  IF length(v_title) < 2 OR length(v_title) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF v_type NOT IN ('academica', 'vida_universitaria', 'liderazgo') THEN RAISE EXCEPTION 'INVALID_TYPE'; END IF;
  
  IF v_type = 'vida_universitaria' THEN
    v_div := NULL;
  ELSIF v_div IS NOT NULL AND NOT EXISTS (SELECT 1 FROM divisions WHERE id = v_div) THEN
    RAISE EXCEPTION 'INVALID_DIVISION';
  END IF;

  IF EXISTS (SELECT 1 FROM activities WHERE edition_id = v_ed AND (division_id = v_div OR (division_id IS NULL AND v_div IS NULL)) AND lower(title) = lower(v_title)
             AND id IS DISTINCT FROM v_id) THEN RAISE EXCEPTION 'ACTIVITY_EXISTS'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type, experience_category)
    VALUES (v_ed, v_div, v_title, left(coalesce(p->>'description', ''), 1000), left(coalesce(p->>'location', ''), 150),
      coalesce((p->>'is_demo')::boolean, false), v_type,
      CASE WHEN v_type = 'vida_universitaria' THEN coalesce(p->>'experience_category', 'vida_universitaria') ELSE NULL END
    ) RETURNING id INTO v_id;
    IF v_div IS NOT NULL THEN
      INSERT INTO activity_divisions (activity_id, division_id) VALUES (v_id, v_div);
    END IF;
  ELSE
    UPDATE activities SET division_id = v_div, title = v_title, description = left(coalesce(p->>'description', ''), 1000),
      location = left(coalesce(p->>'location', ''), 150), activity_type = v_type,
      experience_category = CASE WHEN v_type = 'vida_universitaria' THEN coalesce(p->>'experience_category', 'vida_universitaria') ELSE NULL END
      WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    
    IF v_type = 'vida_universitaria' THEN
      DELETE FROM activity_careers WHERE activity_id = v_id;
    END IF;
    
    DELETE FROM activity_divisions WHERE activity_id = v_id;
    IF v_div IS NOT NULL THEN
      INSERT INTO activity_divisions (activity_id, division_id) VALUES (v_id, v_div);
    END IF;
  END IF;
  PERFORM write_audit('catalog.activity_saved', jsonb_build_object('id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_activity_careers(p_activity_id uuid, p_career_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_act activities%ROWTYPE;
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
  v_div_array uuid[];
BEGIN
  PERFORM require_coordinacion();
  SELECT a.* INTO v_act FROM activities a WHERE a.id = p_activity_id AND a.edition_id = v_ed;
  IF v_act.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  
  IF v_act.activity_type = 'vida_universitaria' THEN
    IF v_n > 0 THEN RAISE EXCEPTION 'VIDA_UNIVERSITARIA_CANNOT_HAVE_CAREERS'; END IF;
  END IF;
  
  -- Validate all careers: active, same demo/real environment as activity
  IF v_n > 0 THEN
    IF (SELECT count(*) FROM careers c
        WHERE c.id = ANY(p_career_ids)
        AND c.is_active
        AND c.is_demo = v_act.is_demo
       ) <> v_n THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
    -- No duplicates
    IF (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN
      RAISE EXCEPTION 'DUPLICATE_INTEREST';
    END IF;
  END IF;

  DELETE FROM activity_careers WHERE activity_id = p_activity_id;
  
  IF v_n > 0 THEN
    INSERT INTO activity_careers (activity_id, career_id)
    SELECT p_activity_id, c.id
    FROM unnest(p_career_ids) AS u(id)
    JOIN careers c ON c.id = u.id;
  END IF;

  DELETE FROM activity_divisions WHERE activity_id = p_activity_id;
  
  IF v_act.activity_type = 'vida_universitaria' THEN
    UPDATE activities SET division_id = NULL WHERE id = p_activity_id;
  ELSE
    SELECT array_agg(DISTINCT c.division_id) INTO v_div_array
    FROM activity_careers ac
    JOIN careers c ON c.id = ac.career_id
    WHERE ac.activity_id = p_activity_id;

    IF v_div_array IS NOT NULL THEN
      INSERT INTO activity_divisions (activity_id, division_id)
      SELECT p_activity_id, unnest(v_div_array);
      
      IF array_length(v_div_array, 1) = 1 THEN
        UPDATE activities SET division_id = v_div_array[1] WHERE id = p_activity_id;
      ELSE
        UPDATE activities SET division_id = NULL WHERE id = p_activity_id;
      END IF;
    ELSE
      UPDATE activities SET division_id = NULL WHERE id = p_activity_id;
    END IF;
  END IF;

  PERFORM write_audit('catalog.activity_careers_saved', jsonb_build_object('activity_id', p_activity_id, 'career_count', v_n));
END;
$$;
CREATE OR REPLACE FUNCTION event_operations_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed           editions%ROWTYPE;
  v_server_time  timestamptz := now();
BEGIN
  IF NOT is_operativo() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACTIVE_EDITION';
  END IF;

  RETURN jsonb_build_object(
    'server_time', v_server_time,
    'mode', v_ed.mode,
    'checkin_close_after_minutes', v_ed.checkin_close_after_minutes,
    'summary', jsonb_build_object(
      'participants_total',
        (SELECT count(*) FROM participants p WHERE p.edition_id = v_ed.id),
      'platform_consents',
        (SELECT count(*) FROM participant_profiles pp
           JOIN participants p ON p.id = pp.participant_id
          WHERE p.edition_id = v_ed.id AND pp.platform_consent_at IS NOT NULL),
      -- 8C: active commitments (vigente, session not ended, no attendance for the workshop)
      'active_reservations',
        (SELECT count(*) FROM reservations r
           JOIN participants p ON p.id = r.participant_id
           JOIN activity_sessions s ON s.id = r.session_id
          WHERE p.edition_id = v_ed.id AND r.status = 'vigente'
            AND v_server_time < s.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a
                             WHERE a.participant_id = r.participant_id AND a.activity_id = r.activity_id)),
      'participants_with_reservations',
        (SELECT count(DISTINCT r.participant_id) FROM reservations r
           JOIN participants p ON p.id = r.participant_id
           JOIN activity_sessions s ON s.id = r.session_id
          WHERE p.edition_id = v_ed.id AND r.status = 'vigente'
            AND v_server_time < s.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a
                             WHERE a.participant_id = r.participant_id AND a.activity_id = r.activity_id)),
      'total_attendances',
        (SELECT count(*) FROM attendances at
           JOIN participants p ON p.id = at.participant_id
          WHERE p.edition_id = v_ed.id),
      'unique_attended_participants',
        (SELECT count(DISTINCT at.participant_id) FROM attendances at
           JOIN participants p ON p.id = at.participant_id
          WHERE p.edition_id = v_ed.id),
      'sessions_total',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id),
      'sessions_upcoming',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'activa'
            AND s.starts_at > v_server_time),
      'sessions_in_progress',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'activa'
            AND s.starts_at <= v_server_time
            AND s.ends_at > v_server_time),
      'sessions_ended',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'activa'
            AND s.ends_at <= v_server_time),
      'sessions_cancelled',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id
            AND s.status = 'cancelada')
    ),
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'activity_id', a.id,
        'title', a.title,
        'division_id', a.division_id,
        'division_name', d.name,
        'division_code', d.code,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'location', coalesce(nullif(s.location, ''), a.location),
        'status', s.status,
        'capacity', s.capacity,
        'reserved', cnt.reserved,
        'remaining', greatest(s.capacity - cnt.reserved, 0),
        'attended', cnt.attended,
        'is_demo', a.is_demo
      ) ORDER BY s.starts_at, a.title)
      FROM activity_sessions s
      JOIN activities a ON a.id = s.activity_id
      LEFT JOIN divisions d ON d.id = a.division_id
      CROSS JOIN LATERAL (
        SELECT
          session_reserved_count(s.id) AS reserved,
          (SELECT count(*) FROM attendances at WHERE at.session_id = s.id) AS attended
      ) AS cnt
      WHERE a.edition_id = v_ed.id
        AND (v_ed.mode = 'preparacion' OR NOT a.is_demo)
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.my_recommended_activities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_ed editions%ROWTYPE;
  v_interest_ids uuid[];
  v_attended_ids uuid[];
  v_result jsonb;
BEGIN
  SELECT p.* INTO v_p FROM participants p WHERE p.id = v_pid;
  SELECT e.* INTO v_ed FROM editions e WHERE e.id = v_p.edition_id;

  -- Build ordered interest list from initial_interests only (preference 1, then 2)
  v_interest_ids := ARRAY(
    SELECT ii.career_id FROM initial_interests ii
    WHERE ii.participant_id = v_pid
    ORDER BY ii.preference
  );

  -- Attended activity IDs (to mark as explored)
  SELECT coalesce(array_agg(DISTINCT att.activity_id), '{}') INTO v_attended_ids
  FROM attendances att WHERE att.participant_id = v_pid;

  -- Build recommendations
  WITH interest_careers AS (
    SELECT unnest(v_interest_ids) AS career_id, ord
    FROM generate_subscripts(v_interest_ids, 1) AS t(ord)
  ),
  related_activities AS (
    SELECT ac.activity_id, ic.career_id, ic.ord,
           c.name AS career_name,
           c.id AS cid
    FROM activity_careers ac
    JOIN interest_careers ic ON ic.career_id = ac.career_id
    JOIN careers c ON c.id = ic.career_id
    JOIN activities a ON a.id = ac.activity_id
    WHERE a.edition_id = v_ed.id AND a.is_demo = v_p.is_demo
      AND a.activity_type <> 'vida_universitaria'
  ),
  -- Only activities with at least one active session
  activities_with_sessions AS (
    SELECT DISTINCT ra.activity_id, ra.career_name, ra.career_id, ra.ord
    FROM related_activities ra
    JOIN activity_sessions s ON s.activity_id = ra.activity_id
    WHERE s.status = 'activa'
      AND s.is_demo = v_p.is_demo
  ),
  -- Deduplicate: aggregate career names per activity, keep min ord
  deduped AS (
    SELECT
      aw.activity_id,
      min(aw.ord) AS priority,
      string_agg(DISTINCT aw.career_name, ', ' ORDER BY aw.career_name) AS related_careers,
      jsonb_agg(DISTINCT jsonb_build_object('career_id', aw.career_id, 'career_name', aw.career_name)) AS careers
    FROM activities_with_sessions aw
    GROUP BY aw.activity_id
  ),
  final AS (
    SELECT
      d.activity_id,
      d.priority,
      d.related_careers,
      d.careers,
      a.title,
      a.description,
      a.is_demo,
      (d.activity_id = ANY(v_attended_ids)) AS already_attended,
      EXISTS (
        SELECT 1 FROM reservations r
        JOIN activity_sessions s ON s.id = r.session_id
        WHERE r.participant_id = v_pid AND r.status = 'vigente' AND s.activity_id = d.activity_id
      ) AS already_reserved,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', div.id, 'name', div.name, 'code', div.code
        ) ORDER BY div.name)
        FROM activity_divisions ad
        JOIN divisions div ON div.id = ad.division_id
        WHERE ad.activity_id = d.activity_id
      ), '[]'::jsonb) AS divisions_array,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'session_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
          'location', coalesce(nullif(s.location, ''), a.location),
          'capacity', s.capacity,
          'reserved', session_reserved_count(s.id),
          'remaining', greatest(s.capacity - session_reserved_count(s.id), 0),
          'credits', s.credits,
          'started', now() >= s.starts_at
        ) ORDER BY s.starts_at)
        FROM activity_sessions s
        WHERE s.activity_id = d.activity_id AND s.status = 'activa' AND s.is_demo = v_p.is_demo
      ), '[]'::jsonb) AS sessions
    FROM deduped d
    JOIN activities a ON a.id = d.activity_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', f.activity_id,
    'title', f.title,
    'description', left(f.description, 200),
    'division_id', CASE WHEN jsonb_array_length(f.divisions_array) = 1 THEN f.divisions_array->0->>'id' ELSE NULL END,
    'division_name', CASE WHEN jsonb_array_length(f.divisions_array) = 1 THEN f.divisions_array->0->>'name' ELSE NULL END,
    'division_code', CASE WHEN jsonb_array_length(f.divisions_array) = 1 THEN f.divisions_array->0->>'code' ELSE NULL END,
    'divisions', f.divisions_array,
    'related_careers', f.related_careers,
    'careers', f.careers,
    'already_attended', f.already_attended,
    'already_reserved', f.already_reserved,
    'sessions', f.sessions,
    'priority', f.priority
  ) ORDER BY f.already_attended, f.priority, f.title), '[]'::jsonb) INTO v_result
  FROM final f;

  RETURN jsonb_build_object(
    'recommendations', v_result,
    'interest_career_ids', to_jsonb(v_interest_ids),
    'attended_activity_ids', to_jsonb(v_attended_ids)
  );
END;
$$;
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

  IF v_submission.status <> 'approved' THEN
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
  SET status = v_to_status, published_activity_id = v_act
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

CREATE OR REPLACE FUNCTION public.workshop_review_transition_internal(
  p_actor uuid,
  p_submission_id uuid,
  p_action text,
  p_admin_notes text DEFAULT NULL,
  p_review_feedback text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_submission public.workshop_submissions%ROWTYPE;
  v_from text;
  v_to text;
  v_audit_action text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_members m
    JOIN public.staff_roles r ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_action NOT IN ('start_review', 'save_notes', 'request_changes', 'resume_review', 'archive', 'approve')
    OR p_action IS NULL THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
  IF length(coalesce(p_admin_notes, '')) > 5000 OR length(coalesce(p_review_feedback, '')) > 5000 THEN
    RAISE EXCEPTION 'TEXT_TOO_LONG';
  END IF;
  IF p_action = 'save_notes' AND p_admin_notes IS NULL THEN RAISE EXCEPTION 'NOTES_REQUIRED'; END IF;
  IF p_action = 'request_changes' AND nullif(btrim(coalesce(p_review_feedback, '')), '') IS NULL THEN
    RAISE EXCEPTION 'FEEDBACK_REQUIRED';
  END IF;

  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_edition FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_from := v_submission.status;
  v_to := v_from;

  CASE p_action
    WHEN 'start_review' THEN
      IF v_from <> 'submitted' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'in_review'; v_audit_action := 'workshop_submission.review_started';
    WHEN 'save_notes' THEN
      IF v_from NOT IN ('submitted', 'in_review', 'changes_requested', 'approved', 'published') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_audit_action := 'workshop_submission.notes_updated';
    WHEN 'request_changes' THEN
      IF v_from <> 'in_review' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'changes_requested'; v_audit_action := 'workshop_submission.changes_requested';
    WHEN 'resume_review' THEN
      IF v_from <> 'changes_requested' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'in_review'; v_audit_action := 'workshop_submission.review_resumed';
    WHEN 'approve' THEN
      IF v_from <> 'in_review' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'approved'; v_audit_action := 'workshop_submission.approved';
    WHEN 'archive' THEN
      IF v_from NOT IN ('submitted', 'in_review', 'changes_requested', 'approved') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'archived'; v_audit_action := 'workshop_submission.archived';
  END CASE;

  UPDATE public.workshop_submissions
  SET status = v_to, reviewed_at = now(), reviewed_by = p_actor,
    admin_notes = CASE WHEN p_action = 'save_notes' OR (p_action = 'archive' AND p_admin_notes IS NOT NULL)
      THEN nullif(btrim(p_admin_notes), '') ELSE admin_notes END,
    review_feedback = CASE WHEN p_action = 'request_changes' THEN btrim(p_review_feedback) ELSE review_feedback END
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_edition, p_actor, v_audit_action,
    jsonb_build_object('submission_id', p_submission_id, 'from_status', v_from, 'to_status', v_to));

  RETURN jsonb_build_object('id', v_submission.id, 'status', v_submission.status,
    'reviewed_at', v_submission.reviewed_at, 'reviewed_by', v_submission.reviewed_by,
    'admin_notes', v_submission.admin_notes, 'review_feedback', v_submission.review_feedback);
END;
$$;

CREATE OR REPLACE FUNCTION public.participant_tickets(p_pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'academic_tickets', count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'academica'),
    'leadership_tickets', count(DISTINCT a.id) FILTER (WHERE a.activity_type IN ('liderazgo', 'vida_universitaria'))
  )
  FROM attendances at JOIN activities a ON a.id = at.activity_id WHERE at.participant_id = p_pid;
$$;

CREATE OR REPLACE FUNCTION public.participant_raffle_category(p_pid uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tickets AS (
    SELECT
      count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'academica') AS academic,
      count(DISTINCT a.id) FILTER (WHERE a.activity_type IN ('liderazgo', 'vida_universitaria')) AS leadership
    FROM attendances at JOIN activities a ON a.id = at.activity_id WHERE at.participant_id = p_pid
  ),
  has_won AS (SELECT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p_pid AND rw.status = 'confirmado') AS won)
  SELECT rc.id FROM raffle_categories rc JOIN participants p ON p.edition_id = rc.edition_id CROSS JOIN tickets, has_won
  WHERE p.id = p_pid AND rc.is_active AND rc.is_demo IS NOT DISTINCT FROM p.is_demo AND rc.required_academic <= tickets.academic AND rc.required_leadership <= tickets.leadership AND NOT has_won.won
  ORDER BY rc.sort_order DESC, rc.required_academic DESC, rc.required_leadership DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.participant_rank_level(p_pid uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(max(rl.level), 1)
  FROM rank_levels rl
  JOIN participants p ON p.edition_id = rl.edition_id
  WHERE p.id = p_pid
    AND rl.required_attendances <= my_stamp_count(p_pid)
    AND rl.required_divisions <= (
      SELECT count(DISTINCT ad.division_id)
      FROM attendances at
      JOIN activities a ON a.id = at.activity_id
      JOIN activity_divisions ad ON ad.activity_id = a.id
      WHERE at.participant_id = p_pid
    );
$$;
