-- Día OV 2026: admit 2029 intake periods consistently across every participant write path.
-- Add the CIARM high-school entry needed by the official preregistration list.
-- No participant imports or modifications to existing participants occur in this migration.

DO $$
DECLARE
  target_signature text;
  definition_sql text;
  old_check constant text := 'NOT IN (''2027-01'', ''2027-08'', ''2028-01'', ''2028-08'')';
  new_check constant text := 'NOT IN (''2027-01'', ''2027-08'', ''2028-01'', ''2028-08'', ''2029-01'', ''2029-08'')';
BEGIN
  FOR target_signature IN
    SELECT unnest(ARRAY[
      'public.process_participant_import(jsonb,boolean,uuid,jsonb,jsonb,jsonb)',
      'public.register_self_service_internal(jsonb)',
      'public.admin_create_participant(jsonb)',
      'public.update_participant(uuid,jsonb)'
    ])
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(target_signature)) INTO definition_sql;
    IF definition_sql IS NULL THEN
      RAISE EXCEPTION 'Missing expected period validator function: %', target_signature;
    END IF;
    IF position(old_check IN definition_sql) = 0 THEN
      IF position(new_check IN definition_sql) = 0 THEN
        RAISE EXCEPTION 'Unexpected period validator definition: %', target_signature;
      END IF;
    ELSE
      EXECUTE replace(definition_sql, old_check, new_check);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  existing_check text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_check
  FROM pg_constraint
  WHERE conrelid = 'public.participants'::regclass
    AND conname = 'participants_entry_period_check';
  IF existing_check IS NULL
    OR position('2028-08' IN existing_check) = 0
    OR position('2027-01' IN existing_check) = 0 THEN
    RAISE EXCEPTION 'Unexpected participants_entry_period_check definition';
  END IF;
END $$;

ALTER TABLE public.participants
  DROP CONSTRAINT participants_entry_period_check;
ALTER TABLE public.participants
  ADD CONSTRAINT participants_entry_period_check
  CHECK (entry_period IS NULL OR entry_period IN (
    '2027-01', '2027-08', '2028-01', '2028-08', '2029-01', '2029-08'
  ));

INSERT INTO public.high_schools (name, is_active)
SELECT 'Colegio Internacional Alemán de la Riviera Maya CIARM (Tulum)', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.high_schools
  WHERE public.fold_text(name) = public.fold_text(
    'Colegio Internacional Alemán de la Riviera Maya CIARM (Tulum)'
  )
);
