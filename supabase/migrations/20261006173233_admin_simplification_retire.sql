/*
# Simplificación del producto administrativo (UX-3), parte 2: retiro de backend sin consumidores

APLICAR DESPUÉS de desplegar el frontend de este PR y de haber aplicado `20261006170608_admin_simplification_compat`.
El frontend anterior todavía llama a `access_diagnosis`, `update_rank_rules`, `rank_levels.is_provisional` y envía las
reglas técnicas de reservación; retirarlos antes dejaría esas pantallas rotas hasta que el despliegue termine.

Se retira (cada punto con su consumidor eliminado en este PR):
1. `access_diagnosis(text)`: su única pantalla (Ayuda de acceso) se absorbió en Participantes. Todo lo que devolvía lo
   entrega `get_participant` (expediente: fecha de nacimiento, si ya inició sesión, estado de bloqueo, aviso) y
   `search_participants` (`access_locked`), con auditoría `participant.viewed`. `clear_access_lock` permanece: sigue
   siendo la acción de "Retirar bloqueo".
2. `update_rank_rules(jsonb)` y la columna `rank_levels.is_provisional`: las reglas de rangos son del producto
   (sembradas por `seed_default_rank_levels`); ya no hay pantalla que las edite.
3. `update_reservation_settings(jsonb)` queda estricta: solo acepta apertura y cierre. Enviar reglas técnicas
   (máximo, traslado, ventana de check-in) se rechaza con `SYSTEM_MANAGED_SETTING`: las define el sistema.

Se CONSERVA deliberadamente (sigue teniendo consumidores legítimos):
- `list_import_conflicts` / `resolve_import_conflict`: los usa la revisión dentro de Importar padrón y del expediente.
- `clear_access_lock`, `get_participant`, `search_participants`: Participantes.
- `my_progress`, `participant_rank_level`, `rank_levels` (solo lectura): progreso del alumno y check-in.
- Las columnas `editions.max_reservations`, `travel_buffer_minutes`, `checkin_open_before_minutes` y
  `checkin_close_after_minutes`: las lee el motor de reservaciones y el check-in con sus valores por defecto.
  Convertirlas en constantes es una limpieza posterior (toca el motor y el check-in; ver deuda en el PR).
- Los RPC legados de purga (`demo_purge_preview`, `purge_demo_data`): fuera de alcance (compatibilidad de UX-2).
- Las etiquetas históricas de auditoría (`participant.access_checked`, `ranks.updated`): hay filas existentes.
*/

-- 1. Diagnóstico de acceso absorbido por Participantes
DROP FUNCTION IF EXISTS public.access_diagnosis(text);

-- 2. Reglas de rangos del producto
DROP FUNCTION IF EXISTS public.update_rank_rules(jsonb);
ALTER TABLE public.rank_levels DROP COLUMN IF EXISTS is_provisional;

-- 3. Reservaciones: solo apertura y cierre
CREATE OR REPLACE FUNCTION public.update_reservation_settings(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_open timestamptz := nullif(p->>'reservations_open_at', '')::timestamptz;
  v_close timestamptz := nullif(p->>'reservations_close_at', '')::timestamptz;
BEGIN
  PERFORM require_coordinacion();
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF p ?| ARRAY['max_reservations', 'travel_buffer_minutes', 'checkin_open_before_minutes', 'checkin_close_after_minutes'] THEN
    RAISE EXCEPTION 'SYSTEM_MANAGED_SETTING';
  END IF;
  IF v_close IS NOT NULL AND (v_open IS NULL OR v_close <= v_open) THEN RAISE EXCEPTION 'INVALID_WINDOW'; END IF;
  UPDATE editions SET reservations_open_at = v_open, reservations_close_at = v_close WHERE id = v_ed;
  PERFORM write_audit('reservations.settings_updated', jsonb_build_object(
    'reservations_open_at', v_open, 'reservations_close_at', v_close));
END;
$$;
