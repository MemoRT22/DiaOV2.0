/*
# Sorteo final: RPCs de administración, sorteo, confirmación e invalidación

## Resumen
1. Administración (solo Coordinación): save_raffle_category, save_raffle_prize, invalidate_winner.
2. Operación (Sorteo o Coordinación): draw_winner, confirm_winner, mark_no_show.
3. Lectura: raffle_categories_read, raffle_prizes_read, raffle_pool_count,
   raffle_operator_view, raffle_winners_read.
4. Helper: get_pending_winner.
5. draw_winner usa gen_random_bytes, bloqueo de fila, idempotencia.
*/

-- save_raffle_category
CREATE OR REPLACE FUNCTION public.save_raffle_category(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_ed uuid := active_edition_id();
  v_name text := btrim(coalesce(p->>'name', ''));
  v_sort int := coalesce((p->>'sort_order')::int, 0);
  v_req_a int := coalesce((p->>'required_academic')::int, 0);
  v_req_l int := coalesce((p->>'required_leadership')::int, 0);
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_visual jsonb := coalesce((p->'visual_config')::jsonb, '{}'::jsonb);
BEGIN
  PERFORM require_coordinacion();
  IF length(v_name) < 2 OR length(v_name) > 100 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF v_req_a < 0 OR v_req_l < 0 THEN RAISE EXCEPTION 'INVALID_REQUIREMENTS'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership,
      is_active, is_demo, visual_config)
    VALUES (v_ed, v_name, v_sort, v_req_a, v_req_l, v_active,
      coalesce((p->>'is_demo')::boolean, false), v_visual)
    RETURNING id INTO v_id;
  ELSE
    UPDATE raffle_categories SET name = v_name, sort_order = v_sort,
      required_academic = v_req_a, required_leadership = v_req_l,
      is_active = v_active, visual_config = v_visual
    WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('raffle.category_saved',
    jsonb_build_object('id', v_id, 'name', v_name, 'required_academic', v_req_a, 'required_leadership', v_req_l));
  RETURN v_id;
END;
$$;

-- save_raffle_prize
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
BEGIN
  PERFORM require_coordinacion();
  IF length(v_name) < 2 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF v_qty < 0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  SELECT is_demo INTO v_cat_demo FROM raffle_categories WHERE id = v_cat AND edition_id = v_ed;
  IF v_cat_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO raffle_prizes (edition_id, category_id, name, description, quantity, is_active, sort_order, is_demo)
    VALUES (v_ed, v_cat, v_name, v_desc, v_qty, v_active, v_sort, v_cat_demo)
    RETURNING id INTO v_id;
  ELSE
    UPDATE raffle_prizes SET category_id = v_cat, name = v_name, description = v_desc,
      quantity = v_qty, is_active = v_active, sort_order = v_sort
    WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('raffle.prize_saved',
    jsonb_build_object('id', v_id, 'name', v_name, 'quantity', v_qty, 'category_id', v_cat));
  RETURN v_id;
END;
$$;

-- draw_winner
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
      AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.prize_id = p_prize_id AND rw.status = 'no_presentado')
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

-- confirm_winner
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

-- mark_no_show
CREATE OR REPLACE FUNCTION public.mark_no_show(p_winner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rw raffle_winners%ROWTYPE;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_rw FROM raffle_winners WHERE id = p_winner_id FOR UPDATE;
  IF v_rw.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_rw.status <> 'seleccionado' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE raffle_winners SET status = 'no_presentado' WHERE id = p_winner_id;
  PERFORM write_audit('raffle.no_show', jsonb_build_object('winner_id', p_winner_id, 'prize_id', v_rw.prize_id, 'participant_id', v_rw.participant_id));
  RETURN jsonb_build_object('winner_id', p_winner_id, 'status', 'no_presentado');
END;
$$;

-- invalidate_winner
CREATE OR REPLACE FUNCTION public.invalidate_winner(p_winner_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rw raffle_winners%ROWTYPE;
BEGIN
  PERFORM require_coordinacion();
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_rw FROM raffle_winners WHERE id = p_winner_id FOR UPDATE;
  IF v_rw.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_rw.status <> 'confirmado' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE raffle_winners SET status = 'invalidado', invalidated_by = auth.uid(), invalidated_at = now(),
    invalidation_reason = left(btrim(p_reason), 500) WHERE id = p_winner_id;
  PERFORM write_audit('raffle.winner_invalidated', jsonb_build_object('winner_id', p_winner_id, 'prize_id', v_rw.prize_id, 'participant_id', v_rw.participant_id, 'reason', left(btrim(p_reason), 500)));
  PERFORM write_audit('raffle.inventory_restored', jsonb_build_object('prize_id', v_rw.prize_id, 'winner_id', p_winner_id));
  RETURN jsonb_build_object('winner_id', p_winner_id, 'status', 'invalidado');
END;
$$;

-- get_pending_winner (helper)
CREATE OR REPLACE FUNCTION public.get_pending_winner(p_prize_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM raffle_winners WHERE prize_id = p_prize_id AND status = 'seleccionado' LIMIT 1;
$$;

-- Read RPCs
CREATE OR REPLACE FUNCTION public.raffle_categories_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort_order', sort_order,
      'required_academic', required_academic, 'required_leadership', required_leadership,
      'is_active', is_active, 'is_demo', is_demo, 'visual_config', visual_config) ORDER BY sort_order DESC)
    FROM raffle_categories WHERE edition_id = v_ed AND (has_staff_role('coordinacion') OR is_demo = v_is_demo)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.raffle_prizes_read(p_category_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_cat_demo boolean; v_is_demo boolean;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT is_demo INTO v_cat_demo FROM raffle_categories WHERE id = p_category_id AND edition_id = v_ed;
  IF v_cat_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  IF NOT has_staff_role('coordinacion') AND v_cat_demo <> v_is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name, 'description', description,
      'quantity', quantity, 'is_active', is_active, 'sort_order', sort_order,
      'delivered', (SELECT count(*) FROM raffle_winners rw WHERE rw.prize_id = raffle_prizes.id AND rw.status IN ('seleccionado', 'confirmado')),
      'available', quantity - (SELECT count(*) FROM raffle_winners rw WHERE rw.prize_id = raffle_prizes.id AND rw.status IN ('seleccionado', 'confirmado')))
    ORDER BY sort_order, name) FROM raffle_prizes WHERE category_id = p_category_id AND edition_id = v_ed
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.raffle_pool_count(p_category_id uuid)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_cat raffle_categories%ROWTYPE; v_is_demo boolean; v_count int;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_cat FROM raffle_categories WHERE id = p_category_id AND edition_id = v_ed;
  IF v_cat.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  IF NOT has_staff_role('coordinacion') AND v_cat.is_demo <> v_is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT count(*) INTO v_count FROM participants p
  WHERE p.edition_id = v_ed AND p.is_demo = v_cat.is_demo
    AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'confirmado')
    AND participant_raffle_category(p.id) = v_cat.id;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.raffle_operator_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean; v_categories jsonb; v_unassigned jsonb;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', rc.id, 'name', rc.name, 'sort_order', rc.sort_order,
    'required_academic', rc.required_academic, 'required_leadership', rc.required_leadership, 'is_active', rc.is_active,
    'pool_count', (SELECT count(*) FROM participants p WHERE p.edition_id = v_ed AND p.is_demo = rc.is_demo
      AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'confirmado')
      AND participant_raffle_category(p.id) = rc.id)) ORDER BY rc.sort_order DESC), '[]'::jsonb) INTO v_categories
  FROM raffle_categories rc WHERE rc.edition_id = v_ed AND (has_staff_role('coordinacion') OR rc.is_demo = v_is_demo);
  IF has_staff_role('coordinacion') THEN
    WITH combos AS (
      SELECT count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'academica') AS academic,
        count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'liderazgo') AS leadership
      FROM attendances at JOIN activities a ON a.id = at.activity_id JOIN participants p ON p.id = at.participant_id
      WHERE p.edition_id = v_ed AND p.is_demo = v_is_demo GROUP BY p.id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('academic', academic, 'leadership', leadership, 'count', count(*))
      ORDER BY academic DESC, leadership DESC), '[]'::jsonb) INTO v_unassigned
    FROM combos c WHERE NOT EXISTS (SELECT 1 FROM raffle_categories rc WHERE rc.edition_id = v_ed AND rc.is_active AND rc.is_demo = v_is_demo
      AND rc.required_academic <= c.academic AND rc.required_leadership <= c.leadership) GROUP BY academic, leadership;
  ELSE v_unassigned := '[]'::jsonb; END IF;
  RETURN jsonb_build_object('categories', v_categories, 'unassigned_combinations', v_unassigned);
END;
$$;

CREATE OR REPLACE FUNCTION public.raffle_winners_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', rw.id, 'prize_id', rw.prize_id, 'prize_name', rp.name,
      'category_id', rw.category_id, 'category_name', rc.name, 'display_name', coalesce(pp.display_name, 'Participante'),
      'status', rw.status, 'drawn_at', rw.drawn_at, 'confirmed_at', rw.confirmed_at,
      'invalidation_reason', rw.invalidation_reason, 'origin', rw.origin) ORDER BY rw.drawn_at DESC)
    FROM raffle_winners rw JOIN raffle_prizes rp ON rp.id = rw.prize_id JOIN raffle_categories rc ON rc.id = rw.category_id
    LEFT JOIN participant_profiles pp ON pp.participant_id = rw.participant_id
    WHERE rw.edition_id = v_ed AND (has_staff_role('coordinacion') OR rp.is_demo = v_is_demo)
  ), '[]'::jsonb);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.save_raffle_category(jsonb) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.save_raffle_category(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_raffle_prize(jsonb) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.save_raffle_prize(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.invalidate_winner(uuid, text) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.invalidate_winner(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.draw_winner(uuid, text) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.draw_winner(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_winner(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.confirm_winner(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_no_show(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.mark_no_show(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_winner(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.get_pending_winner(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.raffle_categories_read() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.raffle_categories_read() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.raffle_prizes_read(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.raffle_prizes_read(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.raffle_pool_count(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.raffle_pool_count(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.raffle_operator_view() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.raffle_operator_view() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.raffle_winners_read() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.raffle_winners_read() TO authenticated;
