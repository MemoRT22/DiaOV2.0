/*
# Rangos: el nivel depende solo de los sellos acumulados (corrección de 20261006170608_admin_simplification_compat)

La migración compatible sembró requisitos de divisiones distintas (1, 2, 2, 3) que no eran una regla de producto.
Regla vigente: cada taller completado hace avanzar un nivel, hasta cuatro.

  Nivel 1: 0 sellos · Nivel 2: 1 · Nivel 3: 2 · Nivel 4: 3 · Nivel 5: 4 · `required_divisions = 0` en los cinco.

- `seed_default_rank_levels` siembra estos valores para ediciones nuevas.
- Se actualizan los cinco niveles de las ediciones existentes (idempotente; reaplicarla no cambia nada).
- Se conserva `participant_visited_division_ids` y el cálculo unificado de `my_progress` / `participant_rank_level`:
  las divisiones visitadas se siguen informando (`division_ids`) pero ya no bloquean el progreso.
*/

CREATE OR REPLACE FUNCTION public.seed_default_rank_levels(p_edition uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- level, required_attendances (sellos acumulados), required_divisions (siempre 0)
  INSERT INTO rank_levels (edition_id, level, required_attendances, required_divisions)
  SELECT p_edition, v.level, v.att, 0
  FROM (VALUES (1, 0), (2, 1), (3, 2), (4, 3), (5, 4)) AS v(level, att)
  WHERE NOT EXISTS (SELECT 1 FROM rank_levels r WHERE r.edition_id = p_edition)
  ON CONFLICT (edition_id, level) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.seed_default_rank_levels(uuid) FROM PUBLIC, anon, authenticated;

UPDATE public.rank_levels
SET required_attendances = level - 1, required_divisions = 0
WHERE required_attendances IS DISTINCT FROM level - 1 OR required_divisions <> 0;
