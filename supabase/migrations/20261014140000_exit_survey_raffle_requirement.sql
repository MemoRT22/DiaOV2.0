/*
  Encuesta de salida del Día OV 2026 — requisito obligatorio del sorteo.

  Qué resuelve
  - No existía una encuesta. Y el motor del sorteo solo miraba los sellos: un alumno con sellos suficientes entraba al sorteo aunque
    nunca hubiera contestado nada. Ahora entra únicamente quien (1) cumple los sellos de una categoría Y (2) completó la encuesta.
  - La comprobación vive en PostgreSQL, en UN solo lugar, y de ahí la heredan todos los puntos que calculan o seleccionan elegibles.

  Modelo
  - `editions.exit_survey_opens_at` (nullable): hora de apertura. Si es NULL se usa el valor por omisión: el día del evento a las 13:00
    en la zona horaria de la edición (Cancún). Coordinación la cambia con `set_exit_survey_opens_at` (sin tocar código).
  - `exit_survey_responses`: una fila por participante y edición (UNIQUE), con las cinco respuestas obligatorias en columnas con CHECK,
    el comentario opcional, la versión de la encuesta, `is_demo` (separa ensayo de operación oficial) y `completed_at` puesto por el
    servidor. RLS activo y sin políticas: nadie lee ni escribe la tabla directamente; solo las funciones de abajo (SECURITY DEFINER).
    No se puede modificar una respuesta enviada. Se borra en cascada con el participante (y con el reinicio de preparación).
  - `exit_survey_invitations` + `exit_survey_mark_invited()`: reclamo atómico del derecho a mostrar el popup (`claimed` es `true` para una sola solicitud en la vida de la persona), así que sale una sola vez aunque haya varias pestañas o dispositivos.
  - `my_exit_survey()`: estado de la propia persona (hora del servidor, si está abierta, si ya contestó, categoría por sellos, si es
    elegible). `submit_exit_survey(p)`: guarda la encuesta de la persona AUTENTICADA (nunca un participant_id del navegador), valida todo,
    es idempotente (reenviar o enviar dos veces a la vez no duplica ni sobrescribe).
  - Coordinación: `set_exit_survey_opens_at`, `exit_survey_admin` (conteos y resultados agregados, sin identidades).

  Sorteo (las reglas de sellos y categorías NO cambian)
  - `participant_stamp_category(pid)`: la categoría por sellos (la lógica de siempre, sin tocarla).
  - `participant_raffle_category(pid)`: ahora = la categoría por sellos SOLO si la encuesta está completada; si no, NULL. Todo lo que ya
    la usaba (draw_winner, raffle_pool_count, panel del operador, cadencia de `my_raffle_prizes`) hereda el requisito.
  - `raffle_eligible_pool(categoría, premio, demo)`: el conjunto sorteable. Lo usan `draw_winner`, `raffle_pool_count` y
    `raffle_operator_view`, así que el número mostrado es exactamente el conjunto del que se sortea. (Antes el conteo incluía a quien
    tenía un resultado «seleccionado» pendiente y el sorteo no.)
  - Defensa en profundidad: `draw_winner` re-verifica la encuesta del elegido y un trigger BEFORE INSERT en `raffle_winners` rechaza
    (`SURVEY_REQUIRED`) cualquier resultado nuevo de quien no la completó, venga de donde venga. No toca filas históricas.
  - `my_raffle_status()` sigue mostrando la categoría alcanzada por sellos y añade `survey_completed` y `raffle_eligible`.

  No destructivo: no borra ni modifica participantes, asistencias, reservaciones, horarios, cupos ni ganadores históricos de ensayo.
  Idempotente (CREATE ... IF NOT EXISTS / OR REPLACE). Sin datos de producción tocados al aplicarla salvo la nueva columna y tabla.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Configuración y almacenamiento
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.editions ADD COLUMN IF NOT EXISTS exit_survey_opens_at timestamptz;
COMMENT ON COLUMN public.editions.exit_survey_opens_at IS
  'Hora de apertura de la encuesta de salida. NULL = por omisión, el día del evento a las 13:00 (zona horaria de la edición).';

-- Versión vigente de las preguntas. Si cambian, se sube aquí y las respuestas anteriores conservan la suya.
CREATE OR REPLACE FUNCTION public.exit_survey_version() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'exit-2026-v1'::text $$;

CREATE OR REPLACE FUNCTION public.exit_survey_area_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['salud', 'deporte', 'negocios', 'derecho_ri', 'liderazgo', 'arquitectura_diseno', 'ingenierias', 'comunicacion_creativas', 'ninguna']::text[]
$$;

-- P4: de 1 a 3 áreas distintas del catálogo; «ninguna» (todavía sin un área definida) va sola.
CREATE OR REPLACE FUNCTION public.exit_survey_areas_valid(p_areas text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_areas IS NOT NULL
    AND cardinality(p_areas) BETWEEN 1 AND 3
    AND p_areas <@ public.exit_survey_area_keys()
    AND (SELECT count(DISTINCT a) FROM unnest(p_areas) AS a) = cardinality(p_areas)
    AND (NOT ('ninguna' = ANY (p_areas)) OR cardinality(p_areas) = 1)
$$;

CREATE TABLE IF NOT EXISTS public.exit_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES public.editions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  survey_version text NOT NULL,
  is_demo boolean NOT NULL,
  q1_prior_clarity text NOT NULL CHECK (q1_prior_clarity IN ('tenia_carrera', 'entre_varias', 'area_sin_carrera', 'sin_idea')),
  q2_workshop_rating smallint NOT NULL CHECK (q2_workshop_rating BETWEEN 1 AND 5),
  q3_post_clarity text NOT NULL CHECK (q3_post_clarity IN ('ya_claro', 'algunas_opciones', 'descubri_area', 'seguir_explorando')),
  q4_areas text[] NOT NULL CHECK (public.exit_survey_areas_valid(q4_areas)),
  q5_recommend smallint NOT NULL CHECK (q5_recommend BETWEEN 0 AND 10),
  improvement_comment text CHECK (improvement_comment IS NULL OR (length(improvement_comment) BETWEEN 1 AND 500)),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exit_survey_one_per_participant UNIQUE (edition_id, participant_id)
);
CREATE INDEX IF NOT EXISTS exit_survey_responses_participant_idx ON public.exit_survey_responses (participant_id);

ALTER TABLE public.exit_survey_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exit_survey_responses FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exit_survey_responses TO service_role;

-- Invitación automática: se registra por alumno en el servidor, así que el popup sale UNA sola vez aunque cambie de teléfono o
-- de navegador. Es solo memoria de «ya se le invitó»: no es requisito de nada y nunca bloquea el acceso a la encuesta.
CREATE TABLE IF NOT EXISTS public.exit_survey_invitations (
  participant_id uuid PRIMARY KEY REFERENCES public.participants(id) ON DELETE CASCADE,
  invited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exit_survey_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exit_survey_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exit_survey_invitations TO service_role;

-- Una respuesta enviada no se edita (ni la fecha de finalización que puso el servidor).
CREATE OR REPLACE FUNCTION public.exit_survey_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SURVEY_IMMUTABLE'; END
$$;
DROP TRIGGER IF EXISTS exit_survey_responses_immutable ON public.exit_survey_responses;
CREATE TRIGGER exit_survey_responses_immutable BEFORE UPDATE ON public.exit_survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.exit_survey_immutable();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Hora de apertura y estado de la persona
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exit_survey_opens_at_of(p_edition uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(e.exit_survey_opens_at, ((e.event_date + time '13:00') AT TIME ZONE coalesce(e.timezone, 'America/Cancun')))
  FROM editions e WHERE e.id = p_edition;
$$;

-- ¿Ya contestó? Única fuente de «encuesta completada» para el sorteo, la Bitácora y el panel.
CREATE OR REPLACE FUNCTION public.participant_exit_survey_completed(p_pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM exit_survey_responses r JOIN participants p ON p.id = r.participant_id AND p.edition_id = r.edition_id
    WHERE r.participant_id = p_pid);
$$;

-- La encuesta está abierta para esta persona cuando el SERVIDOR dice que ya es la hora. En el ensayo (edición en `preparacion`) las
-- cuentas DEMO pueden probarla en cualquier momento; una cuenta real nunca se salta la hora.
CREATE OR REPLACE FUNCTION public.exit_survey_is_open(p_pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now() >= exit_survey_opens_at_of(p.edition_id) OR (p.is_demo AND e.mode = 'preparacion')
  FROM participants p JOIN editions e ON e.id = p.edition_id WHERE p.id = p_pid;
$$;

-- La categoría alcanzada SOLO por sellos (la regla oficial, sin cambios): la más alta cuyas reglas se cumplen, dentro del mismo modo
-- (DEMO/real) del participante y sin contar a quien ya ganó. NO considera la encuesta.
CREATE OR REPLACE FUNCTION public.participant_stamp_category(p_pid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rc.id
  FROM participants p
  JOIN raffle_categories rc ON rc.edition_id = p.edition_id AND rc.is_demo IS NOT DISTINCT FROM p.is_demo
  CROSS JOIN participant_stamps(p.id) s
  WHERE p.id = p_pid
    AND rc.is_active
    AND raffle_rules_met(rc.rules, s.academic, s.university_life)
    AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'confirmado')
  ORDER BY rc.sort_order DESC, rc.name, rc.id
  LIMIT 1;
$$;

-- La categoría en la que SÍ se sortea: la de sellos, y solo con la encuesta de salida completada.
CREATE OR REPLACE FUNCTION public.participant_raffle_category(p_pid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN participant_exit_survey_completed(p_pid) THEN participant_stamp_category(p_pid) END;
$$;

-- Estado de la encuesta de UNA persona (lo que ven el popup, la Bitácora y la confirmación). Todo lo decide el servidor.
CREATE OR REPLACE FUNCTION public.exit_survey_status_internal(p_pid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    'eligible', v_completed_at IS NOT NULL AND v_category IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.my_exit_survey()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pid uuid := require_participant(true);
BEGIN
  RETURN exit_survey_status_internal(v_pid);
END;
$$;

-- Reclama, de forma ATÓMICA, el derecho a mostrar la invitación automática. `claimed = true` solo para UNA solicitud en toda la vida de
-- la persona (la que inserta la fila; las demás —otra pestaña, otro dispositivo, un reintento— reciben `false`), así que solo el
-- dispositivo que lo obtuvo abre el popup. Solo se reclama con la encuesta abierta y sin contestar: una invitación nunca se «gasta»
-- antes de tiempo ni para quien ya contestó. Quien no lo obtiene conserva el acceso desde la Bitácora.
CREATE OR REPLACE FUNCTION public.exit_survey_mark_invited()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pid uuid := require_participant(true); v_rows int := 0;
BEGIN
  IF exit_survey_is_open(v_pid) AND NOT participant_exit_survey_completed(v_pid) THEN
    INSERT INTO exit_survey_invitations (participant_id) VALUES (v_pid) ON CONFLICT (participant_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;
  RETURN exit_survey_status_internal(v_pid) || jsonb_build_object('claimed', v_rows = 1);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Envío
-- ---------------------------------------------------------------------------------------------------------------------

-- Guarda la encuesta de la persona autenticada. Sin participant_id del navegador. Valida hora, versión, claves, opciones y cantidades.
-- Idempotente: si ya había una respuesta (reenvío tras perder la conexión, doble clic, dos dispositivos) no se duplica ni se
-- sobrescribe, y se responde el estado actual con `already_completed = true`.
CREATE OR REPLACE FUNCTION public.submit_exit_survey(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_p participants%ROWTYPE;
  v_q1 text; v_q3 text; v_comment text;
  v_q2 int; v_q5 int;
  v_areas text[];
  v_rows int;
BEGIN
  -- Serializa los envíos de la MISMA persona: el segundo espera al primero y encuentra su respuesta.
  SELECT * INTO v_p FROM participants WHERE id = v_pid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM exit_survey_responses WHERE participant_id = v_pid AND edition_id = v_p.edition_id) THEN
    RETURN exit_survey_status_internal(v_pid) || jsonb_build_object('saved', false, 'already_completed', true);
  END IF;
  IF NOT exit_survey_is_open(v_pid) THEN RAISE EXCEPTION 'SURVEY_NOT_OPEN'; END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS'; END IF;
  -- Solo las claves de la encuesta: nada de participant_id, fechas ni campos inventados.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) AS k WHERE k NOT IN ('version', 'q1', 'q2', 'q3', 'q4', 'q5', 'comment')) THEN
    RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS';
  END IF;
  IF p->>'version' IS DISTINCT FROM exit_survey_version() THEN RAISE EXCEPTION 'SURVEY_VERSION_MISMATCH'; END IF;

  -- Una clave ausente da NULL: se compara con IS DISTINCT FROM para que «falta» también sea inválido (nunca pasa en silencio).
  IF jsonb_typeof(p->'q1') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'q3') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p->'q2') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'q5') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p->'q4') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS';
  END IF;
  IF coalesce((p->>'q2') !~ '^[0-9]$', true) OR coalesce((p->>'q5') !~ '^[0-9]{1,2}$', true) THEN RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS'; END IF;
  v_q1 := p->>'q1'; v_q3 := p->>'q3'; v_q2 := (p->>'q2')::int; v_q5 := (p->>'q5')::int;
  IF coalesce(v_q1 NOT IN ('tenia_carrera', 'entre_varias', 'area_sin_carrera', 'sin_idea'), true)
     OR coalesce(v_q3 NOT IN ('ya_claro', 'algunas_opciones', 'descubri_area', 'seguir_explorando'), true)
     OR v_q2 NOT BETWEEN 1 AND 5 OR v_q5 NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS';
  END IF;
  IF jsonb_array_length(p->'q4') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'q4') AS a WHERE jsonb_typeof(a) <> 'string') THEN
    RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS';
  END IF;
  SELECT array_agg(a ORDER BY ord) INTO v_areas FROM jsonb_array_elements_text(p->'q4') WITH ORDINALITY AS t(a, ord);
  IF NOT coalesce(exit_survey_areas_valid(v_areas), false) THEN RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS'; END IF;
  IF p ? 'comment' AND coalesce(jsonb_typeof(p->'comment') NOT IN ('null', 'string'), true) THEN RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS'; END IF;
  v_comment := nullif(btrim(regexp_replace(coalesce(p->>'comment', ''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), '');
  IF v_comment IS NOT NULL AND length(v_comment) > 500 THEN RAISE EXCEPTION 'INVALID_SURVEY_ANSWERS'; END IF;

  INSERT INTO exit_survey_responses (edition_id, participant_id, survey_version, is_demo, q1_prior_clarity, q2_workshop_rating,
    q3_post_clarity, q4_areas, q5_recommend, improvement_comment)
  VALUES (v_p.edition_id, v_pid, exit_survey_version(), v_p.is_demo, v_q1, v_q2, v_q3, v_areas, v_q5, v_comment)
  ON CONFLICT (edition_id, participant_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN exit_survey_status_internal(v_pid) || jsonb_build_object('saved', v_rows = 1, 'already_completed', v_rows = 0);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Coordinación: hora de apertura y resultados
-- ---------------------------------------------------------------------------------------------------------------------

-- NULL restablece el valor por omisión (día del evento, 13:00). Un valor fuera de [evento − 7 días, evento + 30 días] se rechaza: es
-- casi seguro un error de captura y dejaría la encuesta abierta antes de tiempo o cerrada para siempre.
CREATE OR REPLACE FUNCTION public.set_exit_survey_opens_at(p_opens_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_e editions%ROWTYPE; v_before timestamptz; v_after timestamptz;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO v_e FROM editions WHERE is_active FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF p_opens_at IS NOT NULL AND (p_opens_at < (v_e.event_date::timestamp - interval '7 days') AT TIME ZONE coalesce(v_e.timezone, 'America/Cancun')
      OR p_opens_at > (v_e.event_date::timestamp + interval '30 days') AT TIME ZONE coalesce(v_e.timezone, 'America/Cancun')) THEN
    RAISE EXCEPTION 'INVALID_OPENING_TIME';
  END IF;
  v_before := exit_survey_opens_at_of(v_e.id);
  UPDATE editions SET exit_survey_opens_at = p_opens_at WHERE id = v_e.id;
  v_after := exit_survey_opens_at_of(v_e.id);
  PERFORM write_audit('exit_survey.opens_at_changed', jsonb_build_object('from', v_before, 'to', v_after, 'custom', p_opens_at IS NOT NULL));
  RETURN jsonb_build_object('opens_at', v_after, 'custom', p_opens_at IS NOT NULL);
END;
$$;

-- Resultados agregados de un conjunto (ensayo u oficial). Sin identidades: ni nombre, ni correo, ni participant_id.
CREATE OR REPLACE FUNCTION public.exit_survey_aggregate_internal(p_edition uuid, p_is_demo boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (SELECT * FROM exit_survey_responses WHERE edition_id = p_edition AND is_demo = p_is_demo)
  SELECT jsonb_build_object(
    'completed', (SELECT count(*) FROM r),
    'participants', (SELECT count(*) FROM participants WHERE edition_id = p_edition AND is_demo = p_is_demo),
    'q1', coalesce((SELECT jsonb_object_agg(k, n) FROM (SELECT q1_prior_clarity AS k, count(*) AS n FROM r GROUP BY 1) s), '{}'::jsonb),
    'q2_rating', coalesce((SELECT jsonb_object_agg(k::text, n) FROM (SELECT q2_workshop_rating AS k, count(*) AS n FROM r GROUP BY 1) s), '{}'::jsonb),
    'q2_average', (SELECT round(avg(q2_workshop_rating)::numeric, 2) FROM r),
    'q3', coalesce((SELECT jsonb_object_agg(k, n) FROM (SELECT q3_post_clarity AS k, count(*) AS n FROM r GROUP BY 1) s), '{}'::jsonb),
    'q4', coalesce((SELECT jsonb_object_agg(k, n) FROM (SELECT a AS k, count(*) AS n FROM r, unnest(r.q4_areas) AS a GROUP BY 1) s), '{}'::jsonb),
    'q5_average', (SELECT round(avg(q5_recommend)::numeric, 2) FROM r),
    'q5_promoters', (SELECT count(*) FROM r WHERE q5_recommend >= 9),
    'q5_passives', (SELECT count(*) FROM r WHERE q5_recommend BETWEEN 7 AND 8),
    'q5_detractors', (SELECT count(*) FROM r WHERE q5_recommend <= 6),
    'comments', coalesce((SELECT jsonb_agg(jsonb_build_object('text', c.improvement_comment, 'completed_at', c.completed_at) ORDER BY c.completed_at DESC)
      FROM (SELECT improvement_comment, completed_at FROM r WHERE improvement_comment IS NOT NULL ORDER BY completed_at DESC LIMIT 300) c), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.exit_survey_admin()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_e editions%ROWTYPE;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO v_e FROM editions WHERE is_active;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  RETURN jsonb_build_object(
    'version', exit_survey_version(),
    'opens_at', exit_survey_opens_at_of(v_e.id),
    'custom', v_e.exit_survey_opens_at IS NOT NULL,
    'default_opens_at', ((v_e.event_date + time '13:00') AT TIME ZONE coalesce(v_e.timezone, 'America/Cancun')),
    'timezone', coalesce(v_e.timezone, 'America/Cancun'),
    'server_now', now(),
    'mode', v_e.mode,
    'official', exit_survey_aggregate_internal(v_e.id, false),
    'rehearsal', exit_survey_aggregate_internal(v_e.id, true)
  );
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Sorteo: el conjunto sorteable es UNO solo
-- ---------------------------------------------------------------------------------------------------------------------

-- Quién puede salir sorteado en una categoría: sellos de la categoría Y encuesta completada, de la edición y el modo (DEMO/real)
-- indicados, sin ganadores confirmados ni seleccionados pendientes. Con premio, además se excluye al «no presentado» más reciente de
-- ESE premio (solo en la ronda inmediata, como siempre). La usan draw_winner, raffle_pool_count y raffle_operator_view.
CREATE OR REPLACE FUNCTION public.raffle_eligible_pool(p_category_id uuid, p_prize_id uuid DEFAULT NULL, p_is_demo boolean DEFAULT NULL)
RETURNS TABLE (participant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND participant_exit_survey_completed(p.id)
    AND participant_raffle_category(p.id) = rc.id;
$$;

-- Ningún resultado nuevo del sorteo para quien no completó la encuesta, sin importar quién lo inserte. Solo INSERT: las filas
-- históricas (ganadores de ensayo incluidos) no se tocan ni se invalidan.
CREATE OR REPLACE FUNCTION public.raffle_winners_require_survey()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('seleccionado', 'confirmado') AND NOT participant_exit_survey_completed(NEW.participant_id) THEN
    RAISE EXCEPTION 'SURVEY_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS raffle_winners_require_survey ON public.raffle_winners;
CREATE TRIGGER raffle_winners_require_survey BEFORE INSERT ON public.raffle_winners
  FOR EACH ROW EXECUTE FUNCTION public.raffle_winners_require_survey();

-- draw_winner: igual que antes, pero el conjunto sorteable sale de raffle_eligible_pool y se re-verifica la encuesta del elegido.
CREATE OR REPLACE FUNCTION public.draw_winner(p_prize_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
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
    -- El conjunto sorteable sale de UNA sola función (la misma que alimenta los conteos del panel): sellos de la categoría Y encuesta
    -- de salida completada, sin ganadores confirmados ni seleccionados pendientes ni el no-presentado más reciente de este premio.
    SELECT array_agg(t.participant_id) INTO v_candidates FROM raffle_eligible_pool(v_cat.id, p_prize_id, v_is_demo) AS t;
    v_count := coalesce(array_length(v_candidates, 1), 0);
    IF v_count = 0 THEN RAISE EXCEPTION 'POOL_EMPTY'; END IF;

    v_rand_bytes := extensions.gen_random_bytes(4);
    v_rand_int := ((get_byte(v_rand_bytes, 0) << 24) | (get_byte(v_rand_bytes, 1) << 16) | (get_byte(v_rand_bytes, 2) << 8) | get_byte(v_rand_bytes, 3)) & 2147483647;
    v_winner_id := v_candidates[(v_rand_int % v_count) + 1];
    SELECT pp.display_name INTO v_winner_name FROM participant_profiles pp WHERE pp.participant_id = v_winner_id;
    v_winner_name := coalesce(v_winner_name, 'Participante');

    IF NOT participant_exit_survey_completed(v_winner_id) THEN RAISE EXCEPTION 'SURVEY_REQUIRED'; END IF;
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

-- El conteo del panel = el conjunto del que se sortea.
CREATE OR REPLACE FUNCTION public.raffle_pool_count(p_category_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid := active_edition_id(); v_cat raffle_categories%ROWTYPE; v_is_demo boolean;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  SELECT * INTO v_cat FROM raffle_categories WHERE id = p_category_id AND edition_id = v_ed;
  IF v_cat.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  IF NOT has_staff_role('coordinacion') AND v_cat.is_demo <> v_is_demo THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  RETURN (SELECT count(*) FROM raffle_eligible_pool(v_cat.id, NULL, v_cat.is_demo))::int;
END;
$$;

-- Panel del operador: `pool_count` es el conjunto sorteable; `survey_pending_count` explica la diferencia con quien ya tiene los
-- sellos de la categoría pero todavía no contesta la encuesta.
CREATE OR REPLACE FUNCTION public.raffle_operator_view()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean; v_categories jsonb; v_unassigned jsonb;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', rc.id, 'name', rc.name, 'sort_order', rc.sort_order, 'rules', rc.rules,
      'required_academic', rc.required_academic, 'required_leadership', rc.required_leadership,
      'is_active', rc.is_active, 'is_demo', rc.is_demo,
      'pool_count', (SELECT count(*) FROM raffle_eligible_pool(rc.id, NULL, rc.is_demo)),
      'survey_pending_count', (SELECT count(*) FROM participants p
        WHERE p.edition_id = v_ed AND p.is_demo = rc.is_demo
          AND participant_stamp_category(p.id) = rc.id AND NOT participant_exit_survey_completed(p.id)))
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
$$;

-- Alumno: la categoría alcanzada por sellos se sigue mostrando AUNQUE falte la encuesta; `survey_completed` y `raffle_eligible`
-- dicen si ya participa de verdad.
CREATE OR REPLACE FUNCTION public.my_raffle_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    'raffle_eligible', v_category IS NOT NULL AND v_survey,
    'categories', v_categories
  );
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Permisos
-- ---------------------------------------------------------------------------------------------------------------------

-- Internas: solo otras funciones (SECURITY DEFINER) y service_role; nunca el navegador.
REVOKE ALL ON FUNCTION public.exit_survey_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_area_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_areas_valid(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_opens_at_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.participant_exit_survey_completed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_is_open(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.participant_stamp_category(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.participant_raffle_category(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_status_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exit_survey_aggregate_internal(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raffle_eligible_pool(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raffle_winners_require_survey() FROM PUBLIC, anon, authenticated;

-- Superficie pública (la autorización de rol está dentro de cada función).
REVOKE ALL ON FUNCTION public.my_exit_survey() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_exit_survey(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exit_survey_mark_invited() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_exit_survey_opens_at(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exit_survey_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_exit_survey() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exit_survey(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exit_survey_mark_invited() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_exit_survey_opens_at(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exit_survey_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.raffle_pool_count(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.raffle_operator_view() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_raffle_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raffle_pool_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.raffle_operator_view() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_raffle_status() TO authenticated;
