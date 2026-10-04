/*
# Sorteo final: categorías por defecto (Baja, Media, Mayor)
Baja: académicos >= 3, liderazgo >= 0 (sort_order 10)
Media: académicos >= 3, liderazgo >= 1 (sort_order 20)
Mayor: académicos >= 4, liderazgo >= 1 (sort_order 30)
*/
DO $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_active, is_demo, visual_config)
  VALUES (v_ed, 'Baja', 10, 3, 0, true, true, '{}'::jsonb),
         (v_ed, 'Media', 20, 3, 1, true, true, '{}'::jsonb),
         (v_ed, 'Mayor', 30, 4, 1, true, true, '{}'::jsonb)
  ON CONFLICT (edition_id, name) DO NOTHING;
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_active, is_demo, visual_config)
  VALUES (v_ed, 'Baja', 10, 3, 0, true, false, '{}'::jsonb),
         (v_ed, 'Media', 20, 3, 1, true, false, '{}'::jsonb),
         (v_ed, 'Mayor', 30, 4, 1, true, false, '{}'::jsonb)
  ON CONFLICT (edition_id, name) DO NOTHING;
END $$;
