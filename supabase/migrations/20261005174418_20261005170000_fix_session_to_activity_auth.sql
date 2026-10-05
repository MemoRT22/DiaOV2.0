/*
# Fase 8B fix — session_to_activity: autorización is_operativo
*/
CREATE OR REPLACE FUNCTION public.session_to_activity(p_session uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN (SELECT activity_id FROM activity_sessions WHERE id = p_session);
END;
$$;

REVOKE ALL ON FUNCTION public.session_to_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_to_activity(uuid) TO authenticated;
