/*
# Reservaciones: sin lectura directa de la tabla para ningún rol de la app

1. Cambios
- Se retira todo privilegio (tabla y columnas) de `anon`, `authenticated` y `PUBLIC` sobre `reservations`.
  La lectura del aspirante pasa exclusivamente por `my_reservation_board()`, que exige
  `require_participant(true)` (sesión válida + Aviso de Privacidad vigente aceptado).
  Coordinación usa sus funciones operativas (`session_reservation_counts()`), que solo devuelven conteos.
2. Seguridad
- RLS sigue habilitado y se conserva la política "Participant reads own reservations" como defensa
  en profundidad: si alguien volviera a otorgar SELECT por error, seguiría limitada a filas propias.
- Realtime no se ve afectado: usa `realtime.messages` con su propia política y no lee esta tabla.
3. Notas
- Idempotente (REVOKE no falla si el privilegio ya no existe). No modifica datos.
*/
REVOKE ALL ON TABLE public.reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL (id, participant_id, session_id, activity_id, status, created_at, ended_at, replaced_by)
  ON TABLE public.reservations FROM PUBLIC, anon, authenticated;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;