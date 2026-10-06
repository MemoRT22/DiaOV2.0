/*
# Centro de Operación: snapshot operativo v2 (`event_operations_overview`)

Extiende el contrato del snapshot de forma COMPATIBLE con el frontend ya desplegado (todas las claves anteriores
siguen presentes con el mismo significado), así que puede aplicarse antes o después del nuevo frontend.

Nuevo en cada sesión
- `divisions`: `[{ id, code, name }]` con todas las divisiones reales de la actividad (`activity_divisions`, ordenadas
  por nombre). Vacío para actividades sin división (Vida Universitaria).
- `affected_reservations`: reservaciones que quedaron como `cancelada_sesion` por la cancelación de esta sesión.
- `affected_unresolved`: de esas, las del participante que todavía no tiene una reservación vigente posterior
  (misma definición de «resuelta» que el tablero del aspirante).

Nuevo en el resumen: `activities_total`, `capacity_total` y `reserved_total` (sesiones activas) para el pre-evento.
Nuevo en la raíz: `event_date` y `timezone` de la edición.

Compatibilidad (a retirar cuando ya no haya frontends anteriores):
- `division_id` / `division_name` / `division_code` por sesión: ahora toman la PRIMERA división (por nombre). Antes
  salían de `activities.division_id`, que es NULL en talleres multidivisión (y rompía el filtro del frontend anterior).
  Sin divisiones: `division_id` NULL y nombre/código vacíos (no NULL) para no romper el orden por nombre.
- `summary.platform_consents`: se conserva por compatibilidad; el Centro de Operación nuevo ya no lo muestra.
- `is_demo` por sesión: dato interno, el frontend nuevo no lo muestra.

Rendimiento: reservaciones, asistencias, cancelaciones afectadas y divisiones se calculan con agregaciones agrupadas
(una pasada por tabla) y se unen a las sesiones; se elimina la llamada `session_reserved_count(s.id)` por fila.
`reserved` conserva su definición (reservaciones `vigente` + `expirada`, las que ocupan cupo).

`location`: la de la sesión con respaldo en la del taller; NULL (no cadena vacía) si ambas están vacías.

Privacidad y permisos sin cambios: solo Staff/Coordinación (`is_operativo()`), sin datos personales de participantes.
*/

CREATE OR REPLACE FUNCTION public.event_operations_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed          editions%ROWTYPE;
  v_server_time timestamptz := now();
  v_sessions    jsonb;
  v_activities  int;
  v_capacity    bigint;
  v_reserved    bigint;
BEGIN
  IF NOT is_operativo() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACTIVE_EDITION';
  END IF;

  WITH scope AS (
    SELECT s.id AS session_id, s.activity_id, s.starts_at, s.ends_at, s.capacity, s.status, s.location AS session_location,
           a.title, a.location AS activity_location, a.is_demo, a.division_id AS activity_division_id
    FROM activity_sessions s
    JOIN activities a ON a.id = s.activity_id
    WHERE a.edition_id = v_ed.id
      AND (v_ed.mode = 'preparacion' OR NOT a.is_demo)
  ),
  reserved AS (
    SELECT r.session_id, count(*)::int AS n
    FROM reservations r JOIN scope sc ON sc.session_id = r.session_id
    WHERE r.status IN ('vigente', 'expirada')
    GROUP BY r.session_id
  ),
  attended AS (
    SELECT at.session_id, count(*)::int AS n
    FROM attendances at JOIN scope sc ON sc.session_id = at.session_id
    GROUP BY at.session_id
  ),
  cancelled AS (
    SELECT r.session_id,
           count(*)::int AS total,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM reservations nx
             WHERE nx.participant_id = r.participant_id AND nx.status = 'vigente' AND nx.created_at > r.ended_at
           ))::int AS unresolved
    FROM reservations r JOIN scope sc ON sc.session_id = r.session_id
    WHERE r.status = 'cancelada_sesion'
    GROUP BY r.session_id
  ),
  activity_divs AS (
    SELECT ad.activity_id,
           jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) ORDER BY d.name, d.id) AS divisions
    FROM activity_divisions ad
    JOIN divisions d ON d.id = ad.division_id
    WHERE ad.activity_id IN (SELECT activity_id FROM scope)
    GROUP BY ad.activity_id
  ),
  rows AS (
    SELECT sc.*,
           coalesce(rs.n, 0) AS reserved_n,
           coalesce(att.n, 0) AS attended_n,
           coalesce(cn.total, 0) AS affected_total,
           coalesce(cn.unresolved, 0) AS affected_unresolved,
           coalesce(
             ads.divisions,
             CASE WHEN dl.id IS NOT NULL THEN jsonb_build_array(jsonb_build_object('id', dl.id, 'code', dl.code, 'name', dl.name)) END,
             '[]'::jsonb
           ) AS divisions
    FROM scope sc
    LEFT JOIN reserved rs ON rs.session_id = sc.session_id
    LEFT JOIN attended att ON att.session_id = sc.session_id
    LEFT JOIN cancelled cn ON cn.session_id = sc.session_id
    LEFT JOIN activity_divs ads ON ads.activity_id = sc.activity_id
    LEFT JOIN divisions dl ON dl.id = sc.activity_division_id
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'session_id', r.session_id,
      'activity_id', r.activity_id,
      'title', r.title,
      'divisions', r.divisions,
      'division_id', (r.divisions->0->>'id')::uuid,
      'division_name', coalesce(r.divisions->0->>'name', ''),
      'division_code', coalesce(r.divisions->0->>'code', ''),
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'location', nullif(btrim(coalesce(nullif(r.session_location, ''), r.activity_location, '')), ''),
      'status', r.status,
      'capacity', r.capacity,
      'reserved', r.reserved_n,
      'remaining', greatest(r.capacity - r.reserved_n, 0),
      'attended', r.attended_n,
      'affected_reservations', r.affected_total,
      'affected_unresolved', r.affected_unresolved,
      'is_demo', r.is_demo
    ) ORDER BY r.starts_at, r.title, r.session_id), '[]'::jsonb),
    count(DISTINCT r.activity_id)::int,
    coalesce(sum(r.capacity) FILTER (WHERE r.status = 'activa'), 0),
    coalesce(sum(r.reserved_n) FILTER (WHERE r.status = 'activa'), 0)
  INTO v_sessions, v_activities, v_capacity, v_reserved
  FROM rows r;

  RETURN jsonb_build_object(
    'server_time', v_server_time,
    'mode', v_ed.mode,
    'event_date', v_ed.event_date,
    'timezone', v_ed.timezone,
    'checkin_close_after_minutes', v_ed.checkin_close_after_minutes,
    'summary', jsonb_build_object(
      'participants_total',
        (SELECT count(*) FROM participants p WHERE p.edition_id = v_ed.id),
      'platform_consents',
        (SELECT count(*) FROM participant_profiles pp
           JOIN participants p ON p.id = pp.participant_id
          WHERE p.edition_id = v_ed.id AND pp.platform_consent_at IS NOT NULL),
      'active_reservations',
        (SELECT count(*) FROM reservations r
           JOIN participants p ON p.id = r.participant_id
           JOIN activity_sessions s ON s.id = r.session_id
          WHERE p.edition_id = v_ed.id AND r.status = 'vigente'
            AND v_server_time < s.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a
                             WHERE a.participant_id = r.participant_id AND a.activity_id = r.activity_id)),
      'participants_with_reservations',
        (SELECT count(DISTINCT r.participant_id) FROM reservations r
           JOIN participants p ON p.id = r.participant_id
           JOIN activity_sessions s ON s.id = r.session_id
          WHERE p.edition_id = v_ed.id AND r.status = 'vigente'
            AND v_server_time < s.ends_at
            AND NOT EXISTS (SELECT 1 FROM attendances a
                             WHERE a.participant_id = r.participant_id AND a.activity_id = r.activity_id)),
      'total_attendances',
        (SELECT count(*) FROM attendances at
           JOIN participants p ON p.id = at.participant_id
          WHERE p.edition_id = v_ed.id),
      'unique_attended_participants',
        (SELECT count(DISTINCT at.participant_id) FROM attendances at
           JOIN participants p ON p.id = at.participant_id
          WHERE p.edition_id = v_ed.id),
      'sessions_total',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id),
      'sessions_upcoming',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id AND s.status = 'activa' AND s.starts_at > v_server_time),
      'sessions_in_progress',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id AND s.status = 'activa'
            AND s.starts_at <= v_server_time AND s.ends_at > v_server_time),
      'sessions_ended',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id AND s.status = 'activa' AND s.ends_at <= v_server_time),
      'sessions_cancelled',
        (SELECT count(*) FROM activity_sessions s
           JOIN activities a ON a.id = s.activity_id
          WHERE a.edition_id = v_ed.id AND s.status = 'cancelada'),
      'activities_total', v_activities,
      'capacity_total', v_capacity,
      'reserved_total', v_reserved
    ),
    'sessions', v_sessions
  );
END;
$$;
