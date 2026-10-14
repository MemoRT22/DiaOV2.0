-- Regresión de folio y premios del alumno (`my_raffle_prizes`, `raffle_winner_folios`). Base local/descartable; fixtures DEMO; todo
-- termina con ROLLBACK. Éxito: la sentencia aborta con RAFFLE_FOLIO_OK (cualquier otro mensaje es un fallo).
BEGIN;
CREATE FUNCTION pg_temp.as_user(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',p_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','',true);
  RETURN answer;
END $f$;
CREATE FUNCTION pg_temp.as_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('role','anon',true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role','postgres',true);
  RETURN answer;
END $f$;
DO $test$
DECLARE
  ed uuid := active_edition_id();
  sorteo uuid := gen_random_uuid(); coord uuid := gen_random_uuid(); staff uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); ureal uuid := gen_random_uuid();
  pa uuid; pb uuid; pc uuid; preal uuid;
  cat uuid; cat_real uuid; prize uuid; prize2 uuid; prize_real uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid; wreal uuid; w_a2 uuid;
  folio1 text; folio2 text; answer text; res jsonb; pass int := 0; fail int := 0; msg text := '';
  mode_before text; act uuid; sess uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rf.'||right(u::text,6)||'@test.invalid','{}','{}',now(),now()
  FROM unnest(ARRAY[sorteo,coord,staff,ua,ub,uc,ureal]) u;
  INSERT INTO staff_members(user_id,role,full_name,is_active,email) VALUES
    (sorteo,'sorteo','RF Sorteo',true,'rf.sorteo@test.invalid'),(coord,'coordinacion','RF Coord',true,'rf.coord@test.invalid'),(staff,'staff','RF Staff',true,'rf.staff@test.invalid');
  INSERT INTO staff_roles(user_id,role) VALUES (sorteo,'sorteo'),(coord,'coordinacion'),(staff,'staff');
  -- Dos alumnos con EL MISMO NOMBRE, un tercero distinto y uno real (no DEMO).
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id) VALUES
    (ed,'rf.a@test.invalid','Valeria Méndez Castillo','demo',true,ua) RETURNING id INTO pa;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id) VALUES
    (ed,'rf.b@test.invalid','Valeria Méndez Castillo','demo',true,ub) RETURNING id INTO pb;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id) VALUES
    (ed,'rf.c@test.invalid','Otra Persona','demo',true,uc) RETURNING id INTO pc;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id) VALUES
    (ed,'rf.real@test.invalid','Valeria Méndez Castillo','forms',false,ureal) RETURNING id INTO preal;
  INSERT INTO participant_profiles(participant_id,auth_user_id,display_name) VALUES
    (pa,ua,'Valeria Méndez Castillo'),(pb,ub,'Valeria Méndez Castillo'),(pc,uc,'Otra Persona'),(preal,ureal,'Valeria Méndez Castillo')
  ON CONFLICT (participant_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  UPDATE participant_profiles pp SET platform_consent_version=e.privacy_notice_version, platform_consent_at=now()
  FROM editions e WHERE e.id=ed AND pp.participant_id IN (pa,pb,pc,preal);
  INSERT INTO raffle_categories(edition_id,name,sort_order,is_active,is_demo,rules) VALUES (ed,'RF Galaxia',99,true,true,'[{"total":1}]') RETURNING id INTO cat;
  INSERT INTO raffle_categories(edition_id,name,sort_order,is_active,is_demo,rules) VALUES (ed,'RF Galaxia real',98,true,false,'[{"total":1}]') RETURNING id INTO cat_real;
  INSERT INTO raffle_prizes(edition_id,category_id,name,quantity,is_active,is_demo) VALUES (ed,cat,'Nintendo Switch OLED',3,true,true) RETURNING id INTO prize;
  INSERT INTO raffle_prizes(edition_id,category_id,name,quantity,is_active,is_demo) VALUES (ed,cat,'Audífonos',3,true,true) RETURNING id INTO prize2;
  INSERT INTO raffle_prizes(edition_id,category_id,name,quantity,is_active,is_demo) VALUES (ed,cat_real,'Premio real',3,true,false) RETURNING id INTO prize_real;
  -- La encuesta de salida es requisito de cualquier resultado nuevo del sorteo (trigger): los cuatro la contestaron.
  INSERT INTO exit_survey_responses(edition_id,participant_id,survey_version,is_demo,q1_prior_clarity,q2_workshop_rating,q3_post_clarity,q4_areas,q5_recommend)
  SELECT ed,x.id,exit_survey_version(),x.d,'sin_idea',4,'seguir_explorando',ARRAY['salud'],8 FROM (VALUES (pa,true),(pb,true),(pc,true),(preal,false)) AS x(id,d);
  -- Mismo INSERT (sin folio) que hace draw_winner: el folio lo pone la base.
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat,prize,pa,'seleccionado','online',true) RETURNING id, folio INTO w1, folio1;
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat,prize,pb,'seleccionado','online',true) RETURNING id, folio INTO w2, folio2;
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat,prize2,pc,'no_presentado','online',true) RETURNING id INTO w3;
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat,prize2,pb,'invalidado','online',true) RETURNING id INTO w4;
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat_real,prize_real,preal,'seleccionado','online',false) RETURNING id INTO wreal;

  -- 1. Folio único, con formato, asignado por la base y distinto por resultado.
  IF folio1 ~ '^GAN-[0-9]{6,}$' AND folio2 ~ '^GAN-[0-9]{6,}$' AND folio1 <> folio2 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL formato/unicidad de folio: '||folio1||' '||folio2; END IF;
  IF (SELECT count(DISTINCT folio) = count(*) FROM raffle_winners) THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL folios repetidos'; END IF;
  -- 2. Estable: no se puede cambiar ni siquiera por el dueño de la tabla.
  answer := (SELECT CASE WHEN EXISTS (SELECT 1) THEN 'x' END);
  BEGIN UPDATE raffle_winners SET folio = 'GAN-999999' WHERE id = w1; answer := 'cambió'; EXCEPTION WHEN others THEN answer := SQLERRM; END;
  IF answer = 'FOLIO_IMMUTABLE' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL folio mutable: '||answer; END IF;
  -- Cambiar el estado no cambia el folio.
  UPDATE raffle_winners SET status = 'confirmado', confirmed_at = now() WHERE id = w2;
  IF (SELECT folio FROM raffle_winners WHERE id = w2) = folio2 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL folio cambió al confirmar'; END IF;
  UPDATE raffle_winners SET status = 'seleccionado', confirmed_at = NULL WHERE id = w2;

  -- 3. Solo el participante seleccionado ve su premio; mismo nombre ≠ mismo resultado.
  res := (pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF jsonb_array_length(res) = 1 AND res->0->>'winner_id' = w1::text AND res->0->>'folio' = folio1 AND res->0->>'status' = 'seleccionado'
     AND res->0->>'prize_name' = 'Nintendo Switch OLED' AND res->0->>'display_name' = 'Valeria Méndez Castillo' AND res->0->>'category_name' = 'RF Galaxia'
    THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL premio de A: '||res::text; END IF;
  res := (pg_temp.as_user(ub, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF jsonb_array_length(res) = 1 AND res->0->>'winner_id' = w2::text AND res->0->>'folio' = folio2 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL premio de B (invalidado oculto): '||res::text; END IF;
  res := (pg_temp.as_user(uc, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF res = '[]'::jsonb THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL no_presentado visible: '||res::text; END IF;
  -- 4. Sin datos de terceros ni ids de otros: la respuesta solo trae las llaves previstas.
  res := (pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(res->0) k) = ARRAY['category_name','confirmed_at','display_name','drawn_at','folio','prize_name','status','winner_id']
    THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL llaves inesperadas'; END IF;
  -- 5. Separación real/DEMO: el alumno real no ve el resultado DEMO ni a la inversa.
  res := (pg_temp.as_user(ureal, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF jsonb_array_length(res) = 1 AND res->0->>'winner_id' = wreal::text THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL real: '||res::text; END IF;
  -- un resultado DEMO atribuido a un alumno real (dato inconsistente) no se le muestra
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat,prize2,preal,'confirmado','online',true);
  res := (pg_temp.as_user(ureal, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF jsonb_array_length(res) = 1 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL DEMO visible a real'; END IF;
  -- 6. Estados: confirmado se ve como tal; luego no_presentado/invalidado lo retiran.
  UPDATE raffle_winners SET status = 'confirmado', confirmed_at = now() WHERE id = w1;
  res := (pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF res->0->>'status' = 'confirmado' AND res->0->>'folio' = folio1 AND res->0->>'confirmed_at' IS NOT NULL THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL confirmado'; END IF;
  UPDATE raffle_winners SET status = 'invalidado' WHERE id = w1;
  IF (pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->'prizes' = '[]'::jsonb THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL invalidado visible'; END IF;
  -- 7. Un alumno puede tener otro resultado en otro premio (orden por fecha, ambos con folio propio).
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,origin,is_demo) VALUES (ed,cat,prize2,pa,'seleccionado','online',true) RETURNING id INTO w_a2;
  res := (pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->'prizes';
  IF jsonb_array_length(res) = 1 AND res->0->>'winner_id' = w_a2::text AND res->0->>'folio' <> folio1 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL segundo resultado'; END IF;
  -- 8. Permisos: anon, Staff y Sorteo no son participantes; el alumno no escribe ni lee la tabla.
  IF pg_temp.as_anon('select my_raffle_prizes()::text') LIKE 'ERR:%' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL anon'; END IF;
  IF pg_temp.as_user(staff, 'select my_raffle_prizes()::text') LIKE 'ERR:%' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL staff'; END IF;
  IF pg_temp.as_user(ua, 'select count(*) from raffle_winners') LIKE 'ERR:permission denied%' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL tabla legible'; END IF;
  IF pg_temp.as_user(ua, format('update raffle_winners set status=%L where id=%L','confirmado',w_a2)) LIKE 'ERR:%' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL alumno escribe'; END IF;
  IF pg_temp.as_user(ua, format('select raffle_winner_folios(array[%L]::uuid[])::text',w_a2)) = 'ERR:NOT_AUTHORIZED' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL alumno consulta folios'; END IF;
  IF pg_temp.as_user(staff, format('select raffle_winner_folios(array[%L]::uuid[])::text',w_a2)) = 'ERR:NOT_AUTHORIZED' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL staff consulta folios'; END IF;
  -- 9. El panel (Sorteo/Coordinación) ve el MISMO folio; el panel de Sorteo solo el conjunto de su modo.
  SELECT mode INTO mode_before FROM editions WHERE id = ed;
  UPDATE editions SET mode = 'preparacion' WHERE id = ed;
  res := (pg_temp.as_user(sorteo, format('select raffle_winner_folios(array[%L,%L,%L]::uuid[])::text', w_a2, w2, wreal)))::jsonb;
  IF jsonb_array_length(res) = 2 AND (SELECT folio FROM jsonb_to_recordset(res) AS x(winner_id uuid, folio text) WHERE winner_id = w2) = folio2
     AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(res) AS x(winner_id uuid, folio text) WHERE winner_id = wreal)
    THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL folios del panel de sorteo: '||res::text; END IF;
  res := (pg_temp.as_user(coord, format('select raffle_winner_folios(array[%L,%L]::uuid[])::text', w2, wreal)))::jsonb;
  IF jsonb_array_length(res) = 2 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL folios de coordinación'; END IF;
  UPDATE editions SET mode = mode_before WHERE id = ed;
  -- el folio del alumno y el del panel son el mismo
  IF (pg_temp.as_user(ub, 'select my_raffle_prizes()::text'))::jsonb->'prizes'->0->>'folio' = folio2 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL folio alumno ≠ panel'; END IF;
  -- 10. Solo lectura: consultar no cambia el estado.
  IF (SELECT status FROM raffle_winners WHERE id = w2) = 'seleccionado' THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL la lectura cambió el estado'; END IF;
  IF NOT has_function_privilege('anon','public.my_raffle_prizes()','EXECUTE') AND NOT has_function_privilege('anon','public.raffle_winner_folios(uuid[])','EXECUTE') THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL privilegios'; END IF;

  -- 11. Cadencia que dicta el servidor (`poll_seconds`): sin carga continua mientras se explora.
  -- A tiene un resultado pendiente → 15 s.
  IF ((pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 15 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll pendiente'; END IF;
  -- C no tiene resultado propio vigente: con sorteo en curso (hay ganadores recientes) y sin categoría → 120 s.
  IF ((pg_temp.as_user(uc, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 120 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll en vivo sin categoría: '||coalesce(pg_temp.as_user(uc, 'select my_raffle_prizes()::text'),'null'); END IF;
  -- Sin sorteo en curso (nada reciente) y sin asistencias → latido de recuperación de 600 s: NUNCA null, nunca «sin consultar».
  UPDATE raffle_winners SET drawn_at = now() - interval '3 hours' WHERE edition_id = ed;
  IF ((pg_temp.as_user(uc, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 600 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll idle sin asistencias'; END IF;
  -- Con asistencias, sin sorteo en curso y SIN categoría todavía → latido lento de 300 s.
  INSERT INTO activities(edition_id,title,is_demo) VALUES (ed,'RF Taller',true) RETURNING id INTO act;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,is_demo,status) VALUES (act,now(),now()+interval '30 min',5,true,'activa') RETURNING id INTO sess;
  INSERT INTO attendances(participant_id,session_id,activity_id,method) VALUES (pc,sess,act,'qr');
  -- (la categoría de prueba no pide sellos de este tipo: se desactiva un momento para aislar el caso «asistencias sin categoría»)
  UPDATE raffle_categories SET is_active = false WHERE id = cat;
  IF ((pg_temp.as_user(uc, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 300 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll idle con asistencias sin categoría: '||coalesce(pg_temp.as_user(uc, 'select my_raffle_prizes()::text'),'null'); END IF;
  -- Con asistencias y en una categoría, sin sorteo en curso → latido de 180 s (acota cuándo se entera de que empezó).
  UPDATE raffle_categories SET is_active = true WHERE id = cat;
  IF ((pg_temp.as_user(uc, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 180 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll idle en categoría: '||coalesce(pg_temp.as_user(uc, 'select my_raffle_prizes()::text'),'null'); END IF;
  -- El paso de «sin asistencias» a «con asistencias» cambia la cadencia (600 → 180) sin más que volver a preguntar; y cuando empieza el sorteo
  -- (aparece un ganador reciente) esa misma persona pasa a 20 s.
  UPDATE raffle_winners SET drawn_at = now() WHERE id = w2;
  IF ((pg_temp.as_user(uc, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 20 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll al empezar el sorteo: '||coalesce(pg_temp.as_user(uc, 'select my_raffle_prizes()::text'),'null'); END IF;
  UPDATE raffle_winners SET drawn_at = now() - interval '3 hours' WHERE id = w2;
  -- Un pendiente propio sigue en 15 s aunque el sorteo ya no sea reciente (para ver pronto la confirmación).
  IF ((pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int = 15 THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll pendiente (sin sorteo reciente)'; END IF;
  -- Una persona con resultado ya entregado (y sus asistencias, como toda ganadora real) no se consulta rápido.
  INSERT INTO attendances(participant_id,session_id,activity_id,method) VALUES (pa,sess,act,'qr');
  UPDATE raffle_winners SET status = 'confirmado', confirmed_at = now() WHERE id = w_a2;
  IF ((pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb->>'poll_seconds')::int IN (180, 300) THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll tras entrega'; END IF;
  -- Ninguna respuesta trae poll_seconds nulo.
  IF NOT EXISTS (SELECT 1 FROM unnest(ARRAY[ua,ub,uc,ureal]) u WHERE (pg_temp.as_user(u, 'select my_raffle_prizes()::text'))::jsonb->'poll_seconds' = 'null'::jsonb) THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL poll nulo'; END IF;
  -- La respuesta solo trae las dos llaves previstas.
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((pg_temp.as_user(ua, 'select my_raffle_prizes()::text'))::jsonb) k) = ARRAY['poll_seconds','prizes'] THEN pass:=pass+1; ELSE fail:=fail+1; msg:=msg||E'\nFAIL llaves de la respuesta'; END IF;

  IF fail = 0 THEN RAISE EXCEPTION E'RAFFLE_FOLIO_OK: % passed, 0 failed', pass;
  ELSE RAISE EXCEPTION E'RAFFLE_FOLIO_FAILED: % passed, % failed%', pass, fail, msg; END IF;
END
$test$;
ROLLBACK;
