-- Verificación DEFINITIVA de integridad, en el servidor, después de una corrida. k6 audita lo que cada persona ve; esto audita lo que quedó
-- guardado. Solo LEE y solo mira datos de la prueba (talleres «LT %» y cuentas lt.*@loadtest.invalid). Uso:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/verify-integrity.sql
-- Cada fila es una comprobación; `violations` debe ser 0. La última fila es el veredicto.
\pset format aligned
\pset border 2
WITH lt_sessions AS (
  SELECT s.id, s.activity_id, s.capacity, s.starts_at, s.ends_at, a.title FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title LIKE 'LT %'
), lt_people AS (SELECT id FROM participants WHERE email LIKE 'lt.%@loadtest.invalid'),
active AS (
  SELECT r.* FROM reservations r JOIN lt_sessions s ON s.id = r.session_id WHERE r.status = 'vigente'
),
checks AS (
  SELECT 'cupo: sesiones con más reservaciones vigentes que capacidad' AS check_name,
         (SELECT count(*) FROM (SELECT s.id FROM lt_sessions s JOIN active a ON a.session_id = s.id GROUP BY s.id, s.capacity HAVING count(*) > s.capacity) x) AS violations
  UNION ALL SELECT 'duplicados: la misma persona dos veces en la misma sesión (vigente)',
         (SELECT count(*) FROM (SELECT participant_id, session_id FROM active GROUP BY 1, 2 HAVING count(*) > 1) x)
  UNION ALL SELECT 'duplicados: la misma persona en dos horarios del mismo taller (vigente y sin terminar)',
         (SELECT count(*) FROM (SELECT a.participant_id, a.activity_id FROM active a JOIN lt_sessions s ON s.id = a.session_id WHERE s.ends_at > now() GROUP BY 1, 2 HAVING count(*) > 1) x)
  UNION ALL SELECT 'máximo: personas con más reservaciones vigentes (sin terminar) que el máximo de la edición',
         (SELECT count(*) FROM (SELECT a.participant_id FROM active a JOIN lt_sessions s ON s.id = a.session_id WHERE s.ends_at > now() GROUP BY 1
            HAVING count(*) > (SELECT max_reservations FROM editions WHERE is_active)) x)
  UNION ALL SELECT 'conflictos: dos reservaciones vigentes de una persona que se solapan en el tiempo',
         (SELECT count(*) FROM active a JOIN lt_sessions sa ON sa.id = a.session_id JOIN active b ON b.participant_id = a.participant_id AND b.id > a.id JOIN lt_sessions sb ON sb.id = b.session_id
            WHERE sa.starts_at < sb.ends_at AND sb.starts_at < sa.ends_at)
  UNION ALL SELECT 'asistencia: más de una por persona y taller',
         (SELECT count(*) FROM (SELECT participant_id, activity_id FROM attendances WHERE participant_id IN (SELECT id FROM lt_people) GROUP BY 1, 2 HAVING count(*) > 1) x)
  UNION ALL SELECT 'asistencia: sin reservación asociada',
         (SELECT count(*) FROM attendances WHERE participant_id IN (SELECT id FROM lt_people) AND reservation_id IS NULL)
  UNION ALL SELECT 'asistencia: sellos distintos a los de la duración oficial de la sesión',
         (SELECT count(*) FROM attendances at JOIN lt_sessions s ON s.id = at.session_id WHERE at.participant_id IN (SELECT id FROM lt_people) AND at.credits_granted <> session_stamp_credits(s.starts_at, s.ends_at))
  UNION ALL SELECT 'encuesta: más de una por persona',
         (SELECT count(*) FROM (SELECT participant_id FROM exit_survey_responses WHERE participant_id IN (SELECT id FROM lt_people) GROUP BY 1 HAVING count(*) > 1) x)
  UNION ALL SELECT 'encuesta: respuestas fuera de rango o sin marcar como ensayo',
         (SELECT count(*) FROM exit_survey_responses WHERE participant_id IN (SELECT id FROM lt_people) AND (NOT is_demo OR q2_workshop_rating NOT BETWEEN 1 AND 5 OR q5_recommend NOT BETWEEN 0 AND 10))
  UNION ALL SELECT 'aislamiento: participantes REALES (no DEMO) en la base',
         (SELECT count(*) FROM participants WHERE NOT is_demo)
)
SELECT check_name, violations, CASE WHEN violations = 0 THEN 'OK' ELSE 'FALLA' END AS result FROM checks
UNION ALL SELECT '== VEREDICTO ==', (SELECT sum(violations) FROM checks), CASE WHEN (SELECT sum(violations) FROM checks) = 0 THEN 'INTEGRIDAD OK' ELSE 'INTEGRIDAD VIOLADA' END;

-- Informativo: ocupación de las sesiones «calientes» (deben llenarse sin pasar de la capacidad).
SELECT a.title, s.capacity, count(r.id) FILTER (WHERE r.status = 'vigente') AS reserved,
       s.capacity - count(r.id) FILTER (WHERE r.status = 'vigente') AS remaining
FROM activity_sessions s JOIN activities a ON a.id = s.activity_id LEFT JOIN reservations r ON r.session_id = s.id
WHERE a.title LIKE 'LT HOT %' GROUP BY s.id, a.title, s.capacity ORDER BY a.title;

-- Informativo: totales de la corrida.
SELECT (SELECT count(*) FROM reservations WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE 'lt.%@loadtest.invalid')) AS reservations,
       (SELECT count(*) FROM attendances WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE 'lt.%@loadtest.invalid')) AS attendances,
       (SELECT count(*) FROM exit_survey_responses WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE 'lt.%@loadtest.invalid')) AS surveys;
