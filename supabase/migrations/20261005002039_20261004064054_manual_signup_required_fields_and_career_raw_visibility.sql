CREATE OR REPLACE FUNCTION create_participant_manual(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
v_ed uuid := active_edition_id();
v_email text := lower(btrim(coalesce(p->>'email', '')));
v_name text := btrim(coalesce(p->>'full_name', ''));
v_birth date;
v_phone text;
v_school text := nullif(left(btrim(coalesce(p->>'high_school', '')), 200), '');
v_career uuid;
v_demo boolean := coalesce((p->>'is_demo')::boolean, false);
v_now jsonb := jsonb_build_object('by', auth.uid(), 'at', now());
v_ov jsonb;
v_id uuid;
BEGIN
PERFORM require_operativo();
IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
IF coalesce(p->>'birth_date', '') = '' THEN RAISE EXCEPTION 'BIRTH_DATE_REQUIRED'; END IF;
v_birth := check_birth_date((p->>'birth_date')::date);
IF btrim(coalesce(p->>'phone', '')) = '' THEN RAISE EXCEPTION 'PHONE_REQUIRED'; END IF;
v_phone := clean_phone(p->>'phone');
IF v_phone IS NULL THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;
IF v_school IS NULL THEN RAISE EXCEPTION 'HIGH_SCHOOL_REQUIRED'; END IF;
IF coalesce(p->>'initial_career_id', '') = '' THEN RAISE EXCEPTION 'CAREER_REQUIRED'; END IF;
SELECT id INTO v_career FROM careers
WHERE id::text = p->>'initial_career_id' AND is_active AND (v_demo OR NOT is_demo);
IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
IF coalesce((p->>'consent_confirmed')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
IF email_in_use(v_ed, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

v_ov := jsonb_build_object('full_name', v_now, 'birth_date', v_now, 'phone', v_now, 'high_school', v_now, 'initial_career_id', v_now);

INSERT INTO participants (edition_id, email, full_name, birth_date, phone, high_school, initial_career_id, origin,
manual_consent_captured_by, manual_consent_at, manual_consent_version, created_by, is_demo, manual_overrides)
VALUES (v_ed, v_email, v_name, v_birth, v_phone, v_school, v_career, 'manual',
auth.uid(), now(), (SELECT privacy_notice_version FROM editions WHERE id = v_ed), auth.uid(), v_demo, v_ov)
RETURNING id INTO v_id;

PERFORM write_audit('participant.created', jsonb_build_object('participant_id', v_id,
'fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_ov) k)));
RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_participant(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p participants%ROWTYPE; v jsonb;
BEGIN
PERFORM require_operativo();
SELECT * INTO p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
v := jsonb_build_object(
'id', p.id, 'full_name', p.full_name, 'email', p.email, 'birth_date', p.birth_date, 'phone', p.phone,
'high_school', p.high_school, 'initial_career_id', p.initial_career_id, 'initial_career_raw', p.initial_career_raw,
'origin', p.origin, 'is_demo', p.is_demo,
'forms_consent', p.forms_consent, 'forms_consent_at', p.forms_consent_at,
'manual_consent_at', p.manual_consent_at,
'manual_consent_by', (SELECT full_name FROM staff_members WHERE user_id = p.manual_consent_captured_by),
'manual_overrides', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('at', val->>'at',
'cleared', coalesce((val->>'cleared')::boolean, false),
'by', (SELECT full_name FROM staff_members WHERE user_id::text = val->>'by'))), '{}'::jsonb)
FROM jsonb_each(p.manual_overrides) AS t(k, val)),
'email_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('email', h.email, 'changed_at', h.changed_at,
'reason', h.reason, 'changed_by', (SELECT full_name FROM staff_members WHERE user_id = h.changed_by)) ORDER BY h.changed_at DESC), '[]'::jsonb)
FROM participant_email_history h WHERE h.participant_id = p.id),
'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = p.id AND status = 'pending'),
'has_logged_in', p.auth_user_id IS NOT NULL,
'platform_consent_at', (SELECT platform_consent_at FROM participant_profiles WHERE participant_id = p.id),
'attendances', (SELECT count(*) FROM attendances WHERE participant_id = p.id),
'access', access_lock_state(p.email),
'created_at', p.created_at, 'updated_at', p.updated_at
);
IF is_coordinacion() THEN
v := v || jsonb_build_object('forms_extra', (
SELECT coalesce(jsonb_agg(jsonb_build_object('label', e.value->>'label', 'value', e.value->>'value')
ORDER BY (e.value->>'pos')::int NULLS LAST, e.value->>'label'), '[]'::jsonb)
FROM jsonb_each(coalesce(p.extra->'forms', '{}'::jsonb)) e));
END IF;
PERFORM write_audit('participant.viewed', jsonb_build_object('participant_id', p.id));
RETURN v;
END;
$$;

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
p.initial_career_raw AS initial_career_received,
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
'extra_columns', v_cols, 'roster_status', v_ed.roster_status);
END;
$$;