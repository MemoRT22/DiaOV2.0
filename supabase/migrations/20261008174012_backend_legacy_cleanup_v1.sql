-- The manual Program editor and its count endpoint have no runtime callers in
-- the current frontend, Edge Functions, SQL routines, or triggers. Historical
-- activities and sessions remain untouched. RESTRICT makes an unexpected
-- dependency fail the migration rather than removing it implicitly.
DROP FUNCTION public.save_activity(jsonb) RESTRICT;
DROP FUNCTION public.save_session(jsonb) RESTRICT;
DROP FUNCTION public.save_activity_careers(uuid, uuid[]) RESTRICT;
DROP FUNCTION public.delete_activity(uuid) RESTRICT;
DROP FUNCTION public.delete_session(uuid) RESTRICT;
DROP FUNCTION public.session_reservation_counts() RESTRICT;

-- Discard still consumes this service-role-only RPC. Keep its signature during
-- the rolling Edge deployment, but remove every retired review transition.
-- Approved legacy submissions remain publishable by the separate atomic RPC.
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
BEGIN
  IF p_action IS DISTINCT FROM 'archive' OR p_review_feedback IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;
  IF length(coalesce(p_admin_notes, '')) > 5000 THEN RAISE EXCEPTION 'TEXT_TOO_LONG'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_members m
    JOIN public.staff_roles r ON r.user_id = m.user_id AND r.role = 'coordinacion'
    WHERE m.user_id = p_actor AND m.is_active
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;
  IF v_edition IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  SELECT * INTO v_submission FROM public.workshop_submissions
    WHERE id = p_submission_id AND edition_id = v_edition FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_from := v_submission.status;
  IF v_from NOT IN ('submitted', 'in_review', 'changes_requested', 'approved') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  UPDATE public.workshop_submissions
  SET status = 'archived', reviewed_at = now(), reviewed_by = p_actor,
    admin_notes = CASE WHEN p_admin_notes IS NOT NULL
      THEN nullif(btrim(p_admin_notes), '') ELSE admin_notes END
  WHERE id = p_submission_id RETURNING * INTO v_submission;

  INSERT INTO public.audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_edition, p_actor, 'workshop_submission.archived',
    jsonb_build_object('submission_id', p_submission_id,
      'from_status', v_from, 'to_status', 'archived'));

  RETURN jsonb_build_object('id', v_submission.id, 'status', v_submission.status,
    'reviewed_at', v_submission.reviewed_at, 'reviewed_by', v_submission.reviewed_by,
    'admin_notes', v_submission.admin_notes, 'review_feedback', v_submission.review_feedback);
END;
$$;
REVOKE ALL ON FUNCTION public.workshop_review_transition_internal(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workshop_review_transition_internal(uuid, uuid, text, text, text)
  TO service_role;
