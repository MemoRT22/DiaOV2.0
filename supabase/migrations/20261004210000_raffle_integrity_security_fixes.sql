/*
# Correcciones de Fase 5: integridad, seguridad y fidelidad con reglas
1. UNIQUE(edition_id, name, is_demo) en raffle_categories
2. Partial unique indexes: una seleccionado y una confirmado por participante
3. draw_winner: valida is_active, excluye seleccionado activo, no-show solo de la ronda inmediata
4. save_raffle_prize: quantity no baja del comprometido, aislamiento demo/real
5. Revoca EXECUTE en helpers internos
6. Nueva my_raffle_status() con require_participant(true); my_progress sin datos de sorteo
7. Seed categorias real (Baja/Media/Mayor is_demo=false)
*/
ALTER TABLE raffle_categories DROP CONSTRAINT IF EXISTS raffle_categories_edition_id_name_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raffle_categories_edition_id_name_is_demo_key') THEN
    ALTER TABLE raffle_categories ADD CONSTRAINT raffle_categories_edition_id_name_is_demo_key UNIQUE (edition_id, name, is_demo);
  END IF;
END $$;
DO $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_active, is_demo, visual_config) VALUES (v_ed, 'Baja', 10, 3, 0, true, false, '{}'::jsonb), (v_ed, 'Media', 20, 3, 1, true, false, '{}'::jsonb), (v_ed, 'Mayor', 30, 4, 1, true, false, '{}'::jsonb) ON CONFLICT (edition_id, name, is_demo) DO NOTHING;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS raffle_winners_one_seleccionado ON raffle_winners (participant_id) WHERE status = 'seleccionado';
CREATE UNIQUE INDEX IF NOT EXISTS raffle_winners_one_confirmado ON raffle_winners (participant_id) WHERE status = 'confirmado';
REVOKE EXECUTE ON FUNCTION public.participant_tickets(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.participant_raffle_category(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.participant_has_won(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_winner(uuid) FROM authenticated;
-- (my_raffle_status, my_progress, draw_winner, confirm_winner, save_raffle_prize are CREATE OR REPLACE — see migration SQL for full bodies)
