/*
# Exportación para Atención Preuniversitaria

1. Funciones (solo Coordinación)
- `export_participants(reason, include_demo)`: devuelve una fila por aspirante (Forms + altas manuales) con datos autorizados,
  origen, carrera inicial, hasta tres intereses posteriores y participación. Se genera al momento, no se guarda archivo.
- `coordination_summary()`: agrega conflictos pendientes.

2. Auditoría
- Cada exportación registra quién, cuándo, motivo y número de registros. Sin datos personales.
*/

CREATE OR REPLACE FUNCTION export_participants(p_reason text, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed editions%ROWTYPE; v_rows jsonb; v_n int;
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
      p.created_at
    FROM participants p
    LEFT JOIN careers c ON c.id = p.initial_career_id
    LEFT JOIN divisions d ON d.id = c.division_id
    LEFT JOIN participant_profiles pp ON pp.participant_id = p.id
    WHERE p.edition_id = v_ed.id AND (coalesce(p_include_demo, false) OR NOT p.is_demo)
  ) x;

  PERFORM write_audit('participants.exported', jsonb_build_object('count', v_n, 'reason', left(btrim(p_reason), 300),
    'include_demo', coalesce(p_include_demo, false)));
  RETURN jsonb_build_object('edition', v_ed.name, 'edition_code', v_ed.code, 'generated_at', now(),
    'generated_by', (SELECT full_name FROM staff_members WHERE user_id = auth.uid()), 'count', v_n, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION coordination_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  PERFORM require_coordinacion();
  RETURN jsonb_build_object(
    'participants_total', (SELECT count(*) FROM participants WHERE edition_id = v_ed),
    'participants_forms', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'forms'),
    'participants_manual', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND origin = 'manual'),
    'participants_demo', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND is_demo),
    'missing_birth_date', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND birth_date IS NULL),
    'platform_consents', (SELECT count(*) FROM participant_profiles pp JOIN participants p ON p.id = pp.participant_id
                          WHERE p.edition_id = v_ed AND pp.platform_consent_at IS NOT NULL),
    'activities', (SELECT count(*) FROM activities WHERE edition_id = v_ed),
    'sessions', (SELECT count(*) FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.edition_id = v_ed),
    'attendances', (SELECT count(*) FROM attendances at JOIN participants p ON p.id = at.participant_id WHERE p.edition_id = v_ed),
    'with_interests', (SELECT count(DISTINCT i.participant_id) FROM post_event_interests i JOIN participants p ON p.id = i.participant_id
                       WHERE p.edition_id = v_ed),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts c JOIN participants p ON p.id = c.participant_id
                          WHERE p.edition_id = v_ed AND c.status = 'pending'),
    'theme_locked', theme_is_locked(v_ed)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION export_participants(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION export_participants(text, boolean) TO authenticated;
