-- UX-2: preparation is disposable; configuration and audit history are not.
ALTER TABLE public.editions ADD COLUMN IF NOT EXISTS last_preparation_reset_at timestamptz;

CREATE TABLE IF NOT EXISTS public.preparation_auth_cleanup (
  -- Deliberately no FK to auth.users: the row survives successful Auth deletion as evidence.
  auth_user_id uuid PRIMARY KEY,
  edition_id uuid NOT NULL REFERENCES public.editions(id) ON DELETE RESTRICT,
  reset_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed', 'deleted')),
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preparation_auth_cleanup_pending_idx
  ON public.preparation_auth_cleanup (edition_id, status, created_at);
ALTER TABLE public.preparation_auth_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preparation_auth_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.preparation_auth_cleanup TO service_role;

-- The Edge Function authenticates the caller; the database checks again before each privileged action.
CREATE OR REPLACE FUNCTION public.preparation_reset_preview_internal(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
    'auth_identities', (SELECT count(*) FROM public.participants p JOIN auth.users u ON u.id=p.auth_user_id
      WHERE p.edition_id=v_ed AND lower(u.email)=('p.'||p.id::text||'@participantes.diaov.invalid'))
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
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ed uuid; v_mode text; v_preview jsonb; v_run uuid := gen_random_uuid(); v_now timestamptz := clock_timestamp();
BEGIN
  IF p_phrase IS DISTINCT FROM 'REINICIAR PREPARACIÓN' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
  -- Serializes resets and operation-real activation on the active edition.
  SELECT id, mode INTO v_ed, v_mode FROM public.editions WHERE is_active FOR UPDATE;
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF v_mode <> 'preparacion' THEN RAISE EXCEPTION 'RESET_DISABLED'; END IF;
  v_preview := public.preparation_reset_preview_internal(p_actor);

  INSERT INTO public.preparation_auth_cleanup(auth_user_id,edition_id,reset_id)
    SELECT u.id,v_ed,v_run FROM public.participants p JOIN auth.users u ON u.id=p.auth_user_id
    WHERE p.edition_id=v_ed AND lower(u.email)=('p.'||p.id::text||'@participantes.diaov.invalid')
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

CREATE OR REPLACE FUNCTION public.preparation_auth_cleanup_result_internal(
  p_actor uuid, p_auth_user_id uuid, p_success boolean, p_error_code text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ed uuid; v_run uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members s JOIN public.staff_roles r ON r.user_id=s.user_id
    WHERE s.user_id=p_actor AND s.is_active AND r.role='coordinacion') THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT edition_id,reset_id INTO v_ed,v_run FROM public.preparation_auth_cleanup WHERE auth_user_id=p_auth_user_id FOR UPDATE;
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  UPDATE public.preparation_auth_cleanup SET status=CASE WHEN p_success THEN 'deleted' ELSE 'failed' END,
    attempts=attempts+1,error_code=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error_code,'AUTH_ERROR'),80) END,
    updated_at=clock_timestamp() WHERE auth_user_id=p_auth_user_id;
  INSERT INTO public.audit_log(edition_id,actor_user_id,action,detail) VALUES
    (v_ed,p_actor,'preparation.auth_cleanup',jsonb_build_object('reset_id',v_run,'auth_user_id',p_auth_user_id,
      'status',CASE WHEN p_success THEN 'deleted' ELSE 'failed' END,'error_code',CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error_code,'AUTH_ERROR'),80) END));
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_real_operation(p_phrase text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ed uuid; v_mode text; v_temporary integer;
BEGIN
  PERFORM public.require_coordinacion();
  IF p_phrase IS DISTINCT FROM 'ACTIVAR OPERACIÓN REAL' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
  SELECT id,mode INTO v_ed,v_mode FROM public.editions WHERE is_active FOR UPDATE;
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF v_mode <> 'preparacion' THEN RAISE EXCEPTION 'ALREADY_REAL'; END IF;
  SELECT (SELECT count(*) FROM public.participants WHERE edition_id=v_ed AND is_demo)
    + (SELECT count(*) FROM public.activity_sessions s JOIN public.activities a ON a.id=s.activity_id WHERE a.edition_id=v_ed AND s.is_demo)
    + (SELECT count(*) FROM public.activities WHERE edition_id=v_ed AND is_demo)
    + (SELECT count(*) FROM public.careers WHERE is_demo)
    + (SELECT count(*) FROM public.divisions WHERE is_demo)
    + (SELECT count(*) FROM public.staff_members WHERE is_demo)
    INTO v_temporary;
  IF v_temporary > 0 THEN RAISE EXCEPTION 'TEMPORARY_RECORDS_REMAIN'; END IF;
  IF EXISTS (SELECT 1 FROM public.preparation_auth_cleanup WHERE edition_id=v_ed AND status IN ('pending','failed'))
    THEN RAISE EXCEPTION 'AUTH_CLEANUP_PENDING'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.theme_versions WHERE edition_id=v_ed AND status='published')
    THEN RAISE EXCEPTION 'NO_PUBLISHED_THEME'; END IF;
  UPDATE public.editions SET mode='operacion_real',real_operation_at=now(),theme_unlock_until=NULL WHERE id=v_ed;
  PERFORM public.write_audit('edition.real_operation_activated','{}'::jsonb);
END;
$$;

-- The legacy partial purge must not remain a browser-callable destructive endpoint.
-- (TRANSITORIO) Mantenemos EXECUTE en primitivas legadas por compatibilidad temporal con frontend publicado
-- REVOKE EXECUTE ON FUNCTION public.purge_demo_data(text) FROM PUBLIC, anon, authenticated;

-- REVOKE EXECUTE ON FUNCTION public.demo_purge_preview() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.preparation_reset_preview_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_preparation_internal(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preparation_auth_cleanup_result_internal(uuid,uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparation_reset_preview_internal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_preparation_internal(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.preparation_auth_cleanup_result_internal(uuid,uuid,boolean,text) TO service_role;
