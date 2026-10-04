-- Regression tests for the pre-reservations correction phase.
-- Run the whole file as one statement. It ALWAYS ends by raising an exception
-- carrying the results, so every change it makes is rolled back.
-- Expectations: OK | ERR:<code> | NOT:<code> | TRUE (query must return true) | SHOW (just record)

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  s uuid := '00000000-0000-4000-8000-0000000000c2';
  r uuid := '00000000-0000-4000-8000-0000000000c3';
  d uuid := '00000000-0000-4000-8000-0000000000c4';
  n uuid := '00000000-0000-4000-8000-0000000000c5';
  t uuid := '00000000-0000-4000-8000-0000000000c6';
  ed uuid := active_edition_id();
  st record;
  v_uid uuid; v_q text; v_val text; v_err text; v_ok boolean; v_last text := 'null';
  v_aid text; v_fid text; v_act text; v_any text := (SELECT id::text FROM participants WHERE edition_id = active_edition_id() LIMIT 1);
  v_res text[] := '{}'; v_pass int := 0; v_fail int := 0;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, d, n, t]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RT Coord', true, 'rt.c1@test.invalid'),
    (s, 'staff', 'RT Staff', true, 'rt.c2@test.invalid'),
    (r, 'sorteo', 'RT Sorteo', true, 'rt.c3@test.invalid'),
    (d, 'coordinacion', 'RT Desactivada', false, 'rt.c4@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo'), (d, 'coordinacion');

  CREATE TEMP TABLE rt_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rt_steps (name, who, q, expect) VALUES
  -- Roles (real authorization through the RPCs)
  ('rol: coordinación puede previsualizar importación', 'C', $q$select preview_participant_import('[]'::jsonb, false)$q$, 'OK'),
  ('rol: staff no importa', 'S', $q$select preview_participant_import('[]'::jsonb, false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: sorteo no importa', 'R', $q$select preview_participant_import('[]'::jsonb, false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: cuenta desactivada no importa', 'D', $q$select preview_participant_import('[]'::jsonb, false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: sin rol no importa', 'N', $q$select preview_participant_import('[]'::jsonb, false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: staff no exporta', 'S', $q$select export_participants('prueba regresion', false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: sorteo no exporta', 'R', $q$select export_participants('prueba regresion', false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: desactivada no exporta', 'D', $q$select export_participants('prueba regresion', false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: sorteo no consulta expedientes', 'R', $q$select get_participant(':ANY')$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: desactivada no consulta expedientes', 'D', $q$select get_participant(':ANY')$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: sin rol no consulta expedientes', 'N', $q$select get_participant(':ANY')$q$, 'ERR:NOT_AUTHORIZED'),
  ('rol: staff consulta expedientes', 'S', $q$select get_participant(':ANY')$q$, 'OK'),

  -- Import batch 1: new, CSV duplicates, unknown career, invalid date, missing consent, extra headers
  ('import 1 aplicar', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"RT.Ana@Test.invalid ","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"DEMO-MED","consent":true,"submitted_at":"2026-01-10T10:00:00Z",
     "extra":[{"col":9,"header":"¿Cómo te enteraste?","value":"Instagram"},{"col":10,"header":"  ¿cómo te  enteraste? ","value":"Amigos"},{"col":11,"header":"","value":"sin titulo"},{"col":12,"header":"Pregunta muy larga sobre tus intereses profesionales y personales que excede el límite permitido de caracteres","value":"larga"},{"col":13,"header":"email","value":"intruso@test.invalid"},{"col":14,"header":"Vacía","value":""}]},
    {"row":3,"email":"rt.beto@test.invalid","full_name":"Beto Uno","birth_date":"2008-01-01","career":"DEMO-MED","consent":true},
    {"row":4,"email":"rt.beto@test.invalid","full_name":"Beto Dos","birth_date":"2008-01-01","career":"DEMO-MED","consent":true},
    {"row":5,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"NO-EXISTE","consent":true},
    {"row":6,"email":"rt.dani@test.invalid","full_name":"Dani Prueba","birth_date":"2008-13-45","career":"DEMO-MED","consent":true},
    {"row":7,"email":"rt.eli@test.invalid","full_name":"Eli Prueba","birth_date":"2008-03-03","career":"DEMO-MED","consent":false}
  ]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('import: fila nueva', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' = 'new'$q$, 'TRUE'),
  ('import: duplicado en CSV marca la fila anterior', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 3)')->>'status' = 'duplicate'$q$, 'TRUE'),
  ('import: duplicado en CSV conserva la última', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 4)')->>'status' = 'new'$q$, 'TRUE'),
  ('import: carrera desconocida se guarda con aviso', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 5)')->>'status' = 'new' and jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 5)')->'warnings' ? 'Carrera no encontrada en el catálogo'$q$, 'TRUE'),
  ('import: fecha inválida es error', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 6)')->>'status' = 'error'$q$, 'TRUE'),
  ('import: sin consentimiento es error', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 7)')->>'status' = 'error'$q$, 'TRUE'),
  ('import: fecha inválida y sin consentimiento no se guardan', 'P', $q$select count(*) = 0 from participants where email in ('rt.dani@test.invalid','rt.eli@test.invalid')$q$, 'TRUE'),
  ('extras: encabezados duplicados por mayúsculas/espacios, vacío y largo', 'P', $q$select (extra->'forms') ? '¿como te enteraste?' and (extra->'forms') ? '¿como te enteraste? (2)'
      and extra->'forms'->'¿como te enteraste? (2)'->>'label' = '¿Cómo te enteraste? (2)'
      and exists (select 1 from jsonb_each(extra->'forms') e where e.value->>'label' like 'Columna sin título%')
      and exists (select 1 from jsonb_each(extra->'forms') e where e.value->>'label' like '%…' and length(e.value->>'label') <= 81)
      and not exists (select 1 from jsonb_each(extra->'forms') e where e.value->>'label' = 'Vacía')
      from participants where id = ':AID'$q$, 'TRUE'),
  ('extras: encabezado "email" no pisa el correo', 'P', $q$select email = 'rt.ana@test.invalid' and extra->'forms' ? 'email' from participants where id = ':AID'$q$, 'TRUE'),

  -- Re-import unchanged
  ('import 2 sin cambios', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"DEMO-MED","consent":true,"submitted_at":"2026-01-10T10:00:00Z","extra":[{"col":9,"header":"¿Cómo te enteraste?","value":"Instagram"}]}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('import: sin cambios', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' = 'unchanged'$q$, 'TRUE'),

  -- Manual correction preserved
  ('corrección manual de teléfono', 'C', $q$select update_participant(':AID', '{"phone":"9989999999"}'::jsonb)$q$, 'OK'),
  ('import 3 con teléfono viejo', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"DEMO-MED","consent":true}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('import: corrección manual se conserva', 'P', $q$select phone = '9989999999' from participants where id = ':AID'$q$, 'TRUE'),

  -- Email correction + old email in Forms
  ('corregir correo con motivo', 'C', $q$select update_participant(':AID', '{"email":"rt.ana2@test.invalid","email_reason":"Error al escribir en Forms"}'::jsonb)$q$, 'OK'),
  ('correo: historial guarda correo anterior y motivo', 'P', $q$select count(*) = 1 from participant_email_history where participant_id = ':AID' and email = 'rt.ana@test.invalid' and reason = 'Error al escribir en Forms' and changed_by = '00000000-0000-4000-8000-0000000000c1'$q$, 'TRUE'),
  ('import 4 con correo anterior', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"DEMO-MED","consent":true}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('correo: reconocido por correo anterior', 'P', $q$select (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'note') like 'Reconocido por correo anterior%' and jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' <> 'new'$q$, 'TRUE'),
  ('correo: no se crea duplicado ni se revierte', 'P', $q$select (select count(*) from participants where edition_id = active_edition_id() and email in ('rt.ana@test.invalid','rt.ana2@test.invalid')) = 1 and (select email from participants where id = ':AID') = 'rt.ana2@test.invalid'$q$, 'TRUE'),
  ('correo: el anterior no sirve para entrar', 'P', $q$select count(*) = 0 from participants where edition_id = active_edition_id() and email = 'rt.ana@test.invalid'$q$, 'TRUE'),
  ('correo: no se puede reutilizar un correo anterior', 'C', $q$select create_participant_manual('{"email":"rt.ana@test.invalid","full_name":"Otra Persona","consent_confirmed":true}'::jsonb)$q$, 'ERR:EMAIL_EXISTS'),
  ('import 5 correo anterior con nombre y fecha distintos', 'C', $q$select preview_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Zeta Distinta","birth_date":"1990-01-01","career":"DEMO-MED","consent":true}]'::jsonb, false)$q$, 'OK'),
  ('correo: alerta fuerte sin bloquear la fila', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'alert' is not null and jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' <> 'error'$q$, 'TRUE'),

  -- Partial manual creation + later Forms
  ('alta manual parcial', 'C', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","consent_confirmed":true}'::jsonb)$q$, 'OK'),
  ('alta manual: solo protege campos capturados', 'P', $q$select (select array_agg(k order by k) from jsonb_object_keys(manual_overrides) k) <@ ARRAY['email','full_name'] and manual_overrides ? 'full_name' and not manual_overrides ? 'phone' from participants where id = ':FID'$q$, 'TRUE'),
  ('import 6 completa alta manual', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.fer@test.invalid","full_name":"Fernanda Forms","birth_date":"2008-07-07","phone":"9982222222","high_school":"Prepa Dos","career":"DEMO-MED","consent":true}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('alta manual: Forms completa vacíos y respeta nombre', 'P', $q$select phone = '9982222222' and birth_date = '2008-07-07' and high_school = 'Prepa Dos' and full_name = 'Fer Manual' from participants where id = ':FID'$q$, 'TRUE'),

  -- Demo row
  ('import demo', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.demo@test.invalid","full_name":"Demo Prueba","birth_date":"2008-08-08","career":"DEMO-MED","consent":true}]'::jsonb, 'rt-demo.csv', true)$q$, 'OK'),

  -- Export
  ('exportar sin demo', 'C', $q$select export_participants('prueba regresion', false)$q$, 'OK'),
  ('export: excluye datos de prueba', 'P', $q$select not jsonb_path_exists($LAST::jsonb, '$.rows[*] ? (@.email == "rt.demo@test.invalid")')$q$, 'TRUE'),
  ('export: fila de Forms completa', 'P', $q$select r->>'birth_date' = '2008-05-14' and r->>'phone' = '9989999999' and r->>'high_school' = 'Prepa Uno' and r->>'initial_career' is not null
      and r ? 'interest_1' and r->>'origin' = 'forms' and (r->>'forms_consent')::boolean and r->>'previous_emails' like '%rt.ana@test.invalid%'
      and r->'forms_extra'->>'¿como te enteraste?' = 'Instagram'
      from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.ana2@test.invalid")') r$q$, 'TRUE'),
  ('export: fila manual con consentimiento', 'P', $q$select r->>'origin' = 'manual' and r->>'manual_consent_at' is not null and r->>'birth_date' = '2008-07-07' from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.fer@test.invalid")') r$q$, 'TRUE'),
  ('export: columnas extra estables y legibles', 'P', $q$select jsonb_path_exists($LAST::jsonb, '$.extra_columns[*] ? (@.label == "¿Cómo te enteraste? (2)")') and jsonb_path_exists($LAST::jsonb, '$.extra_columns[*] ? (@.key == "¿como te enteraste?")')$q$, 'TRUE'),
  ('exportar con demo', 'C', $q$select export_participants('prueba regresion', true)$q$, 'OK'),
  ('export: incluye demo cuando se pide', 'P', $q$select jsonb_path_exists($LAST::jsonb, '$.rows[*] ? (@.email == "rt.demo@test.invalid")')$q$, 'TRUE'),

  -- Extras visibility
  ('extras: coordinación los ve', 'C', $q$select jsonb_array_length(get_participant(':AID')->'forms_extra') >= 4$q$, 'TRUE'),
  ('extras: staff no los recibe', 'S', $q$select not (get_participant(':AID') ? 'forms_extra')$q$, 'TRUE'),
  ('correo: historial visible en expediente', 'S', $q$select jsonb_array_length(get_participant(':AID')->'email_history') = 1$q$, 'TRUE'),

  -- Consent guard (student = participant A)
  ('vincular aspirante', 'P', $q$update participants set auth_user_id = '00000000-0000-4000-8000-0000000000c6' where id = ':AID'$q$, 'SHOW'),
  ('aviso: guardar intereses sin aviso se rechaza', 'T', $q$select save_post_event_interests(array[]::uuid[])$q$, 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('aviso: progreso disponible antes del aviso', 'T', $q$select my_progress()$q$, 'OK'),
  ('aviso: aceptar aviso', 'T', $q$select accept_platform_notice()$q$, 'OK'),
  ('aviso: después de aceptar ya no lo exige', 'T', $q$select save_post_event_interests(array[(select id from careers where code = 'DEMO-MED')])$q$, 'NOT:PRIVACY_NOTICE_REQUIRED'),
  ('aspirante: no ve expedientes', 'T', $q$select get_participant(':AID')$q$, 'ERR:NOT_AUTHORIZED'),
  ('aspirante: no exporta', 'T', $q$select export_participants('x', false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('aspirante: no recibe extras en su progreso', 'T', $q$select position('forms' in my_progress()::text) = 0$q$, 'TRUE'),
  ('sin participante: rechazado por la regla central', 'N', $q$select my_progress()$q$, 'ERR:NOT_AUTHORIZED'),
  ('sin participante: no guarda intereses', 'N', $q$select save_post_event_interests(array[]::uuid[])$q$, 'ERR:NOT_AUTHORIZED'),

  -- Session status / location
  ('sesión: crear taller', 'C', $q$select save_activity(jsonb_build_object('title','RT taller regresion','description','','location','Edificio A','division_id',(select division_id from careers where code = 'DEMO-MED'),'is_demo',true))$q$, 'OK'),
  ('sesión: estado inválido (llena) se rechaza', 'C', $q$select save_session(jsonb_build_object('activity_id',':ACT','starts_at',(select (event_date::text || ' 10:00-05')::timestamptz from editions where id = active_edition_id()),'ends_at',(select (event_date::text || ' 10:45-05')::timestamptz from editions where id = active_edition_id()),'capacity',10,'status','llena'))$q$, 'ERR:INVALID_SESSION_STATUS'),
  ('sesión: guardar oculta sin ubicación', 'C', $q$select save_session(jsonb_build_object('activity_id',':ACT','starts_at',(select (event_date::text || ' 10:00-05')::timestamptz from editions where id = active_edition_id()),'ends_at',(select (event_date::text || ' 10:45-05')::timestamptz from editions where id = active_edition_id()),'capacity',10,'status','oculta','location',''))$q$, 'OK'),
  ('sesión: hereda ubicación y guarda estado', 'P', $q$select location = 'Edificio A' and status = 'oculta' from activity_sessions where activity_id = ':ACT'$q$, 'TRUE'),
  ('sesión: aspirante no ve horario oculto', 'T', $q$select count(*) = 0 from activity_sessions where activity_id = ':ACT'$q$, 'TRUE'),
  ('sesión: staff sí ve horario oculto', 'S', $q$select count(*) = 1 from activity_sessions where activity_id = ':ACT'$q$, 'TRUE');

  FOR st IN SELECT * FROM rt_steps ORDER BY seq LOOP
    v_aid := coalesce((SELECT participant_id::text FROM participant_by_email(ed, 'rt.ana@test.invalid')), '00000000-0000-0000-0000-000000000000');
    v_fid := coalesce((SELECT id::text FROM participants WHERE edition_id = ed AND email = 'rt.fer@test.invalid'), '00000000-0000-0000-0000-000000000000');
    v_act := coalesce((SELECT id::text FROM activities WHERE title = 'RT taller regresion' LIMIT 1), '00000000-0000-0000-0000-000000000000');
    v_q := replace(replace(replace(replace(replace(st.q, '$LAST', quote_literal(v_last)), ':AID', v_aid), ':FID', v_fid), ':ACT', v_act), ':ANY', v_any);
    v_uid := CASE st.who WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r WHEN 'D' THEN d WHEN 'N' THEN n WHEN 'T' THEN t END;
    v_val := NULL; v_err := NULL;
    BEGIN
      IF v_uid IS NOT NULL THEN
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
    IF st.who <> 'P' AND v_err IS NULL THEN v_last := coalesce(v_val, 'null'); END IF;

    v_ok := CASE
      WHEN st.expect = 'OK' THEN v_err IS NULL
      WHEN st.expect = 'TRUE' THEN v_err IS NULL AND v_val = 'true'
      WHEN st.expect = 'SHOW' THEN true
      WHEN st.expect LIKE 'ERR:%' THEN v_err LIKE '%' || substr(st.expect, 5) || '%'
      WHEN st.expect LIKE 'NOT:%' THEN v_err IS NULL OR v_err NOT LIKE '%' || substr(st.expect, 5) || '%'
    END;
    IF v_ok THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
    v_res := v_res || format('%s %s%s', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, st.name,
      CASE WHEN st.expect = 'SHOW' OR NOT v_ok THEN ' -> ' || left(coalesce('error: ' || v_err, v_val, 'null'), 300) ELSE '' END);
  END LOOP;

  RAISE EXCEPTION E'RESULTADOS (cambios revertidos): % ok, % fallas\n%', v_pass, v_fail, array_to_string(v_res, E'\n');
END
$test$;
