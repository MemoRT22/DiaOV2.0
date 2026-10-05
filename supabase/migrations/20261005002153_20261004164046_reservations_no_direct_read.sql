REVOKE ALL ON TABLE public.reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL (id, participant_id, session_id, activity_id, status, created_at, ended_at, replaced_by)
  ON TABLE public.reservations FROM PUBLIC, anon, authenticated;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;