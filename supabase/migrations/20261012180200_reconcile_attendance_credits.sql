/*
  Conciliación de sellos: asistencias que nacieron con la regla anterior.

  Contexto
  - Hasta `20261012180000_checkin_credits_by_duration` todas las sesiones valían 1 sello, así que las asistencias a
    sesiones de 60 minutos recibieron 1 sello en lugar de 2.

  Qué asistencias pueden estar por debajo (y por qué ya no puede aparecer ninguna más)
  - Desde que existe el trigger `attendances_set_credits`, toda asistencia nace con los sellos oficiales, aunque la
    inserte una llamada antigua de `check_in` que estaba en curso durante la instalación. Crear ese trigger esperó a
    que confirmaran las inserciones ya iniciadas. Por tanto, las asistencias por debajo de la regla son un conjunto
    cerrado y ya confirmado: esta conciliación las ve todas, sin depender de marcas de tiempo ni del momento en que
    se ejecute. Sin ese trigger se niega a ejecutarse.

  Duración histórica confiable (qué se corrige y qué no)
  - Solo se corrige una asistencia cuando el horario de su sesión es, con certeza, el mismo que tenía al registrarse:
    su propia reservación (`reservation_id`, misma sesión y mismo participante) sigue `vigente` o `expirada`. Mientras
    una sesión conserva una reservación así, `guard_session_reservations` rechaza cualquier cambio de horario, y una
    reservación nunca vuelve a esos estados después de salir de ellos. La duración actual es entonces la histórica.
  - Si esa prueba no existe (sin reservación, reservación cancelada, sesión distinta), el snapshot NO se toca: la
    diferencia puede deberse a una edición posterior del horario. Queda registrada una sola vez en auditoría
    (`attendance.credits_reconcile_skipped`) para revisión manual.

  Garantías
  - Solo eleva: nunca reduce un sello ya otorgado. Una asistencia igual o por encima de la regla no se toca.
  - No inserta ni borra asistencias: no puede duplicar sellos.
  - Idempotente y repetible: una fila corregida deja de cumplir la condición; se puede volver a ejecutar cuando sea.
  - Concurrencia: bloquea únicamente las filas que va a corregir (ninguna tabla); los check-ins simultáneos no
    esperan. Dos ejecuciones a la vez no corrigen dos veces la misma fila.
  - No toca premios, ganadores ni categorías. La categoría de un alumno sin premio confirmado se recalcula sola a
    partir de sus sellos; un ganador confirmado conserva su premio.
  - Auditable: una entrada `attendance.credits_reconciled` por asistencia, con el valor anterior, el nuevo y la
    duración que lo justifica.
*/

CREATE OR REPLACE FUNCTION public.reconcile_attendance_credits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciled int;
  v_skipped int;
BEGIN
  -- Sin el trigger no hay garantía de que el conjunto a conciliar esté cerrado.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.attendances'::regclass AND t.tgname = 'attendances_set_credits'
      AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'CREDIT_RULE_NOT_INSTALLED';
  END IF;

  WITH candidates AS (
    SELECT at.id, at.participant_id, at.session_id, at.activity_id, at.recorded_at, p.edition_id,
           at.credits_granted AS credits_before,
           session_stamp_credits(s.starts_at, s.ends_at) AS credits_after,
           round(extract(epoch FROM (s.ends_at - s.starts_at)) / 60)::int AS session_minutes,
           r.id AS schedule_proof
    FROM attendances at
    JOIN activity_sessions s ON s.id = at.session_id
    JOIN participants p ON p.id = at.participant_id
    LEFT JOIN reservations r
      ON r.id = at.reservation_id AND r.session_id = at.session_id AND r.participant_id = at.participant_id
     AND r.status IN ('vigente', 'expirada')
    WHERE at.credits_granted < session_stamp_credits(s.starts_at, s.ends_at)
    FOR UPDATE OF at
  ),
  fixed AS (
    UPDATE attendances a SET credits_granted = c.credits_after
    FROM candidates c
    WHERE a.id = c.id AND c.schedule_proof IS NOT NULL AND a.credits_granted < c.credits_after
    RETURNING a.id
  ),
  logged AS (
    INSERT INTO audit_log (edition_id, action, detail)
    SELECT c.edition_id, 'attendance.credits_reconciled', jsonb_build_object(
      'attendance_id', c.id, 'participant_id', c.participant_id, 'session_id', c.session_id,
      'activity_id', c.activity_id, 'recorded_at', c.recorded_at, 'session_minutes', c.session_minutes,
      'credits_before', c.credits_before, 'credits_after', c.credits_after,
      'reason', 'Regla oficial: sesión de 60 minutos = 2 sellos')
    FROM candidates c JOIN fixed f ON f.id = c.id
    RETURNING 1
  ),
  skipped AS (
    INSERT INTO audit_log (edition_id, action, detail)
    SELECT c.edition_id, 'attendance.credits_reconcile_skipped', jsonb_build_object(
      'attendance_id', c.id, 'participant_id', c.participant_id, 'session_id', c.session_id,
      'activity_id', c.activity_id, 'recorded_at', c.recorded_at, 'session_minutes_now', c.session_minutes,
      'credits_granted', c.credits_before, 'credits_by_current_schedule', c.credits_after,
      'reason', 'Sin reservación vigente que garantice que el horario no cambió después de la asistencia; requiere revisión manual')
    FROM candidates c
    WHERE c.schedule_proof IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.action = 'attendance.credits_reconcile_skipped' AND a.detail->>'attendance_id' = c.id::text)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM fixed), (SELECT count(*) FROM candidates WHERE schedule_proof IS NULL)
  INTO v_reconciled, v_skipped;

  RETURN jsonb_build_object('reconciled', v_reconciled, 'skipped_without_reliable_schedule', v_skipped);
END;
$$;

-- Operación de mantenimiento: solo el propietario (migraciones / SQL de administración).
REVOKE ALL ON FUNCTION public.reconcile_attendance_credits() FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE v_result jsonb := public.reconcile_attendance_credits();
BEGIN
  RAISE NOTICE 'reconcile_attendance_credits: %', v_result;
END $$;
