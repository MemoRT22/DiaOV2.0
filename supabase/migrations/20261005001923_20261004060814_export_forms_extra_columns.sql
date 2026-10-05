CREATE OR REPLACE FUNCTION export_participants(p_reason text, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed editions%ROWTYPE; v_rows jsonb; v_n int; v_cols jsonb;
BEGIN
  PERFORM require_coordinacion();
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED_SHORT'; END IF;
  SELECT * INTO v_ed FROM editions WHERE id = active_edition_id();

  SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.full_name), '[]'::jsonb), count(*) INTO v_rows, v_n FROM (
    SELECT p.full_name, p.email, p.phone, p.birth_date, p.high_school,
      c.code AS initial_career_code, c.name AS initial_career, d.name AS initial_division,
      p.origin, p.is_demo, p.forms_consent, p.forms_consent_at, p.manual_consent_at,
      pp.platform_consent_at, p.auth_user_id IS NOT NULL AS logged_in,
      (SELECT name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id WHERE i.participant_id = p.id AND i.preference = 1) AS interest_1,
      (SELECT name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id WHERE i.participant_id = p.id AND i.preference = 2) AS interest_2,
      (SELECT name FROM post_event_interests i JOIN careers ic ON ic.id = i.career_id WHERE i.participant_id = p.id AND i.preference = 3) AS interest_3,
      (SELECT count(*) FROM attendances a WHERE a.participant_id = p.id) AS attendances,
      (SELECT string_agg(h.email, ', ' ORDER BY h.changed_at) FROM participant_email_history h WHERE h.participant_id = p.id) AS previous_emails,
      (SELECT coalesce(jsonb_object_agg(e.key, e.value->>'value'), '{}'::jsonb)
         FROM jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e) AS forms_extra,
      p.created_at
    FROM participants p
    LEFT JOIN careers c ON c.id = p.initial_career_id
    LEFT JOIN divisions d ON d.id = c.division_id
    LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
    WHERE p.edition_id = v_ed.id AND (coalesce(p_include_demo, false) OR NOT p.is_demo)
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label) ORDER BY k.pos, k.label, k.key), '[]'::jsonb)
  INTO v_cols FROM (
    SELECT DISTINCT ON (e.key) e.key, e.value->>'label' AS label, coalesce((e.value->>'pos')::int, 99999) AS pos
    FROM participants p, jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e
    WHERE p.edition_id = v_ed.id AND (coalesce(p_include_demo, false) OR NOT p.is_demo)
    ORDER BY e.key, coalesce((e.value->>'pos')::int, 99999), e.value->>'label'
  ) k;

  PERFORM write_audit('participants.exported', jsonb_build_object('count', v_n, 'reason', left(btrim(p_reason), 300),
    'include_demo', coalesce(p_include_demo, false)));
  RETURN jsonb_build_object('edition', v_ed.name, 'edition_code', v_ed.code, 'generated_at', now(),
    'generated_by', (SELECT full_name FROM staff_members WHERE user_id = auth.uid()), 'count', v_n, 'rows', v_rows,
    'extra_columns', v_cols);
END;
$$;

REVOKE EXECUTE ON FUNCTION export_participants(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION export_participants(text, boolean) TO authenticated;