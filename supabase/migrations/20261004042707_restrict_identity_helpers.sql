/*
# Restrict identity helpers to signed-in users

1. Security
- `is_coordinacion()` and `current_participant_id()` are only meaningful for a signed-in caller
  and are used solely by policies scoped to `authenticated`.
- EXECUTE is revoked from `anon` and `public`; `authenticated` keeps access so existing policies keep working.
*/

REVOKE EXECUTE ON FUNCTION public.is_coordinacion() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_participant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_coordinacion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_participant_id() TO authenticated;
