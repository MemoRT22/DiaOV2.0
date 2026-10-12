-- Regresión del CRUD administrativo completo (talleres, alumnos, divisiones) y del tipo de misión en el tablero del
-- alumno. Ejecutar con psql -v ON_ERROR_STOP=1 en una base local/descartable. Todo ocurre dentro de una transacción
-- que termina con ROLLBACK. Éxito: ADMIN_CRUD_OK, salida 0.
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
CREATE FUNCTION pg_temp.as_role(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('role',p_role,true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role','postgres',true);
  RETURN answer;
END $f$;
-- Ejecuta como propietario (lo que hace service_role desde la Edge Function) y devuelve 'ERR:<mensaje>' si falla.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  EXECUTE p_sql INTO answer;
  RETURN answer;
EXCEPTION WHEN others THEN RETURN 'ERR:' || SQLERRM;
END $f$;
-- Ninguna fila dependiente puede quedar apuntando a algo que ya no existe (las FK lo impiden; se comprueba igual).
CREATE FUNCTION pg_temp.orphans() RETURNS int LANGUAGE sql AS $f$
  SELECT (SELECT count(*) FROM activity_sessions s WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = s.activity_id))
       + (SELECT count(*) FROM reservations r WHERE NOT EXISTS (SELECT 1 FROM activity_sessions s WHERE s.id = r.session_id)
            OR NOT EXISTS (SELECT 1 FROM participants p WHERE p.id = r.participant_id))
       + (SELECT count(*) FROM attendances t WHERE NOT EXISTS (SELECT 1 FROM activity_sessions s WHERE s.id = t.session_id)
            OR NOT EXISTS (SELECT 1 FROM participants p WHERE p.id = t.participant_id))
       + (SELECT count(*) FROM activity_credentials c WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = c.activity_id))
       + (SELECT count(*) FROM activity_careers c WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = c.activity_id)
            OR NOT EXISTS (SELECT 1 FROM careers k WHERE k.id = c.career_id))
       + (SELECT count(*) FROM activity_divisions d WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = d.activity_id)
            OR NOT EXISTS (SELECT 1 FROM divisions v WHERE v.id = d.division_id))
       + (SELECT count(*) FROM workshop_submission_careers c WHERE NOT EXISTS (SELECT 1 FROM workshop_submissions w WHERE w.id = c.submission_id)
            OR NOT EXISTS (SELECT 1 FROM careers k WHERE k.id = c.career_id))
       + (SELECT count(*) FROM workshop_submissions w WHERE (w.status = 'published') IS DISTINCT FROM (w.published_activity_id IS NOT NULL)
            OR (w.published_activity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = w.published_activity_id)))
       + (SELECT count(*) FROM workshop_submissions w WHERE w.activity_type = 'academica' AND w.status <> 'draft'
            AND NOT EXISTS (SELECT 1 FROM workshop_submission_careers c WHERE c.submission_id = w.id))
       + (SELECT count(*) FROM careers k WHERE NOT EXISTS (SELECT 1 FROM divisions v WHERE v.id = k.division_id))
       + (SELECT count(*) FROM participants p WHERE p.initial_career_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers k WHERE k.id = p.initial_career_id))
       + (SELECT count(*) FROM participants p WHERE p.initial_career_id IS DISTINCT FROM
            (SELECT career_id FROM initial_interests i WHERE i.participant_id = p.id AND i.preference = 1)
            AND EXISTS (SELECT 1 FROM initial_interests i WHERE i.participant_id = p.id))
       + (SELECT count(*) FROM initial_interests i WHERE i.preference = 2 AND NOT EXISTS (SELECT 1 FROM initial_interests o WHERE o.participant_id = i.participant_id AND o.preference = 1))
       + (SELECT count(*) FROM post_event_interests i WHERE i.preference > 1 AND NOT EXISTS (SELECT 1 FROM post_event_interests o WHERE o.participant_id = i.participant_id AND o.preference = i.preference - 1))
       + (SELECT count(*) FROM raffle_winners w WHERE NOT EXISTS (SELECT 1 FROM participants p WHERE p.id = w.participant_id))
       + (SELECT count(*) FROM participant_profiles pp WHERE NOT EXISTS (SELECT 1 FROM participants p WHERE p.id = pp.participant_id));
$f$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  coord uuid := gen_random_uuid(); staff uuid := gen_random_uuid(); staff_linked uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  pa uuid; pb uuid; pc uuid; p_manual uuid; p_empty uuid; p_staff uuid;
  div_a uuid; div_b uuid; div_empty uuid; car_a1 uuid; car_a2 uuid; car_b1 uuid; other_career uuid;
  academic jsonb; life jsonb;
  w_pending uuid; w_pub uuid; w_life uuid; w_arch uuid; w_only_a uuid; w_multi uuid;
  act_pub uuid; act_life uuid; act_only_a uuid; act_multi uuid;
  ses uuid; ses_life uuid; ses_only_a uuid; cred jsonb;
  answer text; result jsonb; preview jsonb; board jsonb;
  cat uuid; prize uuid; n int; baseline_orphans int; careers_elsewhere int; divisions_before int;
BEGIN
  baseline_orphans := pg_temp.orphans();
  SELECT count(*) INTO divisions_before FROM divisions;

  -- Personal: Coordinación, Staff y una cuenta de Staff que alguien vinculó por error a un participante.
  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES (coord,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crud.coord@test.invalid','{}','{}',now(),now()),
         (staff,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crud.staff@test.invalid','{}','{}',now(),now()),
         (staff_linked,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crud.staff2@test.invalid','{}','{}',now(),now()),
         (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crud.a@test.invalid','{"kind":"participant"}','{}',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crud.b@test.invalid','{"kind":"participant"}','{}',now(),now()),
         (uc,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crud.c@test.invalid','{"kind":"participant"}','{}',now(),now());
  INSERT INTO staff_members(user_id,role,full_name,is_active,email)
  VALUES (coord,'coordinacion','CRUD Coord',true,'crud.coord@test.invalid'),
         (staff,'staff','CRUD Staff',true,'crud.staff@test.invalid'),
         (staff_linked,'staff','CRUD Staff vinculado',true,'crud.staff2@test.invalid');
  INSERT INTO staff_roles(user_id,role) VALUES (coord,'coordinacion'),(staff,'staff'),(staff_linked,'staff');

  -- ===================================================================================================================
  -- DIVISIONES: crear, editar, consultar
  -- ===================================================================================================================
  answer := pg_temp.as_user(coord, $q$select save_division('{"code": "ZZ-CRUD-A", "name": "CRUD División A", "sort_order": 901}')$q$);
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'DIVISION_CREATE[%]', answer; END IF;
  div_a := answer::uuid;
  div_b := pg_temp.as_user(coord, $q$select save_division('{"code": "ZZ-CRUD-B", "name": "CRUD División B", "sort_order": 902}')$q$)::uuid;
  div_empty := pg_temp.as_user(coord, $q$select save_division('{"code": "ZZ-CRUD-E", "name": "CRUD Vacía", "sort_order": 903}')$q$)::uuid;
  answer := pg_temp.as_user(coord, format($q$select save_division('{"id": "%s", "code": "ZZ-CRUD-E", "name": "CRUD Vacía editada", "sort_order": 904}')$q$, div_empty));
  IF answer LIKE 'ERR:%' OR (SELECT name FROM divisions WHERE id = div_empty) <> 'CRUD Vacía editada' THEN RAISE EXCEPTION 'DIVISION_EDIT[%]', answer; END IF;
  car_a1 := pg_temp.as_user(coord, format($q$select save_career('{"code": "ZZ-A1", "name": "CRUD Carrera A1", "division_id": "%s"}')$q$, div_a))::uuid;
  car_a2 := pg_temp.as_user(coord, format($q$select save_career('{"code": "ZZ-A2", "name": "CRUD Carrera A2", "division_id": "%s"}')$q$, div_a))::uuid;
  car_b1 := pg_temp.as_user(coord, format($q$select save_career('{"code": "ZZ-B1", "name": "CRUD Carrera B1", "division_id": "%s"}')$q$, div_b))::uuid;
  SELECT c.id INTO other_career FROM careers c JOIN divisions d ON d.id = c.division_id
  WHERE c.is_active AND NOT c.is_demo AND NOT d.is_demo AND d.id NOT IN (div_a, div_b) ORDER BY c.id LIMIT 1;
  SELECT count(*) INTO careers_elsewhere FROM careers WHERE division_id NOT IN (div_a, div_b, div_empty);

  -- ===================================================================================================================
  -- ALUMNOS: alta manual, edición, vista previa
  -- ===================================================================================================================
  -- Tres participantes «de prueba» con cuenta de acceso, como los que llegan por autorregistro.
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id,password_configured_at)
  VALUES (ed,'crud.a@test.invalid','CRUD Alumno A','self_service',false,ua,now()) RETURNING id INTO pa;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id,password_configured_at)
  VALUES (ed,'crud.b@test.invalid','CRUD Alumno B','self_service',false,ub,now()) RETURNING id INTO pb;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id,password_configured_at)
  VALUES (ed,'crud.c@test.invalid','CRUD Alumno C','self_service',false,uc,now()) RETURNING id INTO pc;
  UPDATE participant_profiles pp SET platform_consent_version=e.privacy_notice_version,platform_consent_at=now()
  FROM participants p JOIN editions e ON e.id=p.edition_id WHERE pp.participant_id=p.id AND p.email LIKE 'crud.%@test.invalid';

  -- Alta manual: solo Coordinación.
  answer := pg_temp.as_user(staff, $q$select admin_create_participant('{"email": "crud.manual@test.invalid", "full_name": "CRUD Manual"}')$q$);
  IF answer <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'MANUAL_CREATE_BY_STAFF[%]', answer; END IF;
  IF pg_temp.as_role('anon', $q$select admin_create_participant('{"email": "x@test.invalid", "full_name": "Anon"}')$q$) NOT LIKE 'ERR:permission denied%'
  THEN RAISE EXCEPTION 'MANUAL_CREATE_BY_ANON'; END IF;
  answer := pg_temp.as_user(coord, format($q$select admin_create_participant('{"email": "  CRUD.Manual@Test.invalid ", "full_name": "  CRUD   Manual  ", "phone": "9981234567", "high_school_grade": "3", "entry_period": "2027-08", "initial_career_id": "%s"}')$q$, car_a1));
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'MANUAL_CREATE[%]', answer; END IF;
  p_manual := answer::uuid;
  IF NOT EXISTS (SELECT 1 FROM participants WHERE id = p_manual AND email = 'crud.manual@test.invalid' AND full_name = 'CRUD Manual'
       AND origin = 'manual' AND NOT is_demo AND created_by = coord AND auth_user_id IS NULL AND password_configured_at IS NULL
       AND initial_career_id = car_a1 AND manual_overrides ?& ARRAY['full_name','phone','high_school_grade','entry_period','initial_career_id'])
     OR NOT EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = p_manual AND preference = 1 AND career_id = car_a1)
  THEN RAISE EXCEPTION 'MANUAL_CREATE_ROW'; END IF;
  -- El Aviso de Privacidad NO se da por aceptado: ni consentimiento manual ni de plataforma.
  IF EXISTS (SELECT 1 FROM participants WHERE id = p_manual AND (manual_consent_at IS NOT NULL OR forms_consent IS NOT NULL))
     OR EXISTS (SELECT 1 FROM participant_profiles WHERE participant_id = p_manual AND platform_consent_at IS NOT NULL)
  THEN RAISE EXCEPTION 'MANUAL_CREATE_ASSUMED_CONSENT'; END IF;
  -- Entra por el flujo normal: el correo queda como «configura tu contraseña».
  IF participant_access_state_internal('crud.manual@test.invalid') <> 'password_setup' THEN RAISE EXCEPTION 'MANUAL_ACCESS_STATE'; END IF;
  -- Sin duplicados: mismo correo, o un correo anterior (alias) de otra persona.
  answer := pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "crud.manual@test.invalid", "full_name": "Otro Nombre"}')$q$);
  IF answer <> 'ERR:EMAIL_EXISTS' THEN RAISE EXCEPTION 'MANUAL_DUPLICATE[%]', answer; END IF;
  answer := pg_temp.as_user(coord, format($q$select update_participant(%L, '{"email": "crud.manual.nuevo@test.invalid", "email_reason": "correo corregido"}')$q$, p_manual));
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'MANUAL_EDIT[%]', answer; END IF;
  answer := pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "crud.manual@test.invalid", "full_name": "Otro Nombre"}')$q$);
  IF answer <> 'ERR:EMAIL_EXISTS' THEN RAISE EXCEPTION 'MANUAL_ALIAS_DUPLICATE[%]', answer; END IF;
  -- Validaciones.
  IF pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "no-es-correo", "full_name": "CRUD X"}')$q$) <> 'ERR:INVALID_EMAIL'
     OR pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "crud.x@test.invalid", "full_name": "A"}')$q$) <> 'ERR:INVALID_NAME'
     OR pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "crud.x@test.invalid", "full_name": "CRUD X", "high_school_grade": "9"}')$q$) <> 'ERR:INVALID_GRADE'
     OR pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "crud.x@test.invalid", "full_name": "CRUD X", "initial_career_id": "00000000-0000-4000-8000-000000000000"}')$q$) <> 'ERR:INVALID_CAREER'
  THEN RAISE EXCEPTION 'MANUAL_VALIDATION'; END IF;
  -- Alta mínima (solo correo y nombre).
  p_empty := pg_temp.as_user(coord, $q$select admin_create_participant('{"email": "crud.minimo@test.invalid", "full_name": "CRUD Mínimo"}')$q$)::uuid;
  -- Participante vinculado por error a una cuenta de Staff.
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id,password_configured_at)
  VALUES (ed,'crud.vinculado@test.invalid','CRUD Vinculado a Staff','forms',false,staff_linked,now()) RETURNING id INTO p_staff;

  -- ===================================================================================================================
  -- TALLERES: crear (pendiente y publicado), consultar, editar
  -- ===================================================================================================================
  academic := jsonb_build_object(
    'facilitator_name','CRUD Responsable','facilitator_email','crud.fac@test.invalid',
    'activity_type','academica','experience_category',null,
    'title','CRUD Taller académico','student_pitch','Descripción para el alumno.',
    'objective','Aprender algo nuevo.','takeaway','Una experiencia concreta.',
    'keywords',jsonb_build_array('prueba','crud','taller'),
    'session_duration_minutes',60,'capacity_per_session',20,
    'building','Edificio A','room_space','Aula 1','requirements',null,'notes',null,
    'career_ids',jsonb_build_array(car_b1));
  life := academic || jsonb_build_object('activity_type','vida_universitaria','experience_category','deportiva',
    'title','CRUD Vida Universitaria','session_duration_minutes',30,'career_ids','[]'::jsonb) - 'objective';

  IF pg_temp.try(format('select workshop_admin_create_internal(%L, %L::jsonb, false)::text', staff, academic)) <> 'ERR:NOT_AUTHORIZED'
  THEN RAISE EXCEPTION 'WORKSHOP_CREATE_BY_STAFF'; END IF;
  IF pg_temp.as_user(coord, format('select workshop_admin_create_internal(%L, %L::jsonb, false)', coord, academic)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select workshop_admin_delete_internal(%L, %L)', coord, gen_random_uuid())) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select workshop_delete_cascade_internal(%L, null)', gen_random_uuid())) NOT LIKE 'ERR:permission denied%'
  THEN RAISE EXCEPTION 'WORKSHOP_INTERNALS_EXPOSED'; END IF;
  -- Académico pendiente.
  result := workshop_admin_create_internal(coord, academic || jsonb_build_object('title','CRUD Pendiente'), false);
  w_pending := (result->>'submission_id')::uuid;
  IF result->>'status' <> 'submitted' OR (SELECT status FROM workshop_submissions WHERE id = w_pending) <> 'submitted'
     OR NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'workshop_submission.created_by_admin' AND actor_user_id = coord AND detail->>'submission_id' = w_pending::text)
  THEN RAISE EXCEPTION 'WORKSHOP_CREATE_PENDING[%]', result; END IF;
  -- Académico creado y publicado en un paso.
  result := workshop_admin_create_internal(coord, academic, true);
  w_pub := (result->>'submission_id')::uuid; act_pub := (result->>'activity_id')::uuid;
  IF result->>'status' <> 'published' OR act_pub IS NULL
     OR (SELECT count(*) FROM activity_sessions WHERE activity_id = act_pub) <> 2
     OR NOT EXISTS (SELECT 1 FROM activity_credentials WHERE activity_id = act_pub)
     OR (SELECT activity_type FROM activities WHERE id = act_pub) <> 'academica'
  THEN RAISE EXCEPTION 'WORKSHOP_CREATE_PUBLISHED[%]', result; END IF;
  -- Vida Universitaria creada y publicada (sin carreras ni división).
  result := workshop_admin_create_internal(coord, life, true);
  w_life := (result->>'submission_id')::uuid; act_life := (result->>'activity_id')::uuid;
  IF result->>'status' <> 'published'
     OR NOT EXISTS (SELECT 1 FROM activities WHERE id = act_life AND activity_type = 'vida_universitaria' AND experience_category = 'deportiva' AND division_id IS NULL)
     OR EXISTS (SELECT 1 FROM activity_divisions WHERE activity_id = act_life)
  THEN RAISE EXCEPTION 'WORKSHOP_CREATE_LIFE[%]', result; END IF;
  -- Si la publicación falla, no queda un alta a medias.
  n := (SELECT count(*) FROM workshop_submissions);
  IF pg_temp.try(format('select workshop_admin_create_internal(%L, %L::jsonb, true)::text', coord, academic || jsonb_build_object('career_ids', jsonb_build_array(gen_random_uuid())))) <> 'ERR:INVALID_CAREER'
     OR (SELECT count(*) FROM workshop_submissions) <> n
  THEN RAISE EXCEPTION 'WORKSHOP_CREATE_ATOMIC'; END IF;
  -- Editar (pendiente y publicado) sigue por el camino existente.
  PERFORM workshop_admin_edit_internal(coord, w_pending, academic || jsonb_build_object('title','CRUD Pendiente editado'));
  PERFORM workshop_admin_edit_internal(coord, w_life, life || jsonb_build_object('title','CRUD Vida Universitaria editada','experience_category','liderazgo'));
  IF (SELECT title FROM workshop_submissions WHERE id = w_pending) <> 'CRUD Pendiente editado'
     OR NOT EXISTS (SELECT 1 FROM activities WHERE id = act_life AND title = 'CRUD Vida Universitaria editada' AND experience_category = 'liderazgo')
  THEN RAISE EXCEPTION 'WORKSHOP_EDIT'; END IF;
  -- Descartado.
  w_arch := (workshop_admin_create_internal(coord, academic || jsonb_build_object('title','CRUD Descartado'), false)->>'submission_id')::uuid;
  PERFORM workshop_review_transition_internal(coord, w_arch, 'archive', NULL, NULL);

  -- Datos de prueba sobre el taller publicado: reservaciones, asistencias con sellos (check_in real) y sorteo.
  SELECT id INTO ses FROM activity_sessions WHERE activity_id = act_pub ORDER BY starts_at LIMIT 1;
  SELECT id INTO ses_life FROM activity_sessions WHERE activity_id = act_life ORDER BY starts_at LIMIT 1;
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (pa,ses,act_pub),(pb,ses,act_pub),(pa,ses_life,act_life),(pc,ses_life,act_life);
  cred := jsonb_build_object('qr_token', (SELECT pgp_sym_decrypt(qr_token_encrypted, credential_encryption_key()) FROM activity_credentials WHERE activity_id = act_pub));
  answer := pg_temp.as_user(ua, format('select check_in(%L)', cred->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 2 THEN RAISE EXCEPTION 'FIXTURE_CHECKIN[%]', answer; END IF;
  answer := pg_temp.as_user(ua, format('select check_in(%L)', (SELECT pgp_sym_decrypt(qr_token_encrypted, credential_encryption_key()) FROM activity_credentials WHERE activity_id = act_life)));
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'FIXTURE_CHECKIN_LIFE[%]', answer; END IF;
  IF my_stamp_count(pa) <> 3 THEN RAISE EXCEPTION 'FIXTURE_STAMPS[%]', my_stamp_count(pa); END IF;

  -- El tablero del alumno expone el tipo oficial y la categoría, también sin división.
  board := pg_temp.as_user(ua, 'select my_reservation_board()')::jsonb;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(board->'sessions') s WHERE s->>'activity_id' = act_life::text
       AND s->>'activity_type' = 'vida_universitaria' AND s->>'experience_category' = 'liderazgo' AND s->>'division_id' IS NULL
       AND jsonb_array_length(s->'division_ids') = 0)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(board->'sessions') s WHERE s->>'activity_id' = act_pub::text
       AND s->>'activity_type' = 'academica' AND s->>'experience_category' IS NULL AND s->'division_ids' = jsonb_build_array(div_b))
     OR (SELECT count(*) FROM jsonb_array_elements(board->'sessions') s WHERE s->>'activity_id' = act_pub::text) <> 2
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(board->'sessions') s WHERE NOT (s ? 'activity_type') OR NOT (s ? 'experience_category'))
  THEN RAISE EXCEPTION 'BOARD_ACTIVITY_TYPE'; END IF;

  -- El expediente informa lo que se eliminaría.
  preview := workshop_admin_get_internal(w_pub)->'dependents';
  IF preview <> '{"sessions": 2, "reservations": 2, "attendances": 1, "participants": 2}'::jsonb THEN RAISE EXCEPTION 'WORKSHOP_DEPENDENTS[%]', preview; END IF;
  IF workshop_admin_get_internal(w_pending)->'dependents' <> '{"sessions": 0, "reservations": 0, "attendances": 0, "participants": 0}'::jsonb
  THEN RAISE EXCEPTION 'WORKSHOP_DEPENDENTS_PENDING'; END IF;

  -- ===================================================================================================================
  -- TALLERES: eliminar
  -- ===================================================================================================================
  IF pg_temp.try(format('select workshop_admin_delete_internal(%L, %L)::text', staff, w_pub)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.try(format('select workshop_admin_delete_internal(%L, %L)::text', coord, gen_random_uuid())) <> 'ERR:NOT_FOUND'
     OR NOT EXISTS (SELECT 1 FROM activities WHERE id = act_pub)
  THEN RAISE EXCEPTION 'WORKSHOP_DELETE_GUARDS'; END IF;
  -- Pendiente y descartado: sin dependientes.
  result := workshop_admin_delete_internal(coord, w_pending);
  IF result->'removed' <> '{"sessions": 0, "reservations": 0, "attendances": 0, "participants": 0}'::jsonb
     OR EXISTS (SELECT 1 FROM workshop_submissions WHERE id = w_pending)
     OR EXISTS (SELECT 1 FROM workshop_submission_careers WHERE submission_id = w_pending)
  THEN RAISE EXCEPTION 'WORKSHOP_DELETE_PENDING[%]', result; END IF;
  PERFORM workshop_admin_delete_internal(coord, w_arch);
  IF EXISTS (SELECT 1 FROM workshop_submissions WHERE id = w_arch) THEN RAISE EXCEPTION 'WORKSHOP_DELETE_ARCHIVED'; END IF;
  -- Publicado, con sesiones, reservaciones, asistencias y credencial: nada lo bloquea y nada queda colgando.
  result := workshop_admin_delete_internal(coord, w_pub);
  IF result->'removed' <> '{"sessions": 2, "reservations": 2, "attendances": 1, "participants": 2}'::jsonb THEN RAISE EXCEPTION 'WORKSHOP_DELETE_COUNTS[%]', result; END IF;
  IF EXISTS (SELECT 1 FROM workshop_submissions WHERE id = w_pub) OR EXISTS (SELECT 1 FROM activities WHERE id = act_pub)
     OR EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = act_pub) OR EXISTS (SELECT 1 FROM reservations WHERE activity_id = act_pub)
     OR EXISTS (SELECT 1 FROM attendances WHERE activity_id = act_pub) OR EXISTS (SELECT 1 FROM activity_credentials WHERE activity_id = act_pub)
     OR EXISTS (SELECT 1 FROM activity_careers WHERE activity_id = act_pub) OR EXISTS (SELECT 1 FROM activity_divisions WHERE activity_id = act_pub)
     OR pg_temp.orphans() <> baseline_orphans
  THEN RAISE EXCEPTION 'WORKSHOP_DELETE_LEFTOVERS'; END IF;
  IF workshop_admin_get_internal(w_pub) IS NOT NULL
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(workshop_admin_list_internal(NULL, NULL, 'CRUD Taller académico', 1)->'items'))
  THEN RAISE EXCEPTION 'WORKSHOP_STILL_IN_ADMIN'; END IF;
  -- Desaparece del catálogo del alumno; sus sellos bajan en lo que valía esa asistencia; lo demás sigue intacto.
  board := pg_temp.as_user(ua, 'select my_reservation_board()')::jsonb;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(board->'sessions') s WHERE s->>'activity_id' = act_pub::text)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(board->'reservations') r WHERE r->>'activity_id' = act_pub::text)
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(board->'sessions') s WHERE s->>'activity_id' = act_life::text)
     OR pg_temp.as_user(ua, format('select my_workshop_detail(%L)', act_pub)) NOT LIKE 'ERR:%'
     OR my_stamp_count(pa) <> 1 OR (SELECT count(*) FROM reservations WHERE participant_id = pa) <> 1
  THEN RAISE EXCEPTION 'WORKSHOP_STILL_VISIBLE_TO_STUDENT'; END IF;
  -- La credencial eliminada deja de servir.
  IF pg_temp.as_user(ub, format('select check_in(%L)', cred->>'qr_token')) <> 'ERR:INVALID_CREDENTIAL' THEN RAISE EXCEPTION 'DELETED_CREDENTIAL_VALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'workshop_submission.deleted' AND actor_user_id = coord
       AND detail->>'submission_id' = w_pub::text AND detail->>'from_status' = 'published' AND (detail->'removed'->>'reservations')::int = 2)
  THEN RAISE EXCEPTION 'WORKSHOP_DELETE_AUDIT'; END IF;

  -- ===================================================================================================================
  -- ALUMNOS: eliminar
  -- ===================================================================================================================
  -- pa tiene reservación, asistencia con sello, intereses, alias de correo y un premio confirmado.
  PERFORM sync_initial_interests(pa, ARRAY[car_a1, car_b1]);
  INSERT INTO post_event_interests(participant_id,preference,career_id) VALUES (pa,1,car_b1),(pa,2,other_career);
  INSERT INTO participant_email_history(participant_id,edition_id,email,changed_by,reason) VALUES (pa,ed,'crud.a.viejo@test.invalid',coord,'prueba');
  cat := pg_temp.as_user(coord, $q$select save_raffle_category('{"name": "CRUD Categoría", "sort_order": 99, "rules": [{"total": 1}]}')$q$)::uuid;
  prize := pg_temp.as_user(coord, format($q$select save_raffle_prize('{"category_id": "%s", "name": "CRUD Premio", "quantity": 1, "is_active": true, "sort_order": 1}')$q$, cat))::uuid;
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,is_demo,confirmed_at) VALUES (ed,cat,prize,pa,'confirmado',false,now());

  IF pg_temp.as_user(staff, format('select participant_delete_preview(%L)', pa)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.as_role('anon', format('select participant_delete_preview(%L)', pa)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select participant_delete_internal(%L, %L)', coord, pa)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select participant_delete_plan_internal(%L, %L)', coord, pa)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select participant_auth_is_removable(%L)', pa)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.try(format('select participant_delete_internal(%L, %L)::text', staff, pa)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.try(format('select participant_delete_plan_internal(%L, %L)::text', staff, pa)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.try(format('select participant_delete_internal(%L, %L)::text', coord, gen_random_uuid())) <> 'ERR:NOT_FOUND'
     OR NOT EXISTS (SELECT 1 FROM participants WHERE id = pa)
  THEN RAISE EXCEPTION 'PARTICIPANT_DELETE_GUARDS'; END IF;

  preview := pg_temp.as_user(coord, format('select participant_delete_preview(%L)', pa))::jsonb;
  IF preview - 'id' <> jsonb_build_object('full_name','CRUD Alumno A','email','crud.a@test.invalid','is_demo',false,
       'reservations',1,'attendances',1,'stamps',1,'initial_interests',2,'post_event_interests',2,'email_aliases',1,
       'import_conflicts',0,'raffle_records',1,'raffle_confirmed',1,'has_account',true,'account_will_be_deleted',true)
  THEN RAISE EXCEPTION 'PARTICIPANT_PREVIEW[%]', preview; END IF;
  -- Identidad de Auth: la de un participante se retira; una cuenta de Staff vinculada por error, jamás.
  IF participant_delete_plan_internal(coord, pa) <> jsonb_build_object('participant_id', pa, 'auth_user_id', ua, 'linked_non_participant_account', false)
     OR participant_delete_plan_internal(coord, p_staff) <> jsonb_build_object('participant_id', p_staff, 'auth_user_id', NULL, 'linked_non_participant_account', true)
     OR participant_delete_plan_internal(coord, p_empty) <> jsonb_build_object('participant_id', p_empty, 'auth_user_id', NULL, 'linked_non_participant_account', false)
     OR (pg_temp.as_user(coord, format('select participant_delete_preview(%L)', p_staff))::jsonb->>'account_will_be_deleted')::boolean
  THEN RAISE EXCEPTION 'PARTICIPANT_AUTH_PLAN'; END IF;

  -- Sin reservaciones ni nada más.
  result := participant_delete_internal(coord, p_empty);
  IF NOT (result->>'deleted')::boolean OR EXISTS (SELECT 1 FROM participants WHERE id = p_empty)
     OR EXISTS (SELECT 1 FROM participant_profiles WHERE participant_id = p_empty)
  THEN RAISE EXCEPTION 'PARTICIPANT_DELETE_EMPTY[%]', result; END IF;
  -- Con reservaciones, sellos, intereses, alias y sorteo. (La Edge Function retira antes la identidad de Auth.)
  n := session_reserved_count(ses_life);
  DELETE FROM auth.users WHERE id = ua;
  result := participant_delete_internal(coord, pa);
  IF result->'removed' <> '{"reservations": 1, "attendances": 1, "stamps": 1, "initial_interests": 2, "post_event_interests": 2, "email_aliases": 1, "import_conflicts": 0, "raffle_records": 1}'::jsonb
  THEN RAISE EXCEPTION 'PARTICIPANT_DELETE_COUNTS[%]', result; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE id = pa) OR EXISTS (SELECT 1 FROM participant_profiles WHERE participant_id = pa)
     OR EXISTS (SELECT 1 FROM reservations WHERE participant_id = pa) OR EXISTS (SELECT 1 FROM attendances WHERE participant_id = pa)
     OR EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = pa) OR EXISTS (SELECT 1 FROM post_event_interests WHERE participant_id = pa)
     OR EXISTS (SELECT 1 FROM participant_email_history WHERE participant_id = pa) OR EXISTS (SELECT 1 FROM raffle_winners WHERE participant_id = pa)
     OR pg_temp.orphans() <> baseline_orphans
  THEN RAISE EXCEPTION 'PARTICIPANT_DELETE_LEFTOVERS'; END IF;
  -- Su lugar se libera, el premio vuelve a estar disponible y los demás alumnos no se ven afectados.
  IF session_reserved_count(ses_life) <> n - 1
     OR (SELECT (p->>'available')::int FROM jsonb_array_elements(pg_temp.as_user(coord, format('select raffle_prizes_read(%L)', cat))::jsonb) p WHERE p->>'id' = prize::text) <> 1
     OR NOT EXISTS (SELECT 1 FROM reservations WHERE participant_id = pc AND session_id = ses_life)
  THEN RAISE EXCEPTION 'PARTICIPANT_DELETE_SIDE_EFFECTS'; END IF;
  -- Ya no aparece en búsquedas ni exportaciones, su correo (y su alias) quedan libres y no puede entrar.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.as_user(coord, $q$select search_participants('CRUD Alumno A')$q$)::jsonb))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.as_user(coord, $q$select export_participants('prueba de regresión', true)$q$)::jsonb->'rows') r WHERE r->>'email' = 'crud.a@test.invalid')
     OR participant_access_state_internal('crud.a@test.invalid') <> 'self_registration'
     OR email_in_use(ed, 'crud.a.viejo@test.invalid', NULL)
     OR pg_temp.as_user(ua, 'select my_reservation_board()') NOT LIKE 'ERR:%'
  THEN RAISE EXCEPTION 'PARTICIPANT_STILL_REACHABLE'; END IF;
  -- Auditoría sin datos personales.
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'participant.deleted' AND actor_user_id = coord AND detail->>'participant_id' = pa::text
       AND (detail->'removed'->>'raffle_records')::int = 1 AND detail::text NOT LIKE '%crud.a@test.invalid%' AND detail::text NOT LIKE '%CRUD Alumno A%')
  THEN RAISE EXCEPTION 'PARTICIPANT_DELETE_AUDIT'; END IF;
  -- El participante vinculado a Staff se elimina; la cuenta y el rol de Staff siguen intactos.
  PERFORM participant_delete_internal(coord, p_staff);
  IF EXISTS (SELECT 1 FROM participants WHERE id = p_staff)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = staff_linked)
     OR NOT EXISTS (SELECT 1 FROM staff_members WHERE user_id = staff_linked AND is_active)
     OR NOT EXISTS (SELECT 1 FROM staff_roles WHERE user_id = staff_linked AND role = 'staff')
     OR (SELECT count(*) FROM staff_members WHERE user_id IN (coord, staff, staff_linked)) <> 3
  THEN RAISE EXCEPTION 'STAFF_ACCOUNT_AFFECTED'; END IF;

  -- ===================================================================================================================
  -- DIVISIONES: eliminar
  -- ===================================================================================================================
  -- Taller solo de la división A (publicado, con reservación y asistencia) y taller compartido entre A y B.
  result := workshop_admin_create_internal(coord, academic || jsonb_build_object('title','CRUD Solo A','career_ids',jsonb_build_array(car_a1, car_a2)), true);
  w_only_a := (result->>'submission_id')::uuid; act_only_a := (result->>'activity_id')::uuid;
  result := workshop_admin_create_internal(coord, academic || jsonb_build_object('title','CRUD Compartido','career_ids',jsonb_build_array(car_a1, car_b1)), true);
  w_multi := (result->>'submission_id')::uuid; act_multi := (result->>'activity_id')::uuid;
  IF (SELECT division_id FROM activities WHERE id = act_only_a) <> div_a OR (SELECT division_id FROM activities WHERE id = act_multi) IS NOT NULL
     OR (SELECT count(*) FROM activity_divisions WHERE activity_id = act_multi) <> 2
  THEN RAISE EXCEPTION 'FIXTURE_DIVISION_WORKSHOPS'; END IF;
  SELECT id INTO ses_only_a FROM activity_sessions WHERE activity_id = act_only_a ORDER BY starts_at LIMIT 1;
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (pb,ses_only_a,act_only_a),(pc,ses_only_a,act_only_a);
  INSERT INTO attendances(participant_id,session_id,activity_id,method) VALUES (pb,ses_only_a,act_only_a,'qr');
  INSERT INTO reservations(participant_id,session_id,activity_id)
  SELECT pb, id, act_multi FROM activity_sessions WHERE activity_id = act_multi ORDER BY starts_at DESC LIMIT 1;
  -- Intereses: pb tiene A1 (1ª) y B1 (2ª); pc solo A2; el alumno manual solo A1. Posteriores de pb: A1, B1, A2.
  PERFORM sync_initial_interests(pb, ARRAY[car_a1, car_b1]);
  PERFORM sync_initial_interests(pc, ARRAY[car_a2]);
  INSERT INTO post_event_interests(participant_id,preference,career_id) VALUES (pb,1,car_a1),(pb,2,car_b1),(pb,3,car_a2),(pc,1,car_a2);

  IF pg_temp.as_user(staff, format('select delete_division(%L)', div_a)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.as_user(staff, format('select division_delete_preview(%L)', div_a)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.as_role('anon', format('select delete_division(%L)', div_a)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select division_delete_plan_internal(%L)', div_a)) NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(coord, format('select delete_division(%L)', gen_random_uuid())) <> 'ERR:NOT_FOUND'
     OR NOT EXISTS (SELECT 1 FROM divisions WHERE id = div_a)
  THEN RAISE EXCEPTION 'DIVISION_DELETE_GUARDS'; END IF;

  -- División vacía.
  preview := pg_temp.as_user(coord, format('select division_delete_preview(%L)', div_empty))::jsonb;
  IF (preview->>'careers')::int <> 0 OR jsonb_array_length(preview->'workshops_deleted') <> 0 OR (preview->>'workshops_kept')::int <> 0
  THEN RAISE EXCEPTION 'DIVISION_PREVIEW_EMPTY[%]', preview; END IF;
  answer := pg_temp.as_user(coord, format('select delete_division(%L)', div_empty));
  IF answer LIKE 'ERR:%' OR EXISTS (SELECT 1 FROM divisions WHERE id = div_empty) THEN RAISE EXCEPTION 'DIVISION_DELETE_EMPTY[%]', answer; END IF;

  -- División con carreras, intereses y talleres.
  preview := pg_temp.as_user(coord, format('select division_delete_preview(%L)', div_a))::jsonb;
  IF (preview->>'careers')::int <> 2 OR preview->'career_names' <> '["CRUD Carrera A1", "CRUD Carrera A2"]'::jsonb
     OR jsonb_array_length(preview->'workshops_deleted') <> 1
     OR ((preview->'workshops_deleted'->0) - 'submission_id' - 'activity_id') <> '{"title": "CRUD Solo A", "status": "published", "sessions": 2, "reservations": 2, "attendances": 1}'::jsonb
     OR (preview->>'workshops_kept')::int <> 1 OR (preview->>'activities_unlinked')::int <> 1
     OR (preview->>'participants_initial_interest')::int <> 3 OR (preview->>'participants_post_event_interest')::int <> 2
  THEN RAISE EXCEPTION 'DIVISION_PREVIEW[%]', preview; END IF;
  answer := pg_temp.as_user(coord, format('select delete_division(%L)', div_a));
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'DIVISION_DELETE[%]', answer; END IF;
  result := answer::jsonb;
  IF result->'removed' <> '{"sessions": 2, "reservations": 2, "attendances": 1}'::jsonb THEN RAISE EXCEPTION 'DIVISION_DELETE_COUNTS[%]', result; END IF;
  -- La división y sus carreras ya no existen.
  IF EXISTS (SELECT 1 FROM divisions WHERE id = div_a) OR EXISTS (SELECT 1 FROM careers WHERE id IN (car_a1, car_a2))
  THEN RAISE EXCEPTION 'DIVISION_OR_CAREERS_REMAIN'; END IF;
  -- El taller que solo era de A se eliminó completo.
  IF EXISTS (SELECT 1 FROM workshop_submissions WHERE id = w_only_a) OR EXISTS (SELECT 1 FROM activities WHERE id = act_only_a)
     OR EXISTS (SELECT 1 FROM reservations WHERE activity_id = act_only_a) OR EXISTS (SELECT 1 FROM attendances WHERE activity_id = act_only_a)
  THEN RAISE EXCEPTION 'DIVISION_ONLY_WORKSHOP_REMAINS'; END IF;
  -- El taller compartido sigue publicado con la división B: misma actividad, mismas sesiones y reservaciones.
  IF (SELECT status FROM workshop_submissions WHERE id = w_multi) <> 'published'
     OR (SELECT array_agg(career_id) FROM workshop_submission_careers WHERE submission_id = w_multi) <> ARRAY[car_b1]
     OR (SELECT array_agg(career_id) FROM activity_careers WHERE activity_id = act_multi) <> ARRAY[car_b1]
     OR (SELECT array_agg(division_id) FROM activity_divisions WHERE activity_id = act_multi) <> ARRAY[div_b]
     OR (SELECT division_id FROM activities WHERE id = act_multi) IS DISTINCT FROM div_b
     OR (SELECT count(*) FROM activity_sessions WHERE activity_id = act_multi) <> 2
     OR (SELECT count(*) FROM reservations WHERE activity_id = act_multi AND participant_id = pb) <> 1
     OR NOT EXISTS (SELECT 1 FROM activity_credentials WHERE activity_id = act_multi)
  THEN RAISE EXCEPTION 'DIVISION_SHARED_WORKSHOP_DAMAGED'; END IF;
  -- Vida Universitaria (sin división) no se toca.
  IF NOT EXISTS (SELECT 1 FROM activities WHERE id = act_life) OR (SELECT status FROM workshop_submissions WHERE id = w_life) <> 'published'
  THEN RAISE EXCEPTION 'DIVISION_TOUCHED_UNIVERSITY_LIFE'; END IF;
  -- Intereses iniciales: la 2ª opción de pb pasa a 1ª; pc y el alumno manual quedan sin carrera inicial.
  IF (SELECT array_agg(career_id ORDER BY preference) FROM initial_interests WHERE participant_id = pb) <> ARRAY[car_b1]
     OR (SELECT preference FROM initial_interests WHERE participant_id = pb) <> 1
     OR (SELECT initial_career_id FROM participants WHERE id = pb) <> car_b1
     OR EXISTS (SELECT 1 FROM initial_interests WHERE participant_id IN (pc, p_manual))
     OR (SELECT count(*) FROM participants WHERE id IN (pc, p_manual) AND initial_career_id IS NULL) <> 2
  THEN RAISE EXCEPTION 'DIVISION_INITIAL_INTERESTS'; END IF;
  -- Intereses posteriores: pb conserva B1 renumerado a 1; pc queda sin intereses.
  IF (SELECT array_agg(career_id ORDER BY preference) FROM post_event_interests WHERE participant_id = pb) <> ARRAY[car_b1]
     OR (SELECT preference FROM post_event_interests WHERE participant_id = pb) <> 1
     OR EXISTS (SELECT 1 FROM post_event_interests WHERE participant_id = pc)
  THEN RAISE EXCEPTION 'DIVISION_POST_EVENT_INTERESTS'; END IF;
  -- Las demás divisiones y sus carreras permanecen exactamente igual; ninguna referencia inválida.
  IF (SELECT count(*) FROM careers WHERE division_id NOT IN (div_b)) <> careers_elsewhere
     OR NOT EXISTS (SELECT 1 FROM careers WHERE id = car_b1 AND division_id = div_b)
     OR (SELECT count(*) FROM divisions) <> divisions_before + 1
     OR pg_temp.orphans() <> baseline_orphans
  THEN RAISE EXCEPTION 'DIVISION_COLLATERAL_DAMAGE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'catalog.division_deleted' AND actor_user_id = coord AND detail->>'code' = 'ZZ-CRUD-A'
       AND (detail->>'careers')::int = 2 AND (detail->>'workshops_deleted')::int = 1 AND (detail->>'workshops_kept')::int = 1)
  THEN RAISE EXCEPTION 'DIVISION_DELETE_AUDIT'; END IF;
  -- Y la división B, ahora dueña única del taller compartido, también se puede eliminar: el taller cae con ella.
  answer := pg_temp.as_user(coord, format('select delete_division(%L)', div_b));
  IF answer LIKE 'ERR:%' OR EXISTS (SELECT 1 FROM divisions WHERE id = div_b) OR EXISTS (SELECT 1 FROM activities WHERE id = act_multi)
     OR EXISTS (SELECT 1 FROM workshop_submissions WHERE id = w_multi) OR (SELECT initial_career_id FROM participants WHERE id = pb) IS NOT NULL
     OR (SELECT count(*) FROM divisions) <> divisions_before OR pg_temp.orphans() <> baseline_orphans
  THEN RAISE EXCEPTION 'DIVISION_DELETE_SECOND[%]', answer; END IF;

  RAISE NOTICE 'ADMIN_CRUD_OK: talleres (crear, publicar, editar, eliminar con dependientes), alumnos (alta manual sin consentimiento, eliminación con todo lo suyo, cuentas de Staff intactas), divisiones (limpieza coherente) y tipo de misión en el tablero';
END $test$;
ROLLBACK;
