/*
# Operations Center RPC — event_operations_overview()

1. Purpose
   Single SECURITY DEFINER, STABLE function that returns all aggregate data
   needed by the Day OV Operations Center dashboard in one round trip.
   No PII is returned. No new tables are created.

2. What it returns (JSONB)
   - server_time: current server timestamp
   - mode: edition mode ('preparacion' | 'operacion_real')
   - checkin_close_after_minutes: for frontend CHECK-IN PENDIENTE signal window
   - summary: global metrics object (participants, consents, reservations,
     attendances, session counts by temporal status)
   - sessions: array of per-session objects with reserved/attended counts,
     capacity, remaining, division info — no PII

3. Authorization
   - Guarded by is_operativo() → allows Coordinacion and Staff only.
   - Sorteo, anon, and participants are blocked.
   - EXECUTE revoked from PUBLIC and anon; granted to authenticated.

4. Demo/real isolation
   - In 'preparacion' mode: includes all sessions (demo + real).
   - In 'operacion_real' mode: excludes demo sessions.

5. Performance
   - Single query with CTEs + LATERAL joins for counts.
   - No N+1; no per-session function calls from React.
   - Reuses session_reserved_count() and active_edition_id().

6. No persistent state
   - All temporal status (proxima/en_curso/terminada) is derived on the
     frontend from starts_at/ends_at/server_time/status.
   - No session_metrics, occupancy_snapshots, or operational_alerts tables.
*/

CREATE OR REPLACE FUNCTION public.event_operations_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ed           editions%ROWTYPE;
  v_server_time  timestamptz := now();
BEGIN
  IF NOT is_operativo() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_ed FROM editions WHERE is_active LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACTIVE_EDITION';
  END IF;

  RETURN jsonb_build_object(
    'server_time', v_server_time,
    'mode', v_ed.mode,
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
         WHERE p.edition_id = v_ed.id AND r.status = 'vigente'),
      'participants_with_reservations',
        (SELECT count(DISTINCT r.participant_id) FROM reservations r
         JOIN participants p ON p.id = r.participant_id
         WHERE p.edition_id = v_ed.id AND r.status = 'vigente'),
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
         WHERE a.edition_id = v_ed.id
           AND s.status = 'activa'
           AND s.starts_at > v_server_time),
      'sessions_in_progress',
        (SELECT count(*) FROM activity_sessions s
         JOIN activities a ON a.id = s.activity_id
         WHERE a.edition_id = v_ed.id
           AND s.status = 'activa'
           AND s.starts_at <= v_server_time
           AND s.ends_at > v_server_time),
      'sessions_ended',
        (SELECT count(*) FROM activity_sessions s
         JOIN activities a ON a.id = s.activity_id
         WHERE a.edition_id = v_ed.id
           AND s.status = 'activa'
           AND s.ends_at <= v_server_time),
      'sessions_cancelled',
        (SELECT count(*) FROM activity_sessions s
         JOIN activities a ON a.id = s.activity_id
         WHERE a.edition_id = v_ed.id
           AND s.status = 'cancelada')
    ),
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'activity_id', a.id,
        'title', a.title,
        'division_id', a.division_id,
        'division_name', d.name,
        'division_code', d.code,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'location', coalesce(nullif(s.location, ''), a.location),
        'status', s.status,
        'capacity', s.capacity,
        'reserved', cnt.reserved,
        'remaining', greatest(s.capacity - cnt.reserved, 0),
        'attended', cnt.attended,
        'is_demo', a.is_demo
      ) ORDER BY s.starts_at, a.title)
      FROM activity_sessions s
      JOIN activities a ON a.id = s.activity_id
      JOIN divisions d ON d.id = a.division_id
      CROSS JOIN LATERAL (
        SELECT
          session_reserved_count(s.id) AS reserved,
          (SELECT count(*) FROM attendances at WHERE at.session_id = s.id) AS attended
      ) AS cnt
      WHERE a.edition_id = v_ed.id
        AND (v_ed.mode = 'preparacion' OR NOT a.is_demo)
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.event_operations_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.event_operations_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.event_operations_overview() TO authenticated;