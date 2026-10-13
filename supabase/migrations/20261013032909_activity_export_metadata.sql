/*
  Descarga masiva de QR de talleres: metadatos de solo lectura para Coordinación.

  La exportación reutiliza la credencial vigente de cada actividad (`activity_credential_display`).
  Lo único que faltaba es saber a qué división, carrera, responsable y edificio pertenece cada taller:
  `activity_divisions` no es legible para `authenticated`, `workshop_submissions` es solo administrativa y
  `activity_checkin_overview()` no devuelve nada de eso.

  Esta función:
    · es de solo lectura (STABLE) y no escribe nada;
    · exige Coordinación (`is_coordinacion()`); el Staff operativo, los participantes y los anónimos reciben NOT_AUTHORIZED;
    · NO devuelve tokens, códigos manuales, hashes ni material cifrado: solo si la actividad TIENE credencial
      (`has_credential`) y cuándo se emitió la vigente (`credential_rotated_at`, para avisar si cambió después de descargar);
    · NO depende del modo de la edición (`preparacion` / `operacion_real`) ni de `is_demo`: devuelve las actividades de
      la edición activa con su bandera `is_demo` y deja que la pantalla decida (por defecto solo reales);
    · no genera ni rota credenciales, no toca talleres, horarios, reservaciones ni sellos.

  Asociaciones reales, sin inventar: divisiones = `activity_divisions` ∪ `activities.division_id` (heredado) ∪ divisiones de las
  carreras de `activity_careers`; un taller sin ninguna de ellas devuelve `divisions: []` y no se descarta. El responsable sale de
  la propuesta que lo publicó (`workshop_submissions.published_activity_id`); un taller dado de alta a mano devuelve null.

  Las credenciales siguen saliendo de `activity_credential_display`, que audita cada consulta (`checkin.credential_displayed`).
*/

CREATE OR REPLACE FUNCTION public.activity_export_metadata()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ed uuid;
BEGIN
  IF NOT is_coordinacion() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_ed := active_edition_id();

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'activity_id', a.id,
      'title', a.title,
      'activity_type', a.activity_type,
      'experience_category', a.experience_category,
      'is_demo', a.is_demo,
      'location', a.location,
      'building', nullif(btrim(sub.building), ''),
      'room_space', nullif(btrim(sub.room_space), ''),
      'facilitator_name', nullif(btrim(sub.facilitator_name), ''),
      'facilitator_email', nullif(lower(btrim(sub.facilitator_email)), ''),
      'has_credential', (ac.activity_id IS NOT NULL),
      'credential_rotated_at', ac.rotated_at,
      'divisions', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) ORDER BY d.sort_order, d.name)
        FROM divisions d
        WHERE d.id IN (
          SELECT x.division_id FROM activity_divisions x WHERE x.activity_id = a.id
          UNION
          SELECT a.division_id WHERE a.division_id IS NOT NULL
          UNION
          SELECT c.division_id FROM activity_careers acr JOIN careers c ON c.id = acr.career_id WHERE acr.activity_id = a.id
        )
      ), '[]'::jsonb),
      'careers', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'division_id', c.division_id) ORDER BY c.name)
        FROM activity_careers acr JOIN careers c ON c.id = acr.career_id
        WHERE acr.activity_id = a.id
      ), '[]'::jsonb),
      'sessions', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'session_id', s.id,
          'starts_at', s.starts_at,
          'ends_at', s.ends_at,
          'status', s.status,
          'location', nullif(btrim(s.location), '')
        ) ORDER BY s.starts_at)
        FROM activity_sessions s
        WHERE s.activity_id = a.id
      ), '[]'::jsonb)
    ) ORDER BY a.title, a.id)
    FROM activities a
    LEFT JOIN activity_credentials ac ON ac.activity_id = a.id
    LEFT JOIN LATERAL (
      SELECT ws.building, ws.room_space, ws.facilitator_name, ws.facilitator_email
      FROM workshop_submissions ws
      WHERE ws.published_activity_id = a.id
      ORDER BY ws.updated_at DESC
      LIMIT 1
    ) sub ON true
    WHERE a.edition_id = v_ed
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.activity_export_metadata() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_export_metadata() TO authenticated;
