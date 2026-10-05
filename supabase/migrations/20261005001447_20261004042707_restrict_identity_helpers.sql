REVOKE EXECUTE ON FUNCTION public.is_coordinacion() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_participant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_coordinacion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_participant_id() TO authenticated;