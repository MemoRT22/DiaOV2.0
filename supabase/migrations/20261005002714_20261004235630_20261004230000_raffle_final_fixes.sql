CREATE OR REPLACE FUNCTION public.raffle_pending_selection(p_prize_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_rw raffle_winners%ROWTYPE;
  v_name text;
  v_prize_name text;
  v_cat_name text;
  v_is_demo boolean;
  v_ed_mode text;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_rw FROM raffle_winners WHERE prize_id = p_prize_id AND status = 'seleccionado' LIMIT 1;
  IF v_rw.id IS NULL THEN RETURN jsonb_build_object('winner_id', null); END IF;
  SELECT mode INTO v_ed_mode FROM editions WHERE id = v_ed;
  IF has_staff_role('coordinacion') THEN
    NULL;
  ELSE
    IF v_ed_mode = 'preparacion' AND NOT v_rw.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_ed_mode <> 'preparacion' AND v_rw.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  END IF;
  SELECT pp.display_name INTO v_name FROM participant_profiles pp WHERE pp.participant_id = v_rw.participant_id;
  SELECT name INTO v_prize_name FROM raffle_prizes WHERE id = v_rw.prize_id;
  SELECT name INTO v_cat_name FROM raffle_categories WHERE id = v_rw.category_id;
  RETURN jsonb_build_object(
    'winner_id', v_rw.id, 'display_name', coalesce(v_name, 'Participante'),
    'status', v_rw.status, 'drawn_at', v_rw.drawn_at,
    'prize_id', v_rw.prize_id, 'prize_name', coalesce(v_prize_name, ''),
    'category_id', v_rw.category_id, 'category_name', coalesce(v_cat_name, '')
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.raffle_pending_selection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raffle_pending_selection(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.draw_winner(p_prize_id uuid, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ed_mode text;
  v_prize raffle_prizes%ROWTYPE;
  v_cat raffle_categories%ROWTYPE;
  v_existing raffle_winners%ROWTYPE;
  v_candidates uuid[];
  v_count int;
  v_rand_bytes bytea;
  v_rand_int int;
  v_winner_id uuid;
  v_winner_name text;
  v_new_id uuid;
  v_delivered int;
  v_is_demo boolean;
  v_attempt int := 0;
  v_max_attempts int := 10;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing FROM raffle_winners
    WHERE idempotency_key = btrim(p_idempotency_key) AND prize_id = p_prize_id;
    IF v_existing.id IS NOT NULL THEN
      SELECT pp.display_name INTO v_winner_name
      FROM participant_profiles pp WHERE pp.participant_id = v_existing.participant_id;
      RETURN jsonb_build_object('winner_id', v_existing.id, 'participant_id', v_existing.participant_id,
        'display_name', coalesce(v_winner_name, 'Participante'), 'prize_id', v_existing.prize_id,
        'status', v_existing.status, 'idempotent', true);
    END IF;
  END IF;
  SELECT * INTO v_prize FROM raffle_prizes WHERE id = p_prize_id AND edition_id = v_ed FOR UPDATE;
  IF v_prize.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT v_prize.is_active THEN RAISE EXCEPTION 'PRIZE_INACTIVE'; END IF;
  SELECT mode INTO v_ed_mode FROM editions WHERE id = v_ed;
  IF NOT has_staff_role('coordinacion') THEN
    IF v_ed_mode = 'preparacion' AND NOT v_prize.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_ed_mode <> 'preparacion' AND v_prize.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  END IF;
  SELECT * INTO v_cat FROM raffle_categories WHERE id = v_prize.category_id AND edition_id = v_ed;
  IF v_cat.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT v_cat.is_active THEN RAISE EXCEPTION 'CATEGORY_INACTIVE'; END IF;
  IF EXISTS (SELECT 1 FROM raffle_winners WHERE prize_id = p_prize_id AND status = 'seleccionado') THEN
    RAISE EXCEPTION 'PENDING_SELECTION';
  END IF;
  SELECT count(*) INTO v_delivered FROM raffle_winners
  WHERE prize_id = p_prize_id AND status IN ('seleccionado', 'confirmado');
  IF v_delivered >= v_prize.quantity THEN RAISE EXCEPTION 'PRIZE_EXHAUSTED'; END IF;
  v_is_demo := v_prize.is_demo;

  WHILE v_attempt < v_max_attempts LOOP
    WITH eligible AS (
      SELECT p.id FROM participants p
      WHERE p.edition_id = v_ed AND p.is_demo = v_is_demo
        AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'confirmado')
        AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'seleccionado')
        AND NOT EXISTS (
          SELECT 1 FROM raffle_winners rw
          WHERE rw.participant_id = p.id AND rw.prize_id = p_prize_id AND rw.status = 'no_presentado'
            AND NOT EXISTS (
              SELECT 1 FROM raffle_winners rw3
              WHERE rw3.prize_id = p_prize_id
                AND rw3.status IN ('seleccionado', 'confirmado', 'no_presentado')
                AND rw3.drawn_at > rw.drawn_at
            )
        )
        AND participant_raffle_category(p.id) = v_cat.id
    )
    SELECT array_agg(id) INTO v_candidates FROM eligible;
    v_count := coalesce(array_length(v_candidates, 1), 0);
    IF v_count = 0 THEN RAISE EXCEPTION 'POOL_EMPTY'; END IF;

    v_rand_bytes := extensions.gen_random_bytes(4);
    v_rand_int := ((get_byte(v_rand_bytes, 0) << 24) | (get_byte(v_rand_bytes, 1) << 16) | (get_byte(v_rand_bytes, 2) << 8) | get_byte(v_rand_bytes, 3)) & 2147483647;
    v_winner_id := v_candidates[(v_rand_int % v_count) + 1];
    SELECT pp.display_name INTO v_winner_name FROM participant_profiles pp WHERE pp.participant_id = v_winner_id;
    v_winner_name := coalesce(v_winner_name, 'Participante');

    BEGIN
      INSERT INTO raffle_winners (edition_id, category_id, prize_id, participant_id, status, drawn_by, origin, idempotency_key, is_demo)
      VALUES (v_ed, v_cat.id, p_prize_id, v_winner_id, 'seleccionado', auth.uid(), 'online', p_idempotency_key, v_is_demo)
      RETURNING id INTO v_new_id;
      PERFORM write_audit('raffle.draw_executed', jsonb_build_object('winner_id', v_new_id, 'prize_id', p_prize_id, 'category_id', v_cat.id, 'pool_size', v_count, 'attempt', v_attempt + 1));
      RETURN jsonb_build_object('winner_id', v_new_id, 'participant_id', v_winner_id, 'display_name', v_winner_name,
        'prize_id', p_prize_id, 'prize_name', v_prize.name, 'category_id', v_cat.id, 'category_name', v_cat.name,
        'status', 'seleccionado', 'pool_size', v_count, 'idempotent', false);
    EXCEPTION
      WHEN unique_violation THEN
        v_attempt := v_attempt + 1;
        CONTINUE;
    END;
  END LOOP;
  RAISE EXCEPTION 'POOL_EMPTY';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.draw_winner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draw_winner(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_winner(p_winner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rw raffle_winners%ROWTYPE;
  v_prize raffle_prizes%ROWTYPE;
  v_delivered int;
  v_ed uuid := active_edition_id();
  v_ed_mode text;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_rw FROM raffle_winners WHERE id = p_winner_id FOR UPDATE;
  IF v_rw.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_rw.status <> 'seleccionado' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  SELECT mode INTO v_ed_mode FROM editions WHERE id = v_ed;
  IF NOT has_staff_role('coordinacion') THEN
    IF v_ed_mode = 'preparacion' AND NOT v_rw.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_ed_mode <> 'preparacion' AND v_rw.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  END IF;
  SELECT * INTO v_prize FROM raffle_prizes WHERE id = v_rw.prize_id FOR UPDATE;
  SELECT count(*) INTO v_delivered FROM raffle_winners WHERE prize_id = v_rw.prize_id AND status IN ('seleccionado', 'confirmado');
  IF v_delivered > v_prize.quantity THEN RAISE EXCEPTION 'PRIZE_EXHAUSTED'; END IF;
  UPDATE raffle_winners SET status = 'confirmado', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_winner_id;
  PERFORM write_audit('raffle.winner_confirmed', jsonb_build_object('winner_id', p_winner_id, 'prize_id', v_rw.prize_id));
  RETURN jsonb_build_object('winner_id', p_winner_id, 'status', 'confirmado');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_winner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_winner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_no_show(p_winner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rw raffle_winners%ROWTYPE;
  v_ed uuid := active_edition_id();
  v_ed_mode text;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_rw FROM raffle_winners WHERE id = p_winner_id FOR UPDATE;
  IF v_rw.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_rw.status <> 'seleccionado' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  SELECT mode INTO v_ed_mode FROM editions WHERE id = v_ed;
  IF NOT has_staff_role('coordinacion') THEN
    IF v_ed_mode = 'preparacion' AND NOT v_rw.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_ed_mode <> 'preparacion' AND v_rw.is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  END IF;
  UPDATE raffle_winners SET status = 'no_presentado' WHERE id = p_winner_id;
  PERFORM write_audit('raffle.no_show', jsonb_build_object('winner_id', p_winner_id, 'prize_id', v_rw.prize_id, 'participant_id', v_rw.participant_id));
  RETURN jsonb_build_object('winner_id', p_winner_id, 'status', 'no_presentado');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_no_show(uuid) TO authenticated;