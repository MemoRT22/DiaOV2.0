DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.process_participant_import(jsonb,boolean,uuid,jsonb)'::regprocedure);
  v_old text := E'WHERE upper(code) = upper(v_career_raw) OR fold_text(name) = fold_text(v_career_raw)\nORDER BY (upper(code) = upper(v_career_raw)) DESC LIMIT 1;';
  v_new text := E'WHERE (upper(code) = upper(v_career_raw) OR fold_text(name) = fold_text(v_career_raw))\nAND is_active AND (p_is_demo OR NOT is_demo)\nORDER BY (upper(code) = upper(v_career_raw)) DESC, (is_demo = p_is_demo) DESC LIMIT 1;';
BEGIN
  IF position(v_new in v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old in v_def) = 0 OR position(v_old in substr(v_def, position(v_old in v_def) + 1)) > 0 THEN
    RAISE EXCEPTION 'process_participant_import body differs from the expected version';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;