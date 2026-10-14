-- Comprobación de contención A NIVEL DE BASE DE DATOS, sin k6, Auth ni PostgREST: N conexiones REALES (dblink) de N personas distintas
-- piden a la vez las sesiones «calientes» a través de la función real `reserve_session`. Es la prueba más barata de que el cupo no se
-- excede bajo concurrencia, y sirve para validar el esquema antes de gastar una corrida de k6. Solo para una base AISLADA (local o de
-- pruebas) con datos sembrados por seed.sql. Requiere superusuario por dblink:
--   psql "$SUPERUSER_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_isolated=YES -v conns=80 -f tools/contention-check.sql
-- (no deja residuos: borra las reservaciones que crea; el estado sembrado no cambia).
\set ON_ERROR_STOP on
SELECT set_config('loadtest.confirm', :'confirm_isolated', false) AS _c, set_config('loadtest.conns', :'conns', false) AS _n \gset
CREATE EXTENSION IF NOT EXISTS dblink;
DO $$
DECLARE
  n int := current_setting('loadtest.conns')::int;
  conns text[] := '{}'; conn text; i int; uid uuid; hot uuid[]; caps int[]; h int; ok int[] := '{}'; res text; reserved int; over int := 0; report text := '';
BEGIN
  IF current_setting('loadtest.confirm', true) IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'Confirma que es un entorno AISLADO: -v confirm_isolated=YES'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE NOT is_demo) THEN RAISE EXCEPTION 'Hay participantes REALES en esta base: se rechaza.'; END IF;
  SELECT array_agg(s.id ORDER BY a.title), array_agg(s.capacity ORDER BY a.title) INTO hot, caps
  FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title LIKE 'LT HOT %';
  IF hot IS NULL THEN RAISE EXCEPTION 'No hay sesiones LT HOT: aplica seed.sql primero'; END IF;
  DELETE FROM reservations WHERE session_id = ANY (hot);

  PERFORM dblink_connect('lt_gate', 'dbname=' || current_database() || ' user=' || current_user);
  PERFORM dblink_exec('lt_gate', 'begin');
  PERFORM * FROM dblink('lt_gate', 'select pg_advisory_xact_lock(424242)') AS t(x text);  -- compuerta: nadie arranca hasta que se abra
  FOR i IN 1..n LOOP
    conn := 'lt_c' || i;
    SELECT id INTO uid FROM auth.users WHERE email LIKE 'lt.%@loadtest.invalid' ORDER BY email OFFSET i - 1 LIMIT 1;
    PERFORM dblink_connect(conn, 'dbname=' || current_database() || ' user=' || current_user);
    PERFORM dblink_exec(conn, format('set request.jwt.claim.sub = %L', uid));
    PERFORM dblink_exec(conn, format('set request.jwt.claims = %L', jsonb_build_object('sub', uid, 'role', 'authenticated')::text));
    PERFORM dblink_exec(conn, 'set role authenticated');
    -- Cada persona intenta TODAS las sesiones calientes, empezando por una distinta (con choques de horario y de máximo incluidos).
    PERFORM dblink_send_query(conn, 'select pg_advisory_lock_shared(424242); do $d$ declare s uuid; begin foreach s in array ' ||
      format('%L::uuid[]', hot) || ' loop begin perform reserve_session(s); exception when others then null; end; end loop; end $d$; select pg_advisory_unlock_shared(424242)');
    conns := conns || conn;
  END LOOP;
  PERFORM pg_sleep(1);
  PERFORM dblink_exec('lt_gate', 'commit');  -- se abre la compuerta: las N conexiones compiten a la vez
  PERFORM dblink_disconnect('lt_gate');
  FOREACH conn IN ARRAY conns LOOP
    PERFORM * FROM dblink_get_result(conn) AS t(x text);
    PERFORM * FROM dblink_get_result(conn, false) AS t(x text);
    PERFORM dblink_disconnect(conn);
  END LOOP;

  FOR h IN 1..array_length(hot, 1) LOOP
    SELECT count(*) INTO reserved FROM reservations WHERE session_id = hot[h] AND status = 'vigente';
    IF reserved > caps[h] THEN over := over + 1; END IF;
    report := report || format(E'\n  sesión %s: %s reservadas de %s lugares%s', h, reserved, caps[h], CASE WHEN reserved > caps[h] THEN '  ← EXCEDIDO' ELSE '' END);
  END LOOP;
  IF EXISTS (SELECT 1 FROM (SELECT participant_id FROM reservations WHERE session_id = ANY (hot) AND status = 'vigente' GROUP BY 1 HAVING count(*) > (SELECT max_reservations FROM editions WHERE is_active)) x) THEN
    RAISE EXCEPTION 'CONTENCIÓN FALLA: alguien tiene más reservaciones que el máximo';
  END IF;
  IF over > 0 THEN RAISE EXCEPTION 'CONTENCIÓN FALLA: se excedió el cupo en % sesiones:%', over, report; END IF;
  RAISE NOTICE 'CONTENCIÓN OK con % conexiones simultáneas: ningún cupo excedido, ninguna persona sobre el máximo.%', n, report;
  DELETE FROM reservations WHERE session_id = ANY (hot);
END
$$;
DROP EXTENSION IF EXISTS dblink;
