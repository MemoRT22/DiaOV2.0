/*
  Participantes (admin): show the most recent registrations without typing a search.

  Before: search_participants returned [] for queries shorter than 2 characters, so the screen stayed empty until
  staff typed something (a freshly self-registered student "did not appear").
  Now: an empty (or 1-character) query returns the 50 most recent participants of the active edition, newest first.
  Same SECURITY DEFINER guard (require_operativo: Coordinación or Staff), same columns, same 50-row limit; the search
  path for 2+ characters is unchanged.
*/
CREATE OR REPLACE FUNCTION public.search_participants(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q text := lower(btrim(coalesce(p_query, ''))); d text; browse boolean;
BEGIN
  PERFORM require_operativo();
  browse := length(q) < 2;
  d := regexp_replace(q, '[^0-9]', '', 'g');
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT p.id, p.full_name, p.email, p.phone, p.high_school, p.origin, p.is_demo,
        c.name AS career_name, p.auth_user_id IS NOT NULL AS has_logged_in,
        p.password_configured_at IS NOT NULL AS access_configured,
        (SELECT count(*) FROM participant_import_conflicts k WHERE k.participant_id = p.id AND k.status = 'pending')::int AS pending_conflicts,
        p.created_at
      FROM participants p LEFT JOIN careers c ON c.id = p.initial_career_id
      WHERE p.edition_id = active_edition_id()
        AND (browse OR lower(p.full_name) LIKE '%' || q || '%' OR p.email LIKE '%' || q || '%'
          OR (length(d) >= 4 AND p.phone LIKE '%' || d || '%'))
      ORDER BY CASE WHEN browse THEN p.created_at END DESC, p.full_name
      LIMIT 50
    ) x), '[]'::jsonb);
END;
$function$;
