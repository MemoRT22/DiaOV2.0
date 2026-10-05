ALTER TABLE raffle_categories DROP CONSTRAINT IF EXISTS raffle_categories_edition_id_name_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raffle_categories_edition_id_name_is_demo_key') THEN
    ALTER TABLE raffle_categories ADD CONSTRAINT raffle_categories_edition_id_name_is_demo_key UNIQUE (edition_id, name, is_demo);
  END IF;
END $$;

DO $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  IF v_ed IS NULL THEN RETURN; END IF;
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_active, is_demo, visual_config)
  VALUES
    (v_ed, 'Baja', 10, 3, 0, true, false, '{}'::jsonb),
    (v_ed, 'Media', 20, 3, 1, true, false, '{}'::jsonb),
    (v_ed, 'Mayor', 30, 4, 1, true, false, '{}'::jsonb)
  ON CONFLICT (edition_id, name, is_demo) DO NOTHING;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS raffle_winners_one_seleccionado
  ON raffle_winners (participant_id) WHERE status = 'seleccionado';
CREATE UNIQUE INDEX IF NOT EXISTS raffle_winners_one_confirmado
  ON raffle_winners (participant_id) WHERE status = 'confirmado';

REVOKE EXECUTE ON FUNCTION public.participant_tickets(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.participant_raffle_category(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.participant_has_won(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_winner(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.my_raffle_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_tickets jsonb;
  v_category uuid;
  v_cat_name text;
  v_has_won boolean;
BEGIN
  v_tickets := participant_tickets(v_pid);
  v_has_won := participant_has_won(v_pid);
  IF NOT v_has_won THEN
    v_category := participant_raffle_category(v_pid);
    IF v_category IS NOT NULL THEN
      SELECT name INTO v_cat_name FROM raffle_categories WHERE id = v_category;
    END IF;
  ELSE
    v_category := NULL;
    v_cat_name := NULL;
  END IF;
  RETURN jsonb_build_object(
    'academic_tickets', (v_tickets->>'academic_tickets')::int,
    'leadership_tickets', (v_tickets->>'leadership_tickets')::int,
    'raffle_category', v_category,
    'raffle_category_name', v_cat_name,
    'has_won', v_has_won
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_raffle_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_raffle_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_progress()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(false);
  v_ed editions%ROWTYPE;
  v_stamps int;
  v_attended int;
  v_reserved int;
  v_divs uuid[];
  v_level int;
  v_next rank_levels%ROWTYPE;
  v_consent boolean;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  v_stamps := my_stamp_count(v_pid);
  v_attended := my_attended_workshop_count(v_pid);
  SELECT coalesce(array_agg(DISTINCT a2.division_id), '{}') INTO v_divs
  FROM attendances at JOIN activities a2 ON a2.id = at.activity_id
  WHERE at.participant_id = v_pid;
  SELECT count(*) INTO v_reserved FROM reservations WHERE participant_id = v_pid AND status = 'vigente';
  v_level := participant_rank_level(v_pid);
  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;
  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version
  INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;
  RETURN jsonb_build_object(
    'level', v_level, 'stamps', v_stamps,
    'attended_workshops', v_attended, 'reserved_workshops', v_reserved,
    'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object('level', v_next.level,
      'required_attendances', v_next.required_attendances, 'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'interests_prompt', v_attended >= v_ed.interests_prompt_min_attendances
      OR (v_ed.interests_prompt_at IS NOT NULL AND now() >= v_ed.interests_prompt_at),
    'interests_open', v_ed.interests_close_at IS NULL OR now() < v_ed.interests_close_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_progress() TO authenticated;

CREATE OR REPLACE FUNCTION public.draw_winner(p_prize_id uuid, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_ed uuid := active_edition_id();
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
              AND rw3.status IN ('seleccionado', 'confirmado')
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
  INSERT INTO raffle_winners (edition_id, category_id, prize_id, participant_id, status, drawn_by, origin, idempotency_key, is_demo)
  VALUES (v_ed, v_cat.id, p_prize_id, v_winner_id, 'seleccionado', auth.uid(), 'online', p_idempotency_key, v_is_demo)
  RETURNING id INTO v_new_id;
  PERFORM write_audit('raffle.draw_executed', jsonb_build_object('winner_id', v_new_id, 'prize_id', p_prize_id, 'category_id', v_cat.id, 'pool_size', v_count));
  RETURN jsonb_build_object('winner_id', v_new_id, 'participant_id', v_winner_id, 'display_name', v_winner_name,
    'prize_id', p_prize_id, 'prize_name', v_prize.name, 'category_id', v_cat.id, 'category_name', v_cat.name,
    'status', 'seleccionado', 'pool_size', v_count, 'idempotent', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.draw_winner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draw_winner(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_winner(p_winner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rw raffle_winners%ROWTYPE; v_prize raffle_prizes%ROWTYPE; v_delivered int;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_rw FROM raffle_winners WHERE id = p_winner_id FOR UPDATE;
  IF v_rw.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_rw.status <> 'seleccionado' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
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

CREATE OR REPLACE FUNCTION public.save_raffle_prize(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_ed uuid := active_edition_id();
  v_cat uuid := nullif(p->>'category_id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_desc text := left(coalesce(p->>'description', ''), 500);
  v_qty int := coalesce((p->>'quantity')::int, 0);
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_sort int := coalesce((p->>'sort_order')::int, 0);
  v_cat_demo boolean;
  v_prize_demo boolean;
  v_committed int;
BEGIN
  PERFORM require_coordinacion();
  IF length(v_name) < 2 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF v_qty < 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  SELECT is_demo INTO v_cat_demo FROM raffle_categories WHERE id = v_cat AND edition_id = v_ed;
  IF v_cat_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_id IS NOT NULL THEN
    SELECT is_demo INTO v_prize_demo FROM raffle_prizes WHERE id = v_id AND edition_id = v_ed;
    IF v_prize_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF v_cat_demo <> v_prize_demo THEN RAISE EXCEPTION 'DEMO_REAL_MISMATCH'; END IF;
    SELECT count(*) INTO v_committed FROM raffle_winners WHERE prize_id = v_id AND status IN ('seleccionado', 'confirmado');
    IF v_qty < v_committed THEN RAISE EXCEPTION 'QUANTITY_BELOW_COMMITTED'; END IF;
    UPDATE raffle_prizes SET category_id = v_cat, name = v_name, description = v_desc,
      quantity = v_qty, is_active = v_active, sort_order = v_sort
    WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ELSE
    INSERT INTO raffle_prizes (edition_id, category_id, name, description, quantity, is_active, sort_order, is_demo)
    VALUES (v_ed, v_cat, v_name, v_desc, v_qty, v_active, v_sort, v_cat_demo)
    RETURNING id INTO v_id;
  END IF;
  PERFORM write_audit('raffle.prize_saved', jsonb_build_object('id', v_id, 'name', v_name, 'quantity', v_qty, 'category_id', v_cat));
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_raffle_prize(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_raffle_prize(jsonb) TO authenticated;