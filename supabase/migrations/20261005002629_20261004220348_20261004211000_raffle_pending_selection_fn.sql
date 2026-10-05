CREATE OR REPLACE FUNCTION public.raffle_pending_selection(p_prize_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rw raffle_winners%ROWTYPE; v_name text;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_rw FROM raffle_winners WHERE prize_id = p_prize_id AND status = 'seleccionado' LIMIT 1;
  IF v_rw.id IS NULL THEN RETURN jsonb_build_object('winner_id', null); END IF;
  SELECT pp.display_name INTO v_name FROM participant_profiles pp WHERE pp.participant_id = v_rw.participant_id;
  RETURN jsonb_build_object('winner_id', v_rw.id, 'display_name', coalesce(v_name, 'Participante'), 'status', v_rw.status, 'drawn_at', v_rw.drawn_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.raffle_pending_selection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raffle_pending_selection(uuid) TO authenticated;