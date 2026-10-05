/*
# Fase 8A — Fix RLS: usar current_participant_id() en policy de initial_interests

## Problema
La policy de RLS en initial_interests usaba un subquery a participants,
pero authenticated no tiene acceso directo a participants (REVOKE ALL).
Esto causaba que la policy siempre evaluara a false para authenticated.

## Solución
Usar current_participant_id() (SECURITY DEFINER) igual que post_event_interests.
*/

DROP POLICY IF EXISTS "Participant reads own initial interests" ON initial_interests;
CREATE POLICY "Participant reads own initial interests"
  ON initial_interests FOR SELECT TO authenticated
  USING (participant_id = current_participant_id());
