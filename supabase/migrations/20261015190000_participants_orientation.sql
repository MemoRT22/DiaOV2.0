/*
  Panel de orientacion de Participantes (SOLO LECTURA).

  Dos RPC para Coordinacion y Staff (require_operativo) que alimentan la pantalla Participantes del panel:
  - participants_dashboard_summary(): conteos rapidos (cuentas, sesion reciente, con reservaciones, con asistencia, sellos, posibles duplicados).
  - participants_orientation(p_ids): por cada participante mostrado, su actividad (ultima actividad de sesion, reservaciones vigentes, asistencias,
    sellos, categoria del sorteo) y las OTRAS cuentas con el mismo telefono, para saber con que correo debe entrar un alumno.
  No modifican nada (STABLE), no cambian permisos de tablas ni reglas. «Ultima actividad» = ultimo inicio de sesion o renovacion de sesion.
*/

CREATE OR REPLACE FUNCTION public.participants_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ed uuid := active_edition_id(); v_demo boolean;
BEGIN
  PERFORM require_operativo();
  v_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  RETURN (
    WITH seen AS (
      SELECT s.user_id, max(coalesce(s.refreshed_at, s.created_at)) AS at FROM auth.sessions s GROUP BY s.user_id
    ), base AS (
      SELECT p.id, p.auth_user_id,
        nullif(right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10), '') AS phone_key,
        greatest(u.last_sign_in_at, seen.at) AS last_seen,
        (SELECT count(*) FROM reservations r WHERE r.participant_id = p.id AND r.status = 'vigente')::int AS vig,
        (SELECT count(*) FROM attendances a WHERE a.participant_id = p.id)::int AS att,
        (SELECT coalesce(sum(a.credits_granted), 0) FROM attendances a WHERE a.participant_id = p.id)::int AS stamps
      FROM participants p
      LEFT JOIN auth.users u ON u.id = p.auth_user_id
      LEFT JOIN seen ON seen.user_id = p.auth_user_id
      WHERE p.edition_id = v_ed AND p.is_demo = v_demo
    ), grp AS (
      SELECT phone_key, count(*) AS n,
        count(*) FILTER (WHERE vig > 0 OR att > 0) AS used,
        (array_agg(vig + att ORDER BY last_seen DESC NULLS LAST))[1] AS latest_has
      FROM base WHERE phone_key IS NOT NULL GROUP BY phone_key HAVING count(*) > 1
    )
    SELECT jsonb_build_object(
      'server_time', now(),
      'accounts_total', (SELECT count(*) FROM base),
      'accounts_with_login', (SELECT count(*) FROM base WHERE auth_user_id IS NOT NULL),
      'active_last_hour', (SELECT count(*) FROM base WHERE last_seen > now() - interval '70 minutes'),
      'with_reservations', (SELECT count(*) FROM base WHERE vig > 0),
      'reservations_active', (SELECT coalesce(sum(vig), 0) FROM base),
      'with_attendance', (SELECT count(*) FROM base WHERE att > 0),
      'stamps_total', (SELECT coalesce(sum(stamps), 0) FROM base),
      'duplicate_groups', (SELECT count(*) FROM grp),
      'duplicate_accounts', (SELECT coalesce(sum(n), 0) FROM grp),
      'duplicates_data_split', (SELECT count(*) FROM grp WHERE used > 1),
      'duplicates_route_elsewhere', (SELECT count(*) FROM grp WHERE used >= 1 AND latest_has = 0)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.participants_orientation(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ed uuid := active_edition_id(); v_demo boolean;
BEGIN
  PERFORM require_operativo();
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_ids) > 100 THEN RAISE EXCEPTION 'TOO_MANY_IDS'; END IF;
  v_demo := (SELECT mode = 'preparacion' FROM editions WHERE id = v_ed);
  RETURN coalesce((
    WITH seen AS (
      SELECT s.user_id, max(coalesce(s.refreshed_at, s.created_at)) AS at FROM auth.sessions s GROUP BY s.user_id
    ), info AS (
      SELECT p.id, p.full_name, p.email, p.origin, p.auth_user_id IS NOT NULL AS has_login,
        nullif(right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10), '') AS phone_key,
        greatest(u.last_sign_in_at, seen.at) AS last_seen,
        (SELECT count(*) FROM reservations r WHERE r.participant_id = p.id AND r.status = 'vigente')::int AS vig,
        (SELECT count(*) FROM attendances a WHERE a.participant_id = p.id)::int AS att,
        (SELECT coalesce(sum(a.credits_granted), 0) FROM attendances a WHERE a.participant_id = p.id)::int AS stamps
      FROM participants p
      LEFT JOIN auth.users u ON u.id = p.auth_user_id
      LEFT JOIN seen ON seen.user_id = p.auth_user_id
      WHERE p.edition_id = v_ed AND p.is_demo = v_demo
        AND (p.id = ANY (p_ids) OR p.phone IS NOT NULL)
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', me.id,
      'last_seen_at', me.last_seen,
      'reservations_active', me.vig,
      'attendances', me.att,
      'stamps', me.stamps,
      'category', (SELECT rc.name FROM raffle_categories rc WHERE rc.id = participant_stamp_category(me.id)),
      'others', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', o.id, 'full_name', o.full_name, 'email', o.email, 'origin', o.origin,
          'has_login', o.has_login, 'last_seen_at', o.last_seen, 'reservations_active', o.vig, 'attendances', o.att, 'stamps', o.stamps)
          ORDER BY (o.vig + o.att) DESC, o.last_seen DESC NULLS LAST)
        FROM info o WHERE me.phone_key IS NOT NULL AND o.phone_key = me.phone_key AND o.id <> me.id), '[]'::jsonb)
    ))
    FROM info me WHERE me.id = ANY (p_ids)
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.participants_dashboard_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.participants_orientation(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.participants_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.participants_orientation(uuid[]) TO authenticated;
