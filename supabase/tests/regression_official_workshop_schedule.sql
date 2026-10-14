-- Ejecutar solo en una base local/descartable con todas las migraciones aplicadas.
-- El ROLLBACK conserva intactos catalogo, sesiones, reservaciones, asistencias y credenciales.
BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_edition uuid := (SELECT id FROM public.editions WHERE is_active);
  v_career uuid;
  v_payload jsonb;
  v_payload_15 jsonb;
  v_sub_15 uuid;
  v_sub_30 uuid;
  v_sub_60 uuid;
  v_act_15 uuid;
  v_act_30 uuid;
  v_act_60 uuid;
  v_participant uuid;
  v_reserved_session uuid;
  v_ids_before uuid[];
  v_ids_after uuid[];
  v_ids_15_initial uuid[];
  v_ids_15_at_30 uuid[];
  v_ids_15_back_at_15 uuid[];
  v_times_before tstzrange[];
  v_error text;
BEGIN
  IF (SELECT array_agg(to_char(starts_at AT TIME ZONE 'America/Cancun', 'HH24:MI') || '-' ||
      to_char(ends_at AT TIME ZONE 'America/Cancun', 'HH24:MI') ORDER BY slot_number)
      FROM public.official_workshop_session_slots(DATE '2026-10-15', 15)) <>
      ARRAY['10:00-10:15','10:25-10:40','10:50-11:05','11:15-11:30','11:40-11:55','12:05-12:20'] THEN
    RAISE EXCEPTION 'OFFICIAL_SCHEDULE_15_MISMATCH';
  END IF;
  IF (SELECT array_agg(to_char(starts_at AT TIME ZONE 'America/Cancun', 'HH24:MI') || '-' ||
      to_char(ends_at AT TIME ZONE 'America/Cancun', 'HH24:MI') ORDER BY slot_number)
      FROM public.official_workshop_session_slots(DATE '2026-10-15', 30)) <>
      ARRAY['10:00-10:30','10:40-11:10','11:20-11:50','12:00-12:30'] THEN
    RAISE EXCEPTION 'OFFICIAL_SCHEDULE_30_MISMATCH';
  END IF;
  IF (SELECT array_agg(to_char(starts_at AT TIME ZONE 'America/Cancun', 'HH24:MI') || '-' ||
      to_char(ends_at AT TIME ZONE 'America/Cancun', 'HH24:MI') ORDER BY slot_number)
      FROM public.official_workshop_session_slots(DATE '2026-10-15', 60)) <>
      ARRAY['10:00-11:00','11:20-12:20'] THEN
    RAISE EXCEPTION 'OFFICIAL_SCHEDULE_60_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES (15, 6, 10), (30, 4, 10), (60, 2, 20)) expected(duration, slots, gap)
    WHERE (SELECT count(*) FROM public.official_workshop_session_slots(DATE '2026-10-15', expected.duration)) <> expected.slots
       OR EXISTS (
         SELECT 1 FROM public.official_workshop_session_slots(DATE '2026-10-15', expected.duration) s
         WHERE s.ends_at - s.starts_at <> make_interval(mins => expected.duration)
            OR public.session_stamp_credits(s.starts_at, s.ends_at) <> CASE WHEN expected.duration = 60 THEN 2 ELSE 1 END
       )
       OR EXISTS (
         SELECT 1 FROM (
           SELECT extract(epoch FROM (s.starts_at - lag(s.ends_at) OVER (ORDER BY s.slot_number))) / 60 AS gap
           FROM public.official_workshop_session_slots(DATE '2026-10-15', expected.duration) s
         ) gaps WHERE gap IS NOT NULL AND gap <> expected.gap
       )
  ) THEN RAISE EXCEPTION 'OFFICIAL_DURATION_GAP_OR_CREDITS_MISMATCH'; END IF;

  BEGIN
    PERFORM public.official_workshop_session_slots(DATE '2026-10-15', 45);
    RAISE EXCEPTION 'INVALID_DURATION_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'INVALID_DURATION' THEN RAISE; END IF;
  END;

  SELECT c.id INTO v_career FROM public.careers c
  JOIN public.divisions d ON d.id = c.division_id
  WHERE c.is_active AND NOT c.is_demo AND NOT d.is_demo ORDER BY c.id LIMIT 1;
  IF v_edition IS NULL OR v_career IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_MISSING'; END IF;

  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES(v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'official-schedule@test.invalid', '{}', '{}', now(), now());
  INSERT INTO public.staff_members(user_id, role, full_name, is_active, is_demo)
  VALUES(v_actor, 'coordinacion', 'Calendario SQL local', true, false);
  INSERT INTO public.staff_roles(user_id, role) VALUES(v_actor, 'coordinacion');

  v_payload := jsonb_build_object(
    'facilitator_name','Horario Prueba', 'facilitator_email','horario@test.invalid',
    'activity_type','academica', 'experience_category',null, 'title','Calendario oficial',
    'student_pitch','Prueba local del calendario.', 'objective','Validar horarios.',
    'takeaway','Calendario consistente.', 'keywords',jsonb_build_array('horario','prueba','taller'),
    'session_duration_minutes',30, 'capacity_per_session',20, 'building','Edificio A',
    'room_space','Aula 1', 'requirements',null, 'notes',null,
    'career_ids',jsonb_build_array(v_career));

  v_payload_15 := v_payload || jsonb_build_object(
    'activity_type','vida_universitaria','experience_category','otra','career_ids','[]'::jsonb,
    'session_duration_minutes',15,'title','Calendario 15');
  v_sub_15 := (public.create_workshop_submission_internal(v_payload_15)->>'submission_id')::uuid;
  v_sub_30 := (public.create_workshop_submission_internal(v_payload || jsonb_build_object('title','Calendario 30'))->>'submission_id')::uuid;
  v_sub_60 := (public.create_workshop_submission_internal(v_payload || jsonb_build_object(
    'session_duration_minutes',60,'title','Calendario 60'))->>'submission_id')::uuid;
  v_act_15 := (public.publish_workshop_submission_internal(v_actor, v_sub_15)->>'activity_id')::uuid;
  v_act_30 := (public.publish_workshop_submission_internal(v_actor, v_sub_30)->>'activity_id')::uuid;
  v_act_60 := (public.publish_workshop_submission_internal(v_actor, v_sub_60)->>'activity_id')::uuid;

  IF EXISTS (
    SELECT 1 FROM (VALUES (v_act_15, 15), (v_act_30, 30), (v_act_60, 60)) expected(activity_id, duration)
    WHERE EXISTS (
      (SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = expected.activity_id
       EXCEPT SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
         (SELECT event_date FROM public.editions WHERE id = v_edition), expected.duration))
      UNION ALL
      (SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
         (SELECT event_date FROM public.editions WHERE id = v_edition), expected.duration)
       EXCEPT SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = expected.activity_id)
    )
  ) THEN RAISE EXCEPTION 'PUBLISHED_SCHEDULE_MISMATCH'; END IF;

  -- 15 -> 30: al reducir seis sesiones a cuatro se conservan los cuatro IDs
  -- reutilizables; solamente desaparecen las dos sesiones excedentes sin relaciones.
  SELECT array_agg(id ORDER BY starts_at) INTO v_ids_15_initial
  FROM public.activity_sessions WHERE activity_id = v_act_15;
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub_15,
    v_payload_15 || jsonb_build_object('session_duration_minutes',30,'title','Calendario 15 a 30'));
  SELECT array_agg(id ORDER BY starts_at) INTO v_ids_15_at_30
  FROM public.activity_sessions WHERE activity_id = v_act_15;
  IF cardinality(v_ids_15_at_30) <> 4
     OR v_ids_15_at_30 <> v_ids_15_initial[1:4]
     OR (SELECT published_activity_id FROM public.workshop_submissions WHERE id = v_sub_15) <> v_act_15
     OR EXISTS (
       (SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = v_act_15
        EXCEPT SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
          (SELECT event_date FROM public.editions WHERE id = v_edition), 30))
       UNION ALL
       (SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
          (SELECT event_date FROM public.editions WHERE id = v_edition), 30)
        EXCEPT SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = v_act_15)
     )
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions a
       JOIN public.activity_sessions b ON a.id::text < b.id::text
       WHERE a.activity_id = v_act_15 AND b.activity_id = v_act_15
         AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
     ) THEN
    RAISE EXCEPTION 'EDIT_15_TO_30_LOST_REUSABLE_IDS_OR_CREATED_CONFLICTS';
  END IF;

  -- 30 -> 15: las cuatro sesiones existentes conservan sus IDs y se agregan
  -- únicamente las dos sesiones nuevas necesarias para completar el calendario.
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub_15,
    v_payload_15 || jsonb_build_object('title','Calendario 30 a 15'));
  SELECT array_agg(id ORDER BY starts_at) INTO v_ids_15_back_at_15
  FROM public.activity_sessions WHERE activity_id = v_act_15;
  IF cardinality(v_ids_15_back_at_15) <> 6
     OR NOT v_ids_15_at_30 <@ v_ids_15_back_at_15
     OR (SELECT published_activity_id FROM public.workshop_submissions WHERE id = v_sub_15) <> v_act_15
     OR EXISTS (
       (SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = v_act_15
        EXCEPT SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
          (SELECT event_date FROM public.editions WHERE id = v_edition), 15))
       UNION ALL
       (SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
          (SELECT event_date FROM public.editions WHERE id = v_edition), 15)
        EXCEPT SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = v_act_15)
     )
     OR EXISTS (
       SELECT 1 FROM public.activity_sessions a
       JOIN public.activity_sessions b ON a.id::text < b.id::text
       WHERE a.activity_id = v_act_15 AND b.activity_id = v_act_15
         AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
     ) THEN
    RAISE EXCEPTION 'EDIT_30_TO_15_LOST_EXISTING_IDS_OR_CREATED_CONFLICTS';
  END IF;

  SELECT array_agg(id ORDER BY starts_at), array_agg(tstzrange(starts_at, ends_at, '[)') ORDER BY starts_at)
  INTO v_ids_before, v_times_before FROM public.activity_sessions WHERE activity_id = v_act_30;
  IF (public.publish_workshop_submission_internal(v_actor, v_sub_30)->>'session_count')::int <> 4 OR
     (SELECT array_agg(id ORDER BY starts_at) FROM public.activity_sessions WHERE activity_id = v_act_30) <> v_ids_before THEN
    RAISE EXCEPTION 'PUBLISH_RETRY_DUPLICATED_OR_REPLACED_SESSIONS';
  END IF;

  INSERT INTO public.participants(edition_id,email,full_name,origin,is_demo)
  VALUES(v_edition,'official-schedule-participant@test.invalid','Alumno Horario','manual',false)
  RETURNING id INTO v_participant;
  SELECT id INTO v_reserved_session FROM public.activity_sessions WHERE activity_id = v_act_30 ORDER BY starts_at LIMIT 1;
  INSERT INTO public.reservations(participant_id,session_id,activity_id)
  VALUES(v_participant,v_reserved_session,v_act_30);

  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub_30,
    v_payload || jsonb_build_object('title','Edicion sin cambio de horario'));
  IF (SELECT array_agg(id ORDER BY starts_at) FROM public.activity_sessions WHERE activity_id = v_act_30) <> v_ids_before OR
     (SELECT array_agg(tstzrange(starts_at, ends_at, '[)') ORDER BY starts_at)
      FROM public.activity_sessions WHERE activity_id = v_act_30) <> v_times_before OR
     NOT EXISTS (SELECT 1 FROM public.reservations WHERE participant_id = v_participant AND session_id = v_reserved_session) THEN
    RAISE EXCEPTION 'SAME_DURATION_EDIT_CHANGED_EXISTING_RELATIONS';
  END IF;

  BEGIN
    PERFORM public.workshop_admin_edit_internal(v_actor, v_sub_30,
      v_payload || jsonb_build_object('session_duration_minutes',60));
    RAISE EXCEPTION 'DURATION_CHANGE_WITH_RESERVATION_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'SESSION_SCHEDULE_LOCKED' THEN RAISE; END IF;
  END;
  IF (SELECT array_agg(id ORDER BY starts_at) FROM public.activity_sessions WHERE activity_id = v_act_30) <> v_ids_before OR
     (SELECT array_agg(tstzrange(starts_at, ends_at, '[)') ORDER BY starts_at)
      FROM public.activity_sessions WHERE activity_id = v_act_30) <> v_times_before OR
     (SELECT session_duration_minutes FROM public.workshop_submissions WHERE id = v_sub_30) <> 30 THEN
    RAISE EXCEPTION 'BLOCKED_EDIT_WAS_NOT_ATOMIC';
  END IF;

  SELECT array_agg(id ORDER BY starts_at) INTO v_ids_before
  FROM public.activity_sessions WHERE activity_id = v_act_60;
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub_60,
    v_payload || jsonb_build_object('title','Calendario 60 a 30'));
  SELECT array_agg(id ORDER BY starts_at) INTO v_ids_after
  FROM public.activity_sessions WHERE activity_id = v_act_60;
  IF cardinality(v_ids_after) <> 4 OR NOT v_ids_before <@ v_ids_after OR EXISTS (
    (SELECT starts_at, ends_at FROM public.activity_sessions WHERE activity_id = v_act_60
     EXCEPT SELECT starts_at, ends_at FROM public.official_workshop_session_slots(
       (SELECT event_date FROM public.editions WHERE id = v_edition), 30))
  ) THEN RAISE EXCEPTION 'DURATION_EDIT_DID_NOT_REUSE_IDS_OR_USE_OFFICIAL_SCHEDULE'; END IF;

  RAISE NOTICE 'OFFICIAL_WORKSHOP_SCHEDULE_OK';
END;
$test$;

ROLLBACK;
