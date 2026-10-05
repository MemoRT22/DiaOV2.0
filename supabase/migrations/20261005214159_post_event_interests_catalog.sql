/*
# Intereses finales: catálogo seleccionable alineado con el backend

`my_post_event_interests()` ahora devuelve `careers`: las carreras que el participante puede elegir, derivadas de
su identidad (participants.is_demo), con la misma regla que valida `save_post_event_interests()`:
is_active = true AND is_demo = <entorno del participante>.
El frontend usa este catálogo en lugar de `fetchCareers()` (que no filtra por entorno); el backend sigue siendo
la autoridad final.
*/
CREATE OR REPLACE FUNCTION my_post_event_interests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := require_participant(false); v_is_demo boolean;
BEGIN
  SELECT is_demo INTO v_is_demo FROM participants WHERE id = v_pid;
  RETURN post_event_interests_state(v_pid) || jsonb_build_object(
    'max_interests', 3,
    'career_ids', coalesce((SELECT jsonb_agg(career_id ORDER BY preference)
                            FROM post_event_interests WHERE participant_id = v_pid), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('career_id', career_id, 'preference', preference)
                                        ORDER BY preference)
                       FROM post_event_interests WHERE participant_id = v_pid), '[]'::jsonb),
    'careers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name,
                                                             'division_id', c.division_id) ORDER BY c.name)
                         FROM careers c WHERE c.is_active AND c.is_demo = v_is_demo), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION my_post_event_interests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_post_event_interests() TO authenticated;
