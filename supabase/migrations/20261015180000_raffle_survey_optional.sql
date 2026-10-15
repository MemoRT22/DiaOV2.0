/*
  La encuesta de salida deja de ser requisito del sorteo (decision de Coordinacion, 2026-10-15).

  Unico cambio: se quita la condicion «encuesta completada». Todo lo demas de la elegibilidad queda IGUAL: sellos y reglas de cada categoria
  (`participant_stamp_category` / `raffle_rules_met`, sin tocar), edicion, DEMO/real, exclusion de ganadores confirmados y seleccionados,
  no-presentado mas reciente de ese premio, premios, inventario, idempotencia, bloqueo de premio y reintentos ante concurrencia.
  Completar la encuesta NO da ventaja alguna (ni boletos, ni probabilidad). La encuesta sigue existiendo, se sigue contestando y guardando.

  Funciones y objetos que impedian participar sin encuesta:
  - participant_raffle_category: devolvia NULL si no habia encuesta  -> ahora = participant_stamp_category (solo sellos).
  - raffle_eligible_pool: filtro `participant_exit_survey_completed(p.id)` -> eliminado.
  - draw_winner: `IF NOT participant_exit_survey_completed(...) THEN SURVEY_REQUIRED` -> eliminado.
  - trigger raffle_winners_require_survey (BEFORE INSERT, raffle_winners) y su funcion -> retirados (los demas triggers de la tabla no se tocan).
  - my_raffle_status.raffle_eligible: `categoria AND encuesta` -> solo categoria (survey_completed se conserva como dato informativo).
  - exit_survey_status_internal.eligible: ya no exige haber contestado (stamps_met / completed se conservan).
  - raffle_operator_view: `pool_count` ya sale del mismo grupo; se retira `survey_pending_count` (decia «aun no contestan la encuesta»).

  Reversible: las definiciones anteriores estan en 20261014140000_exit_survey_raffle_requirement.sql.
  No toca datos (ni ganadores, ni respuestas de la encuesta) ni check_in ni sellos.
*/

-- 1) La categoria del sorteo depende exclusivamente de los sellos.
CREATE OR REPLACE FUNCTION public.participant_raffle_category(p_pid uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT participant_stamp_category(p_pid);
$function$;

-- 2) Conjunto sorteable: igual que antes, sin el filtro de encuesta.
CREATE OR REPLACE FUNCTION public.raffle_eligible_pool(p_category_id uuid, p_prize_id uuid DEFAULT NULL::uuid, p_is_demo boolean DEFAULT NULL::boolean)
RETURNS TABLE(participant_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id
  FROM raffle_categories rc
  JOIN participants p ON p.edition_id = rc.edition_id AND p.is_demo = coalesce(p_is_demo, rc.is_demo)
  WHERE rc.id = p_category_id
    AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'confirmado')
    AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'seleccionado')
    AND NOT (
      p_prize_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM raffle_winners rw
        WHERE rw.participant_id = p.id AND rw.prize_id = p_prize_id AND rw.status = 'no_presentado'
          AND NOT EXISTS (
            SELECT 1 FROM raffle_winners rw3
            WHERE rw3.prize_id = p_prize_id
              AND rw3.status IN ('seleccionado', 'confirmado', 'no_presentado')
              AND rw3.drawn_at > rw.drawn_at)))
    AND participant_raffle_category(p.id) = rc.id;
$function$;

-- 3) El sorteo: identico, sin la validacion de encuesta.
CREATE OR REPLACE FUNCTION public.draw_winner(p_prize_id uuid, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
    -- El conjunto sorteable sale de UNA sola funcion (la misma que alimenta los conteos del panel): sellos de la categoria,
    -- sin ganadores confirmados ni seleccionados pendientes ni el no-presentado mas reciente de este premio.
    SELECT array_agg(t.participant_id) INTO v_candidates FROM raffle_eligible_pool(v_cat.id, p_prize_id, v_is_demo) AS t;
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
$function$;

-- 4) Se retira unicamente la restriccion de encuesta; folio inmutable y guardia DEMO/real siguen activos.
DROP TRIGGER IF EXISTS raffle_winners_require_survey ON public.raffle_winners;
DROP FUNCTION IF EXISTS public.raffle_winners_require_survey();

-- 5) Estado del alumno: participa con los sellos de su categoria (la encuesta es solo informativa).
CREATE OR REPLACE FUNCTION public.my_raffle_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_stamps record;
  v_category uuid;
  v_cat_name text;
  v_has_won boolean;
  v_survey boolean;
  v_categories jsonb;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_stamps FROM participant_stamps(v_pid);
  v_has_won := participant_has_won(v_pid);
  v_survey := participant_exit_survey_completed(v_pid);
  IF NOT v_has_won THEN
    v_category := participant_stamp_category(v_pid);
    IF v_category IS NOT NULL THEN
      SELECT name INTO v_cat_name FROM raffle_categories WHERE id = v_category;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', rc.id, 'name', rc.name, 'sort_order', rc.sort_order, 'rules', rc.rules)
    ORDER BY rc.sort_order, rc.name, rc.id), '[]'::jsonb)
  INTO v_categories
  FROM raffle_categories rc
  WHERE rc.edition_id = v_p.edition_id AND rc.is_demo IS NOT DISTINCT FROM v_p.is_demo AND rc.is_active;
  RETURN jsonb_build_object(
    'academic_stamps', v_stamps.academic,
    'university_life_stamps', v_stamps.university_life,
    'total_stamps', v_stamps.academic + v_stamps.university_life,
    'academic_tickets', v_stamps.academic,
    'leadership_tickets', v_stamps.university_life,
    'raffle_category', v_category,
    'raffle_category_name', v_cat_name,
    'has_won', v_has_won,
    'survey_completed', v_survey,
    'raffle_eligible', v_category IS NOT NULL,
    'categories', v_categories
  );
END;
$function$;

-- 6) Estado de la encuesta: «eligible» = sellos de una categoria (haber contestado ya no cambia nada).
CREATE OR REPLACE FUNCTION public.exit_survey_status_internal(p_pid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p participants%ROWTYPE;
  v_completed_at timestamptz;
  v_category uuid;
  v_category_name text;
  v_has_won boolean;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = p_pid;
  SELECT r.completed_at INTO v_completed_at FROM exit_survey_responses r WHERE r.participant_id = p_pid AND r.edition_id = v_p.edition_id;
  v_has_won := participant_has_won(p_pid);
  v_category := participant_stamp_category(p_pid);
  IF v_category IS NOT NULL THEN SELECT name INTO v_category_name FROM raffle_categories WHERE id = v_category; END IF;
  RETURN jsonb_build_object(
    'version', exit_survey_version(),
    'opens_at', exit_survey_opens_at_of(v_p.edition_id),
    'server_now', now(),
    'is_open', exit_survey_is_open(p_pid),
    'completed', v_completed_at IS NOT NULL,
    'completed_at', v_completed_at,
    'invited_at', (SELECT i.invited_at FROM exit_survey_invitations i WHERE i.participant_id = p_pid),
    'has_won', v_has_won,
    'stamps_category_id', v_category,
    'stamps_category_name', v_category_name,
    'stamps_met', v_category IS NOT NULL,
    'eligible', v_category IS NOT NULL
  );
END;
$function$;

-- 7) Panel del operador: los conteos salen del mismo grupo (ya sin encuesta); se retira el indicador «sin encuesta».
CREATE OR REPLACE FUNCTION public.raffle_operator_view()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean; v_categories jsonb; v_unassigned jsonb;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', rc.id, 'name', rc.name, 'sort_order', rc.sort_order, 'rules', rc.rules,
      'required_academic', rc.required_academic, 'required_leadership', rc.required_leadership,
      'is_active', rc.is_active, 'is_demo', rc.is_demo,
      'pool_count', (SELECT count(*) FROM raffle_eligible_pool(rc.id, NULL, rc.is_demo)))
    ORDER BY rc.sort_order DESC), '[]'::jsonb)
  INTO v_categories
  FROM raffle_categories rc
  WHERE rc.edition_id = v_ed AND (has_staff_role('coordinacion') OR rc.is_demo = v_is_demo);

  IF has_staff_role('coordinacion') THEN
    -- Participantes con sellos que todavía no alcanzan ninguna categoría activa, agrupados por combinación.
    WITH combos AS (
      SELECT s.academic, s.university_life
      FROM participants p CROSS JOIN LATERAL participant_stamps(p.id) s
      WHERE p.edition_id = v_ed AND p.is_demo = v_is_demo AND s.academic + s.university_life > 0
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('academic', g.academic, 'university_life', g.university_life,
        'leadership', g.university_life, 'count', g.n) ORDER BY g.academic DESC, g.university_life DESC), '[]'::jsonb)
    INTO v_unassigned
    FROM (
      SELECT c.academic, c.university_life, count(*) AS n
      FROM combos c
      WHERE NOT EXISTS (
        SELECT 1 FROM raffle_categories rc
        WHERE rc.edition_id = v_ed AND rc.is_active AND rc.is_demo = v_is_demo
          AND raffle_rules_met(rc.rules, c.academic, c.university_life))
      GROUP BY c.academic, c.university_life
    ) g;
  ELSE
    v_unassigned := '[]'::jsonb;
  END IF;
  RETURN jsonb_build_object('categories', v_categories, 'unassigned_combinations', v_unassigned);
END;
$function$;
