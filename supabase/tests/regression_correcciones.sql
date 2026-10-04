-- Regression tests for the pre-reservations correction phase (roster, careers, extras, manual sign-up).
-- Run the whole file as one statement. It ALWAYS ends by raising an exception
-- carrying the results, so every change it makes is rolled back.
-- Expectations: OK | ERR:<code> | NOT:<code> | TRUE (query must return true) | SHOW (just record)
-- Placeholders: $LAST (last non-P result), :AID Ana, :FID Fer, :CID Carla, :JID Juli, :ACT activity, :ANY any participant,
--               :REAL active non-demo career, :OFF inactive career, :DEMO demo career

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
  v_aid text; v_fid text; v_cid text; v_jid text; v_act text;
  v_any text := (SELECT id::text FROM participants WHERE edition_id = active_edition_id() LIMIT 1);
  v_real text; v_off text; v_demo text := (SELECT id::text FROM careers WHERE code = 'DEMO-MED');
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

  UPDATE editions SET roster_status = 'preparacion', roster_declared_at = NULL WHERE id = ed;
  INSERT INTO careers (code, name, division_id, is_demo, is_active)
  SELECT 'RT-REAL', 'RT Carrera Real', division_id, false, true FROM careers WHERE code = 'DEMO-MED'
  RETURNING id::text INTO v_real;
  INSERT INTO careers (code, name, division_id, is_demo, is_active)
  SELECT 'RT-OFF', 'RT Carrera Inactiva', division_id, false, false FROM careers WHERE code = 'DEMO-MED'
  RETURNING id::text INTO v_off;
  INSERT INTO careers (code, name, division_id, is_demo, is_active)
  SELECT 'RT-DMED', 'RT Medicina', division_id, true, true FROM careers WHERE code = 'DEMO-MED';

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

  -- Import batch 1: new, CSV duplicates, invalid date, missing consent, extra headers
  ('import 1 aplicar', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"RT.Ana@Test.invalid ","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"RT-REAL","consent":true,"submitted_at":"2026-01-10T10:00:00Z",
     "extra":[{"col":9,"header":"¿Cómo te enteraste?","value":"Instagram"},{"col":10,"header":"  ¿cómo te  enteraste? ","value":"Amigos"},{"col":11,"header":"","value":"sin titulo"},{"col":12,"header":"Pregunta muy larga sobre tus intereses profesionales y personales que excede el límite permitido de caracteres","value":"larga"},{"col":13,"header":"email","value":"intruso@test.invalid"},{"col":14,"header":"Vacía","value":""}]},
    {"row":3,"email":"rt.beto@test.invalid","full_name":"Beto Uno","birth_date":"2008-01-01","career":"RT-REAL","consent":true},
    {"row":4,"email":"rt.beto@test.invalid","full_name":"Beto Dos","birth_date":"2008-01-01","career":"RT-REAL","consent":true},
    {"row":6,"email":"rt.dani@test.invalid","full_name":"Dani Prueba","birth_date":"2008-13-45","career":"RT-REAL","consent":true},
    {"row":7,"email":"rt.eli@test.invalid","full_name":"Eli Prueba","birth_date":"2008-03-03","career":"RT-REAL","consent":false}
  ]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('import: fila nueva', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' = 'new'$q$, 'TRUE'),
  ('import: duplicado en CSV marca la fila anterior', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 3)')->>'status' = 'duplicate'$q$, 'TRUE'),
  ('import: duplicado en CSV conserva la última', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 4)')->>'status' = 'new'$q$, 'TRUE'),
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

  -- Stable extra identity: same duplicated headers, alternating empty cells
  ('extras alternos: importar', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.ivan@test.invalid","full_name":"Ivan Alterno","birth_date":"2008-04-04","career":"RT-REAL","consent":true,
     "extra":[{"col":9,"header":"Pregunta","value":"Respuesta A"},{"col":10,"header":"Pregunta","value":""}]},
    {"row":3,"email":"rt.juli@test.invalid","full_name":"Juli Alterna","birth_date":"2008-04-05","career":"RT-REAL","consent":true,
     "extra":[{"col":9,"header":"Pregunta","value":""},{"col":10,"header":"Pregunta","value":"Respuesta B"}]}
  ]'::jsonb, 'rt-alt.csv', false)$q$, 'OK'),
  ('extras alternos: la primera columna conserva su clave', 'P', $q$select extra->'forms'->'pregunta'->>'value' = 'Respuesta A' and not (extra->'forms' ? 'pregunta (2)') from participants where email = 'rt.ivan@test.invalid'$q$, 'TRUE'),
  ('extras alternos: la segunda columna no se recorre', 'P', $q$select extra->'forms'->'pregunta (2)'->>'value' = 'Respuesta B' and extra->'forms'->'pregunta (2)'->>'label' = 'Pregunta (2)' and not (extra->'forms' ? 'pregunta') from participants where email = 'rt.juli@test.invalid'$q$, 'TRUE'),
  ('extras alternos: expediente muestra "Pregunta (2)"', 'C', $q$select exists (select 1 from jsonb_array_elements(get_participant(':JID')->'forms_extra') e where e->>'label' = 'Pregunta (2)' and e->>'value' = 'Respuesta B')
      and not exists (select 1 from jsonb_array_elements(get_participant(':JID')->'forms_extra') e where e->>'label' = 'Pregunta')$q$, 'TRUE'),

  -- Unknown careers: resolved once per distinct value, raw text kept
  ('carrera: vista previa con carreras desconocidas', 'C', $q$select preview_participant_import('[
    {"row":2,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true},
    {"row":3,"email":"rt.gabi@test.invalid","full_name":"Gabi Prueba","birth_date":"2008-02-03","career":"  medicina   VETERINARIA ","consent":true},
    {"row":4,"email":"rt.hugo@test.invalid","full_name":"Hugo Prueba","birth_date":"2008-02-04","career":"Gastronomía Molecular","consent":true},
    {"row":5,"email":"rt.ines@test.invalid","full_name":"Ines Prueba","birth_date":"2008-02-05","career":"RT-REAL","consent":true}
  ]'::jsonb, false)$q$, 'OK'),
  ('carrera: valor desconocido agrupado una sola vez', 'P', $q$select jsonb_array_length($LAST::jsonb->'unmatched_careers') = 2
      and jsonb_path_exists($LAST::jsonb, '$.unmatched_careers[*] ? (@.count == 2 && @.target == null)')
      and jsonb_path_exists($LAST::jsonb, '$.unmatched_careers[*] ? (@.count == 1)')$q$, 'TRUE'),
  ('carrera: filas marcadas con el valor original', 'P', $q$select (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'career_unresolved')::boolean
      and (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 3)')->>'career_unresolved')::boolean
      and (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->'warnings')::text like '%Medicina Veterinaria%'
      and not (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 5)')->>'career_unresolved')::boolean$q$, 'TRUE'),
  ('carrera: confirmar sin resolver se bloquea', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true}
  ]'::jsonb, 'rt-car.csv', false)$q$, 'ERR:UNRESOLVED_CAREERS'),
  ('carrera: bloqueo no guarda nada', 'P', $q$select count(*) = 0 from participants where email = 'rt.carla@test.invalid'$q$, 'TRUE'),
  ('carrera: resolver solo una parte sigue bloqueado', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true},
    {"row":4,"email":"rt.hugo@test.invalid","full_name":"Hugo Prueba","birth_date":"2008-02-04","career":"Gastronomía Molecular","consent":true}
  ]'::jsonb, 'rt-car.csv', false, '{"medicina veterinaria":":REAL"}'::jsonb)$q$, 'ERR:UNRESOLVED_CAREERS'),
  ('carrera: no se puede relacionar con carrera de prueba', 'C', $q$select preview_participant_import('[
    {"row":2,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true}
  ]'::jsonb, false, '{"medicina veterinaria":":DEMO"}'::jsonb)$q$, 'ERR:INVALID_CAREER'),
  ('carrera: no se puede relacionar con carrera inactiva', 'C', $q$select preview_participant_import('[
    {"row":2,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true}
  ]'::jsonb, false, '{"medicina veterinaria":":OFF"}'::jsonb)$q$, 'ERR:INVALID_CAREER'),
  ('carrera: confirmar con todo resuelto', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true},
    {"row":3,"email":"rt.gabi@test.invalid","full_name":"Gabi Prueba","birth_date":"2008-02-03","career":"  medicina   VETERINARIA ","consent":true},
    {"row":4,"email":"rt.hugo@test.invalid","full_name":"Hugo Prueba","birth_date":"2008-02-04","career":"Gastronomía Molecular","consent":true},
    {"row":5,"email":"rt.ines@test.invalid","full_name":"Ines Prueba","birth_date":"2008-02-05","career":"RT-REAL","consent":true}
  ]'::jsonb, 'rt-car.csv', false, '{"medicina veterinaria":":REAL","gastronomia molecular":"none"}'::jsonb)$q$, 'OK'),
  ('carrera: un mapeo aplica a todas las filas y conserva el texto original', 'P', $q$select count(*) = 2 and bool_and(initial_career_id = ':REAL') and array_agg(initial_career_raw order by email) = ARRAY['Medicina Veterinaria','medicina VETERINARIA']
      from participants where email in ('rt.carla@test.invalid','rt.gabi@test.invalid')$q$, 'TRUE'),
  ('carrera: "Sin carrera" explícito conserva el texto', 'P', $q$select initial_career_id is null and initial_career_raw = 'Gastronomía Molecular' from participants where email = 'rt.hugo@test.invalid'$q$, 'TRUE'),
  ('carrera: mapeo auditado', 'P', $q$select count(*) = 1 from audit_log where action = 'participants.career_mapped' and actor_user_id = '00000000-0000-4000-8000-0000000000c1'
      and jsonb_array_length(detail->'mappings') = 2 and jsonb_path_exists(detail, '$.mappings[*] ? (@.rows == 2)')$q$, 'TRUE'),
  ('carrera: expediente muestra texto recibido', 'C', $q$select get_participant(':CID')->>'initial_career_raw' = 'Medicina Veterinaria'$q$, 'TRUE'),

  -- Automatic recognition in a REAL import only accepts active, non-demo careers
  ('catálogo: vista previa real con carreras real, inactiva y de prueba', 'C', $q$select preview_participant_import('[
    {"row":2,"email":"rt.nico@test.invalid","full_name":"Nico Real","birth_date":"2008-06-01","career":"rt carrera real","consent":true},
    {"row":3,"email":"rt.olga@test.invalid","full_name":"Olga Inactiva","birth_date":"2008-06-02","career":"RT-OFF","consent":true},
    {"row":4,"email":"rt.pepe@test.invalid","full_name":"Pepe Codigo Demo","birth_date":"2008-06-03","career":"DEMO-MED","consent":true},
    {"row":5,"email":"rt.quin@test.invalid","full_name":"Quin Nombre Demo","birth_date":"2008-06-04","career":"  RT medicina ","consent":true}
  ]'::jsonb, false)$q$, 'OK'),
  ('catálogo: carrera real activa se reconoce sola', 'P', $q$select not (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'career_unresolved')::boolean
      and not jsonb_path_exists($LAST::jsonb, '$.unmatched_careers[*] ? (@.key == "rt carrera real")')$q$, 'TRUE'),
  ('catálogo: inactiva, código demo y nombre demo quedan pendientes', 'P', $q$select jsonb_array_length($LAST::jsonb->'unmatched_careers') = 3
      and jsonb_path_exists($LAST::jsonb, '$.unmatched_careers[*] ? (@.key == "rt-off" && @.target == null)')
      and jsonb_path_exists($LAST::jsonb, '$.unmatched_careers[*] ? (@.key == "demo-med" && @.target == null)')
      and jsonb_path_exists($LAST::jsonb, '$.unmatched_careers[*] ? (@.key == "rt medicina" && @.target == null)')
      and (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 3)')->>'career_unresolved')::boolean
      and (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 4)')->>'career_unresolved')::boolean
      and (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 5)')->>'career_unresolved')::boolean$q$, 'TRUE'),
  ('catálogo: no se puede cargar sin resolverlas', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.nico@test.invalid","full_name":"Nico Real","birth_date":"2008-06-01","career":"rt carrera real","consent":true},
    {"row":4,"email":"rt.pepe@test.invalid","full_name":"Pepe Codigo Demo","birth_date":"2008-06-03","career":"DEMO-MED","consent":true}
  ]'::jsonb, 'rt-cat.csv', false)$q$, 'ERR:UNRESOLVED_CAREERS'),
  ('catálogo: nada se guardó con la carrera de prueba', 'P', $q$select count(*) = 0 from participants where email in ('rt.nico@test.invalid','rt.pepe@test.invalid')$q$, 'TRUE'),
  ('catálogo: relacionadas con carrera real activa se cargan', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.nico@test.invalid","full_name":"Nico Real","birth_date":"2008-06-01","career":"rt carrera real","consent":true},
    {"row":3,"email":"rt.olga@test.invalid","full_name":"Olga Inactiva","birth_date":"2008-06-02","career":"RT-OFF","consent":true},
    {"row":4,"email":"rt.pepe@test.invalid","full_name":"Pepe Codigo Demo","birth_date":"2008-06-03","career":"DEMO-MED","consent":true},
    {"row":5,"email":"rt.quin@test.invalid","full_name":"Quin Nombre Demo","birth_date":"2008-06-04","career":"  RT medicina ","consent":true}
  ]'::jsonb, 'rt-cat.csv', false, '{"rt-off":":REAL","demo-med":":REAL","rt medicina":":REAL"}'::jsonb)$q$, 'OK'),
  ('catálogo: todas quedan con la carrera real y conservan el texto', 'P', $q$select count(*) = 4 and bool_and(initial_career_id = ':REAL')
      and array_agg(initial_career_raw order by email) = ARRAY['rt carrera real','RT-OFF','DEMO-MED','RT medicina']
      from participants where email in ('rt.nico@test.invalid','rt.olga@test.invalid','rt.pepe@test.invalid','rt.quin@test.invalid')$q$, 'TRUE'),

  -- Re-import unchanged
  ('import 2 sin cambios', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"RT-REAL","consent":true,"submitted_at":"2026-01-10T10:00:00Z","extra":[{"col":9,"header":"¿Cómo te enteraste?","value":"Instagram"}]}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('import: sin cambios', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' = 'unchanged'$q$, 'TRUE'),

  -- Manual correction preserved
  ('corrección manual de teléfono', 'C', $q$select update_participant(':AID', '{"phone":"9989999999"}'::jsonb)$q$, 'OK'),
  ('import 3 con teléfono viejo', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"RT-REAL","consent":true}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('import: corrección manual se conserva', 'P', $q$select phone = '9989999999' from participants where id = ':AID'$q$, 'TRUE'),

  -- Email correction + old email in Forms
  ('corregir correo con motivo', 'C', $q$select update_participant(':AID', '{"email":"rt.ana2@test.invalid","email_reason":"Error al escribir en Forms"}'::jsonb)$q$, 'OK'),
  ('correo: historial guarda correo anterior y motivo', 'P', $q$select count(*) = 1 from participant_email_history where participant_id = ':AID' and email = 'rt.ana@test.invalid' and reason = 'Error al escribir en Forms' and changed_by = '00000000-0000-4000-8000-0000000000c1'$q$, 'TRUE'),
  ('import 4 con correo anterior', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","phone":"9981111111","high_school":"Prepa Uno","career":"RT-REAL","consent":true}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('correo: reconocido por correo anterior', 'P', $q$select (jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'note') like 'Reconocido por correo anterior%' and jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' <> 'new'$q$, 'TRUE'),
  ('correo: no se crea duplicado ni se revierte', 'P', $q$select (select count(*) from participants where edition_id = active_edition_id() and email in ('rt.ana@test.invalid','rt.ana2@test.invalid')) = 1 and (select email from participants where id = ':AID') = 'rt.ana2@test.invalid'$q$, 'TRUE'),
  ('correo: el anterior no sirve para entrar', 'P', $q$select count(*) = 0 from participants where edition_id = active_edition_id() and email = 'rt.ana@test.invalid'$q$, 'TRUE'),
  ('correo: no se puede reutilizar un correo anterior', 'C', $q$select create_participant_manual('{"email":"rt.ana@test.invalid","full_name":"Otra Persona","birth_date":"2008-01-01","phone":"9983333333","high_school":"Prepa Tres","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'ERR:EMAIL_EXISTS'),
  ('import 5 correo anterior con nombre y fecha distintos', 'C', $q$select preview_participant_import('[{"row":2,"email":"rt.ana@test.invalid","full_name":"Zeta Distinta","birth_date":"1990-01-01","career":"RT-REAL","consent":true}]'::jsonb, false)$q$, 'OK'),
  ('correo: alerta fuerte sin bloquear la fila', 'P', $q$select jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'alert' is not null and jsonb_path_query_first($LAST::jsonb, '$.** ? (@.row == 2)')->>'status' <> 'error'$q$, 'TRUE'),

  -- In-person sign-up: every field required, career only from the active official catalog
  ('alta presencial: falta fecha', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","phone":"9984444444","high_school":"Prepa Cuatro","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'ERR:BIRTH_DATE_REQUIRED'),
  ('alta presencial: falta teléfono', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","high_school":"Prepa Cuatro","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'ERR:PHONE_REQUIRED'),
  ('alta presencial: falta preparatoria', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"  ","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'ERR:HIGH_SCHOOL_REQUIRED'),
  ('alta presencial: falta carrera', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"Prepa Cuatro","consent_confirmed":true}'::jsonb)$q$, 'ERR:CAREER_REQUIRED'),
  ('alta presencial: carrera fuera del catálogo', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"Prepa Cuatro","initial_career_id":"00000000-0000-0000-0000-000000000000","consent_confirmed":true}'::jsonb)$q$, 'ERR:INVALID_CAREER'),
  ('alta presencial: carrera inactiva', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"Prepa Cuatro","initial_career_id":":OFF","consent_confirmed":true}'::jsonb)$q$, 'ERR:INVALID_CAREER'),
  ('alta presencial: carrera de prueba en alta real', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"Prepa Cuatro","initial_career_id":":DEMO","consent_confirmed":true}'::jsonb)$q$, 'ERR:INVALID_CAREER'),
  ('alta presencial: sin consentimiento', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"Prepa Cuatro","initial_career_id":":REAL","consent_confirmed":false}'::jsonb)$q$, 'ERR:CONSENT_REQUIRED'),
  ('alta presencial: completa (staff)', 'S', $q$select create_participant_manual('{"email":"rt.fer@test.invalid","full_name":"Fer Manual","birth_date":"2008-07-07","phone":"9984444444","high_school":"Prepa Cuatro","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'OK'),
  ('alta presencial: guarda todo con origen manual', 'P', $q$select origin = 'manual' and birth_date = '2008-07-07' and phone = '9984444444' and high_school = 'Prepa Cuatro' and initial_career_id = ':REAL'
      and manual_consent_at is not null and manual_overrides ?& ARRAY['full_name','birth_date','phone','high_school','initial_career_id'] from participants where id = ':FID'$q$, 'TRUE'),
  ('import 6 con datos distintos del alta', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.fer@test.invalid","full_name":"Fernanda Forms","birth_date":"2008-07-07","phone":"9982222222","high_school":"Prepa Dos","career":"RT-REAL","consent":true}]'::jsonb, 'rt.csv', false)$q$, 'OK'),
  ('alta presencial: recarga no reemplaza datos capturados ni duplica', 'P', $q$select phone = '9984444444' and high_school = 'Prepa Cuatro' and full_name = 'Fer Manual' and (select count(*) from participants where email = 'rt.fer@test.invalid') = 1 from participants where id = ':FID'$q$, 'TRUE'),

  -- Demo row
  ('import demo', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.demo@test.invalid","full_name":"Demo Prueba","birth_date":"2008-08-08","career":"DEMO-MED","consent":true}]'::jsonb, 'rt-demo.csv', true)$q$, 'OK'),
  ('demo: importación de prueba sí reconoce carrera de prueba', 'P', $q$select initial_career_id = ':DEMO' and is_demo from participants where email = 'rt.demo@test.invalid'$q$, 'TRUE'),

  -- Export
  ('exportar sin demo', 'C', $q$select export_participants('prueba regresion', false)$q$, 'OK'),
  ('export: excluye datos de prueba', 'P', $q$select not jsonb_path_exists($LAST::jsonb, '$.rows[*] ? (@.email == "rt.demo@test.invalid")')$q$, 'TRUE'),
  ('export: fila de Forms completa', 'P', $q$select r->>'birth_date' = '2008-05-14' and r->>'phone' = '9989999999' and r->>'high_school' = 'Prepa Uno' and r->>'initial_career' is not null
      and r ? 'interest_1' and r->>'origin' = 'forms' and (r->>'forms_consent')::boolean and r->>'previous_emails' like '%rt.ana@test.invalid%'
      and r->'forms_extra'->>'¿como te enteraste?' = 'Instagram'
      from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.ana2@test.invalid")') r$q$, 'TRUE'),
  ('export: fila manual con consentimiento', 'P', $q$select r->>'origin' = 'manual' and r->>'manual_consent_at' is not null and r->>'birth_date' = '2008-07-07' from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.fer@test.invalid")') r$q$, 'TRUE'),
  ('export: columnas extra estables y legibles', 'P', $q$select jsonb_path_exists($LAST::jsonb, '$.extra_columns[*] ? (@.label == "¿Cómo te enteraste? (2)")') and jsonb_path_exists($LAST::jsonb, '$.extra_columns[*] ? (@.key == "¿como te enteraste?")')$q$, 'TRUE'),
  ('export: extras alternos en su columna', 'P', $q$select jsonb_path_exists($LAST::jsonb, '$.extra_columns[*] ? (@.key == "pregunta (2)" && @.label == "Pregunta (2)")')
      and (select r->'forms_extra'->>'pregunta (2)' = 'Respuesta B' and not (r->'forms_extra' ? 'pregunta') from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.juli@test.invalid")') r)
      and (select r->'forms_extra'->>'pregunta' = 'Respuesta A' and not (r->'forms_extra' ? 'pregunta (2)') from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.ivan@test.invalid")') r)$q$, 'TRUE'),
  ('export: carrera recibida en Forms', 'P', $q$select r->>'initial_career_received' = 'Medicina Veterinaria' and r->>'initial_career' = 'RT Carrera Real' from jsonb_path_query($LAST::jsonb, '$.rows[*] ? (@.email == "rt.carla@test.invalid")') r$q$, 'TRUE'),
  ('export: indica estado del padrón', 'P', $q$select $LAST::jsonb->>'roster_status' = 'preparacion'$q$, 'TRUE'),
  ('exportar con demo', 'C', $q$select export_participants('prueba regresion', true)$q$, 'OK'),
  ('export: incluye demo cuando se pide', 'P', $q$select jsonb_path_exists($LAST::jsonb, '$.rows[*] ? (@.email == "rt.demo@test.invalid")')$q$, 'TRUE'),

  -- Extras visibility
  ('extras: coordinación los ve', 'C', $q$select jsonb_array_length(get_participant(':AID')->'forms_extra') >= 4$q$, 'TRUE'),
  ('extras: staff no los recibe', 'S', $q$select not (get_participant(':AID') ? 'forms_extra')$q$, 'TRUE'),
  ('correo: historial visible en expediente', 'S', $q$select jsonb_array_length(get_participant(':AID')->'email_history') = 1$q$, 'TRUE'),

  -- Official roster
  ('padrón: staff no lo declara', 'S', $q$select declare_official_roster('DECLARAR PADRÓN OFICIAL')$q$, 'ERR:NOT_AUTHORIZED'),
  ('padrón: sorteo no lo declara', 'R', $q$select declare_official_roster('DECLARAR PADRÓN OFICIAL')$q$, 'ERR:NOT_AUTHORIZED'),
  ('padrón: frase incorrecta', 'C', $q$select declare_official_roster('declarar')$q$, 'ERR:WRONG_PHRASE'),
  ('padrón: coordinación lo declara', 'C', $q$select declare_official_roster('DECLARAR PADRÓN OFICIAL')$q$, 'OK'),
  ('padrón: estado oficial con fecha', 'P', $q$select roster_status = 'oficial' and roster_declared_at is not null from editions where id = active_edition_id()$q$, 'TRUE'),
  ('padrón: declaración auditada', 'P', $q$select count(*) = 1 from audit_log where action = 'roster.declared_official' and actor_user_id = '00000000-0000-4000-8000-0000000000c1'$q$, 'TRUE'),
  ('padrón: no se declara dos veces', 'C', $q$select declare_official_roster('DECLARAR PADRÓN OFICIAL')$q$, 'ERR:ROSTER_ALREADY_OFFICIAL'),
  ('padrón oficial: bloquea vista previa', 'C', $q$select preview_participant_import('[{"row":2,"email":"rt.kim@test.invalid","full_name":"Kim Tarde","birth_date":"2008-09-09","career":"RT-REAL","consent":true}]'::jsonb, false)$q$, 'ERR:ROSTER_OFFICIAL'),
  ('padrón oficial: bloquea carga directa por RPC', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.kim@test.invalid","full_name":"Kim Tarde","birth_date":"2008-09-09","career":"RT-REAL","consent":true}]'::jsonb, 'tarde.csv', false)$q$, 'ERR:ROSTER_OFFICIAL'),
  ('padrón oficial: bloquea también datos de prueba', 'C', $q$select commit_participant_import('[{"row":2,"email":"rt.kim@test.invalid","full_name":"Kim Tarde","birth_date":"2008-09-09","career":"RT-REAL","consent":true}]'::jsonb, 'tarde.csv', true)$q$, 'ERR:ROSTER_OFFICIAL'),
  ('padrón oficial: nada se cargó', 'P', $q$select count(*) = 0 from participants where email = 'rt.kim@test.invalid'$q$, 'TRUE'),
  ('padrón oficial: alta presencial funciona', 'S', $q$select create_participant_manual('{"email":"rt.luis@test.invalid","full_name":"Luis Presencial","birth_date":"2008-10-10","phone":"9985555555","high_school":"Prepa Cinco","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'OK'),
  ('padrón oficial: alta presencial sigue validando', 'S', $q$select create_participant_manual('{"email":"rt.mar@test.invalid","full_name":"Mar Presencial","birth_date":"2008-10-11","phone":"9986666666","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'ERR:HIGH_SCHOOL_REQUIRED'),
  ('padrón oficial: alta presencial guardada', 'P', $q$select count(*) = 1 from participants where email = 'rt.luis@test.invalid' and origin = 'manual'$q$, 'TRUE'),
  ('padrón oficial: edición manual funciona', 'C', $q$select update_participant(':FID', '{"phone":"9987777777"}'::jsonb)$q$, 'OK'),

  -- Exceptional reopening
  ('reapertura: staff no puede', 'S', $q$select reopen_roster_import('REABRIR IMPORTACIÓN', 'Llegó una corrección de Admisiones')$q$, 'ERR:NOT_AUTHORIZED'),
  ('reapertura: cuenta desactivada no puede', 'D', $q$select reopen_roster_import('REABRIR IMPORTACIÓN', 'Llegó una corrección de Admisiones')$q$, 'ERR:NOT_AUTHORIZED'),
  ('reapertura: motivo obligatorio', 'C', $q$select reopen_roster_import('REABRIR IMPORTACIÓN', '  ')$q$, 'ERR:REASON_REQUIRED'),
  ('reapertura: motivo demasiado corto', 'C', $q$select reopen_roster_import('REABRIR IMPORTACIÓN', 'error')$q$, 'ERR:REASON_REQUIRED'),
  ('reapertura: frase incorrecta', 'C', $q$select reopen_roster_import('reabrir', 'Llegó una corrección de Admisiones')$q$, 'ERR:WRONG_PHRASE'),
  ('reapertura: sigue oficial tras intentos fallidos', 'P', $q$select roster_status = 'oficial' from editions where id = active_edition_id()$q$, 'TRUE'),
  ('reapertura: coordinación reabre', 'C', $q$select reopen_roster_import('REABRIR IMPORTACIÓN', 'Llegó una corrección de Admisiones')$q$, 'OK'),
  ('reapertura: vuelve a preparación', 'P', $q$select roster_status = 'preparacion' from editions where id = active_edition_id()$q$, 'TRUE'),
  ('reapertura: auditada con quién y por qué', 'P', $q$select count(*) = 1 from audit_log where action = 'roster.reopened' and actor_user_id = '00000000-0000-4000-8000-0000000000c1'
      and detail->>'reason' = 'Llegó una corrección de Admisiones' and detail->>'declared_at' is not null and created_at is not null$q$, 'TRUE'),
  ('reapertura: no se reabre si no es oficial', 'C', $q$select reopen_roster_import('REABRIR IMPORTACIÓN', 'Llegó una corrección de Admisiones')$q$, 'ERR:ROSTER_NOT_OFFICIAL'),

  -- Reload during preparation does not duplicate
  ('recarga: contar antes', 'P', $q$select count(*) from participants where edition_id = active_edition_id() and email like 'rt.%@test.invalid'$q$, 'SHOW'),
  ('recarga: mismo CSV completo otra vez', 'C', $q$select commit_participant_import('[
    {"row":2,"email":"rt.beto@test.invalid","full_name":"Beto Dos","birth_date":"2008-01-01","career":"RT-REAL","consent":true},
    {"row":3,"email":"rt.ivan@test.invalid","full_name":"Ivan Alterno","birth_date":"2008-04-04","career":"RT-REAL","consent":true,"extra":[{"col":9,"header":"Pregunta","value":"Respuesta A"},{"col":10,"header":"Pregunta","value":""}]},
    {"row":4,"email":"rt.carla@test.invalid","full_name":"Carla Prueba","birth_date":"2008-02-02","career":"Medicina Veterinaria","consent":true},
    {"row":5,"email":"rt.fer@test.invalid","full_name":"Fernanda Forms","birth_date":"2008-07-07","career":"RT-REAL","consent":true},
    {"row":6,"email":"RT.Ana@test.invalid","full_name":"Ana Prueba","birth_date":"2008-05-14","career":"RT-REAL","consent":true}
  ]'::jsonb, 'rt-recarga.csv', false, '{"medicina veterinaria":":REAL"}'::jsonb)$q$, 'OK'),
  ('recarga: ninguna fila nueva', 'P', $q$select not jsonb_path_exists($LAST::jsonb, '$.** ? (@.status == "new")')$q$, 'TRUE'),
  ('recarga: no duplica aspirantes', 'P', $q$select count(*) = 15 and count(distinct email) = count(*) from participants where edition_id = active_edition_id() and email like 'rt.%@test.invalid'$q$, 'TRUE'),

  ('catálogo: ningún aspirante real referencia una carrera de prueba', 'P', $q$select not exists (select 1 from participants p join careers k on k.id = p.initial_career_id where not p.is_demo and k.is_demo)$q$, 'TRUE'),

  -- Consent guard (student = participant A)
  ('vincular aspirante', 'P', $q$update participants set auth_user_id = '00000000-0000-4000-8000-0000000000c6' where id = ':AID'$q$, 'SHOW'),
  ('aviso: guardar intereses sin aviso se rechaza', 'T', $q$select save_post_event_interests(array[]::uuid[])$q$, 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('aviso: progreso disponible antes del aviso', 'T', $q$select my_progress()$q$, 'OK'),
  ('aviso: aceptar aviso', 'T', $q$select accept_platform_notice()$q$, 'OK'),
  ('aviso: después de aceptar ya no lo exige', 'T', $q$select save_post_event_interests(array[(select id from careers where code = 'DEMO-MED')])$q$, 'NOT:PRIVACY_NOTICE_REQUIRED'),
  ('aspirante: no ve expedientes', 'T', $q$select get_participant(':AID')$q$, 'ERR:NOT_AUTHORIZED'),
  ('aspirante: no exporta', 'T', $q$select export_participants('x', false)$q$, 'ERR:NOT_AUTHORIZED'),
  ('aspirante: no declara padrón', 'T', $q$select declare_official_roster('DECLARAR PADRÓN OFICIAL')$q$, 'ERR:NOT_AUTHORIZED'),
  ('aspirante: no da altas', 'T', $q$select create_participant_manual('{"email":"rt.x@test.invalid","full_name":"X Prueba","birth_date":"2008-01-01","phone":"9981231234","high_school":"P","initial_career_id":":REAL","consent_confirmed":true}'::jsonb)$q$, 'ERR:NOT_AUTHORIZED'),
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
    v_cid := coalesce((SELECT id::text FROM participants WHERE edition_id = ed AND email = 'rt.carla@test.invalid'), '00000000-0000-0000-0000-000000000000');
    v_jid := coalesce((SELECT id::text FROM participants WHERE edition_id = ed AND email = 'rt.juli@test.invalid'), '00000000-0000-0000-0000-000000000000');
    v_act := coalesce((SELECT id::text FROM activities WHERE title = 'RT taller regresion' LIMIT 1), '00000000-0000-0000-0000-000000000000');
    v_q := replace(replace(replace(replace(replace(st.q, '$LAST', quote_literal(v_last)), ':AID', v_aid), ':FID', v_fid), ':ACT', v_act), ':ANY', v_any);
    v_q := replace(replace(replace(replace(replace(v_q, ':CID', v_cid), ':JID', v_jid), ':REAL', v_real), ':OFF', v_off), ':DEMO', v_demo);
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
