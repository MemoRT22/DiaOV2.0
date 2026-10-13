/*
  Notificación de ganador y comprobación visual en la Bitácora.

  Aporta TRES cosas y nada más. No cambia draw_winner, confirm_winner, mark_no_show, invalidate_winner, my_raffle_status ni las
  reglas de elegibilidad, sellos, categorías o inventario de premios:

  1. Un FOLIO único y estable por resultado de sorteo (`raffle_winners.folio`, «GAN-000123»).
     Se asigna por un DEFAULT con secuencia, así que cualquier INSERT existente (draw_winner) lo recibe sin modificarlo. Los resultados
     ya registrados reciben el suyo al agregar la columna. Es único (restricción) y no puede cambiarse después (trigger).
     Es una referencia de cotejo visual entre la Bitácora del alumno y el panel del operador; NO es una credencial ni un secreto.
  2. `my_raffle_prizes()`: lo que el ALUMNO autenticado puede ver de SUS propios resultados vigentes (seleccionado o confirmado),
     más `poll_seconds`, la cadencia con que conviene volver a preguntar (null = no consultar periódicamente), para no cargar al
     servidor con miles de teléfonos mientras se explora y se reserva. Se identifica por `participant_id` (nunca por nombre ni
     correo), solo de su edición y de su mismo conjunto de datos (real/DEMO), y sin datos de otras personas.
  3. `raffle_winner_folios(uuid[])`: lo mismo para el personal de Sorteo/Coordinación, con el alcance de `raffle_winners_read`,
     para que el panel muestre el MISMO folio que ve el alumno.
*/

CREATE SEQUENCE IF NOT EXISTS public.raffle_winner_folio_seq AS bigint START 1;
REVOKE ALL ON SEQUENCE public.raffle_winner_folio_seq FROM PUBLIC, anon, authenticated;

ALTER TABLE public.raffle_winners
  ADD COLUMN IF NOT EXISTS folio text NOT NULL DEFAULT ('GAN-' || lpad(nextval('public.raffle_winner_folio_seq')::text, 6, '0'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raffle_winners_folio_key') THEN
    ALTER TABLE public.raffle_winners ADD CONSTRAINT raffle_winners_folio_key UNIQUE (folio);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raffle_winners_folio_format') THEN
    ALTER TABLE public.raffle_winners ADD CONSTRAINT raffle_winners_folio_format CHECK (folio ~ '^GAN-[0-9]{6,}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.raffle_winners_folio_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folio IS DISTINCT FROM OLD.folio THEN RAISE EXCEPTION 'FOLIO_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS raffle_winners_folio_immutable ON public.raffle_winners;
CREATE TRIGGER raffle_winners_folio_immutable BEFORE UPDATE ON public.raffle_winners
  FOR EACH ROW EXECUTE FUNCTION public.raffle_winners_folio_immutable();

-- Resultados vigentes del propio alumno + cada cuánto conviene volver a preguntar.
--
-- `poll_seconds` evita que miles de teléfonos consulten sin necesidad mientras se explora y se reserva: lo decide el servidor con el
-- estado real del sorteo, y `null` significa «no consultes periódicamente» (la plataforma igual consulta al abrirse, al volver a la
-- pestaña y al recuperar la conexión).
--   · 15 s  si la persona tiene un resultado pendiente de entrega (para ver la confirmación pronto)
--   · 20 s  si hay un sorteo en curso (alguien resultó ganador en la última hora) y la persona está en alguna categoría
--   · 120 s si hay un sorteo en curso y la persona no está en ninguna categoría
--   · 300 s si no hay sorteo en curso pero la persona ya participó (tiene asistencias)
--   · null  si no hay sorteo en curso y la persona aún no tiene asistencias (no puede ganar todavía)
CREATE OR REPLACE FUNCTION public.my_raffle_prizes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_prizes jsonb;
  v_pending boolean;
  v_live boolean;
  v_poll int;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'winner_id', rw.id,
      'folio', rw.folio,
      'status', rw.status,
      'prize_name', rp.name,
      'category_name', rc.name,
      'display_name', coalesce(pp.display_name, 'Participante'),
      'drawn_at', rw.drawn_at,
      'confirmed_at', rw.confirmed_at
    ) ORDER BY rw.drawn_at DESC, rw.id), '[]'::jsonb),
    coalesce(bool_or(rw.status = 'seleccionado'), false)
  INTO v_prizes, v_pending
  FROM raffle_winners rw
  JOIN raffle_prizes rp ON rp.id = rw.prize_id AND rp.edition_id = v_p.edition_id
  JOIN raffle_categories rc ON rc.id = rw.category_id
  LEFT JOIN participant_profiles pp ON pp.participant_id = rw.participant_id
  WHERE rw.participant_id = v_pid
    AND rw.edition_id = v_p.edition_id
    AND rw.is_demo IS NOT DISTINCT FROM v_p.is_demo
    -- no_presentado e invalidado dejan de ser un premio reclamable: no se devuelven.
    AND rw.status IN ('seleccionado', 'confirmado');

  IF v_pending THEN
    v_poll := 15;
  ELSE
    v_live := EXISTS (
      SELECT 1 FROM raffle_winners x
      WHERE x.edition_id = v_p.edition_id AND x.is_demo IS NOT DISTINCT FROM v_p.is_demo
        AND x.status IN ('seleccionado', 'confirmado') AND x.drawn_at > now() - interval '60 minutes');
    IF v_live THEN
      v_poll := CASE WHEN participant_raffle_category(v_pid) IS NOT NULL THEN 20 ELSE 120 END;
    ELSIF EXISTS (SELECT 1 FROM attendances a WHERE a.participant_id = v_pid) THEN
      v_poll := 300;
    END IF; -- si no, v_poll queda en null
  END IF;

  RETURN jsonb_build_object('prizes', v_prizes, 'poll_seconds', v_poll);
END;
$$;
REVOKE ALL ON FUNCTION public.my_raffle_prizes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_raffle_prizes() TO authenticated;

-- Folios para el panel del operador (mismo alcance que raffle_winners_read).
CREATE OR REPLACE FUNCTION public.raffle_winner_folios(p_winner_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  IF p_winner_ids IS NULL OR cardinality(p_winner_ids) > 1000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('winner_id', rw.id, 'folio', rw.folio))
    FROM raffle_winners rw
    JOIN raffle_prizes rp ON rp.id = rw.prize_id
    WHERE rw.id = ANY (p_winner_ids)
      AND rw.edition_id = v_ed
      AND (has_staff_role('coordinacion') OR rp.is_demo = v_is_demo)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.raffle_winner_folios(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raffle_winner_folios(uuid[]) TO authenticated;
