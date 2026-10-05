-- Regression tests for the reservation engine (reserve / change / cancel, window, capacity, clashes,
-- limits, administrative states, isolation). Run the whole file as one statement. It ALWAYS ends by raising
-- an exception carrying the results, so every change it makes is rolled back.
-- Expectations: OK | ERR:<text> | TRUE (query must return true) | SHOW (just record)
-- Tokens: {K} is replaced with the quoted uuid stored under key K in rt_ids (sessions, participants, reservations).
-- Who: A, B, N (no notice), M (manual sign-up), C coordinación, S staff, R sorteo, X anonymous, P postgres.
-- Real concurrency is covered by concurrency_reservations.mjs; this file is sequential by design.

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  s uuid := '00000000-0000-4000-8000-0000000000c2';
  r uuid := '00000000-0000-4000-8000-0000000000c3';
  ua uuid := '00000000-0000-4000-8000-0000000000d1';
  ub uuid := '00000000-0000-4000-8000-0000000000d2';
  un uuid := '00000000-0000-4000-8000-0000000000d3';
  um uuid := '00000000-0000-4000-8000-0000000000d4';
  ed uuid := active_edition_id();
  t0 timestamptz := date_trunc('hour', now()) + interval '2 days';
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_act uuid; v_career uuid;
  st record; k record;
  v_uid uuid; v_q text; v_val text; v_err text; v_ok boolean;
  v_res text[] := '{}'; v_pass int := 0; v_fail int := 0;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rtr.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, ua, ub, un, um]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RTR Coord', true, 'rtr.c1@test.invalid'),
    (s, 'staff', 'RTR Staff', true, 'rtr.c2@test.invalid'),
    (r, 'sorteo', 'RTR Sorteo', true, 'rtr.c3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');

  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RTR-REAL', 'RTR Carrera', v_div, false, true)
  RETURNING id INTO v_career;

  CREATE TEMP TABLE rt_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, auth_user_id, initial_career_id) VALUES
    (ed, 'rtr.a@test.invalid', 'Ana Ruta', '2008-01-01', 'forms', ua, v_career),
    (ed, 'rtr.b@test.invalid', 'Beto Ruta', '2008-01-02', 'forms', ub, v_career),
    (ed, 'rtr.n@test.invalid', 'Nora SinAviso', '2008-01-03', 'forms', un, v_career);
  INSERT INTO rt_ids SELECT 'P' || upper(substr(email, 5, 1)), id FROM participants WHERE email LIKE 'rtr._@test.invalid';
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = p.id AND p.email IN ('rtr.a@test.invalid', 'rtr.b@test.invalid');

  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL,
    max_reservations = 4, travel_buffer_minutes = 10 WHERE id = ed;

  -- Catalog: key, workshop, start/end minutes from t0, capacity, credits
  FOR k IN SELECT * FROM (VALUES
    ('S1','W1',0,20,2,1), ('S2','W1',60,80,30,1),
    ('S3','W2',25,45,30,1), ('S4','W2',30,50,30,1),
    ('S5','W3',10,40,30,1), ('S6','W3',0,20,30,1),
    ('S7','W4',120,240,1,2),
    ('S8','W5',245,260,30,1), ('S9','W5',250,265,30,1),
    ('SH','W7',300,320,30,1),
    ('SC','W8',400,420,30,1), ('SC2','W8',500,520,30,1),
    ('SF','W9',600,620,1,1)
  ) AS x(sk, wk, a, b, cap, cr) LOOP
    SELECT id INTO v_act FROM activities WHERE edition_id = ed AND title = 'RTR ' || k.wk;
    IF v_act IS NULL THEN
      INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
      VALUES (ed, v_div, 'RTR ' || k.wk, '', 'Edificio RTR', false) RETURNING id INTO v_act;
    END IF;
    WITH ins AS (
      INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
      VALUES (v_act, t0 + make_interval(mins => k.a), t0 + make_interval(mins => k.b), k.cap, 'Edificio RTR', 'activa', false, k.cr)
      RETURNING id)
    INSERT INTO rt_ids SELECT k.sk, id FROM ins;
  END LOOP;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RTR W6', '', 'Edificio RTR', false) RETURNING id INTO v_act;
  WITH ins AS (
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo)
    VALUES (v_act, now() - interval '5 minutes', now() + interval '15 minutes', 30, 'Edificio RTR', 'activa', false) RETURNING id)
  INSERT INTO rt_ids SELECT 'SP', id FROM ins;

  CREATE TEMP TABLE rt_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rt_steps (name, who, q, expect) VALUES
  -- Authorization
  ('auth: visitante anónimo no puede reservar', 'X', $q$select reserve_session({S2})$q$, 'ERR:permission denied'),
  ('auth: visitante anónimo no ve el tablero', 'X', $q$select my_reservation_board()$q$, 'ERR:permission denied'),
  ('auth: sin Aviso aceptado no reserva', 'N', $q$select reserve_session({S2})$q$, 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('auth: staff no reserva', 'S', $q$select reserve_session({S2})$q$, 'ERR:NOT_AUTHORIZED'),
  ('auth: sorteo no reserva', 'R', $q$select reserve_session({S2})$q$, 'ERR:NOT_AUTHORIZED'),
  ('auth: staff no obtiene tablero de aspirante', 'S', $q$select my_reservation_board()$q$, 'ERR:NOT_AUTHORIZED'),
  ('auth: no existe reservar con id de otro participante', 'A', $q$select reserve_session({S2}, {PB})$q$, 'ERR:does not exist'),
  ('auth: insertar reservación directa para otro id', 'A', $q$insert into reservations (participant_id, session_id, activity_id) select {PB}, id, activity_id from activity_sessions where id = {S2} returning id$q$, 'ERR:permission denied'),
  ('auth: funciones internas no ejecutables (reglas)', 'A', $q$select assert_reservable({PA}, {S2}, null)$q$, 'ERR:permission denied'),
  ('auth: funciones internas no ejecutables (aviso)', 'A', $q$select broadcast_availability({S2}, 'availability')$q$, 'ERR:permission denied'),
  ('auth: funciones internas no ejecutables (conteo)', 'A', $q$select session_reserved_count({S2})$q$, 'ERR:permission denied'),
  ('auth: nadie publica en el canal de disponibilidad', 'A', $q$insert into realtime.messages (topic, extension, event, payload, private) values ('availability:x', 'broadcast', 'availability', '{}', true) returning id$q$, 'ERR:'),
  ('auth: staff sin conteos de Coordinación', 'S', $q$select session_reservation_counts()$q$, 'ERR:NOT_AUTHORIZED'),
  ('auth: staff no cambia reglas', 'S', $q$select update_reservation_settings('{"max_reservations":9,"travel_buffer_minutes":0}')$q$, 'ERR:NOT_AUTHORIZED'),

  -- Manual sign-up uses the same engine
  ('alta presencial: staff registra', 'S', $q$select create_participant_manual(jsonb_build_object('email','rtr.m@test.invalid','full_name','Memo Presencial','birth_date','2008-02-02','phone','9985555555','high_school','Prepa RTR','initial_career_id',{CAREER},'consent_confirmed',true))$q$, 'OK'),
  ('alta presencial: vincular acceso', 'P', $q$update participants set auth_user_id = '00000000-0000-4000-8000-0000000000d4' where email = 'rtr.m@test.invalid'$q$, 'OK'),
  ('alta presencial: sin Aviso no reserva', 'M', $q$select reserve_session({S2})$q$, 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('alta presencial: acepta Aviso', 'M', $q$select accept_platform_notice()$q$, 'OK'),

  -- Window
  ('ventana: abrir mañana', 'P', $q$update editions set reservations_open_at = now() + interval '1 day' where id = active_edition_id()$q$, 'OK'),
  ('ventana: antes de apertura rechaza', 'A', $q$select reserve_session({S1})$q$, 'ERR:RESERVATIONS_NOT_OPEN'),
  ('ventana: tablero informa no abierta', 'A', $q$select my_reservation_board()->>'window' = 'not_open'$q$, 'TRUE'),
  ('ventana: sin apertura configurada', 'P', $q$update editions set reservations_open_at = null where id = active_edition_id()$q$, 'OK'),
  ('ventana: sin apertura rechaza', 'A', $q$select reserve_session({S1})$q$, 'ERR:RESERVATIONS_NOT_OPEN'),
  ('ventana: abrir', 'P', $q$update editions set reservations_open_at = now() - interval '1 hour' where id = active_edition_id()$q$, 'OK'),

  -- Capacity (S1 capacity 2)
  ('cupo: reserva con cupo', 'A', $q$select reserve_session({S1})$q$, 'OK'),
  ('cupo: último lugar', 'B', $q$select reserve_session({S1})$q$, 'OK'),
  ('cupo: llena rechaza (alta presencial)', 'M', $q$select reserve_session({S1})$q$, 'ERR:SESSION_FULL'),
  ('cupo: conteo final = capacidad', 'P', $q$select count(*) = 2 from reservations where session_id = {S1} and status = 'vigente'$q$, 'TRUE'),
  ('cupo: tablero muestra 0 restantes', 'M', $q$select (x->>'remaining')::int = 0 from jsonb_array_elements(my_reservation_board()->'sessions') x where x->>'id' = {S1}::text$q$, 'TRUE'),
  ('alta presencial: reserva igual que Forms', 'M', $q$select reserve_session({S2})$q$, 'OK'),
  ('duplicado: misma sesión dos veces', 'A', $q$select reserve_session({S1})$q$, 'ERR:ALREADY_RESERVED'),
  ('duplicado: mismo taller otra sesión', 'A', $q$select reserve_session({S2})$q$, 'ERR:SAME_WORKSHOP'),

  -- Schedules (A holds S1 0-20, buffer 10)
  ('horario: misma hora', 'A', $q$select reserve_session({S6})$q$, 'ERR:SCHEDULE_CONFLICT'),
  ('horario: solapamiento parcial', 'A', $q$select reserve_session({S5})$q$, 'ERR:SCHEDULE_CONFLICT'),
  ('horario: viola buffer (termina 20, empieza 25)', 'A', $q$select reserve_session({S3})$q$, 'ERR:SCHEDULE_CONFLICT'),
  ('horario: tablero marca choque', 'A', $q$select jsonb_array_length(x->'conflicts_with') = 1 from jsonb_array_elements(my_reservation_board()->'sessions') x where x->>'id' = {S3}::text$q$, 'TRUE'),
  ('horario: consecutiva respeta buffer exacto (empieza 30)', 'A', $q$select reserve_session({S4})$q$, 'OK'),
  ('horario: sesión larga de 2 h', 'A', $q$select reserve_session({S7})$q$, 'OK'),
  ('horario: duraciones distintas, viola buffer tras la larga', 'A', $q$select reserve_session({S8})$q$, 'ERR:SCHEDULE_CONFLICT'),
  ('horario: duraciones distintas, respeta buffer', 'A', $q$select reserve_session({S9})$q$, 'OK'),

  -- Limits (A has 4 of 4)
  ('límite: superar el máximo', 'A', $q$select reserve_session({SH})$q$, 'ERR:MAX_RESERVATIONS'),
  ('límite: máximo configurable a 5', 'C', $q$select update_reservation_settings(jsonb_build_object('reservations_open_at', now() - interval '1 hour', 'max_reservations', 5, 'travel_buffer_minutes', 10))$q$, 'OK'),
  ('límite: con máximo 5 sí entra', 'A', $q$select reserve_session({SH})$q$, 'OK'),
  ('límite: volver a 4', 'C', $q$select update_reservation_settings(jsonb_build_object('reservations_open_at', now() - interval '1 hour', 'max_reservations', 4, 'travel_buffer_minutes', 10))$q$, 'OK'),
  ('límite: con 5 vigentes y máximo 4 no entra otra', 'A', $q$select reserve_session({SC})$q$, 'ERR:MAX_RESERVATIONS'),
  ('límite: regla inválida', 'C', $q$select update_reservation_settings('{"max_reservations":0,"travel_buffer_minutes":10}')$q$, 'ERR:INVALID_MAX_RESERVATIONS'),
  ('límite: cierre antes de apertura', 'C', $q$select update_reservation_settings(jsonb_build_object('reservations_open_at', now(), 'reservations_close_at', now() - interval '1 hour', 'max_reservations', 4, 'travel_buffer_minutes', 10))$q$, 'ERR:INVALID_WINDOW'),

  -- Time: started session
  ('tiempo: reservar sesión ya iniciada', 'A', $q$select reserve_session({SP})$q$, 'ERR:SESSION_STARTED'),
  ('tiempo: B tenía reservada la sesión que ya inició', 'P', $q$with x as (insert into reservations (participant_id, session_id, activity_id) select {PB}, id, activity_id from activity_sessions where id = {SP} returning id) insert into rt_ids select 'RBP', id from x returning id$q$, 'OK'),
  ('tiempo: cancelar después del inicio', 'B', $q$select cancel_reservation({RBP})$q$, 'ERR:SESSION_STARTED'),
  ('tiempo: cambiar después del inicio', 'B', $q$select change_reservation({RBP}, {S3})$q$, 'ERR:CURRENT_SESSION_STARTED'),

  -- Changes (B holds S1 and SP)
  ('cambio: guardar reservación de B en S1', 'P', $q$insert into rt_ids select 'RB1', id from reservations where participant_id = {PB} and session_id = {S1} and status = 'vigente' returning id$q$, 'OK'),
  ('cambio: exitoso mismo taller 0:00 -> 1:00', 'B', $q$select change_reservation({RB1}, {S2})$q$, 'OK'),
  ('cambio: anterior queda como cambiada con traza', 'P', $q$select status = 'cambiada' and ended_at is not null and replaced_by is not null from reservations where id = {RB1}$q$, 'TRUE'),
  ('cambio: libera el lugar anterior', 'P', $q$select count(*) = 1 from reservations where session_id = {S1} and status = 'vigente'$q$, 'TRUE'),
  ('cambio: la reservación ya cambiada no se reutiliza', 'B', $q$select change_reservation({RB1}, {S3})$q$, 'ERR:RESERVATION_NOT_FOUND'),
  ('cambio: guardar reservación de B en S2', 'P', $q$insert into rt_ids select 'RB2', id from reservations where participant_id = {PB} and session_id = {S2} and status = 'vigente' returning id$q$, 'OK'),
  ('cambio: M toma el último lugar de SF', 'M', $q$select reserve_session({SF})$q$, 'OK'),
  ('cambio: hacia sesión llena falla', 'B', $q$select change_reservation({RB2}, {SF})$q$, 'ERR:SESSION_FULL'),
  ('cambio: tras fallar por llena conserva la anterior', 'P', $q$select status = 'vigente' from reservations where id = {RB2}$q$, 'TRUE'),
  ('cambio: B reserva S4 (0:30-0:50)', 'B', $q$select reserve_session({S4})$q$, 'OK'),
  ('cambio: hacia horario incompatible falla', 'B', $q$select change_reservation({RB2}, {S5})$q$, 'ERR:SCHEDULE_CONFLICT'),
  ('cambio: tras fallar por choque conserva la anterior', 'P', $q$select status = 'vigente' from reservations where id = {RB2}$q$, 'TRUE'),
  ('cambio: guardar reservación de B en S4', 'P', $q$insert into rt_ids select 'RB4', id from reservations where participant_id = {PB} and session_id = {S4} and status = 'vigente' returning id$q$, 'OK'),
  ('cambio: exitoso hacia otro taller', 'B', $q$select change_reservation({RB4}, {S6})$q$, 'OK'),
  ('cambio: hacia una sesión que ya tiene', 'B', $q$select change_reservation({RB2}, {S6})$q$, 'ERR:ALREADY_RESERVED'),
  ('cambio: hacia otra sesión de un taller que ya tiene', 'B', $q$select change_reservation({RB2}, {S5})$q$, 'ERR:SAME_WORKSHOP'),
  ('cambio: guardar reservación de A en S9', 'P', $q$insert into rt_ids select 'RA9', id from reservations where participant_id = {PA} and session_id = {S9} and status = 'vigente' returning id$q$, 'OK'),
  ('cambio: no puede cambiar la reservación de otro', 'B', $q$select change_reservation({RA9}, {S8})$q$, 'ERR:RESERVATION_NOT_FOUND'),
  ('cambio: no puede cancelar la reservación de otro', 'B', $q$select cancel_reservation({RA9})$q$, 'ERR:RESERVATION_NOT_FOUND'),

  -- Close
  ('cierre: cerrar reservaciones', 'P', $q$update editions set reservations_close_at = now() - interval '1 minute' where id = active_edition_id()$q$, 'OK'),
  ('cierre: no se reserva', 'M', $q$select reserve_session({S3})$q$, 'ERR:RESERVATIONS_CLOSED'),
  ('cierre: no se cambia', 'A', $q$select change_reservation({RA9}, {S8})$q$, 'ERR:RESERVATIONS_CLOSED'),
  ('cierre: tras fallar el cambio conserva la anterior', 'P', $q$select status = 'vigente' from reservations where id = {RA9}$q$, 'TRUE'),
  ('cierre: sí se cancela antes del inicio', 'A', $q$select cancel_reservation({RA9})$q$, 'OK'),
  ('cierre: cancelada por alumno con traza', 'P', $q$select status = 'cancelada_alumno' and ended_at is not null from reservations where id = {RA9}$q$, 'TRUE'),
  ('cierre: tablero informa cerrada', 'A', $q$select my_reservation_board()->>'window' = 'closed'$q$, 'TRUE'),
  ('cierre: reabrir', 'P', $q$update editions set reservations_close_at = null where id = active_edition_id()$q$, 'OK'),

  -- Coordinación edits on sessions with reservations (S1 holds A + 0 others)
  ('admin: mover hora con reservaciones se bloquea', 'C', $q$select save_session(to_jsonb(x) || jsonb_build_object('starts_at', x.starts_at + interval '5 minutes', 'ends_at', x.ends_at + interval '5 minutes')) from activity_sessions x where id = {S1}$q$, 'ERR:SESSION_TIMES_LOCKED'),
  ('admin: cupo inválido', 'C', $q$select save_session(to_jsonb(x) || '{"capacity":0}') from activity_sessions x where id = {SF}$q$, 'ERR:INVALID_CAPACITY'),
  ('admin: cupo igual a reservados se permite', 'C', $q$select save_session(to_jsonb(x) || '{"capacity":1}') from activity_sessions x where id = {S1}$q$, 'OK'),
  ('admin: cupo por debajo de reservados vigentes', 'C', $q$select save_session(to_jsonb(x) || '{"capacity":1}') from activity_sessions x where id = {S2}$q$, 'ERR:CAPACITY_BELOW_RESERVED'),
  ('admin: ubicación por edición normal se bloquea', 'C', $q$select save_session(to_jsonb(x) || '{"location":"Otra aula"}') from activity_sessions x where id = {S2}$q$, 'ERR:LOCATION_CHANGE_NEEDS_CONFIRMATION'),
  ('admin: staff no cambia ubicación', 'S', $q$select set_session_location({S2}, 'Aula Nueva', 'Cambio de salón')$q$, 'ERR:NOT_AUTHORIZED'),
  ('admin: cambio de ubicación requiere motivo', 'C', $q$select set_session_location({S2}, 'Aula Nueva', 'x')$q$, 'ERR:REASON_REQUIRED_SHORT'),
  ('admin: cambio explícito de ubicación', 'C', $q$select (set_session_location({S2}, 'Aula Nueva', 'Cambio de salón')->>'reservations')::int = 2$q$, 'TRUE'),
  ('admin: ubicación cambiada sin cancelar reservaciones', 'P', $q$select x.location = 'Aula Nueva' and (select count(*) from reservations where session_id = x.id and status = 'vigente') = 2 from activity_sessions x where id = {S2}$q$, 'TRUE'),
  ('admin: cambio de ubicación auditado', 'P', $q$select exists (select 1 from audit_log where action = 'catalog.session_location_changed' and detail->>'id' = {S2}::text)$q$, 'TRUE'),
  ('admin: cambio no estructural (sellos) se permite', 'C', $q$select save_session(to_jsonb(x) || '{"credits":2}') from activity_sessions x where id = {S2}$q$, 'OK'),
  ('admin: cambio de descripción del taller se permite', 'C', $q$select save_activity(jsonb_build_object('id', a.id, 'title', a.title, 'description', 'Nueva descripción', 'location', a.location, 'division_id', a.division_id)) from activities a join activity_sessions x on x.activity_id = a.id where x.id = {S2}$q$, 'OK'),
  ('admin: eliminar horario con reservaciones', 'C', $q$select delete_session({S1})$q$, 'ERR:HAS_RESERVATIONS'),
  ('admin: Coordinación consulta conteos', 'C', $q$select (x->>'reserved')::int = 2 and (x->>'remaining')::int = 28 from jsonb_array_elements(session_reservation_counts()) x where x->>'session_id' = {S2}::text$q$, 'TRUE'),

  -- Hidden session (A holds SH)
  ('oculta: ocultar horario reservado', 'C', $q$select save_session(to_jsonb(x) || '{"status":"oculta"}') from activity_sessions x where id = {SH}$q$, 'OK'),
  ('oculta: la reservación existente sigue vigente', 'P', $q$select count(*) = 1 from reservations where session_id = {SH} and status = 'vigente'$q$, 'TRUE'),
  ('oculta: no acepta nuevas', 'B', $q$select reserve_session({SH})$q$, 'ERR:SESSION_UNAVAILABLE'),
  ('oculta: el aspirante sin reservación no la ve', 'B', $q$select count(*) = 0 from jsonb_array_elements(my_reservation_board()->'sessions') x where x->>'id' = {SH}::text$q$, 'TRUE'),
  ('oculta: quien la reservó la sigue viendo en su ruta', 'A', $q$select count(*) = 1 from jsonb_array_elements(my_reservation_board()->'sessions') x where x->>'id' = {SH}::text$q$, 'TRUE'),
  ('oculta: guardar reservación de A en SH', 'P', $q$insert into rt_ids select 'RAH', id from reservations where session_id = {SH} and status = 'vigente' returning id$q$, 'OK'),
  ('oculta: quien la reservó puede cancelar', 'A', $q$select cancel_reservation({RAH})$q$, 'OK'),

  -- Administrative cancellation (B: S2, S6, SP vigentes)
  ('cancelada: B reserva SC (llega a 4)', 'B', $q$select reserve_session({SC})$q$, 'OK'),
  ('cancelada: B en el máximo no puede otra', 'B', $q$select reserve_session({S9})$q$, 'ERR:MAX_RESERVATIONS'),
  ('cancelada: Coordinación cancela SC', 'C', $q$select save_session(to_jsonb(x) || '{"status":"cancelada"}') from activity_sessions x where id = {SC}$q$, 'OK'),
  ('cancelada: reservación marcada, no borrada', 'P', $q$select status = 'cancelada_sesion' and ended_at is not null from reservations where session_id = {SC} and participant_id = {PB}$q$, 'TRUE'),
  ('cancelada: cancelación auditada', 'P', $q$select exists (select 1 from audit_log where action = 'reservations.cancelled_by_session' and detail->>'session_id' = {SC}::text)$q$, 'TRUE'),
  ('cancelada: simular tiempo transcurrido (todo corre en una sola transacción)', 'P', $q$update reservations set created_at = now() - interval '2 minutes', ended_at = case when session_id = {SC} then now() - interval '1 minute' else ended_at end where participant_id = {PB}$q$, 'OK'),
  ('cancelada: el aspirante la ve como sesión cancelada', 'B', $q$select x->>'status' = 'cancelada_sesion' and (x->>'resolved')::boolean = false from jsonb_array_elements(my_reservation_board()->'reservations') x where x->>'session_id' = {SC}::text$q$, 'TRUE'),
  ('cancelada: no acepta nuevas', 'M', $q$select reserve_session({SC})$q$, 'ERR:SESSION_CANCELLED'),
  ('cancelada: deja de contar contra el máximo y el taller (elige sustituta)', 'B', $q$select reserve_session({SC2})$q$, 'OK'),
  ('cancelada: queda resuelta tras elegir otra', 'B', $q$select (x->>'resolved')::boolean from jsonb_array_elements(my_reservation_board()->'reservations') x where x->>'session_id' = {SC}::text$q$, 'TRUE'),
  ('cancelada: reactivar', 'C', $q$select save_session(to_jsonb(x) || '{"status":"activa"}') from activity_sessions x where id = {SC}$q$, 'OK'),
  ('cancelada: reactivar no revive reservaciones', 'P', $q$select count(*) = 0 from reservations where session_id = {SC} and status = 'vigente'$q$, 'TRUE'),
  ('cancelada: tras reactivar acepta nuevas', 'M', $q$select reserve_session({SC})$q$, 'OK'),

  -- Isolation and invariants
  ('lectura directa: visitante anónimo', 'X', $q$select count(*) from reservations$q$, 'ERR:permission denied'),
  ('lectura directa: aspirante sin Aviso (nunca aceptado)', 'N', $q$select count(*) from reservations$q$, 'ERR:permission denied'),
  ('lectura directa: A deja de tener el Aviso vigente', 'P', $q$update participant_profiles set platform_consent_version = null, platform_consent_at = null where participant_id = {PA}$q$, 'OK'),
  ('lectura directa: A sin Aviso no lee sus propias reservaciones', 'A', $q$select count(*) from reservations where participant_id = {PA}$q$, 'ERR:permission denied'),
  ('lectura directa: A sin Aviso tampoco obtiene el tablero', 'A', $q$select my_reservation_board()$q$, 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('lectura directa: A acepta el Aviso', 'A', $q$select accept_platform_notice()$q$, 'OK'),
  ('lectura directa: con Aviso el tablero muestra sus reservaciones', 'A', $q$select jsonb_array_length(my_reservation_board()->'reservations') > 0$q$, 'TRUE'),
  ('lectura directa: con Aviso sigue sin acceso a la tabla', 'A', $q$select count(*) from reservations where participant_id = {PA}$q$, 'ERR:permission denied'),
  ('lectura directa: A no lee reservaciones de B', 'A', $q$select count(*) from reservations where participant_id = {PB}$q$, 'ERR:permission denied'),
  ('lectura directa: staff', 'S', $q$select count(*) from reservations$q$, 'ERR:permission denied'),
  ('lectura directa: sorteo', 'R', $q$select count(*) from reservations$q$, 'ERR:permission denied'),
  ('lectura directa: coordinación', 'C', $q$select count(*) from reservations$q$, 'ERR:permission denied'),
  ('coordinación: sus conteos operativos funcionan', 'C', $q$select jsonb_array_length(session_reservation_counts()) > 0$q$, 'TRUE'),
  ('coordinación: los conteos no traen datos personales', 'C', $q$select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k) = array['capacity','remaining','reserved','session_id']) from jsonb_array_elements(session_reservation_counts()) x$q$, 'TRUE'),
  ('sorteo: sin conteos de Coordinación', 'R', $q$select session_reservation_counts()$q$, 'ERR:NOT_AUTHORIZED'),
  ('aislamiento: aspirante no actualiza reservaciones', 'A', $q$update reservations set status = 'vigente' where participant_id = {PA}$q$, 'ERR:permission denied'),
  ('sellos: configurables por sesión', 'A', $q$select (x->>'credits')::int = 2 from jsonb_array_elements(my_reservation_board()->'sessions') x where x->>'id' = {S7}::text$q$, 'TRUE'),
  ('invariante: ninguna sesión supera su cupo', 'P', $q$select bool_and(n <= capacity) from (select x.capacity, count(r.id) n from activity_sessions x left join reservations r on r.session_id = x.id and r.status in ('vigente', 'expirada') group by x.id, x.capacity) q$q$, 'TRUE'),
  ('invariante: una vigente por participante y taller', 'P', $q$select not exists (select 1 from reservations where status = 'vigente' group by participant_id, activity_id having count(*) > 1)$q$, 'TRUE');

  FOR st IN SELECT * FROM rt_steps ORDER BY seq LOOP
    v_q := replace(st.q, '{CAREER}', quote_literal(v_career));
    FOR k IN SELECT * FROM rt_ids LOOP
      v_q := replace(v_q, '{' || k.k || '}', quote_literal(k.id) || '::uuid');
    END LOOP;
    v_uid := CASE st.who WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r WHEN 'A' THEN ua WHEN 'B' THEN ub WHEN 'N' THEN un WHEN 'M' THEN um END;
    v_val := NULL; v_err := NULL;
    BEGIN
      IF v_q ~ '\{[A-Z0-9]+\}' THEN RAISE EXCEPTION 'UNRESOLVED_TOKEN %', v_q; END IF;
      IF st.who = 'X' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
      ELSIF v_uid IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
      END IF;
      IF v_q LIKE 'update %' THEN
        EXECUTE v_q;
      ELSE
        EXECUTE v_q INTO v_val;
      END IF;
    EXCEPTION WHEN others THEN
      v_err := SQLERRM;
    END;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);

    v_ok := CASE
      WHEN st.expect = 'OK' THEN v_err IS NULL
      WHEN st.expect = 'TRUE' THEN v_err IS NULL AND v_val = 'true'
      WHEN st.expect = 'SHOW' THEN true
      WHEN st.expect LIKE 'ERR:%' THEN v_err LIKE '%' || substr(st.expect, 5) || '%'
    END;
    IF v_ok THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
    v_res := v_res || format('%s %s%s', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, st.name,
      CASE WHEN st.expect = 'SHOW' OR NOT v_ok THEN ' -> ' || left(coalesce('error: ' || v_err, v_val, 'null'), 300) ELSE '' END);
  END LOOP;

  RAISE EXCEPTION E'RESULTADOS (cambios revertidos): % ok, % fallas\n%', v_pass, v_fail, array_to_string(v_res, E'\n');
END
$test$;
