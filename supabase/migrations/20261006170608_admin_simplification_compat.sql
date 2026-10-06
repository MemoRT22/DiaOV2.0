/*
# Simplificación del producto administrativo (UX-3), parte 1: cambios compatibles

Esta migración es ADITIVA y compatible con el frontend que ya está desplegado: se puede aplicar antes o después
del despliegue. El retiro de lo que queda sin consumidores va en la migración siguiente
(`20261007010100_admin_simplification_retire`), que se aplica DESPUÉS de desplegar el frontend nuevo.

1. Rangos: las reglas dejan de ser configurables por Coordinación y pasan a ser reglas del producto.
   - `seed_default_rank_levels(edition)`: siembra los 5 niveles con los requisitos del producto
     (asistencias/sellos acumulados y divisiones distintas) si la edición no tiene ninguno.
   - Backfill de las ediciones existentes y trigger para las nuevas. Hasta hoy `rank_levels` quedaba VACÍA salvo que
     Coordinación la configurara, así que el progreso del alumno se quedaba en nivel 1.
   - `participant_visited_division_ids(participante)`: única definición de "divisiones distintas visitadas",
     basada en `activity_divisions` (actividades multidivisión de 9D-A). `participant_rank_level` y `my_progress`
     la comparten; antes `my_progress` contaba `activities.division_id`, que es NULL en actividades multidivisión.
   - `rank_levels` queda solo de lectura para el cliente (se retiran INSERT/UPDATE/DELETE/TRUNCATE).

2. Participantes: `search_participants` devuelve también `access_locked` y `pending_conflicts`, para diagnosticar
   problemas de acceso desde la búsqueda (el expediente ya entrega el resto vía `get_participant`).

3. Reservaciones: `update_reservation_settings` acepta un payload parcial. Coordinación solo controla apertura y cierre;
   las reglas técnicas (máximo, traslado, ventana de check-in) conservan el valor de la edición si no se envían.
   (El frontend anterior que las envía sigue funcionando hasta que la migración de retiro las rechace.)

Seguridad: las funciones nuevas no son ejecutables por PUBLIC/anon/authenticated; solo se invocan desde funciones
SECURITY DEFINER existentes o desde el trigger.
*/

-- ---------------------------------------------------------------------------------------------------------
-- 1. Rangos del producto
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_rank_levels(p_edition uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- level, required_attendances (sellos acumulados), required_divisions (divisiones distintas)
  INSERT INTO rank_levels (edition_id, level, required_attendances, required_divisions)
  SELECT p_edition, v.level, v.att, v.divs
  FROM (VALUES (1, 0, 0), (2, 1, 1), (3, 2, 2), (4, 3, 2), (5, 4, 3)) AS v(level, att, divs)
  WHERE NOT EXISTS (SELECT 1 FROM rank_levels r WHERE r.edition_id = p_edition)
  ON CONFLICT (edition_id, level) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.seed_default_rank_levels(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_rank_levels_for_new_edition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_default_rank_levels(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_rank_levels_for_new_edition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS seed_rank_levels_on_edition ON public.editions;
CREATE TRIGGER seed_rank_levels_on_edition
  AFTER INSERT ON public.editions
  FOR EACH ROW EXECUTE FUNCTION public.seed_rank_levels_for_new_edition();

SELECT public.seed_default_rank_levels(e.id) FROM public.editions e;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.rank_levels FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.participant_visited_division_ids(p_pid uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT ad.division_id), '{}'::uuid[])
  FROM attendances at
  JOIN activity_divisions ad ON ad.activity_id = at.activity_id
  WHERE at.participant_id = p_pid;
$$;
REVOKE ALL ON FUNCTION public.participant_visited_division_ids(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.participant_rank_level(p_pid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(max(rl.level), 1)
  FROM rank_levels rl
  JOIN participants p ON p.edition_id = rl.edition_id
  WHERE p.id = p_pid
    AND rl.required_attendances <= my_stamp_count(p_pid)
    AND rl.required_divisions <= cardinality(participant_visited_division_ids(p_pid));
$$;

CREATE OR REPLACE FUNCTION public.my_progress()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := require_participant(false);
  v_ed editions%ROWTYPE; v_stamps int; v_attended int; v_reserved int;
  v_divs uuid[]; v_level int; v_next rank_levels%ROWTYPE; v_consent boolean; v_pei jsonb;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  v_stamps := my_stamp_count(v_pid);
  v_attended := my_attended_workshop_count(v_pid);
  v_divs := participant_visited_division_ids(v_pid);
  v_reserved := active_reservation_count(v_pid);
  SELECT coalesce(max(level), 1) INTO v_level FROM rank_levels
  WHERE edition_id = v_ed.id AND required_attendances <= v_stamps
    AND required_divisions <= cardinality(v_divs);
  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;
  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version
  INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;
  v_pei := post_event_interests_state(v_pid);
  RETURN jsonb_build_object(
    'level', v_level,
    'stamps', v_stamps,
    'attended_workshops', v_attended,
    'reserved_workshops', v_reserved,
    'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object('level', v_next.level,
      'required_attendances', v_next.required_attendances, 'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'post_event_interests_prompt', v_pei->'post_event_interests_prompt',
    'post_event_interests_open', v_pei->'post_event_interests_open',
    'post_event_interests_completed', v_pei->'post_event_interests_completed',
    'interests_prompt', v_pei->'post_event_interests_prompt',
    'interests_open', v_pei->'post_event_interests_open'
  );
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Búsqueda de participantes con diagnóstico de acceso
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_participants(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q text := lower(btrim(coalesce(p_query, ''))); d text;
BEGIN
  PERFORM require_operativo();
  IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
  d := regexp_replace(q, '[^0-9]', '', 'g');
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT p.id, p.full_name, p.email, p.phone, p.high_school, p.origin, p.is_demo,
        c.name AS career_name, p.birth_date IS NOT NULL AS has_birth_date, p.auth_user_id IS NOT NULL AS has_logged_in,
        coalesce((access_lock_state(p.email)->>'locked')::boolean, false) AS access_locked,
        (SELECT count(*) FROM participant_import_conflicts k WHERE k.participant_id = p.id AND k.status = 'pending')::int AS pending_conflicts
      FROM participants p LEFT JOIN careers c ON c.id = p.initial_career_id
      WHERE p.edition_id = active_edition_id()
        AND (lower(p.full_name) LIKE '%' || q || '%' OR p.email LIKE '%' || q || '%'
          OR (length(d) >= 4 AND p.phone LIKE '%' || d || '%'))
      ORDER BY p.full_name LIMIT 50
    ) x), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Reservaciones: Coordinación decide apertura y cierre; el resto son reglas del sistema
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_reservation_settings(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed editions%ROWTYPE;
  v_open timestamptz := nullif(p->>'reservations_open_at', '')::timestamptz;
  v_close timestamptz := nullif(p->>'reservations_close_at', '')::timestamptz;
  v_max int; v_buffer int; v_checkin_open int; v_checkin_close int;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO v_ed FROM editions WHERE id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  v_max := coalesce((p->>'max_reservations')::int, v_ed.max_reservations);
  v_buffer := coalesce((p->>'travel_buffer_minutes')::int, v_ed.travel_buffer_minutes);
  v_checkin_open := coalesce((p->>'checkin_open_before_minutes')::int, v_ed.checkin_open_before_minutes);
  v_checkin_close := coalesce((p->>'checkin_close_after_minutes')::int, v_ed.checkin_close_after_minutes);
  IF v_max < 1 OR v_max > 20 THEN RAISE EXCEPTION 'INVALID_MAX_RESERVATIONS'; END IF;
  IF v_buffer < 0 OR v_buffer > 120 THEN RAISE EXCEPTION 'INVALID_BUFFER'; END IF;
  IF v_checkin_open < 0 OR v_checkin_open > 120 THEN RAISE EXCEPTION 'INVALID_CHECKIN_WINDOW'; END IF;
  IF v_checkin_close < 0 OR v_checkin_close > 120 THEN RAISE EXCEPTION 'INVALID_CHECKIN_WINDOW'; END IF;
  IF v_close IS NOT NULL AND (v_open IS NULL OR v_close <= v_open) THEN RAISE EXCEPTION 'INVALID_WINDOW'; END IF;
  UPDATE editions SET reservations_open_at = v_open, reservations_close_at = v_close,
    max_reservations = v_max, travel_buffer_minutes = v_buffer,
    checkin_open_before_minutes = v_checkin_open, checkin_close_after_minutes = v_checkin_close
  WHERE id = v_ed.id;
  PERFORM write_audit('reservations.settings_updated', jsonb_build_object('reservations_open_at', v_open,
    'reservations_close_at', v_close, 'max_reservations', v_max, 'travel_buffer_minutes', v_buffer,
    'checkin_open_before_minutes', v_checkin_open, 'checkin_close_after_minutes', v_checkin_close));
END;
$$;
