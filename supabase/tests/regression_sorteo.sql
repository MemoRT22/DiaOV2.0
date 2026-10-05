-- Regression tests for Phase 5: tickets, categories, prizes, draw, no-show, invalidation, roles.
-- Covers: ticket counting, category assignment, role authorization,
-- draw with idempotency, confirm, no-show, invalidation, PII protection,
-- categories exist in demo AND real, inactive prize rejection, quantity guard,
-- helpers revoked from authenticated, demo/real isolation, no-show chain, pending recovery.
-- Roles: C=coordinacion, S=staff, R=sorteo, X=superuser (postgres).

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000d1'; s uuid := '00000000-0000-4000-8000-0000000000d2'; r uuid := '00000000-0000-4000-8000-0000000000d3'; n uuid := '00000000-0000-4000-8000-0000000000d4'; t uuid := '00000000-0000-4000-8000-0000000000d5'; p1u uuid := '00000000-0000-4000-8000-0000000000e1'; p2u uuid := '00000000-0000-4000-8000-0000000000e2'; p3u uuid := '00000000-0000-4000-8000-0000000000e3'; p4u uuid := '00000000-0000-4000-8000-0000000000e4'; ed uuid := active_edition_id(); st record; v_q text; v_err text; v_ok boolean; v_last text := 'null'; v_div uuid; v_act_a1 uuid; v_act_a2 uuid; v_act_a3 uuid; v_act_a4 uuid; v_act_a5 uuid; v_act_l1 uuid; v_ses_a1 uuid; v_ses_a2 uuid; v_ses_a3 uuid; v_ses_a4 uuid; v_ses_a5 uuid; v_ses_l1 uuid; v_cat_baja uuid; v_cat_media uuid; v_cat_mayor uuid; v_cat_baja_real uuid; v_prize_baja uuid; v_prize_mayor uuid; v_prize_inactive uuid; v_prize_chain uuid; v_prize_pending uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_res text[] := '{}'; v_pass int := 0; v_fail int := 0;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rs.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now() FROM unnest(ARRAY[c, s, r, n, t, p1u, p2u, p3u, p4u]) u ON CONFLICT DO NOTHING;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES (c, 'coordinacion', 'RS Coord', true, 'rs.d1@test.invalid'), (s, 'staff', 'RS Staff', true, 'rs.d2@test.invalid'), (r, 'sorteo', 'RS Sorteo', true, 'rs.d3@test.invalid') ON CONFLICT DO NOTHING;
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo') ON CONFLICT DO NOTHING;
  SELECT id INTO v_div FROM divisions WHERE is_demo LIMIT 1;
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type) VALUES (ed, v_div, 'RS Acad 1', true, 'academica') ON CONFLICT DO NOTHING;
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type) VALUES (ed, v_div, 'RS Acad 2', true, 'academica') ON CONFLICT DO NOTHING;
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type) VALUES (ed, v_div, 'RS Acad 3', true, 'academica') ON CONFLICT DO NOTHING;
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type) VALUES (ed, v_div, 'RS Acad 4', true, 'academica') ON CONFLICT DO NOTHING;
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type) VALUES (ed, v_div, 'RS Acad 5', true, 'academica') ON CONFLICT DO NOTHING;
  INSERT INTO activities (edition_id, division_id, title, is_demo, activity_type) VALUES (ed, v_div, 'RS Lider 1', true, 'liderazgo') ON CONFLICT DO NOTHING;
  SELECT id INTO v_act_a1 FROM activities WHERE edition_id = ed AND is_demo AND title = 'RS Acad 1' LIMIT 1;
  SELECT id INTO v_act_a2 FROM activities WHERE edition_id = ed AND is_demo AND title = 'RS Acad 2' LIMIT 1;
  SELECT id INTO v_act_a3 FROM activities WHERE edition_id = ed AND is_demo AND title = 'RS Acad 3' LIMIT 1;
  SELECT id INTO v_act_a4 FROM activities WHERE edition_id = ed AND is_demo AND title = 'RS Acad 4' LIMIT 1;
  SELECT id INTO v_act_a5 FROM activities WHERE edition_id = ed AND is_demo AND title = 'RS Acad 5' LIMIT 1;
  SELECT id INTO v_act_l1 FROM activities WHERE edition_id = ed AND is_demo AND title = 'RS Lider 1' LIMIT 1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status, credits) SELECT v_act_a1, '2026-10-04 10:00-05', '2026-10-04 10:45-05', 100, true, 'activa', 1 WHERE NOT EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act_a1);
  SELECT id INTO v_ses_a1 FROM activity_sessions WHERE activity_id = v_act_a1 LIMIT 1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status, credits) SELECT v_act_a2, '2026-10-04 11:00-05', '2026-10-04 11:45-05', 100, true, 'activa', 1 WHERE NOT EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act_a2);
  SELECT id INTO v_ses_a2 FROM activity_sessions WHERE activity_id = v_act_a2 LIMIT 1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status, credits) SELECT v_act_a3, '2026-10-04 12:00-05', '2026-10-04 12:45-05', 100, true, 'activa', 1 WHERE NOT EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act_a3);
  SELECT id INTO v_ses_a3 FROM activity_sessions WHERE activity_id = v_act_a3 LIMIT 1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status, credits) SELECT v_act_a4, '2026-10-04 13:00-05', '2026-10-04 13:45-05', 100, true, 'activa', 1 WHERE NOT EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act_a4);
  SELECT id INTO v_ses_a4 FROM activity_sessions WHERE activity_id = v_act_a4 LIMIT 1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status, credits) SELECT v_act_a5, '2026-10-04 14:00-05', '2026-10-04 14:45-05', 100, true, 'activa', 2 WHERE NOT EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act_a5);
  SELECT id INTO v_ses_a5 FROM activity_sessions WHERE activity_id = v_act_a5 LIMIT 1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, is_demo, status, credits) SELECT v_act_l1, '2026-10-04 15:00-05', '2026-10-04 15:45-05', 100, true, 'activa', 1 WHERE NOT EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = v_act_l1);
  SELECT id INTO v_ses_l1 FROM activity_sessions WHERE activity_id = v_act_l1 LIMIT 1;
  SELECT id INTO v_cat_baja FROM raffle_categories WHERE edition_id = ed AND name = 'Baja' AND is_demo LIMIT 1;
  SELECT id INTO v_cat_media FROM raffle_categories WHERE edition_id = ed AND name = 'Media' AND is_demo LIMIT 1;
  SELECT id INTO v_cat_mayor FROM raffle_categories WHERE edition_id = ed AND name = 'Mayor' AND is_demo LIMIT 1;
  SELECT id INTO v_cat_baja_real FROM raffle_categories WHERE edition_id = ed AND name = 'Baja' AND NOT is_demo LIMIT 1;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (ed, v_cat_baja, 'RS Premio Baja', 2, true, 1, true) ON CONFLICT DO NOTHING;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (ed, v_cat_mayor, 'RS Premio Mayor', 1, true, 1, true) ON CONFLICT DO NOTHING;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (ed, v_cat_baja, 'RS Premio Inactivo', 1, false, 0, true) ON CONFLICT DO NOTHING;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (ed, v_cat_baja, 'RS Premio Cadena', 1, true, 2, true) ON CONFLICT DO NOTHING;
  INSERT INTO raffle_prizes (edition_id, category_id, name, quantity, is_active, sort_order, is_demo) VALUES (ed, v_cat_baja, 'RS Premio Pending', 1, true, 3, true) ON CONFLICT DO NOTHING;
  SELECT id INTO v_prize_baja FROM raffle_prizes WHERE edition_id = ed AND name = 'RS Premio Baja' LIMIT 1;
  SELECT id INTO v_prize_mayor FROM raffle_prizes WHERE edition_id = ed AND name = 'RS Premio Mayor' LIMIT 1;
  SELECT id INTO v_prize_inactive FROM raffle_prizes WHERE edition_id = ed AND name = 'RS Premio Inactivo' LIMIT 1;
  SELECT id INTO v_prize_chain FROM raffle_prizes WHERE edition_id = ed AND name = 'RS Premio Cadena' LIMIT 1;
  SELECT id INTO v_prize_pending FROM raffle_prizes WHERE edition_id = ed AND name = 'RS Premio Pending' LIMIT 1;
  -- P1: 2 academic + 1 leadership = no group; P2: 4+1 = Mayor; P3: 3+0 = Baja; P4: 3+0 = Baja
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id) VALUES (ed, 'rs.p1@test.invalid', 'P1 Prueba', '2008-01-01', 'manual', true, p1u) ON CONFLICT (edition_id, email) DO NOTHING;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id) VALUES (ed, 'rs.p2@test.invalid', 'P2 Prueba', '2008-01-02', 'forms', true, p2u) ON CONFLICT (edition_id, email) DO NOTHING;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id) VALUES (ed, 'rs.p3@test.invalid', 'P3 Prueba', '2008-01-03', 'forms', true, p3u) ON CONFLICT (edition_id, email) DO NOTHING;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id) VALUES (ed, 'rs.p4@test.invalid', 'P4 Prueba', '2008-01-04', 'forms', true, p4u) ON CONFLICT (edition_id, email) DO NOTHING;
  SELECT id INTO v_p1 FROM participants WHERE email = 'rs.p1@test.invalid';
  SELECT id INTO v_p2 FROM participants WHERE email = 'rs.p2@test.invalid';
  SELECT id INTO v_p3 FROM participants WHERE email = 'rs.p3@test.invalid';
  SELECT id INTO v_p4 FROM participants WHERE email = 'rs.p4@test.invalid';
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (v_p1, p1u, 'P1 Prueba') ON CONFLICT (participant_id) DO UPDATE SET display_name = 'P1 Prueba';
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (v_p2, p2u, 'P2 Prueba') ON CONFLICT (participant_id) DO UPDATE SET display_name = 'P2 Prueba';
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (v_p3, p3u, 'P3 Prueba') ON CONFLICT (participant_id) DO UPDATE SET display_name = 'P3 Prueba';
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (v_p4, p4u, 'P4 Prueba') ON CONFLICT (participant_id) DO UPDATE SET display_name = 'P4 Prueba';
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p1, v_ses_a1, v_act_a1, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p1, v_ses_a5, v_act_a5, 2, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p1, v_ses_l1, v_act_l1, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p2, v_ses_a1, v_act_a1, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p2, v_ses_a2, v_act_a2, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p2, v_ses_a3, v_act_a3, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p2, v_ses_l1, v_act_l1, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p2, v_ses_a4, v_act_a4, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p3, v_ses_a1, v_act_a1, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p3, v_ses_a2, v_act_a2, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p3, v_ses_a3, v_act_a3, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p4, v_ses_a1, v_act_a1, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p4, v_ses_a2, v_act_a2, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p4, v_ses_a4, v_act_a4, 1, 'qr') ON CONFLICT (participant_id, session_id) DO NOTHING;
  CREATE TEMP TABLE rs_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rs_steps (name, who, q, expect) VALUES
  ('tickets: 0 leadership tickets', 'X', $q$select (participant_tickets(':P3')->>'leadership_tickets')::int = 0$q$, 'TRUE'),
  ('tickets: 2 sellos = 1 ticket (no duplica)', 'X', $q$select (participant_tickets(':P1')->>'academic_tickets')::int = 2 and (SELECT count(*) FROM attendances WHERE participant_id = ':P1') = 3$q$, 'TRUE'),
  ('tickets: liderazgo cuenta separado', 'X', $q$select (participant_tickets(':P1')->>'leadership_tickets')::int = 1 and (participant_tickets(':P1')->>'academic_tickets')::int = 2$q$, 'TRUE'),
  ('cat: 2+1 = sin grupo', 'X', $q$select participant_raffle_category(':P1') IS NULL$q$, 'TRUE'),
  ('cat: P2 4+1 = Mayor', 'X', $q$select participant_raffle_category(':P2') = ':CAT_MAYOR'$q$, 'TRUE'),
  ('cat: P3 3+0 = Baja', 'X', $q$select participant_raffle_category(':P3') = ':CAT_BAJA'$q$, 'TRUE'),
  ('cat: P4 3+0 = Baja', 'X', $q$select participant_raffle_category(':P4') = ':CAT_BAJA'$q$, 'TRUE'),
  ('cat: Baja existe demo', 'X', $q$select count(*) = 1 from raffle_categories where edition_id = ':ED' and name = 'Baja' and is_demo$q$, 'TRUE'),
  ('cat: Baja existe real', 'X', $q$select count(*) = 1 from raffle_categories where edition_id = ':ED' and name = 'Baja' and not is_demo$q$, 'TRUE'),
  ('cat: Mayor existe real', 'X', $q$select count(*) = 1 from raffle_categories where edition_id = ':ED' and name = 'Mayor' and not is_demo$q$, 'TRUE'),
  ('rol: sorteo ve categorias', 'R', $q$select jsonb_array_length(raffle_categories_read()) > 0$q$, 'OK'),
  ('rol: staff no sortea', 'S', $q$select draw_winner(':PRIZE_BAJA', 'test-key-staff')$q$, 'ERR:NOT_AUTHORIZED'),
  ('helper: participant_tickets no ejecutable por auth', 'R', $q$select participant_tickets(':P1')$q$, 'ERR:permission'),
  ('helper: get_pending_winner no ejecutable por auth', 'R', $q$select get_pending_winner(':PRIZE_BAJA')$q$, 'ERR:permission'),
  ('premio: disponible qty=2', 'X', $q$select (SELECT quantity FROM raffle_prizes WHERE id = ':PRIZE_BAJA') = 2$q$, 'TRUE'),
  ('premio inactivo: draw_winner rechaza', 'R', $q$select draw_winner(':PRIZE_INACTIVE', 'rs-key-inactive')$q$, 'ERR:PRIZE_INACTIVE'),
  ('sorteo: sortear premio baja', 'R', $q$select draw_winner(':PRIZE_BAJA', 'rs-key-1') is not null$q$, 'OK'),
  ('sorteo: ganador seleccionado', 'X', $q$select count(*) = 1 from raffle_winners where prize_id = ':PRIZE_BAJA' and status = 'seleccionado'$q$, 'TRUE'),
  ('sorteo: idempotencia misma clave', 'R', $q$select (draw_winner(':PRIZE_BAJA', 'rs-key-1')->>'idempotent')::boolean = true$q$, 'OK'),
  ('sorteo: pendiente bloquea nuevo sorteo', 'R', $q$select draw_winner(':PRIZE_BAJA', 'rs-key-2')$q$, 'ERR:PENDING_SELECTION'),
  ('sorteo: confirmar ganador via sorteo', 'R', $q$select confirm_winner((raffle_pending_selection(':PRIZE_BAJA')->>'winner_id')::uuid)->>'status' = 'confirmado'$q$, 'TRUE'),
  ('sorteo: inventario descuenta', 'X', $q$select (SELECT quantity FROM raffle_prizes WHERE id = ':PRIZE_BAJA') - (SELECT count(*) FROM raffle_winners WHERE prize_id = ':PRIZE_BAJA' AND status IN ('seleccionado','confirmado')) = 1$q$, 'TRUE'),
  ('sorteo: ganador excluido de pool', 'X', $q$select count(*) = 0 from participants p where p.id = (SELECT participant_id FROM raffle_winners WHERE prize_id = ':PRIZE_BAJA' AND status = 'confirmado' LIMIT 1) and participant_raffle_category(p.id) is not null$q$, 'TRUE'),
  ('sorteo: sortear segunda unidad', 'R', $q$select draw_winner(':PRIZE_BAJA', 'rs-key-3') is not null$q$, 'OK'),
  ('sorteo: confirmar segundo ganador', 'R', $q$select confirm_winner((raffle_pending_selection(':PRIZE_BAJA')->>'winner_id')::uuid)->>'status' = 'confirmado'$q$, 'TRUE'),
  ('sorteo: premio agotado', 'R', $q$select draw_winner(':PRIZE_BAJA', 'rs-key-4')$q$, 'ERR:PRIZE_EXHAUSTED'),
  ('no-show: sortear premio mayor (P2 en pool)', 'R', $q$select draw_winner(':PRIZE_MAYOR', 'rs-key-5') is not null$q$, 'OK'),
  ('no-show: marcar no presentado via sorteo', 'R', $q$select mark_no_show((raffle_pending_selection(':PRIZE_MAYOR')->>'winner_id')::uuid)->>'status' = 'no_presentado'$q$, 'TRUE'),
  ('no-show: no cuenta como ganado', 'X', $q$select count(*) = 0 from raffle_winners where prize_id = ':PRIZE_MAYOR' and status = 'confirmado'$q$, 'TRUE'),
  ('no-show: inventario restaurado', 'X', $q$select (SELECT quantity FROM raffle_prizes WHERE id = ':PRIZE_MAYOR') - (SELECT count(*) FROM raffle_winners WHERE prize_id = ':PRIZE_MAYOR' AND status IN ('seleccionado','confirmado')) = 1$q$, 'TRUE'),
  ('no-show: P2 sigue en pool de Mayor', 'X', $q$select participant_raffle_category(':P2') = ':CAT_MAYOR'$q$, 'TRUE'),
  ('no-show: pool vacio tras no-show', 'R', $q$select draw_winner(':PRIZE_MAYOR', 'rs-key-6')$q$, 'ERR:POOL_EMPTY'),
  ('cantidad: no baja del comprometido', 'C', $q$select save_raffle_prize(jsonb_build_object('id', ':PRIZE_BAJA', 'category_id', ':CAT_BAJA', 'name', 'RS Premio Baja', 'quantity', 1, 'is_active', true, 'sort_order', 1))$q$, 'ERR:QUANTITY_BELOW_COMMITTED'),
  ('aislamiento: premio demo no se mueve a cat real', 'C', $q$select save_raffle_prize(jsonb_build_object('id', ':PRIZE_BAJA', 'category_id', ':CAT_BAJA_REAL', 'name', 'RS Premio Baja', 'quantity', 2, 'is_active', true, 'sort_order', 1))$q$, 'ERR:DEMO_REAL_MISMATCH'),
  ('invalidar: sin motivo se rechaza', 'C', $q$select invalidate_winner('00000000-0000-0000-0000-000000000000', '')$q$, 'ERR:REASON_REQUIRED'),
  ('rol: sorteo ve winners sin PII', 'R', $q$select not exists (select 1 from jsonb_array_elements(raffle_winners_read()) w where w ? 'email' or w ? 'phone' or w ? 'birth_date')$q$, 'TRUE'),
  -- No-show chain: A no-show -> B selected -> B no-show -> A eligible again
  ('cadena: sortear premio cadena (Baja: P3+P4)', 'R', $q$select draw_winner(':PRIZE_CHAIN', 'ch1') is not null$q$, 'OK'),
  ('cadena: no-show A', 'R', $q$select mark_no_show((raffle_pending_selection(':PRIZE_CHAIN')->>'winner_id')::uuid)->>'status' = 'no_presentado'$q$, 'TRUE'),
  ('cadena: A es P3 o P4', 'X', $q$select (SELECT participant_id FROM raffle_winners WHERE prize_id = ':PRIZE_CHAIN' AND status = 'no_presentado' ORDER BY drawn_at LIMIT 1) IN (':P3', ':P4')$q$, 'TRUE'),
  ('cadena: re-sorteo B', 'R', $q$select draw_winner(':PRIZE_CHAIN', 'ch2') is not null$q$, 'OK'),
  ('cadena: B != A', 'X', $q$select (SELECT participant_id FROM raffle_winners WHERE prize_id = ':PRIZE_CHAIN' AND status = 'seleccionado' LIMIT 1) <> (SELECT participant_id FROM raffle_winners WHERE prize_id = ':PRIZE_CHAIN' AND status = 'no_presentado' ORDER BY drawn_at LIMIT 1)$q$, 'TRUE'),
  ('cadena: no-show B', 'R', $q$select mark_no_show((raffle_pending_selection(':PRIZE_CHAIN')->>'winner_id')::uuid)->>'status' = 'no_presentado'$q$, 'TRUE'),
  ('cadena: A vuelve a ser elegible', 'X', $q$select participant_raffle_category((SELECT participant_id FROM raffle_winners WHERE prize_id = ':PRIZE_CHAIN' AND status = 'no_presentado' ORDER BY drawn_at LIMIT 1)) = ':CAT_BAJA'$q$, 'TRUE'),
  ('cadena: tercer sorteo exitoso (A o B en pool)', 'R', $q$select draw_winner(':PRIZE_CHAIN', 'ch3') is not null$q$, 'OK'),
  -- Pending selection recovery
  ('pending: sortear premio pending', 'R', $q$select draw_winner(':PRIZE_PENDING', 'pk1') is not null$q$, 'OK'),
  ('pending: recuperacion tiene display_name', 'R', $q$select raffle_pending_selection(':PRIZE_PENDING') ? 'display_name'$q$, 'TRUE'),
  ('pending: recuperacion tiene prize_name', 'R', $q$select raffle_pending_selection(':PRIZE_PENDING') ? 'prize_name'$q$, 'TRUE');
  FOR st IN SELECT * FROM rs_steps ORDER BY seq LOOP
    v_q := st.q;
    v_q := replace(v_q, ':ED', ed::text);
    v_q := replace(v_q, ':P1', v_p1::text); v_q := replace(v_q, ':P2', v_p2::text); v_q := replace(v_q, ':P3', v_p3::text); v_q := replace(v_q, ':P4', v_p4::text);
    -- Replace CAT_BAJA_REAL BEFORE CAT_BAJA to avoid partial replacement
    v_q := replace(v_q, ':CAT_BAJA_REAL', v_cat_baja_real::text);
    v_q := replace(v_q, ':CAT_BAJA', v_cat_baja::text); v_q := replace(v_q, ':CAT_MEDIA', v_cat_media::text); v_q := replace(v_q, ':CAT_MAYOR', v_cat_mayor::text);
    v_q := replace(v_q, ':PRIZE_BAJA', v_prize_baja::text); v_q := replace(v_q, ':PRIZE_MAYOR', v_prize_mayor::text); v_q := replace(v_q, ':PRIZE_INACTIVE', v_prize_inactive::text);
    v_q := replace(v_q, ':PRIZE_CHAIN', v_prize_chain::text); v_q := replace(v_q, ':PRIZE_PENDING', v_prize_pending::text);
    PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', 'null', true);
    IF st.who = 'C' THEN PERFORM set_config('role', 'authenticated', true); PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    ELSIF st.who = 'S' THEN PERFORM set_config('role', 'authenticated', true); PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
    ELSIF st.who = 'R' THEN PERFORM set_config('role', 'authenticated', true); PERFORM set_config('request.jwt.claims', json_build_object('sub', r, 'role', 'authenticated')::text, true);
    END IF;
    BEGIN EXECUTE v_q INTO v_last; v_err := NULL;
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; v_last := 'null';
    END;
    v_ok := false;
    IF st.expect = 'OK' AND v_err IS NULL THEN v_ok := true;
    ELSIF st.expect = 'TRUE' AND v_err IS NULL AND v_last IN ('t', 'true') THEN v_ok := true;
    ELSIF st.expect LIKE 'ERR:%' AND v_err IS NOT NULL AND position(split_part(st.expect, ':', 2) in v_err) > 0 THEN v_ok := true;
    END IF;
    IF v_ok THEN v_pass := v_pass + 1; v_res := v_res || format('  OK  | %s', st.name);
    ELSE v_fail := v_fail + 1; v_res := v_res || format(' FAIL | %s (expected %s, got %s, last=%s)', st.name, st.expect, COALESCE(v_err, 'OK'), v_last);
    END IF;
  END LOOP;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', 'null', true);
  DELETE FROM raffle_winners WHERE prize_id IN (v_prize_baja, v_prize_mayor, v_prize_inactive, v_prize_chain, v_prize_pending);
  DELETE FROM raffle_prizes WHERE id IN (v_prize_baja, v_prize_mayor, v_prize_inactive, v_prize_chain, v_prize_pending);
  DELETE FROM attendances WHERE participant_id IN (v_p1, v_p2, v_p3, v_p4);
  DELETE FROM participant_profiles WHERE participant_id IN (v_p1, v_p2, v_p3, v_p4);
  DELETE FROM participants WHERE id IN (v_p1, v_p2, v_p3, v_p4);
  DELETE FROM activity_sessions WHERE activity_id IN (v_act_a1, v_act_a2, v_act_a3, v_act_a4, v_act_a5, v_act_l1);
  DELETE FROM activities WHERE id IN (v_act_a1, v_act_a2, v_act_a3, v_act_a4, v_act_a5, v_act_l1);
  DELETE FROM staff_roles WHERE user_id IN (c, s, r);
  DELETE FROM staff_members WHERE user_id IN (c, s, r);
  DELETE FROM auth.users WHERE id IN (c, s, r, n, t, p1u, p2u, p3u, p4u);
  RAISE EXCEPTION '%', 'RAFFLE REGRESSION: ' || v_pass || ' passed, ' || v_fail || ' failed' || chr(10) || array_to_string(v_res, chr(10));
END $test$;
