/*
  Pantalla publica del sorteo: total de alumnos INSCRITOS (dato real de la tabla `participants`).

  Agrega `registered_total` a `raffle_operator_view()`. Es solo un conteo informativo para la pantalla: NO cambia el conjunto sorteable
  (`pool_count` y `raffle_eligible_pool` siguen igual), ni categorias, ni reglas de sellos, ni premios, ni `draw_winner`.
  Cuenta los participantes de la edicion activa del mismo modo (ensayo / oficial) que el resto de la vista.
*/
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
  RETURN jsonb_build_object('categories', v_categories, 'unassigned_combinations', v_unassigned,
    'registered_total', (SELECT count(*) FROM participants p WHERE p.edition_id = v_ed AND p.is_demo = v_is_demo));
END;
$function$;
