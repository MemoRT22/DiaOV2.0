/*
  Conciliación de sellos: asistencias registradas ANTES de que la regla oficial entrara en vigor.

  Contexto
  - Hasta `20261012180000_checkin_credits_by_duration` todas las sesiones valían 1 sello, así que las asistencias a
    sesiones de 60 minutos recibieron 1 sello en lugar de 2.

  Alcance exacto (y nada más)
  - Asistencias con `recorded_at` anterior a la marca `attendance.credit_rule_installed` de su edición
  - cuyo snapshot `credits_granted` es MENOR que los sellos oficiales de la sesión en la que se registraron.
  Se elevan al valor oficial. Nunca se reduce un sello ya otorgado.

  Por qué es segura
  - No inserta ni borra asistencias: solo corrige el snapshot de filas existentes; no puede duplicar sellos.
  - Idempotente: una fila corregida deja de cumplir la condición; volver a ejecutarla no cambia nada.
  - Lo registrado después de la marca ya nació con la regla correcta y queda fuera: si un horario se edita más
    adelante, el snapshot histórico se respeta.
  - Sin marca (regla no instalada o auditoría reiniciada) no hace nada.
  - No toca premios, ganadores ni categorías. La categoría de sorteo de un alumno sin premio confirmado se recalcula
    sola a partir de sus sellos; un ganador confirmado conserva su premio.
  - Auditable: una entrada `attendance.credits_reconciled` por asistencia, con el valor anterior y el nuevo.
*/
DO $$
DECLARE
  r record;
  v_fixed int := 0;
BEGIN
  FOR r IN
    SELECT at.id, at.participant_id, at.session_id, at.activity_id, at.credits_granted AS credits_before,
           public.session_stamp_credits(s.starts_at, s.ends_at) AS credits_after, p.edition_id, at.recorded_at
    FROM public.attendances at
    JOIN public.activity_sessions s ON s.id = at.session_id
    JOIN public.participants p ON p.id = at.participant_id
    WHERE at.credits_granted < public.session_stamp_credits(s.starts_at, s.ends_at)
      AND at.recorded_at < (
        SELECT min(a.created_at) FROM public.audit_log a
        WHERE a.action = 'attendance.credit_rule_installed' AND a.edition_id = p.edition_id)
    ORDER BY at.recorded_at, at.id
    FOR UPDATE OF at
  LOOP
    UPDATE public.attendances SET credits_granted = r.credits_after WHERE id = r.id;
    INSERT INTO public.audit_log (edition_id, action, detail)
    VALUES (r.edition_id, 'attendance.credits_reconciled', jsonb_build_object(
      'attendance_id', r.id, 'participant_id', r.participant_id, 'session_id', r.session_id,
      'activity_id', r.activity_id, 'recorded_at', r.recorded_at,
      'credits_before', r.credits_before, 'credits_after', r.credits_after,
      'reason', 'Regla oficial: sesión de 60 minutos = 2 sellos'));
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'attendance.credits_reconciled: % asistencia(s) corregida(s)', v_fixed;
END $$;
