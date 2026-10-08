-- Student-only editorial projection. Operational sessions and availability remain in my_reservation_board().
CREATE FUNCTION public.my_workshop_detail(p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant_id uuid := public.require_participant(true);
  v_participant public.participants%ROWTYPE;
  v_detail jsonb;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE id = v_participant_id;

  SELECT jsonb_build_object(
    'activity_id', a.id,
    'title', a.title,
    'student_pitch', a.description,
    'activity_type', a.activity_type,
    'experience_category', a.experience_category,
    'objective', nullif(btrim(ws.objective), ''),
    'takeaway', nullif(btrim(ws.takeaway), ''),
    'requirements', nullif(btrim(ws.requirements), ''),
    'careers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
      FROM public.activity_careers ac
      JOIN public.careers c ON c.id = ac.career_id
      WHERE ac.activity_id = a.id AND c.is_demo = a.is_demo
    ), '[]'::jsonb),
    'divisions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.sort_order, d.name)
      FROM public.divisions d
      WHERE d.id IN (
        SELECT ad.division_id FROM public.activity_divisions ad WHERE ad.activity_id = a.id
        UNION
        SELECT a.division_id WHERE a.division_id IS NOT NULL
      ) AND d.is_demo = a.is_demo
    ), '[]'::jsonb)
  ) INTO v_detail
  FROM public.activities a
  JOIN public.editions e ON e.id = a.edition_id AND e.is_active
  LEFT JOIN LATERAL (
    SELECT s.objective, s.takeaway, s.requirements
    FROM public.workshop_submissions s
    WHERE s.published_activity_id = a.id AND s.edition_id = a.edition_id
      AND s.is_demo = a.is_demo AND s.status = 'published'
    ORDER BY s.id LIMIT 1
  ) ws ON true
  WHERE a.id = p_activity_id
    AND a.edition_id = v_participant.edition_id
    AND a.is_demo = v_participant.is_demo
    AND EXISTS (
      SELECT 1 FROM public.activity_sessions s
      WHERE s.activity_id = a.id AND s.status = 'activa'
    );

  RETURN v_detail;
END;
$$;

REVOKE ALL ON FUNCTION public.my_workshop_detail(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_workshop_detail(uuid) TO authenticated;

COMMENT ON FUNCTION public.my_workshop_detail(uuid) IS
'Safe student editorial fields for one accessible workshop. Requires active-edition participant and accepted privacy notice. Sessions remain in my_reservation_board().';
