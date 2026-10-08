-- Run after backend_legacy_cleanup_v1 in a disposable database.
BEGIN;
DO $test$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.save_activity(jsonb)',
    'public.save_session(jsonb)',
    'public.save_activity_careers(uuid,uuid[])',
    'public.delete_activity(uuid)',
    'public.delete_session(uuid)',
    'public.session_reservation_counts()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      RAISE EXCEPTION 'LEGACY_RPC_STILL_PRESENT: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_workshop_submission_internal(jsonb)',
    'public.workshop_admin_list_internal(text,text,text,integer)',
    'public.workshop_admin_get_internal(uuid)',
    'public.workshop_admin_edit_internal(uuid,uuid,jsonb)',
    'public.publish_workshop_submission_internal(uuid,uuid)',
    'public.my_workshop_detail(uuid)',
    'public.my_reservation_board()',
    'public.reserve_session(uuid)',
    'public.change_reservation(uuid,uuid)',
    'public.cancel_reservation(uuid)',
    'public.check_in(text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'CURRENT_RPC_MISSING: %', v_signature;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated',
       'public.workshop_review_transition_internal(uuid,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.workshop_review_transition_internal(uuid,uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.workshop_review_transition_internal(uuid,uuid,text,text,text)', 'EXECUTE')
     THEN RAISE EXCEPTION 'DISCARD_RPC_PERMISSIONS'; END IF;
END
$test$;
ROLLBACK;
SELECT 'backend_legacy_cleanup_ok' AS result;
