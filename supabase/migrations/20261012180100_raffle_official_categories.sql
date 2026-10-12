/*
  Sorteo: clasificación oficial por sellos (Universo, Galaxia, Sistema Solar).

  Reglas oficiales de Día OV 2026 (siempre se asigna la categoría MÁS ALTA alcanzada; no se acumulan):
  - Universo:      3 académicos + 1 de Vida Universitaria, o 2 académicos + 2 de Vida Universitaria.
  - Galaxia:       2 académicos + 1 de Vida Universitaria, o 4 sellos en total.
  - Sistema Solar: 1 académico + 1 de Vida Universitaria.
  - Sin ninguna condición cumplida: todavía sin categoría.

  Qué estaba mal
  - Se contaban TALLERES distintos, no sellos: un taller de 60 minutos (2 sellos) valía lo mismo que uno de 30.
  - Cada categoría solo admitía una condición «N académicos Y M de liderazgo»; no existían alternativas ni totales.

  Modelo
  - `raffle_categories.rules` (jsonb): lista de ALTERNATIVAS. Cada alternativa fija mínimos de sellos
    `academic`, `university_life` y `total` (los que falten valen 0). La categoría se alcanza si se cumple alguna.
  - Toda alternativa debe pedir ALGO: al menos uno de sus mínimos es mayor que cero. Una alternativa vacía o con
    todo en cero dejaría entrar al sorteo a quien no tiene sellos, así que la base la rechaza (función de validación,
    trigger y CHECK) y, como defensa adicional, la clasificación nunca la da por cumplida.
  - `required_academic` / `required_leadership` se conservan (nada se borra) como reflejo de la primera alternativa,
    para que cualquier lector o cliente anterior siga funcionando; la clasificación ya no los usa.

  Tipos de sello (clasificación oficial del catálogo, `activities.activity_type`)
  - `academica` → académico. Incluye los talleres académicos de cualquier división o carrera, también «Liderazgo».
  - `vida_universitaria` → Vida Universitaria, con cualquier `experience_category` (liderazgo, deportiva, etc.).
  - `liderazgo` → Vida Universitaria. Es el nombre que tuvo ese mismo tipo antes del catálogo oficial
    (`academica | liderazgo` pasó a ser `academica | vida_universitaria`); hoy solo existe en datos DEMO antiguos.
  Lo que decide el tipo de sello es el tipo de actividad, nunca la palabra «liderazgo» en una división o categoría.

  Datos existentes (no destructivo, idempotente)
  - Las categorías por defecto se actualizan EN SITIO (mismos id): Baja → Sistema Solar, Media → Galaxia,
    Mayor → Universo. Premios, ganadores e historial conservan sus referencias.
  - Cualquier otra categoría conserva su condición actual, expresada como una sola alternativa.
  - Compatibilidad verificada en producción (2026-10-12): solo existen las seis categorías por defecto y ninguna tiene
    requisitos en cero. Si en otra base hubiera una categoría sin requisitos (0 académicos y 0 de liderazgo), esta
    migración se detiene con un mensaje claro en lugar de inventarle una condición o convertirla en «todos entran».
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Reglas por categoría
-- ---------------------------------------------------------------------------------------------------------------------

-- Entre 1 y 10 alternativas; cada una con mínimos enteros (0–999) de `academic`, `university_life` y/o `total`,
-- y con al menos un mínimo mayor que cero (una alternativa sin requisitos no es una alternativa).
CREATE OR REPLACE FUNCTION public.raffle_rules_valid(p_rules jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' THEN false
    WHEN jsonb_array_length(p_rules) NOT BETWEEN 1 AND 10 THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_rules) AS alt(value)
      WHERE jsonb_typeof(alt.value) <> 'object'
        OR EXISTS (
          SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(alt.value) = 'object' THEN alt.value ELSE '{}'::jsonb END) AS kv
          WHERE kv.key NOT IN ('academic', 'university_life', 'total')
            OR jsonb_typeof(kv.value) <> 'number'
            OR kv.value::text !~ '^[0-9]{1,3}$'
        )
        OR NOT EXISTS (
          SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(alt.value) = 'object' THEN alt.value ELSE '{}'::jsonb END) AS kv
          WHERE kv.key IN ('academic', 'university_life', 'total') AND kv.value::text ~ '^[0-9]{1,3}$' AND kv.value::text::int > 0
        )
    )
  END;
$$;

-- ¿Se cumple alguna alternativa con estos sellos? El total es siempre académicos + Vida Universitaria.
-- Una alternativa que no pide nada nunca se da por cumplida, aunque llegara a existir.
CREATE OR REPLACE FUNCTION public.raffle_rules_met(p_rules jsonb, p_academic int, p_university_life int)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rules) AS alt(value)
    WHERE coalesce((alt.value->>'academic')::int, 0) <= p_academic
      AND coalesce((alt.value->>'university_life')::int, 0) <= p_university_life
      AND coalesce((alt.value->>'total')::int, 0) <= p_academic + p_university_life
      AND coalesce((alt.value->>'academic')::int, 0) + coalesce((alt.value->>'university_life')::int, 0)
        + coalesce((alt.value->>'total')::int, 0) > 0
  );
$$;

REVOKE ALL ON FUNCTION public.raffle_rules_valid(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raffle_rules_met(jsonb, int, int) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.raffle_categories ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '[]'::jsonb;

-- `rules` es la única fuente de la clasificación. Las columnas antiguas se mantienen coherentes en ambos sentidos:
-- quien todavía escriba solo `required_*` (alta directa o cliente anterior) obtiene esa condición como alternativa
-- única; en cualquier otro caso reflejan la primera alternativa.
CREATE OR REPLACE FUNCTION public.sync_raffle_category_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rules IS NULL OR NEW.rules = '[]'::jsonb
     OR (TG_OP = 'UPDATE' AND NEW.rules = OLD.rules
         AND (NEW.required_academic, NEW.required_leadership) IS DISTINCT FROM (OLD.required_academic, OLD.required_leadership)) THEN
    NEW.rules := jsonb_build_array(jsonb_build_object(
      'academic', coalesce(NEW.required_academic, 0), 'university_life', coalesce(NEW.required_leadership, 0)));
  END IF;
  IF NOT public.raffle_rules_valid(NEW.rules) THEN RAISE EXCEPTION 'INVALID_REQUIREMENTS'; END IF;
  NEW.required_academic := coalesce((NEW.rules->0->>'academic')::int, 0);
  NEW.required_leadership := coalesce((NEW.rules->0->>'university_life')::int, 0);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_raffle_category_rules() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER raffle_categories_sync_rules
  BEFORE INSERT OR UPDATE ON public.raffle_categories
  FOR EACH ROW EXECUTE FUNCTION public.sync_raffle_category_rules();

-- Categorías por defecto → categorías oficiales (mismos id). Solo si conservan el nombre original y el nombre oficial
-- aún no existe en esa edición y modo; volver a ejecutar esto no cambia nada.
UPDATE public.raffle_categories rc
SET name = official.name, sort_order = official.sort_order, rules = official.rules
FROM (VALUES
  ('Baja',  'Sistema Solar', 10, '[{"academic": 1, "university_life": 1}]'::jsonb),
  ('Media', 'Galaxia',       20, '[{"academic": 2, "university_life": 1}, {"total": 4}]'::jsonb),
  ('Mayor', 'Universo',      30, '[{"academic": 3, "university_life": 1}, {"academic": 2, "university_life": 2}]'::jsonb)
) AS official(old_name, name, sort_order, rules)
WHERE rc.name = official.old_name
  AND NOT EXISTS (
    SELECT 1 FROM public.raffle_categories other
    WHERE other.edition_id = rc.edition_id AND other.is_demo = rc.is_demo AND other.name = official.name
  );

-- Compatibilidad: una categoría anterior sin requisitos (0 + 0) no tiene una condición que conservar. No se le
-- inventa una ni se deja pasar: se detiene aquí para que Coordinación la corrija o la retire.
DO $$
DECLARE v_names text;
BEGIN
  SELECT string_agg(format('«%s» (%s)', name, CASE WHEN is_demo THEN 'DEMO' ELSE 'real' END), ', ' ORDER BY is_demo, sort_order, name)
  INTO v_names
  FROM public.raffle_categories
  WHERE rules = '[]'::jsonb AND coalesce(required_academic, 0) <= 0 AND coalesce(required_leadership, 0) <= 0;
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'RAFFLE_CATEGORY_WITHOUT_REQUIREMENTS: %', v_names
      USING HINT = 'Asigna a cada una al menos un mínimo mayor que cero (required_academic / required_leadership) o elimínala, y vuelve a aplicar la migración.';
  END IF;
END $$;

-- Cualquier otra categoría: su condición actual como única alternativa (lo hace el trigger).
UPDATE public.raffle_categories SET rules = '[]'::jsonb WHERE rules = '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raffle_categories_rules_check') THEN
    ALTER TABLE public.raffle_categories ADD CONSTRAINT raffle_categories_rules_check
      CHECK (public.raffle_rules_valid(rules));
  END IF;
  -- Un CHECK ya existente no vuelve a evaluar las filas cuando su función se hace más estricta: se comprueba aquí.
  IF EXISTS (SELECT 1 FROM public.raffle_categories WHERE NOT public.raffle_rules_valid(rules)) THEN
    RAISE EXCEPTION 'RAFFLE_CATEGORY_WITHOUT_REQUIREMENTS: %',
      (SELECT string_agg(format('«%s» (%s)', name, CASE WHEN is_demo THEN 'DEMO' ELSE 'real' END), ', ')
       FROM public.raffle_categories WHERE NOT public.raffle_rules_valid(rules));
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Sellos por tipo y categoría alcanzada
-- ---------------------------------------------------------------------------------------------------------------------

-- Sellos acreditados (snapshot `credits_granted`) por tipo de actividad. Única fuente para Bitácora y sorteo.
CREATE OR REPLACE FUNCTION public.participant_stamps(p_pid uuid)
RETURNS TABLE (academic int, university_life int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(sum(at.credits_granted) FILTER (WHERE a.activity_type = 'academica'), 0)::int,
    coalesce(sum(at.credits_granted) FILTER (WHERE a.activity_type IN ('vida_universitaria', 'liderazgo')), 0)::int
  FROM attendances at JOIN activities a ON a.id = at.activity_id
  WHERE at.participant_id = p_pid;
$$;

REVOKE ALL ON FUNCTION public.participant_stamps(uuid) FROM PUBLIC, anon, authenticated;

-- Se conserva el nombre y las claves anteriores (`*_tickets`); ahora valen sellos, no talleres.
CREATE OR REPLACE FUNCTION public.participant_tickets(p_pid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'academic_stamps', s.academic,
    'university_life_stamps', s.university_life,
    'total_stamps', s.academic + s.university_life,
    'academic_tickets', s.academic,
    'leadership_tickets', s.university_life
  )
  FROM participant_stamps(p_pid) s;
$$;

-- La categoría más alta cuyas reglas se cumplen, dentro del mismo modo (DEMO/real) del participante.
CREATE OR REPLACE FUNCTION public.participant_raffle_category(p_pid uuid)
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Alumno: estado del sorteo
-- ---------------------------------------------------------------------------------------------------------------------

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
  v_categories jsonb;
BEGIN
  SELECT * INTO v_p FROM participants WHERE id = v_pid;
  SELECT * INTO v_stamps FROM participant_stamps(v_pid);
  v_has_won := participant_has_won(v_pid);
  IF NOT v_has_won THEN
    v_category := participant_raffle_category(v_pid);
    IF v_category IS NOT NULL THEN
      SELECT name INTO v_cat_name FROM raffle_categories WHERE id = v_category;
    END IF;
  END IF;
  -- Las categorías vigentes de su modo, de menor a mayor, para explicar qué le falta para la siguiente.
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
    'categories', v_categories
  );
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Administración del sorteo
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.raffle_categories_read()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid := active_edition_id(); v_is_demo boolean;
BEGIN
  PERFORM require_sorteo_or_coordinacion();
  v_is_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sort_order', sort_order, 'rules', rules,
      'required_academic', required_academic, 'required_leadership', required_leadership,
      'is_active', is_active, 'is_demo', is_demo, 'visual_config', visual_config) ORDER BY sort_order DESC)
    FROM raffle_categories
    WHERE edition_id = v_ed AND (has_staff_role('coordinacion') OR is_demo = v_is_demo)), '[]'::jsonb);
END;
$$;

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
      'pool_count', (SELECT count(*) FROM participants p
        WHERE p.edition_id = v_ed AND p.is_demo = rc.is_demo
          AND NOT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p.id AND rw.status = 'confirmado')
          AND participant_raffle_category(p.id) = rc.id))
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

-- Acepta `rules` (alternativas). Un cliente anterior que solo envíe `required_academic` / `required_leadership`
-- sigue funcionando: su condición se guarda como única alternativa.
CREATE OR REPLACE FUNCTION public.save_raffle_category(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_ed uuid := active_edition_id();
  v_name text := btrim(coalesce(p->>'name', ''));
  v_sort int := coalesce((p->>'sort_order')::int, 0);
  v_req_a int := coalesce((p->>'required_academic')::int, 0);
  v_req_l int := coalesce((p->>'required_leadership')::int, 0);
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
  v_visual jsonb := coalesce((p->'visual_config')::jsonb, '{}'::jsonb);
  v_rules jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF length(v_name) < 2 OR length(v_name) > 100 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF v_req_a < 0 OR v_req_l < 0 THEN RAISE EXCEPTION 'INVALID_REQUIREMENTS'; END IF;
  IF p ? 'rules' AND jsonb_typeof(p->'rules') <> 'null' THEN
    v_rules := p->'rules';
    IF NOT raffle_rules_valid(v_rules) THEN RAISE EXCEPTION 'INVALID_REQUIREMENTS'; END IF;
  ELSE
    v_rules := jsonb_build_array(jsonb_build_object('academic', v_req_a, 'university_life', v_req_l));
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO raffle_categories (edition_id, name, sort_order, rules, is_active, is_demo, visual_config)
    VALUES (v_ed, v_name, v_sort, v_rules, v_active, coalesce((p->>'is_demo')::boolean, false), v_visual)
    RETURNING id INTO v_id;
  ELSE
    UPDATE raffle_categories SET name = v_name, sort_order = v_sort, rules = v_rules, is_active = v_active, visual_config = v_visual
    WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('raffle.category_saved', jsonb_build_object('id', v_id, 'name', v_name, 'rules', v_rules));
  RETURN v_id;
END;
$$;
