/*
# Reservaciones: configuración por edición, créditos por sesión y tabla de reservaciones

1. Tablas modificadas
- `editions`
  - `reservations_open_at` (timestamptz, nulo = reservaciones aún no abiertas)
  - `reservations_close_at` (timestamptz, opcional; después solo se permite cancelar)
  - `max_reservations` (int, 1..20, por defecto 4)
  - `travel_buffer_minutes` (int, 0..120, por defecto 10)
- `activity_sessions`
  - `credits` (smallint, 1..10, por defecto 1): valor futuro de la asistencia a esa sesión.

2. Tablas nuevas
- `reservations`: una fila por reservación; nunca se borra al cambiar o cancelar.
  - `participant_id`, `session_id`, `activity_id` (copiado de la sesión para impedir dos sesiones del mismo taller)
  - `status`: vigente | cancelada_alumno | cambiada | cancelada_sesion
  - `created_at`, `ended_at` (cuándo dejó de estar vigente), `replaced_by` (reservación que la sustituyó en un cambio)
  - Índices únicos parciales: una reservación vigente por participante+sesión y por participante+taller.

3. Seguridad
- RLS activado. Solo lectura de las propias reservaciones (participante autenticado).
- Sin permisos de escritura para anon/authenticated: toda escritura ocurre en funciones del servidor.
*/

ALTER TABLE editions ADD COLUMN IF NOT EXISTS reservations_open_at timestamptz;
ALTER TABLE editions ADD COLUMN IF NOT EXISTS reservations_close_at timestamptz;
ALTER TABLE editions ADD COLUMN IF NOT EXISTS max_reservations int NOT NULL DEFAULT 4;
ALTER TABLE editions ADD COLUMN IF NOT EXISTS travel_buffer_minutes int NOT NULL DEFAULT 10;
ALTER TABLE activity_sessions ADD COLUMN IF NOT EXISTS credits smallint NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editions_max_reservations_check') THEN
    ALTER TABLE editions ADD CONSTRAINT editions_max_reservations_check CHECK (max_reservations BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editions_travel_buffer_check') THEN
    ALTER TABLE editions ADD CONSTRAINT editions_travel_buffer_check CHECK (travel_buffer_minutes BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editions_reservation_window_check') THEN
    ALTER TABLE editions ADD CONSTRAINT editions_reservation_window_check
      CHECK (reservations_close_at IS NULL OR reservations_open_at IS NULL OR reservations_close_at > reservations_open_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_sessions_credits_check') THEN
    ALTER TABLE activity_sessions ADD CONSTRAINT activity_sessions_credits_check CHECK (credits BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'vigente'
    CHECK (status IN ('vigente', 'cancelada_alumno', 'cambiada', 'cancelada_sesion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  replaced_by uuid REFERENCES reservations(id) ON DELETE SET NULL,
  CONSTRAINT reservations_ended_consistent CHECK ((status = 'vigente') = (ended_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_per_session
  ON reservations (participant_id, session_id) WHERE status = 'vigente';
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_per_activity
  ON reservations (participant_id, activity_id) WHERE status = 'vigente';
CREATE INDEX IF NOT EXISTS reservations_session_active ON reservations (session_id) WHERE status = 'vigente';
CREATE INDEX IF NOT EXISTS reservations_participant ON reservations (participant_id);
CREATE INDEX IF NOT EXISTS reservations_activity ON reservations (activity_id);
CREATE INDEX IF NOT EXISTS reservations_replaced_by ON reservations (replaced_by);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservations FROM anon, authenticated;
GRANT SELECT ON reservations TO authenticated;

DROP POLICY IF EXISTS "Participant reads own reservations" ON reservations;
CREATE POLICY "Participant reads own reservations"
ON reservations FOR SELECT
TO authenticated
USING (participant_id = current_participant_id());