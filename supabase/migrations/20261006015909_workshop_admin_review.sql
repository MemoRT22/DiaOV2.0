-- Fase 9C: revisión administrativa de propuestas. El frontend solo llama a workshop-admin.
ALTER TABLE public.workshop_submissions
  ADD COLUMN IF NOT EXISTS review_feedback text;

ALTER TABLE public.workshop_submissions
  ADD CONSTRAINT workshop_submissions_review_feedback_length
  CHECK (review_feedback IS NULL OR length(review_feedback) <= 5000);

COMMENT ON COLUMN public.workshop_submissions.review_feedback IS
  'Mensaje preparado para el tallerista al solicitar cambios; no se envía automáticamente.';

CREATE OR REPLACE FUNCTION public.workshop_admin_list_internal(
  p_status text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN
    ('submitted', 'in_review', 'changes_requested', 'approved', 'published', 'archived') THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;
  IF p_type IS NOT NULL AND p_type NOT IN ('academica', 'vida_universitaria') THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000 OR length(coalesce(v_search, '')) > 120 THEN
    RAISE EXCEPTION 'INVALID_FILTER';
  END IF;
  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;

  SELECT count(*) INTO v_total
  FROM public.workshop_submissions s
  WHERE s.edition_id = v_edition AND s.status <> 'draft'
    AND (p_status IS NULL OR s.status = p_status)
    AND (p_type IS NULL OR s.activity_type = p_type)
    AND (v_search IS NULL OR position(lower(v_search) in lower(s.title)) > 0
      OR position(lower(v_search) in lower(s.facilitator_name)) > 0
      OR position(lower(v_search) in lower(s.facilitator_email)) > 0);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'status', s.status, 'submitted_at', s.submitted_at,
    'title', s.title, 'activity_type', s.activity_type,
    'experience_category', s.experience_category,
    'facilitator_name', s.facilitator_name,
    'session_duration_minutes', s.session_duration_minutes,
    'capacity_per_session', s.capacity_per_session,
    'career_count', (SELECT count(*) FROM public.workshop_submission_careers sc WHERE sc.submission_id = s.id)
  ) ORDER BY s.submitted_at DESC, s.id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT * FROM public.workshop_submissions s
    WHERE s.edition_id = v_edition AND s.status <> 'draft'
      AND (p_status IS NULL OR s.status = p_status)
      AND (p_type IS NULL OR s.activity_type = p_type)
      AND (v_search IS NULL OR position(lower(v_search) in lower(s.title)) > 0
        OR position(lower(v_search) in lower(s.facilitator_name)) > 0
        OR position(lower(v_search) in lower(s.facilitator_email)) > 0)
    ORDER BY s.submitted_at DESC, s.id DESC
    LIMIT 25 OFFSET (p_page - 1) * 25
  ) s;

  SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_counts
  FROM (
    SELECT status, count(*) AS n FROM public.workshop_submissions
    WHERE edition_id = v_edition AND status <> 'draft' GROUP BY status
  ) counted;

  RETURN jsonb_build_object('items', v_items, 'total', v_total,
    'page', p_page, 'page_size', 25, 'counts', v_counts);
END;
$$;

CREATE OR REPLACE FUNCTION public.workshop_admin_get_internal(p_submission_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_edition uuid;
  v_submission public.workshop_submissions%ROWTYPE;
  v_careers jsonb;
  v_reviewer text;
BEGIN
  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_edition AND status <> 'draft';
  IF v_submission.id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'career_id', c.id, 'career_name', c.name,
    'division_id', d.id, 'division_name', d.name, 'division_code', d.code
  ) ORDER BY d.sort_order, d.name, c.name), '[]'::jsonb)
  INTO v_careers
  FROM public.workshop_submission_careers sc
  JOIN public.careers c ON c.id = sc.career_id
  JOIN public.divisions d ON d.id = c.division_id
  WHERE sc.submission_id = v_submission.id;

  SELECT full_name INTO v_reviewer FROM public.staff_members WHERE user_id = v_submission.reviewed_by;
  RETURN to_jsonb(v_submission) || jsonb_build_object('careers', v_careers, 'reviewer_name', v_reviewer);
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
  IF p_action NOT IN ('start_review', 'save_notes', 'request_changes', 'resume_review', 'archive')
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
      IF v_from NOT IN ('submitted', 'in_review', 'changes_requested') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_audit_action := 'workshop_submission.notes_updated';
    WHEN 'request_changes' THEN
      IF v_from <> 'in_review' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'changes_requested'; v_audit_action := 'workshop_submission.changes_requested';
    WHEN 'resume_review' THEN
      IF v_from <> 'changes_requested' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
      v_to := 'in_review'; v_audit_action := 'workshop_submission.review_resumed';
    WHEN 'archive' THEN
      IF v_from NOT IN ('submitted', 'in_review', 'changes_requested') THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
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

REVOKE ALL ON FUNCTION public.workshop_admin_list_internal(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workshop_admin_get_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workshop_review_transition_internal(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_admin_list_internal(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.workshop_admin_get_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workshop_review_transition_internal(uuid, uuid, text, text, text) TO service_role;
