-- Coherencia entre propuestas y actividades eliminadas.
--
-- Defecto (hallado en la prueba E2E del flujo de talleres): al eliminar desde Programa una actividad que nació de una
-- propuesta publicada, la FK `workshop_submissions.published_activity_id ... ON DELETE SET NULL` dejaba la propuesta en
-- estado `published` con `published_activity_id = NULL`. El producto ya considera inválido ese par (la publicación lo
-- rechaza con PUBLISH_STATE_INCONSISTENT) y el expediente seguía diciendo «Actividad publicada» como si estuviera viva.
--
-- Regla: una propuesta está `published` si y solo si apunta a una actividad existente. Al eliminar la actividad, la
-- propuesta se conserva como evidencia (con su historial y notas), vuelve a `approved` y deja una nota interna con la
-- fecha; puede publicarse de nuevo. Compatible con el frontend publicado: no cambia contratos.

CREATE OR REPLACE FUNCTION public.delete_activity(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_submission uuid;
BEGIN
  PERFORM require_coordinacion();
  IF EXISTS (SELECT 1 FROM attendances at JOIN activity_sessions s ON s.id = at.session_id WHERE s.activity_id = p_id) THEN
    RAISE EXCEPTION 'HAS_ATTENDANCES';
  END IF;
  IF EXISTS (SELECT 1 FROM reservations WHERE activity_id = p_id) THEN RAISE EXCEPTION 'HAS_RESERVATIONS'; END IF;

  -- Antes del borrado: la FK pondría el vínculo en NULL y ya no sabríamos qué propuesta originó la actividad.
  UPDATE workshop_submissions
  SET status = 'approved',
      published_activity_id = NULL,
      updated_at = now(),
      admin_notes = left(coalesce(admin_notes, ''), 4700) || E'\n' ||
        'Actividad eliminada del Programa el ' || to_char(now() AT TIME ZONE 'America/Cancun', 'DD/MM/YYYY HH24:MI') ||
        '. La propuesta volvió a Aprobada y puede publicarse de nuevo.'
  WHERE published_activity_id = p_id AND edition_id = active_edition_id()
  RETURNING id INTO v_submission;

  DELETE FROM activity_sessions WHERE activity_id = p_id;
  DELETE FROM activities WHERE id = p_id AND edition_id = active_edition_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM write_audit('catalog.activity_deleted', jsonb_build_object('id', p_id, 'submission_id', v_submission));
END;
$function$;

-- Reparación de lo ya ocurrido: propuestas `published` cuya actividad ya no existe.
UPDATE workshop_submissions
SET status = 'approved',
    updated_at = now(),
    admin_notes = left(coalesce(admin_notes, ''), 4700) || E'\n' ||
      'La actividad publicada ya no existía en el Programa (reparado el ' ||
      to_char(now() AT TIME ZONE 'America/Cancun', 'DD/MM/YYYY HH24:MI') || '). La propuesta volvió a Aprobada.'
WHERE status = 'published' AND published_activity_id IS NULL;
