/*
# Automatic career recognition respects the active, real/demo catalog

1. Problem
- When a CSV career text matched a career by code or name, the import accepted it
  without checking whether that career was active or a demo career. A REAL roster
  could silently link participants to a demo career.

2. Change (process_participant_import only)
- The automatic match now only considers careers that are active and, for real
  imports, not demo. Demo imports may match demo or real active careers, preferring demo.
- Anything else (inactive, demo during a real import, nonexistent) is treated as an
  unrecognized career and goes through the existing mapping flow
  (unmatched_careers / UNRESOLVED_CAREERS / audited mapping).

3. Security
- No grant changes: CREATE OR REPLACE keeps the existing privileges
  (internal helper, not executable by anon or authenticated).

4. Notes
- Applied as a guarded text replacement of the single lookup clause; it fails loudly if
  the function body is not the expected version, and is a no-op if already applied.
*/

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
