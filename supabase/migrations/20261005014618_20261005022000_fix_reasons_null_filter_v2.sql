/* Fix: filter jsonb null from reasons array (elem != 'null'::jsonb) */

CREATE OR REPLACE FUNCTION public.my_vocational_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_ed editions%ROWTYPE;
  v_participant participants%ROWTYPE;
  v_initial_career jsonb;
  v_attended jsonb;
  v_reserved_only jsonb;
  v_divisions_visited jsonb;
  v_interests jsonb;
  v_attended_tag_codes text[];
  v_reserved_tag_codes text[];
  v_all_tag_codes text[];
  v_recommendations jsonb;
BEGIN
  SELECT p.* INTO v_participant FROM participants p WHERE p.id = v_pid;
  SELECT e.* INTO v_ed FROM editions e WHERE e.id = v_participant.edition_id;

  SELECT jsonb_build_object(
    'career_id', c.id, 'career_name', c.name,
    'division_id', d.id, 'division_name', d.name,
    'division_code', d.code
  ) INTO v_initial_career
  FROM careers c
  JOIN divisions d ON d.id = c.division_id
  WHERE c.id = v_participant.initial_career_id;

  IF v_initial_career IS NULL THEN v_initial_career := 'null'::jsonb; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', a.id, 'title', a.title, 'activity_type', a.activity_type,
    'division_id', a.division_id, 'division_name', d.name, 'division_code', d.code,
    'tags', coalesce((
      SELECT jsonb_agg(jsonb_build_object('code', vt.code, 'label', vt.label) ORDER BY vt.code)
      FROM activity_vocational_tags avt JOIN vocational_tags vt ON vt.id = avt.tag_id
      WHERE avt.activity_id = a.id AND vt.is_active
    ), '[]'::jsonb)
  ) ORDER BY s.starts_at), '[]'::jsonb) INTO v_attended
  FROM attendances att
  JOIN activity_sessions s ON s.id = att.session_id
  JOIN activities a ON a.id = att.activity_id
  JOIN divisions d ON d.id = a.division_id
  WHERE att.participant_id = v_pid;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'activity_id', a.id, 'title', a.title, 'activity_type', a.activity_type,
    'division_id', a.division_id, 'division_name', d.name, 'division_code', d.code
  ) ORDER BY s.starts_at), '[]'::jsonb) INTO v_reserved_only
  FROM reservations r
  JOIN activity_sessions s ON s.id = r.session_id
  JOIN activities a ON a.id = r.activity_id
  JOIN divisions d ON d.id = a.division_id
  WHERE r.participant_id = v_pid AND r.status = 'vigente'
    AND NOT EXISTS (SELECT 1 FROM attendances att WHERE att.participant_id = v_pid AND att.session_id = r.session_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'division_id', d.id, 'division_name', d.name, 'division_code', d.code
  ) ORDER BY d.sort_order), '[]'::jsonb) INTO v_divisions_visited
  FROM (SELECT DISTINCT a.division_id FROM attendances att JOIN activities a ON a.id = att.activity_id WHERE att.participant_id = v_pid) dist
  JOIN divisions d ON d.id = dist.division_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'preference', i.preference, 'career_id', c.id, 'career_name', c.name,
    'division_id', d.id, 'division_name', d.name
  ) ORDER BY i.preference), '[]'::jsonb) INTO v_interests
  FROM post_event_interests i
  JOIN careers c ON c.id = i.career_id
  JOIN divisions d ON d.id = c.division_id
  WHERE i.participant_id = v_pid;

  SELECT coalesce(array_agg(DISTINCT vt.code), '{}') INTO v_attended_tag_codes
  FROM activity_vocational_tags avt JOIN vocational_tags vt ON vt.id = avt.tag_id AND vt.is_active
  WHERE avt.activity_id IN (SELECT a.id FROM attendances att JOIN activities a ON a.id = att.activity_id WHERE att.participant_id = v_pid);

  SELECT coalesce(array_agg(DISTINCT vt.code), '{}') INTO v_reserved_tag_codes
  FROM activity_vocational_tags avt JOIN vocational_tags vt ON vt.id = avt.tag_id AND vt.is_active
  WHERE avt.activity_id IN (SELECT a.id FROM reservations r JOIN activities a ON a.id = r.activity_id WHERE r.participant_id = v_pid AND r.status = 'vigente');

  v_all_tag_codes := array(SELECT DISTINCT unnest(v_attended_tag_codes || v_reserved_tag_codes));

  WITH candidate_careers AS (
    SELECT c.id, c.name, c.division_id, d.name AS division_name, d.code AS division_code
    FROM careers c JOIN divisions d ON d.id = c.division_id
    WHERE c.is_active AND c.is_demo = v_participant.is_demo
      AND EXISTS (SELECT 1 FROM activities a WHERE a.division_id = c.division_id AND a.edition_id = v_ed.id AND a.is_demo = v_participant.is_demo)
  ),
  attended_divisions AS (
    SELECT DISTINCT a.division_id FROM attendances att JOIN activities a ON a.id = att.activity_id WHERE att.participant_id = v_pid
  ),
  reserved_divisions AS (
    SELECT DISTINCT a.division_id FROM reservations r JOIN activities a ON a.id = r.activity_id WHERE r.participant_id = v_pid AND r.status = 'vigente'
  ),
  career_tag_matches AS (
    SELECT cvt.career_id, count(DISTINCT cvt.tag_id) AS tag_count
    FROM career_vocational_tags cvt JOIN vocational_tags vt ON vt.id = cvt.tag_id AND vt.is_active
    WHERE cvt.tag_id IN (
      SELECT avt.tag_id FROM activity_vocational_tags avt JOIN vocational_tags vt2 ON vt2.id = avt.tag_id AND vt2.is_active
      WHERE avt.activity_id IN (
        SELECT a.id FROM attendances att JOIN activities a ON a.id = att.activity_id WHERE att.participant_id = v_pid
        UNION
        SELECT a.id FROM reservations r JOIN activities a ON a.id = r.activity_id WHERE r.participant_id = v_pid AND r.status = 'vigente'
      )
    )
    GROUP BY cvt.career_id
  ),
  scored AS (
    SELECT cc.id, cc.name, cc.division_id, cc.division_name, cc.division_code,
      (CASE WHEN cc.division_id IN (SELECT division_id FROM attended_divisions) THEN 3 ELSE 0 END
       + CASE WHEN cc.division_id IN (SELECT division_id FROM reserved_divisions) THEN 1 ELSE 0 END
       + coalesce(ctm.tag_count, 0) * 2
       + CASE WHEN cc.id = v_participant.initial_career_id THEN 1 ELSE 0 END) AS score,
      (cc.division_id IN (SELECT division_id FROM attended_divisions)) AS ev_attended_div,
      (cc.division_id IN (SELECT division_id FROM reserved_divisions)) AS ev_reserved_div,
      coalesce(ctm.tag_count, 0) > 0 AS ev_tag_match,
      cc.id = v_participant.initial_career_id AS ev_initial
    FROM candidate_careers cc LEFT JOIN career_tag_matches ctm ON ctm.career_id = cc.id
  ),
  filtered AS (SELECT * FROM scored WHERE score > 0),
  ranked AS (
    SELECT f.*,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object('code', vt.code, 'label', vt.label) ORDER BY vt.code)
        FROM career_vocational_tags cvt JOIN vocational_tags vt ON vt.id = cvt.tag_id AND vt.is_active
        WHERE cvt.career_id = f.id AND vt.code = ANY(v_all_tag_codes)
      ), '[]'::jsonb) AS matched_tags
    FROM filtered f ORDER BY f.score DESC, f.name LIMIT 3
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'career_id', r.id, 'career_name', r.name,
    'division_id', r.division_id, 'division_name', r.division_name, 'division_code', r.division_code,
    'reasons', (
      SELECT coalesce(jsonb_agg(elem ORDER BY idx), '[]'::jsonb)
      FROM jsonb_array_elements(
        jsonb_build_array(
          CASE WHEN r.ev_attended_div THEN jsonb_build_object('type', 'attended_division', 'text', 'Asististe a talleres de la división ' || r.division_name) END,
          CASE WHEN r.ev_reserved_div AND NOT r.ev_attended_div THEN jsonb_build_object('type', 'reserved_division', 'text', 'Reservaste talleres de la división ' || r.division_name) END,
          CASE WHEN r.ev_tag_match THEN jsonb_build_object('type', 'tag_match', 'text', 'Exploraste áreas relacionadas con esta carrera') END,
          CASE WHEN r.ev_initial THEN jsonb_build_object('type', 'initial_interest', 'text', 'Esta fue tu carrera de interés inicial') END
        )
      ) WITH ORDINALITY AS arr(elem, idx)
      WHERE elem IS NOT NULL AND elem != 'null'::jsonb
    ),
    'matched_tags', r.matched_tags,
    'is_initial_interest', r.ev_initial
  ) ORDER BY r.score DESC, r.name), '[]'::jsonb) INTO v_recommendations
  FROM ranked r;

  RETURN jsonb_build_object(
    'initial_interest', v_initial_career,
    'attended_workshops', v_attended,
    'reserved_workshops', v_reserved_only,
    'divisions_visited', v_divisions_visited,
    'post_event_interests', v_interests,
    'recommendations', v_recommendations,
    'tag_codes_explored', to_jsonb(v_all_tag_codes)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_vocational_profile() FROM anon;