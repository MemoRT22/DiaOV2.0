-- Regression tests for the admin simplification (UX-3): product-owned rank rules, shared division counting,
-- access diagnosis from Participantes, import-conflict resolution and the reservation settings contract.
-- Run the whole file as one statement AFTER migrations 20261006170608 and 20261007010100. Fixtures are created
-- inside the statement (nothing from the environment is used destructively) and it ALWAYS ends by raising an
-- exception, so every change is rolled back. Success is read from the message: "ADMIN_SIMPLIFICATION_OK n checks".
DO $test$
DECLARE
  ed uuid := active_edition_id();
  c uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ul uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  pa uuid; pl uuid; pv uuid; pimp uuid;
  divs uuid[]; d1 uuid; d2 uuid; d3 uuid; v_career uuid; v_batch uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
  new_ed uuid; v jsonb; v_n int := 0; v_err text; v_conflict uuid; v_conflict2 uuid;
  retired boolean := to_regprocedure('public.access_diagnosis(text)') IS NULL;

BEGIN
  -- ----- fixtures (postgres) -----------------------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ux3.' || substr(u::text, 1, 8) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, ua, ul, uv]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'UX3 Coord', true, 'ux3.coord@test.invalid'), (s, 'staff', 'UX3 Staff', true, 'ux3.staff@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff');

  SELECT array_agg(id) INTO divs FROM (SELECT id FROM divisions ORDER BY sort_order, id LIMIT 3) x;
  IF coalesce(cardinality(divs), 0) < 3 THEN RAISE EXCEPTION 'TEST_REQUIRES_3_DIVISIONS'; END IF;
  d1 := divs[1]; d2 := divs[2]; d3 := divs[3];
  SELECT id INTO v_career FROM careers WHERE is_active AND NOT is_demo ORDER BY id LIMIT 1;
  IF v_career IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_A_CAREER'; END IF;

  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, auth_user_id, initial_career_id, phone) VALUES
    (ed, 'ux3.a@test.invalid', 'UX3 Ana', '2008-01-01', 'forms', ua, v_career, '9981110001'),
    (ed, 'ux3.l@test.invalid', 'UX3 Luis Bloqueado', '2008-01-02', 'forms', ul, v_career, '9981110002'),
    (ed, 'ux3.v@test.invalid', 'UX3 Vera Solo VU', '2008-01-03', 'forms', uv, v_career, '9981110003');
  SELECT id INTO pa FROM participants WHERE email = 'ux3.a@test.invalid';
  SELECT id INTO pl FROM participants WHERE email = 'ux3.l@test.invalid';
  SELECT id INTO pv FROM participants WHERE email = 'ux3.v@test.invalid';
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id WHERE pp.participant_id = p.id AND p.id IN (pa, pv);

  -- a1: division D1 · a2: multi-division D2+D3 (division_id NULL) · a3: no division (Vida Universitaria) · a4: D1 · a5: no division
  INSERT INTO activities (edition_id, division_id, title, is_demo) VALUES (ed, d1, 'UX3 a1', false) RETURNING id INTO a1;
  INSERT INTO activities (edition_id, division_id, title, is_demo) VALUES (ed, NULL, 'UX3 a2 multi', false) RETURNING id INTO a2;
  INSERT INTO activities (edition_id, division_id, title, is_demo) VALUES (ed, NULL, 'UX3 a3 vida', false) RETURNING id INTO a3;
  INSERT INTO activities (edition_id, division_id, title, is_demo) VALUES (ed, d1, 'UX3 a4', false) RETURNING id INTO a4;
  INSERT INTO activities (edition_id, division_id, title, is_demo) VALUES (ed, NULL, 'UX3 a5 vida', false) RETURNING id INTO a5;
  DELETE FROM activity_divisions WHERE activity_id IN (a1, a2, a3, a4, a5);
  INSERT INTO activity_divisions (activity_id, division_id) VALUES (a1, d1), (a2, d2), (a2, d3), (a4, d1);
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo) SELECT a, now() - interval '3 hours', now() - interval '2 hours', 20, false
  FROM unnest(ARRAY[a1, a2, a3, a4, a5]) a;
  SELECT id INTO s1 FROM activity_sessions WHERE activity_id = a1; SELECT id INTO s2 FROM activity_sessions WHERE activity_id = a2;
  SELECT id INTO s3 FROM activity_sessions WHERE activity_id = a3; SELECT id INTO s4 FROM activity_sessions WHERE activity_id = a4;
  SELECT id INTO s5 FROM activity_sessions WHERE activity_id = a5;

  -- ----- 1. rank rules are product-owned defaults, sown per edition ---------------------------------------
  INSERT INTO editions (code, name, event_date, is_active, mode) VALUES ('UX3_NEW', 'UX3 new edition', '2026-10-30', false, 'preparacion') RETURNING id INTO new_ed;
  IF (SELECT count(*) FROM rank_levels WHERE edition_id = new_ed) <> 5 THEN RAISE EXCEPTION 'NEW_EDITION_RANK_COUNT'; END IF;
  -- the level depends only on accumulated stamps: 0, 1, 2, 3, 4 and never on distinct divisions
  IF EXISTS (SELECT 1 FROM rank_levels WHERE edition_id = new_ed AND (required_attendances <> level - 1 OR required_divisions <> 0)) THEN
    RAISE EXCEPTION 'DEFAULT_THRESHOLDS_WRONG'; END IF;
  v_n := v_n + 3;
  -- seeding never overwrites what an edition already has
  UPDATE rank_levels SET required_attendances = 9 WHERE edition_id = new_ed AND level = 3;
  PERFORM seed_default_rank_levels(new_ed);
  IF (SELECT required_attendances FROM rank_levels WHERE edition_id = new_ed AND level = 3) <> 9
     OR (SELECT count(*) FROM rank_levels WHERE edition_id = new_ed) <> 5 THEN RAISE EXCEPTION 'SEED_NOT_IDEMPOTENT'; END IF;
  v_n := v_n + 1;
  -- the active edition (existing deployment) has all five levels, ready for the student's progress
  IF (SELECT count(*) FROM rank_levels WHERE edition_id = ed) <> 5
     OR EXISTS (SELECT 1 FROM rank_levels WHERE edition_id = ed AND (required_attendances <> level - 1 OR required_divisions <> 0)) THEN
    RAISE EXCEPTION 'ACTIVE_EDITION_RANKS_NOT_BY_STAMPS'; END IF;
  v_n := v_n + 1;
  -- the client can read the rules but never write them
  IF NOT has_table_privilege('authenticated', 'public.rank_levels', 'SELECT') OR NOT has_table_privilege('anon', 'public.rank_levels', 'SELECT') THEN RAISE EXCEPTION 'RANKS_NOT_READABLE'; END IF;
  IF has_table_privilege('authenticated', 'public.rank_levels', 'INSERT') OR has_table_privilege('authenticated', 'public.rank_levels', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.rank_levels', 'DELETE') OR has_table_privilege('authenticated', 'public.rank_levels', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.rank_levels', 'UPDATE') OR has_table_privilege('anon', 'public.rank_levels', 'TRUNCATE') THEN
    RAISE EXCEPTION 'RANKS_WRITABLE_BY_CLIENT'; END IF;
  v_n := v_n + 2;
  -- internal helpers are not callable by the client
  IF has_function_privilege('authenticated', 'public.seed_default_rank_levels(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.seed_default_rank_levels(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.participant_visited_division_ids(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.participant_visited_division_ids(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.seed_rank_levels_for_new_edition()', 'EXECUTE') THEN
    RAISE EXCEPTION 'INTERNAL_HELPERS_EXPOSED'; END IF;
  v_n := v_n + 1;
  -- the administrative configurator is gone once the retirement migration is applied
  IF retired AND (to_regprocedure('public.update_rank_rules(jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rank_levels' AND column_name = 'is_provisional')) THEN
    RAISE EXCEPTION 'RANK_CONFIGURATOR_STILL_EXISTS'; END IF;
  v_n := v_n + 1;

  -- ----- 2. progress: one level per completed workshop (stamps), never blocked by divisions -----------------
  IF participant_rank_level(pa) <> 1 THEN RAISE EXCEPTION 'LEVEL_1_WITH_0_WORKSHOPS'; END IF;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted) VALUES (pa, s1, a1, 1);
  IF participant_rank_level(pa) <> 2 THEN RAISE EXCEPTION 'LEVEL_2_WITH_1_WORKSHOP'; END IF;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted) VALUES (pa, s2, a2, 1);
  IF cardinality(participant_visited_division_ids(pa)) <> 3 THEN RAISE EXCEPTION 'MULTI_DIVISION_NOT_COUNTED'; END IF;
  IF participant_rank_level(pa) <> 3 THEN RAISE EXCEPTION 'LEVEL_3_WITH_2_WORKSHOPS'; END IF;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted) VALUES (pa, s3, a3, 1);
  IF cardinality(participant_visited_division_ids(pa)) <> 3 THEN RAISE EXCEPTION 'DIVISIONLESS_ACTIVITY_ADDED_DIVISION'; END IF;
  IF participant_rank_level(pa) <> 4 THEN RAISE EXCEPTION 'LEVEL_4_WITH_3_WORKSHOPS'; END IF;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted) VALUES (pa, s4, a4, 1);
  IF participant_rank_level(pa) <> 5 THEN RAISE EXCEPTION 'LEVEL_5_WITH_4_WORKSHOPS'; END IF;
  v_n := v_n + 6;
  -- visiting few (or no) distinct divisions never blocks progress: 3 workshops, only 1 division visited
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted) VALUES (pv, s3, a3, 1), (pv, s5, a5, 1), (pv, s1, a1, 1);
  IF cardinality(participant_visited_division_ids(pv)) <> 1 THEN RAISE EXCEPTION 'SINGLE_DIVISION_COUNT'; END IF;
  IF participant_rank_level(pv) <> 4 THEN RAISE EXCEPTION 'DIVISIONS_BLOCKED_PROGRESS[%]', participant_rank_level(pv); END IF;
  v_n := v_n + 2;

  -- the participant's own progress agrees with the rank used by check-in, and works with no configurator
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := my_progress();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (v->>'level')::int <> 5 OR (v->>'level')::int <> participant_rank_level(pa) THEN RAISE EXCEPTION 'MY_PROGRESS_LEVEL_MISMATCH[%]', v->>'level'; END IF;
  IF jsonb_array_length(v->'division_ids') <> 3 OR (v->'division_ids') @> 'null'::jsonb THEN RAISE EXCEPTION 'MY_PROGRESS_DIVISIONS[%]', v->'division_ids'; END IF;
  IF (v->>'stamps')::int <> 4 OR v->'next' <> 'null'::jsonb THEN RAISE EXCEPTION 'MY_PROGRESS_STAMPS_OR_NEXT'; END IF;
  -- the student-facing contract keeps every key the portal reads
  IF NOT (v ?& ARRAY['level', 'stamps', 'attended_workshops', 'reserved_workshops', 'division_ids', 'next', 'consent_accepted',
    'post_event_interests_prompt', 'post_event_interests_open', 'post_event_interests_completed', 'interests_prompt', 'interests_open']) THEN
    RAISE EXCEPTION 'MY_PROGRESS_CONTRACT[%]', v; END IF;
  v_n := v_n + 4;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := my_progress();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (v->>'level')::int <> 4 OR (v->>'level')::int <> participant_rank_level(pv) OR (v->'next'->>'level')::int <> 5
     OR (v->'next'->>'required_attendances')::int <> 4 OR (v->'next'->>'required_divisions')::int <> 0
     OR jsonb_array_length(v->'division_ids') <> 1 THEN RAISE EXCEPTION 'MY_PROGRESS_NEXT_REQUIREMENT[%]', v; END IF;
  v_n := v_n + 1;
  -- progress is only for participants
  v_err := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    PERFORM my_progress();
  EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF v_err IS DISTINCT FROM 'NOT_AUTHORIZED' THEN RAISE EXCEPTION 'MY_PROGRESS_OPEN_TO_STAFF[%]', coalesce(v_err, 'ok'); END IF;
  v_n := v_n + 1;

  -- ----- 3. access diagnosis lives in Participantes (search + expediente) ----------------------------------
  INSERT INTO access_attempts (email_hash, succeeded, cleared) SELECT email_hash('ux3.l@test.invalid'), false, false FROM generate_series(1, 5);
  INSERT INTO import_batches (edition_id, kind, file_name, is_demo) VALUES (ed, 'participants', 'ux3.csv', false) RETURNING id INTO v_batch;
  INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value) VALUES (pa, v_batch, 'phone', '9987654321') RETURNING id INTO v_conflict;
  UPDATE participants SET manual_overrides = jsonb_build_object('phone', jsonb_build_object('at', now()::text, 'by', s::text)) WHERE id = pa;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := search_participants('ux3');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF jsonb_array_length(v) <> 3 THEN RAISE EXCEPTION 'SEARCH_ROWS[%]', jsonb_array_length(v); END IF;
  IF NOT (SELECT (x->>'access_locked')::boolean FROM jsonb_array_elements(v) x WHERE x->>'id' = pl::text) THEN RAISE EXCEPTION 'SEARCH_LOCK_NOT_SHOWN'; END IF;
  IF (SELECT bool_or((x->>'access_locked')::boolean) FROM jsonb_array_elements(v) x WHERE x->>'id' <> pl::text) THEN RAISE EXCEPTION 'SEARCH_FALSE_LOCK'; END IF;
  IF (SELECT (x->>'pending_conflicts')::int FROM jsonb_array_elements(v) x WHERE x->>'id' = pa::text) <> 1
     OR (SELECT (x->>'pending_conflicts')::int FROM jsonb_array_elements(v) x WHERE x->>'id' = pv::text) <> 0 THEN RAISE EXCEPTION 'SEARCH_PENDING_CONFLICTS'; END IF;
  -- the original contract of the search is intact
  IF NOT (SELECT bool_and(x ? 'has_birth_date' AND x ? 'has_logged_in' AND x ? 'career_name' AND x ? 'origin') FROM jsonb_array_elements(v) x) THEN RAISE EXCEPTION 'SEARCH_CONTRACT'; END IF;
  v_n := v_n + 5;

  -- the expediente returns everything the retired diagnosis returned (and writes the audit trail)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := get_participant(pl);
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF NOT (v->'access'->>'locked')::boolean OR (v->'access'->>'failed')::int < 5 OR v->'access'->'locked_until' = 'null'::jsonb THEN RAISE EXCEPTION 'EXPEDIENTE_LOCK_STATE'; END IF;
  IF v->>'birth_date' IS NULL OR v->>'has_logged_in' <> 'true' OR NOT v ? 'platform_consent_at' THEN RAISE EXCEPTION 'EXPEDIENTE_DIAGNOSIS_FIELDS'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'participant.viewed' AND actor_user_id = s AND detail->>'participant_id' = pl::text) THEN RAISE EXCEPTION 'EXPEDIENTE_NOT_AUDITED'; END IF;
  v_n := v_n + 3;
  IF NOT retired THEN
    -- while the legacy RPC still exists it must agree with the expediente
    PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    v_err := access_diagnosis('ux3.l@test.invalid')::text;
    PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
    IF (v_err::jsonb->'access') IS DISTINCT FROM (v->'access') OR (v_err::jsonb->>'has_logged_in') IS DISTINCT FROM (v->>'has_logged_in') THEN RAISE EXCEPTION 'DIAGNOSIS_NOT_EQUIVALENT'; END IF;
    v_n := v_n + 1;
  END IF;
  -- unlocking stays an audited staff action and is reflected by the search
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM clear_access_lock(pl);
  v := search_participants('ux3.l@');
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (v->0->>'access_locked')::boolean THEN RAISE EXCEPTION 'UNLOCK_NOT_REFLECTED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'participant.access_unlocked' AND actor_user_id = s) THEN RAISE EXCEPTION 'UNLOCK_NOT_AUDITED'; END IF;
  v_n := v_n + 2;
  IF retired AND to_regprocedure('public.access_diagnosis(text)') IS NOT NULL THEN RAISE EXCEPTION 'ACCESS_DIAGNOSIS_STILL_EXISTS'; END IF;
  -- participants cannot search other participants
  v_err := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    PERFORM search_participants('ux3');
  EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF v_err IS DISTINCT FROM 'NOT_AUTHORIZED' THEN RAISE EXCEPTION 'SEARCH_OPEN_TO_PARTICIPANTS[%]', coalesce(v_err, 'ok'); END IF;
  v_n := v_n + 1;

  -- ----- 4. import conflicts: resolution keeps the manual-correction protection and the audit trail --------
  v_err := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    PERFORM list_import_conflicts();
  EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF v_err IS DISTINCT FROM 'NOT_AUTHORIZED' THEN RAISE EXCEPTION 'CONFLICTS_OPEN_TO_STAFF[%]', coalesce(v_err, 'ok'); END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := list_import_conflicts();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'id' = v_conflict::text AND x->>'field' = 'phone'
       AND x->>'imported_value' = '9987654321' AND x->>'current_value' = '9981110001' AND x->>'participant_id' = pa::text) THEN RAISE EXCEPTION 'CONFLICT_NOT_LISTED[%]', v; END IF;
  v_n := v_n + 2;
  -- keeping the manual correction leaves the participant untouched
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM resolve_import_conflict(v_conflict, false);
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (SELECT phone FROM participants WHERE id = pa) <> '9981110001' OR (SELECT status FROM participant_import_conflicts WHERE id = v_conflict) <> 'kept'
     OR NOT (SELECT manual_overrides ? 'phone' FROM participants WHERE id = pa) THEN RAISE EXCEPTION 'KEEP_MANUAL_BROKEN'; END IF;
  -- accepting the file value applies it and lifts the protection
  INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value) VALUES (pa, v_batch, 'phone', '9987654321') RETURNING id INTO v_conflict2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM resolve_import_conflict(v_conflict2, true);
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (SELECT phone FROM participants WHERE id = pa) <> '9987654321' OR (SELECT status FROM participant_import_conflicts WHERE id = v_conflict2) <> 'accepted'
     OR (SELECT manual_overrides ? 'phone' FROM participants WHERE id = pa) THEN RAISE EXCEPTION 'ACCEPT_IMPORT_BROKEN'; END IF;
  IF (SELECT count(*) FROM audit_log WHERE action = 'participants.conflict_resolved' AND actor_user_id = c) <> 2 THEN RAISE EXCEPTION 'CONFLICT_RESOLUTION_NOT_AUDITED'; END IF;
  v_n := v_n + 3;

  -- end to end: an import never overwrites a manual correction, it leaves a record to review, and the review resolves it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := commit_participant_import(jsonb_build_array(jsonb_build_object('row', 2, 'email', 'ux3.imp@test.invalid', 'full_name', 'UX3 Importada',
    'birth_date', '2008-05-14', 'phone', '9981111111', 'high_school', 'Prepa UX3', 'career', (SELECT code FROM careers WHERE id = v_career), 'consent', true)), 'ux3.csv', false);
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (v->'counts'->>'new')::int <> 1 THEN RAISE EXCEPTION 'IMPORT_NEW[%]', v->'counts'; END IF;
  SELECT id INTO pimp FROM participants WHERE email = 'ux3.imp@test.invalid';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM update_participant(pimp, '{"phone":"9989999999"}'::jsonb);
  v := commit_participant_import(jsonb_build_array(jsonb_build_object('row', 2, 'email', 'ux3.imp@test.invalid', 'full_name', 'UX3 Importada',
    'birth_date', '2008-05-14', 'phone', '9981111111', 'high_school', 'Prepa UX3', 'career', (SELECT code FROM careers WHERE id = v_career), 'consent', true)), 'ux3.csv', false);
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (v->'counts'->>'conflict')::int <> 1 THEN RAISE EXCEPTION 'IMPORT_CONFLICT_NOT_REPORTED[%]', v->'counts'; END IF;
  IF (SELECT phone FROM participants WHERE id = pimp) <> '9989999999' THEN RAISE EXCEPTION 'IMPORT_OVERWROTE_MANUAL_CORRECTION'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v := list_import_conflicts();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'participant_id' = pimp::text AND x->>'field' = 'phone'
       AND x->>'imported_value' = '9981111111' AND x->>'current_value' = '9989999999') THEN RAISE EXCEPTION 'IMPORT_CONFLICT_NOT_LISTED[%]', v; END IF;
  v_n := v_n + 3;

  -- ----- 5. reservation settings: only opening and closing are decided by Coordinación ---------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM update_reservation_settings(jsonb_build_object('reservations_open_at', now() - interval '1 hour', 'reservations_close_at', now() + interval '10 days'));
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  IF (SELECT max_reservations FROM editions WHERE id = ed) <> 4 OR (SELECT travel_buffer_minutes FROM editions WHERE id = ed) <> 10
     OR (SELECT checkin_open_before_minutes FROM editions WHERE id = ed) <> 5 OR (SELECT checkin_close_after_minutes FROM editions WHERE id = ed) <> 20 THEN
    RAISE EXCEPTION 'SYSTEM_RULES_CHANGED'; END IF;
  IF (SELECT reservations_close_at FROM editions WHERE id = ed) <= now() THEN RAISE EXCEPTION 'CLOSE_NOT_SAVED'; END IF;
  v_n := v_n + 2;
  IF retired THEN
    v_err := NULL;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
      PERFORM set_config('role', 'authenticated', true);
      PERFORM update_reservation_settings('{"max_reservations":9}');
    EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
    IF v_err IS DISTINCT FROM 'SYSTEM_MANAGED_SETTING' THEN RAISE EXCEPTION 'TECHNICAL_SETTING_ACCEPTED[%]', coalesce(v_err, 'ok'); END IF;
    v_n := v_n + 1;
  END IF;

  RAISE EXCEPTION 'ADMIN_SIMPLIFICATION_OK % checks (retired=%)', v_n, retired;
END
$test$;
