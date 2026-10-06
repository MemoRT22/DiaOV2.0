-- Preparatorias oficiales: configuración persistente, fuera del Preparation Reset.
CREATE TABLE IF NOT EXISTS public.high_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS high_schools_folded_name_key ON public.high_schools (public.fold_text(name));
-- Opción oficial explícita; el resto de la lista de Guillermo se incorpora sin alterar los nombres.
INSERT INTO public.high_schools(name, is_active) VALUES ('Otra escuela', true) ON CONFLICT DO NOTHING;
ALTER TABLE public.high_schools ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.high_schools FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.high_schools TO authenticated, service_role;
DROP POLICY IF EXISTS "Staff reads high schools" ON public.high_schools;
CREATE POLICY "Staff reads high schools" ON public.high_schools FOR SELECT TO authenticated USING ((SELECT public.is_operativo()));

ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS high_school_id uuid REFERENCES public.high_schools(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS participants_high_school_id_idx ON public.participants(high_school_id);

-- El ID es la identidad; el texto se conserva para los consumidores y registros legacy.
CREATE OR REPLACE FUNCTION public.sync_participant_high_school()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  IF NEW.high_school_id IS NOT NULL THEN
    SELECT h.name INTO v_name FROM public.high_schools h WHERE h.id = NEW.high_school_id;
    IF v_name IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
    NEW.high_school := v_name;
  ELSIF NEW.high_school IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.high_school IS DISTINCT FROM OLD.high_school) THEN
    SELECT h.id, h.name INTO NEW.high_school_id, v_name
    FROM public.high_schools h WHERE h.is_active AND public.fold_text(h.name) = public.fold_text(NEW.high_school);
    IF NEW.high_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
    NEW.high_school := v_name;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS participants_sync_high_school ON public.participants;
CREATE TRIGGER participants_sync_high_school BEFORE INSERT OR UPDATE OF high_school, high_school_id
ON public.participants FOR EACH ROW EXECUTE FUNCTION public.sync_participant_high_school();
REVOKE ALL ON FUNCTION public.sync_participant_high_school() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_high_school(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := btrim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g'));
  v_active boolean := coalesce((p->>'is_active')::boolean, true);
BEGIN
  PERFORM public.require_coordinacion();
  IF length(v_name) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF EXISTS (SELECT 1 FROM public.high_schools WHERE public.fold_text(name) = public.fold_text(v_name) AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'HIGH_SCHOOL_EXISTS';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.high_schools(name, is_active) VALUES (v_name, v_active) RETURNING id INTO v_id;
  ELSE
    UPDATE public.high_schools SET name = v_name, is_active = v_active, updated_at = now() WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    UPDATE public.participants SET high_school = v_name WHERE high_school_id = v_id AND high_school IS DISTINCT FROM v_name;
  END IF;
  PERFORM public.write_audit('catalog.high_school_saved', jsonb_build_object('id', v_id, 'active', v_active));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'HIGH_SCHOOL_EXISTS';
END;
$$;
REVOKE ALL ON FUNCTION public.save_high_school(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_high_school(jsonb) TO authenticated;

-- Contratos públicos e internos con el ID estructural.

CREATE OR REPLACE FUNCTION public.register_self_service_internal(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed editions%ROWTYPE;
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_first text := left(btrim(regexp_replace(coalesce(p->>'first_name', ''), '\s+', ' ', 'g')), 75);
  v_last text := left(btrim(regexp_replace(coalesce(p->>'last_name', ''), '\s+', ' ', 'g')), 75);
  v_name text;
  v_phone text;
  v_school text;
  v_school_id uuid;
  v_grade text := nullif(btrim(coalesce(p->>'high_school_grade', '')), '');
  v_period text := nullif(btrim(coalesce(p->>'entry_period', '')), '');
  v_career uuid;
  v_id uuid;
BEGIN
  SELECT * INTO v_ed FROM editions WHERE is_active;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  IF v_first = '' OR v_last = '' THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  v_name := v_first || ' ' || v_last;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  BEGIN v_phone := clean_phone(p->>'phone'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_PHONE'; END;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'PHONE_REQUIRED'; END IF;
  SELECT id, name INTO v_school_id, v_school FROM public.high_schools
  WHERE id::text = p->>'high_school_id' AND is_active;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
  IF v_grade IS NULL OR v_grade NOT IN ('1', '2', '3', 'graduado') THEN RAISE EXCEPTION 'INVALID_GRADE'; END IF;
  IF v_period IS NULL OR v_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  SELECT id INTO v_career FROM careers WHERE id::text = p->>'initial_career_id' AND is_active AND NOT is_demo;
  IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
  IF coalesce((p->>'consent_accepted')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF email_in_use(v_ed.id, v_email, NULL) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  BEGIN
    INSERT INTO participants (edition_id, email, full_name, phone, high_school, high_school_id, high_school_grade, entry_period,
                              initial_career_id, origin, is_demo)
    VALUES (v_ed.id, v_email, v_name, v_phone, v_school, v_school_id, v_grade, v_period, v_career, 'self_service', false)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMAIL_EXISTS';
  END;

  PERFORM sync_initial_interests(v_id, ARRAY[v_career, NULL]::uuid[], ARRAY[NULL, NULL]::text[]);
  UPDATE participant_profiles
  SET platform_consent_at = now(), platform_consent_version = v_ed.privacy_notice_version,
      platform_consent_source = 'self_service', updated_at = now()
  WHERE participant_id = v_id;
  INSERT INTO audit_log (edition_id, actor_user_id, action, detail)
  VALUES (v_ed.id, NULL, 'participant.self_registered', jsonb_build_object('participant_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_participant(p_id uuid, p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur participants%ROWTYPE;
  n participants%ROWTYPE;
  v_fields text[] := '{}';
  v_cleared text[] := '{}';
  v_reason text := nullif(left(btrim(coalesce(p->>'email_reason', '')), 300), '');
  v_ov jsonb;
  v_career2 uuid;
  v_existing_career2 uuid;
  v_new_career1 uuid;
  v_new_career2 uuid;
  v_career_ids uuid[];
  v_career_raws text[];
  v_demo boolean;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO cur FROM participants WHERE id = p_id AND edition_id = active_edition_id() FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  n := cur;

  IF p ? 'email' THEN n.email := lower(btrim(coalesce(p->>'email', '')));
    IF n.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(n.email) > 254 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  END IF;
  IF p ? 'full_name' THEN n.full_name := btrim(coalesce(p->>'full_name', ''));
    IF length(n.full_name) < 3 OR length(n.full_name) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  END IF;
  IF p ? 'phone' THEN n.phone := clean_phone(p->>'phone'); END IF;
  IF p ? 'high_school' THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
  IF p ? 'high_school_id' THEN
    PERFORM public.require_coordinacion();
    IF coalesce(p->>'high_school_id', '') = '' THEN
      n.high_school_id := NULL; n.high_school := NULL;
    ELSE
      SELECT id, name INTO n.high_school_id, n.high_school FROM public.high_schools
      WHERE id::text = p->>'high_school_id' AND (is_active OR id = cur.high_school_id);
      IF n.high_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
    END IF;
  END IF;
  IF p ? 'high_school_grade' THEN n.high_school_grade := nullif(btrim(coalesce(p->>'high_school_grade', '')), '');
    IF n.high_school_grade IS NOT NULL AND n.high_school_grade NOT IN ('1', '2', '3', 'graduado') THEN RAISE EXCEPTION 'INVALID_GRADE'; END IF;
  END IF;
  IF p ? 'entry_period' THEN n.entry_period := nullif(btrim(coalesce(p->>'entry_period', '')), '');
    IF n.entry_period IS NOT NULL AND n.entry_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN RAISE EXCEPTION 'INVALID_PERIOD'; END IF;
  END IF;
  IF p ? 'initial_career_id' THEN n.initial_career_id := nullif(p->>'initial_career_id', '')::uuid;
    IF n.initial_career_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM careers WHERE id = n.initial_career_id) THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
  END IF;

  IF p ? 'initial_career_id_2' THEN
    v_career2 := nullif(p->>'initial_career_id_2', '')::uuid;
    IF v_career2 IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM careers WHERE id = v_career2 AND is_active) THEN
        RAISE EXCEPTION 'INVALID_CAREER';
      END IF;
      v_demo := cur.is_demo;
      IF NOT v_demo AND EXISTS (SELECT 1 FROM careers WHERE id = v_career2 AND is_demo) THEN
        RAISE EXCEPTION 'CAREER_ENVIRONMENT_MISMATCH';
      END IF;
      IF v_career2 = coalesce(n.initial_career_id, cur.initial_career_id) THEN
        RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
      END IF;
      IF coalesce(n.initial_career_id, cur.initial_career_id) IS NULL THEN
        RAISE EXCEPTION 'CAREER_2_REQUIRES_CAREER_1';
      END IF;
    END IF;
  END IF;

  IF n.email IS DISTINCT FROM cur.email THEN
    IF email_in_use(cur.edition_id, n.email, cur.id) THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;
    v_fields := v_fields || 'email'::text;
  END IF;
  IF n.full_name IS DISTINCT FROM cur.full_name THEN v_fields := v_fields || 'full_name'::text; END IF;
  IF n.phone IS DISTINCT FROM cur.phone THEN v_fields := v_fields || 'phone'::text;
    IF n.phone IS NULL THEN v_cleared := v_cleared || 'phone'::text; END IF; END IF;
  IF n.high_school_id IS DISTINCT FROM cur.high_school_id OR n.high_school IS DISTINCT FROM cur.high_school THEN v_fields := v_fields || 'high_school'::text;
    IF n.high_school IS NULL THEN v_cleared := v_cleared || 'high_school'::text; END IF; END IF;
  IF n.high_school_grade IS DISTINCT FROM cur.high_school_grade THEN v_fields := v_fields || 'high_school_grade'::text;
    IF n.high_school_grade IS NULL THEN v_cleared := v_cleared || 'high_school_grade'::text; END IF; END IF;
  IF n.entry_period IS DISTINCT FROM cur.entry_period THEN v_fields := v_fields || 'entry_period'::text;
    IF n.entry_period IS NULL THEN v_cleared := v_cleared || 'entry_period'::text; END IF; END IF;
  IF n.initial_career_id IS DISTINCT FROM cur.initial_career_id THEN v_fields := v_fields || 'initial_career_id'::text;
    IF n.initial_career_id IS NULL THEN v_cleared := v_cleared || 'initial_career_id'::text; END IF; END IF;

  SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
  IF p ? 'initial_career_id_2' AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
    v_fields := v_fields || 'initial_career_id_2'::text;
    IF v_career2 IS NULL THEN v_cleared := v_cleared || 'initial_career_id_2'::text; END IF;
  END IF;

  IF array_length(v_fields, 1) IS NULL THEN RETURN; END IF;

  SELECT cur.manual_overrides || coalesce(jsonb_object_agg(f,
    jsonb_build_object('by', auth.uid(), 'at', now()) || CASE WHEN f = ANY(v_cleared) THEN '{"cleared": true}'::jsonb ELSE '{}'::jsonb END),
    '{}'::jsonb) INTO v_ov
  FROM unnest(v_fields) f WHERE f <> 'email';

  IF n.email IS DISTINCT FROM cur.email THEN
    INSERT INTO participant_email_history (participant_id, edition_id, email, changed_by, reason)
    VALUES (cur.id, cur.edition_id, cur.email, auth.uid(), v_reason)
    ON CONFLICT (edition_id, email) DO NOTHING;
  END IF;

  UPDATE participants SET email = n.email, full_name = n.full_name, phone = n.phone,
    high_school = n.high_school, high_school_id = n.high_school_id, high_school_grade = n.high_school_grade, entry_period = n.entry_period,
    initial_career_id = n.initial_career_id, manual_overrides = v_ov, updated_at = now()
  WHERE id = cur.id;

  IF v_fields @> ARRAY['initial_career_id']::text[] OR v_fields @> ARRAY['initial_career_id_2']::text[] THEN
    IF p ? 'initial_career_id' THEN
      v_new_career1 := n.initial_career_id;
    ELSE
      SELECT career_id INTO v_new_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
    END IF;
    IF p ? 'initial_career_id_2' THEN
      v_new_career2 := v_career2;
    ELSE
      v_new_career2 := v_existing_career2;
    END IF;
    IF v_new_career1 IS NULL AND v_new_career2 IS NOT NULL THEN
      v_new_career1 := v_new_career2;
      v_new_career2 := NULL;
    END IF;
    v_career_ids := ARRAY[v_new_career1, v_new_career2];
    v_career_raws := ARRAY[
      (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 1),
      CASE WHEN p ? 'initial_career_id_2' THEN NULL ELSE (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2) END
    ];
    IF v_new_career1 IS NOT NULL OR v_new_career2 IS NOT NULL THEN
      PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
    ELSE
      DELETE FROM initial_interests WHERE participant_id = cur.id;
      UPDATE participants SET initial_career_id = NULL, initial_career_raw = NULL, updated_at = now() WHERE id = cur.id;
    END IF;
  END IF;

  PERFORM write_audit('participant.updated', jsonb_build_object('participant_id', cur.id, 'fields', to_jsonb(v_fields),
    'cleared', to_jsonb(v_cleared), 'email_changed', n.email IS DISTINCT FROM cur.email, 'reason_given', v_reason IS NOT NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_participant(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p participants%ROWTYPE; v jsonb;
BEGIN
  PERFORM require_operativo();
  SELECT * INTO p FROM participants WHERE id = p_id AND edition_id = active_edition_id();
  IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v := jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
    'high_school', p.high_school, 'high_school_id', p.high_school_id, 'high_school_grade', p.high_school_grade, 'entry_period', p.entry_period,
    'initial_career_id', p.initial_career_id, 'initial_career_raw', p.initial_career_raw,
    'origin', p.origin, 'is_demo', p.is_demo,
    'forms_consent', p.forms_consent, 'forms_consent_at', p.forms_consent_at,
    'manual_consent_at', p.manual_consent_at,
    'manual_consent_by', (SELECT full_name FROM staff_members WHERE user_id = p.manual_consent_captured_by),
    'manual_overrides', (SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('at', val->>'at',
      'cleared', coalesce((val->>'cleared')::boolean, false),
      'by', (SELECT full_name FROM staff_members WHERE user_id::text = val->>'by'))), '{}'::jsonb)
      FROM jsonb_each(p.manual_overrides) AS t(k, val)),
    'initial_interests', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'preference', ii.preference, 'career_id', ii.career_id, 'career_name', c.name, 'career_code', c.code,
      'career_raw', ii.career_raw) ORDER BY ii.preference), '[]'::jsonb)
      FROM initial_interests ii JOIN careers c ON c.id = ii.career_id WHERE ii.participant_id = p.id),
    'email_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('email', h.email, 'changed_at', h.changed_at,
      'reason', h.reason, 'changed_by', (SELECT full_name FROM staff_members WHERE user_id = h.changed_by)) ORDER BY h.changed_at DESC), '[]'::jsonb)
      FROM participant_email_history h WHERE h.participant_id = p.id),
    'pending_conflicts', (SELECT count(*) FROM participant_import_conflicts WHERE participant_id = p.id AND status = 'pending'),
    'has_logged_in', p.auth_user_id IS NOT NULL,
    'access_configured', p.password_configured_at IS NOT NULL,
    'password_configured_at', p.password_configured_at,
    'platform_consent_at', (SELECT platform_consent_at FROM participant_profiles WHERE participant_id = p.id),
    'platform_consent_source', (SELECT platform_consent_source FROM participant_profiles WHERE participant_id = p.id),
    'attendances', (SELECT count(*) FROM attendances WHERE participant_id = p.id),
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

CREATE OR REPLACE FUNCTION public.resolve_import_conflict(p_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c participant_import_conflicts%ROWTYPE; v_school_id uuid; v_school_name text;
BEGIN
  PERFORM require_coordinacion();
  SELECT * INTO c FROM participant_import_conflicts WHERE id = p_id AND status = 'pending' FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_accept THEN
    IF c.field = 'high_school' THEN
      SELECT id, name INTO v_school_id, v_school_name FROM public.high_schools
      WHERE is_active AND public.fold_text(name) = public.fold_text(c.imported_value);
      IF v_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
    END IF;
    UPDATE participants SET
      full_name = CASE WHEN c.field = 'full_name' THEN c.imported_value ELSE full_name END,
      phone = CASE WHEN c.field = 'phone' THEN c.imported_value ELSE phone END,
      high_school = CASE WHEN c.field = 'high_school' THEN v_school_name ELSE high_school END,
      high_school_id = CASE WHEN c.field = 'high_school' THEN v_school_id ELSE high_school_id END,
      high_school_grade = CASE WHEN c.field = 'high_school_grade' THEN c.imported_value ELSE high_school_grade END,
      entry_period = CASE WHEN c.field = 'entry_period' THEN c.imported_value ELSE entry_period END,
      initial_career_id = CASE WHEN c.field = 'initial_career_id' THEN c.imported_value::uuid ELSE initial_career_id END,
      manual_overrides = manual_overrides - c.field,
      updated_at = now()
    WHERE id = c.participant_id;
  END IF;
  UPDATE participant_import_conflicts SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'kept' END,
    resolved_by = auth.uid(), resolved_at = now() WHERE id = c.id;
  PERFORM write_audit('participants.conflict_resolved', jsonb_build_object('participant_id', c.participant_id,
    'field', c.field, 'accepted_import', p_accept));
END;
$$;

DROP FUNCTION IF EXISTS public.preview_participant_import(jsonb, boolean, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.commit_participant_import(jsonb, text, boolean, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.process_participant_import(jsonb, boolean, uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.process_participant_import(p_rows jsonb, p_is_demo boolean, p_batch uuid, p_career_map jsonb, p_career_map_2 jsonb, p_high_school_map jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ed uuid := active_edition_id();
  v_ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  v_apply boolean := p_batch IS NOT NULL;
  v_map jsonb := CASE WHEN jsonb_typeof(p_career_map) = 'object' THEN p_career_map ELSE '{}'::jsonb END;
  v_map2 jsonb := CASE WHEN jsonb_typeof(p_career_map_2) = 'object' THEN p_career_map_2 ELSE '{}'::jsonb END;
  v_school_map jsonb := CASE WHEN jsonb_typeof(p_high_school_map) = 'object' THEN p_high_school_map ELSE '{}'::jsonb END;
  r record; cur participants%ROWTYPE; v_match record;
  v_results jsonb := '[]'::jsonb;
  v_counts jsonb := jsonb_build_object('new',0,'update',0,'unchanged',0,'conflict',0,'duplicate',0,'error',0);
  v_email text; v_name text; v_phone text; v_school text; v_grade text; v_period text; v_consent boolean;
  v_career uuid; v_career_raw text; v_career2 uuid; v_career2_raw text;
  v_at timestamptz;
  v_errors text[]; v_warn text[]; v_status text; v_upd jsonb; v_conf text[]; v_nv jsonb; v_cv jsonb; f text;
  v_extra jsonb; v_old_forms jsonb; v_extra_changed boolean; v_alias text;
  v_ckey text; v_ctarget text; v_cname text;
  v_ckey2 text; v_ctarget2 text; v_cname2 text;
  v_unmatched jsonb := '{}'::jsonb;
  v_unmatched2 jsonb := '{}'::jsonb;
  v_unmatched_schools jsonb := '{}'::jsonb;
  v_school_raw text; v_school_id uuid; v_school_key text; v_school_target text;
  v_career_raw_orig text; v_career2_raw_orig text;
  v_career_ids uuid[]; v_career_raws text[];
  v_existing_career1 uuid; v_existing_career2 uuid;
  v_has_c2_override boolean;
BEGIN
  IF (SELECT roster_status FROM editions WHERE id = v_ed) = 'oficial' THEN RAISE EXCEPTION 'ROSTER_OFFICIAL'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  FOR r IN
    SELECT x.value AS j, x.ord,
      max(x.ord) OVER (PARTITION BY lower(btrim(coalesce(x.value->>'email', '')))) AS last_ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord
  LOOP
    v_errors := '{}'; v_warn := '{}'; v_conf := '{}'; v_upd := '{}'::jsonb; v_alias := NULL;
    v_extra_changed := false; v_ckey := NULL; v_ctarget := NULL; v_ckey2 := NULL; v_ctarget2 := NULL;
    v_email := lower(btrim(coalesce(r.j->>'email', '')));
    v_name := left(btrim(regexp_replace(coalesce(r.j->>'full_name', ''), '\s+', ' ', 'g')), 150);
    v_school_raw := nullif(left(btrim(regexp_replace(coalesce(r.j->>'high_school', ''), '\s+', ' ', 'g')), 200), '');
    v_school := v_school_raw; v_school_id := NULL; v_school_key := NULL; v_school_target := NULL;
    v_phone := NULL; v_career := NULL; v_career2 := NULL; v_at := NULL;
    v_career_raw := NULL; v_career2_raw := NULL;
    v_grade := nullif(btrim(coalesce(r.j->>'high_school_grade', '')), '');
    v_period := nullif(btrim(coalesce(r.j->>'entry_period', '')), '');
    v_consent := CASE WHEN jsonb_typeof(r.j->'consent') = 'boolean' THEN (r.j->>'consent')::boolean ELSE NULL END;

    v_career_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career', ''), '\s+', ' ', 'g')), 200);
    v_career2_raw_orig := left(btrim(regexp_replace(coalesce(r.j->>'career_2', ''), '\s+', ' ', 'g')), 200);

    IF v_career2_raw_orig <> '' THEN
      v_career_raw := v_career_raw_orig;
      v_career2_raw := v_career2_raw_orig;
    ELSIF v_career_raw_orig ~ '[,;]' THEN
      v_career_raw := left(btrim(split_part(v_career_raw_orig, ',', 1)), 200);
      v_career2_raw := left(btrim(split_part(v_career_raw_orig, ',', 2)), 200);
      IF v_career2_raw = '' AND v_career_raw_orig ~ ';' THEN
        v_career_raw := left(btrim(split_part(v_career_raw_orig, ';', 1)), 200);
        v_career2_raw := left(btrim(split_part(v_career_raw_orig, ';', 2)), 200);
      END IF;
      v_career_raw := left(btrim(regexp_replace(v_career_raw, '\s+', ' ', 'g')), 200);
      v_career2_raw := left(btrim(regexp_replace(v_career2_raw, '\s+', ' ', 'g')), 200);
    ELSE
      v_career_raw := v_career_raw_orig;
    END IF;

    v_extra := normalize_forms_extra(r.j->'extra');

    IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email) > 254 THEN v_errors := v_errors || 'Correo inválido'::text; END IF;
    IF length(v_name) < 3 THEN v_errors := v_errors || 'Falta el nombre'::text; END IF;
    IF v_consent IS FALSE THEN v_errors := v_errors || 'Sin consentimiento de privacidad'::text; END IF;
    BEGIN v_phone := clean_phone(r.j->>'phone');
    EXCEPTION WHEN others THEN v_warn := v_warn || 'Teléfono inválido, se omitió'::text; END;
    IF v_grade IS NOT NULL AND v_grade NOT IN ('1', '2', '3', 'graduado') THEN
      v_warn := v_warn || ('Grado de preparatoria no reconocido "' || left(v_grade, 40) || '", se omitió')::text; v_grade := NULL;
    END IF;
    IF v_period IS NOT NULL AND v_period NOT IN ('2027-01', '2027-08', '2028-01', '2028-08') THEN
      v_warn := v_warn || ('Periodo de ingreso no reconocido "' || left(v_period, 40) || '", se omitió')::text; v_period := NULL;
    END IF;

    -- Solo coincidencia normalizada exacta; las decisiones manuales usan IDs oficiales activos.
    IF v_school_raw IS NOT NULL THEN
      SELECT id, name INTO v_school_id, v_school FROM public.high_schools
      WHERE is_active AND public.fold_text(name) = public.fold_text(v_school_raw);
      IF v_school_id IS NULL THEN
        v_school_key := public.fold_text(v_school_raw);
        v_school_target := v_school_map->>v_school_key;
        IF v_school_target IS NOT NULL THEN
          SELECT id, name INTO v_school_id, v_school FROM public.high_schools
          WHERE id::text = v_school_target AND is_active;
          IF v_school_id IS NULL THEN RAISE EXCEPTION 'INVALID_HIGH_SCHOOL'; END IF;
          v_warn := v_warn || ('Preparatoria no reconocida "' || v_school_raw || '": relacionada con ' || v_school)::text;
        ELSE
          v_warn := v_warn || ('Preparatoria no reconocida "' || v_school_raw || '": relaciónala antes de cargar')::text;
        END IF;
      END IF;
    END IF;

    -- Resolve career 1
    IF v_career_raw <> '' THEN
      SELECT id INTO v_career FROM careers
      WHERE (upper(code) = upper(v_career_raw) OR fold_text(name) = fold_text(v_career_raw))
        AND is_active AND (p_is_demo OR NOT is_demo)
      ORDER BY (upper(code) = upper(v_career_raw)) DESC, (is_demo = p_is_demo) DESC LIMIT 1;
      IF v_career IS NULL THEN
        v_ckey := fold_text(v_career_raw);
        v_ctarget := v_map->>v_ckey;
        IF v_ctarget = 'none' THEN
          v_warn := v_warn || ('Carrera no reconocida "' || v_career_raw || '": se carga sin carrera inicial por decisión de Coordinación')::text;
        ELSIF v_ctarget IS NOT NULL THEN
          SELECT id, name INTO v_career, v_cname FROM careers
          WHERE id::text = v_ctarget AND is_active AND (p_is_demo OR NOT is_demo);
          IF v_career IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
          v_warn := v_warn || ('Carrera no reconocida "' || v_career_raw || '": relacionada con ' || v_cname)::text;
        ELSE
          v_warn := v_warn || ('Carrera no reconocida "' || v_career_raw || '": relaciónala con una carrera oficial antes de cargar')::text;
        END IF;
      END IF;
    END IF;

    -- Resolve career 2 (the official Forms has none; kept for files that still bring it)
    IF v_career2_raw <> '' THEN
      IF fold_text(v_career2_raw) = fold_text(v_career_raw) THEN
        v_career2_raw := '';
      ELSE
        SELECT id INTO v_career2 FROM careers
        WHERE (upper(code) = upper(v_career2_raw) OR fold_text(name) = fold_text(v_career2_raw))
          AND is_active AND (p_is_demo OR NOT is_demo)
        ORDER BY (upper(code) = upper(v_career2_raw)) DESC, (is_demo = p_is_demo) DESC LIMIT 1;
        IF v_career2 IS NULL THEN
          v_ckey2 := fold_text(v_career2_raw);
          v_ctarget2 := v_map2->>v_ckey2;
          IF v_ctarget2 = 'none' THEN
            v_warn := v_warn || ('Segunda carrera no reconocida "' || v_career2_raw || '": se omite por decisión de Coordinación')::text;
            v_career2_raw := '';
          ELSIF v_ctarget2 IS NOT NULL THEN
            SELECT id, name INTO v_career2, v_cname2 FROM careers
            WHERE id::text = v_ctarget2 AND is_active AND (p_is_demo OR NOT is_demo);
            IF v_career2 IS NULL THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
            v_warn := v_warn || ('Segunda carrera no reconocida "' || v_career2_raw || '": relacionada con ' || v_cname2)::text;
          ELSE
            v_warn := v_warn || ('Segunda carrera no reconocida "' || v_career2_raw || '": relaciónala con una carrera oficial antes de cargar')::text;
          END IF;
        END IF;
        IF v_career2 IS NOT NULL AND v_career2 = v_career THEN
          v_career2 := NULL;
          v_career2_raw := '';
          v_warn := v_warn || 'La segunda carrera es igual a la primera: se omite'::text;
        END IF;
      END IF;
    END IF;

    IF coalesce(r.j->>'submitted_at', '') <> '' THEN
      BEGIN v_at := (r.j->>'submitted_at')::timestamptz; EXCEPTION WHEN others THEN v_at := NULL; END;
    END IF;

    cur := NULL;
    IF array_length(v_errors, 1) IS NULL THEN
      SELECT * INTO v_match FROM participant_by_email(v_ed, v_email);
      IF v_match.participant_id IS NOT NULL THEN
        SELECT * INTO cur FROM participants WHERE id = v_match.participant_id;
        IF v_match.via_alias THEN v_alias := v_email; END IF;
      END IF;
      IF cur.id IS NOT NULL AND cur.is_demo <> p_is_demo THEN
        v_errors := v_errors || (CASE WHEN cur.is_demo THEN 'Ya existe como registro de prueba' ELSE 'Ya existe como registro real' END)::text;
      END IF;
    END IF;

    IF r.ord <> r.last_ord AND v_email <> '' THEN
      v_status := 'duplicate';
    ELSIF array_length(v_errors, 1) IS NOT NULL THEN
      v_status := 'error';
    ELSE
      v_status := CASE WHEN cur.id IS NULL THEN 'new' ELSE 'pending' END;
    END IF;

    IF v_school_key IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched_schools := jsonb_set(v_unmatched_schools, ARRAY[v_school_key], jsonb_build_object(
        'key', v_school_key, 'value', coalesce(v_unmatched_schools->v_school_key->>'value', v_school_raw),
        'count', coalesce((v_unmatched_schools->v_school_key->>'count')::int, 0) + 1,
        'rows', coalesce((v_unmatched_schools->v_school_key->>'count')::int, 0) + 1, 'target', v_school_target));
    END IF;
    IF v_ckey IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched := jsonb_set(v_unmatched, ARRAY[v_ckey], jsonb_build_object(
        'key', v_ckey, 'value', coalesce(v_unmatched->v_ckey->>'value', v_career_raw),
        'count', coalesce((v_unmatched->v_ckey->>'count')::int, 0) + 1, 'target', v_ctarget));
    END IF;
    IF v_ckey2 IS NOT NULL AND v_status NOT IN ('duplicate', 'error') THEN
      v_unmatched2 := jsonb_set(v_unmatched2, ARRAY[v_ckey2], jsonb_build_object(
        'key', v_ckey2, 'value', coalesce(v_unmatched2->v_ckey2->>'value', v_career2_raw),
        'count', coalesce((v_unmatched2->v_ckey2->>'count')::int, 0) + 1, 'target', v_ctarget2));
    END IF;

    IF v_status = 'new' THEN
      IF v_apply THEN
        INSERT INTO participants (edition_id, email, full_name, phone, high_school, high_school_id, high_school_grade, entry_period,
          initial_career_id, initial_career_raw, origin, import_batch_id, forms_consent, forms_consent_at, forms_consent_version,
          created_by, is_demo, extra)
        VALUES (v_ed, v_email, v_name, v_phone, v_school, v_school_id, v_grade, v_period, v_career, nullif(v_career_raw, ''), 'forms', p_batch,
          v_consent, CASE WHEN v_consent THEN coalesce(v_at, now()) END, CASE WHEN v_consent THEN v_ver END,
          auth.uid(), p_is_demo,
          CASE WHEN v_extra = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('forms', v_extra) END)
        RETURNING id INTO v_match.participant_id;

        v_career_ids := ARRAY[v_career, v_career2];
        v_career_raws := ARRAY[nullif(v_career_raw, ''), nullif(v_career2_raw, '')];
        PERFORM sync_initial_interests(v_match.participant_id, v_career_ids, v_career_raws);
      END IF;
    ELSIF v_status = 'pending' THEN
      SELECT career_id INTO v_existing_career1 FROM initial_interests WHERE participant_id = cur.id AND preference = 1;
      SELECT career_id INTO v_existing_career2 FROM initial_interests WHERE participant_id = cur.id AND preference = 2;
      v_has_c2_override := cur.manual_overrides ? 'initial_career_id_2';
      -- A file without a second career (the official Forms has none) never erases an existing one.
      IF v_career2_raw_orig = '' AND NOT (v_career_raw_orig ~ '[,;]') THEN
        v_career2 := v_existing_career2;
        v_career2_raw := (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2);
      END IF;

      v_nv := jsonb_strip_nulls(jsonb_build_object('full_name', v_name, 'phone', v_phone, 'high_school', v_school,
        'initial_career_id', v_career::text, 'high_school_grade', v_grade, 'entry_period', v_period));
      v_cv := jsonb_build_object('full_name', cur.full_name, 'phone', cur.phone, 'high_school', cur.high_school,
        'initial_career_id', cur.initial_career_id::text, 'high_school_grade', cur.high_school_grade, 'entry_period', cur.entry_period);
      FOR f IN SELECT jsonb_object_keys(v_nv) LOOP
        CONTINUE WHEN (v_nv->>f) IS NOT DISTINCT FROM (v_cv->>f);
        IF cur.manual_overrides ? f THEN
          v_conf := v_conf || f;
          IF v_apply THEN
            INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value)
            VALUES (cur.id, p_batch, f, v_nv->>f)
            ON CONFLICT (participant_id, field) WHERE status = 'pending'
            DO UPDATE SET imported_value = EXCLUDED.imported_value, batch_id = EXCLUDED.batch_id, created_at = now();
          END IF;
        ELSE
          v_upd := v_upd || jsonb_build_object(f, v_nv->f);
        END IF;
      END LOOP;

      IF v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2 THEN
        v_conf := v_conf || 'initial_career_id_2';
        IF v_apply THEN
          INSERT INTO participant_import_conflicts (participant_id, batch_id, field, imported_value)
          VALUES (cur.id, p_batch, 'initial_career_id_2', v_career2::text)
          ON CONFLICT (participant_id, field) WHERE status = 'pending'
          DO UPDATE SET imported_value = EXCLUDED.imported_value, batch_id = EXCLUDED.batch_id, created_at = now();
        END IF;
      END IF;

      v_old_forms := coalesce(cur.extra->'forms', '{}'::jsonb);
      v_extra_changed := EXISTS (SELECT 1 FROM jsonb_each(v_extra) e
        WHERE (v_old_forms->e.key->>'value') IS DISTINCT FROM (e.value->>'value'));

      v_status := CASE WHEN array_length(v_conf, 1) IS NOT NULL THEN 'conflict'
                       WHEN v_upd <> '{}'::jsonb OR v_extra_changed
                         OR (NOT v_has_c2_override AND v_career2 IS DISTINCT FROM v_existing_career2)
                       THEN 'update' ELSE 'unchanged' END;

      IF v_apply THEN
        UPDATE participants SET
          full_name = coalesce(v_upd->>'full_name', full_name),
          phone = coalesce(v_upd->>'phone', phone),
          high_school = coalesce(v_upd->>'high_school', high_school),
          high_school_id = CASE WHEN v_upd ? 'high_school' OR (high_school_id IS NULL AND NOT (cur.manual_overrides ? 'high_school'))
            THEN coalesce(v_school_id, high_school_id) ELSE high_school_id END,
          high_school_grade = coalesce(v_upd->>'high_school_grade', high_school_grade),
          entry_period = coalesce(v_upd->>'entry_period', entry_period),
          initial_career_id = CASE WHEN v_upd ? 'initial_career_id' THEN (v_upd->>'initial_career_id')::uuid ELSE initial_career_id END,
          initial_career_raw = coalesce(nullif(v_career_raw, ''), initial_career_raw),
          extra = CASE WHEN v_extra = '{}'::jsonb THEN extra
                  ELSE coalesce(extra, '{}'::jsonb) || jsonb_build_object('forms', v_old_forms || v_extra) END,
          forms_consent = coalesce(v_consent, forms_consent),
          forms_consent_at = CASE WHEN v_consent THEN coalesce(forms_consent_at, v_at, now()) ELSE forms_consent_at END,
          forms_consent_version = CASE WHEN v_consent THEN coalesce(forms_consent_version, v_ver) ELSE forms_consent_version END,
          import_batch_id = p_batch,
          updated_at = now()
        WHERE id = cur.id;

        IF NOT (cur.manual_overrides ? 'initial_career_id') THEN
          v_career_ids := ARRAY[
            CASE WHEN v_upd ? 'initial_career_id' THEN v_career ELSE coalesce(v_existing_career1, cur.initial_career_id) END,
            CASE WHEN v_has_c2_override THEN v_existing_career2 ELSE v_career2 END
          ];
          v_career_raws := ARRAY[
            coalesce(nullif(v_career_raw, ''), cur.initial_career_raw),
            CASE WHEN v_has_c2_override THEN (SELECT career_raw FROM initial_interests WHERE participant_id = cur.id AND preference = 2)
                 ELSE nullif(v_career2_raw, '') END
          ];
          IF v_career_ids[1] IS NOT NULL OR v_career_ids[2] IS NOT NULL THEN
            PERFORM sync_initial_interests(cur.id, v_career_ids, v_career_raws);
          END IF;
        END IF;
      END IF;
    END IF;

    v_counts := jsonb_set(v_counts, ARRAY[v_status], to_jsonb((v_counts->>v_status)::int + 1));
    v_results := v_results || jsonb_build_object('row', coalesce((r.j->>'row')::int, r.ord), 'email', v_email, 'name', v_name,
      'status', v_status, 'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warn),
      'updated_fields', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_upd) k)
        || CASE WHEN v_extra_changed THEN '["forms_extra"]'::jsonb ELSE '[]'::jsonb END,
      'conflict_fields', to_jsonb(v_conf),
      'note', CASE WHEN v_alias IS NOT NULL AND v_status NOT IN ('duplicate', 'error')
                THEN 'Reconocido por correo anterior: ' || v_alias || ' (correo vigente: ' || cur.email || ')' END,
      'alert', NULL,
      'high_school_unresolved', v_school_key IS NOT NULL AND v_school_target IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'career_unresolved', v_ckey IS NOT NULL AND v_ctarget IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'career_2_unresolved', v_ckey2 IS NOT NULL AND v_ctarget2 IS NULL AND v_status NOT IN ('duplicate', 'error'),
      'extra_count', (SELECT count(*) FROM jsonb_object_keys(v_extra)));
  END LOOP;

  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched_schools) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_HIGH_SCHOOLS';
  END IF;
  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_CAREERS';
  END IF;
  IF v_apply AND EXISTS (SELECT 1 FROM jsonb_each(v_unmatched2) u WHERE u.value->>'target' IS NULL) THEN
    RAISE EXCEPTION 'UNRESOLVED_CAREERS';
  END IF;

  RETURN jsonb_build_object(
    'counts', v_counts, 'rows', v_results,
    'unmatched_high_schools', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched_schools) u),
    'unmatched_careers', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched) u),
    'unmatched_careers_2', (SELECT coalesce(jsonb_agg(u.value ORDER BY u.value->>'value'), '[]'::jsonb) FROM jsonb_each(v_unmatched2) u)
  );
END;
$$;

CREATE OR REPLACE FUNCTION preview_participant_import(
  p_rows jsonb,
  p_is_demo boolean DEFAULT false,
  p_career_map jsonb DEFAULT '{}'::jsonb,
  p_career_map_2 jsonb DEFAULT '{}'::jsonb,
  p_high_school_map jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_coordinacion();
  RETURN process_participant_import(p_rows, coalesce(p_is_demo, false), NULL, p_career_map, p_career_map_2, p_high_school_map);
END;
$$;

CREATE OR REPLACE FUNCTION commit_participant_import(
  p_rows jsonb,
  p_file_name text,
  p_is_demo boolean DEFAULT false,
  p_career_map jsonb DEFAULT '{}'::jsonb,
  p_career_map_2 jsonb DEFAULT '{}'::jsonb,
  p_high_school_map jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_res jsonb; v_mapped jsonb;
BEGIN
  PERFORM require_coordinacion();
  INSERT INTO import_batches (edition_id, kind, file_name, is_demo, created_by)
  VALUES (active_edition_id(), 'participants', left(coalesce(p_file_name, ''), 200), coalesce(p_is_demo, false), auth.uid())
  RETURNING id INTO v_batch;
  v_res := process_participant_import(p_rows, coalesce(p_is_demo, false), v_batch, p_career_map, p_career_map_2, p_high_school_map);
  UPDATE import_batches SET counts = v_res->'counts' WHERE id = v_batch;
  PERFORM write_audit('participants.imported', jsonb_build_object('batch_id', v_batch, 'counts', v_res->'counts',
    'file_name', left(coalesce(p_file_name, ''), 200), 'is_demo', coalesce(p_is_demo, false)));
  SELECT jsonb_agg(jsonb_build_object('value', u->>'value', 'rows', (u->>'count')::int,
    'career_id', CASE WHEN u->>'target' = 'none' THEN NULL ELSE u->>'target' END,
    'career', CASE WHEN u->>'target' = 'none' THEN 'Sin carrera' ELSE (SELECT name FROM careers WHERE id::text = u->>'target') END))
  INTO v_mapped FROM jsonb_array_elements(v_res->'unmatched_careers') u;
  IF v_mapped IS NOT NULL THEN
    PERFORM write_audit('participants.career_mapped', jsonb_build_object('batch_id', v_batch, 'mappings', v_mapped));
  END IF;
  RETURN v_res || jsonb_build_object('batch_id', v_batch);
END;
$$;

REVOKE ALL ON FUNCTION public.process_participant_import(jsonb, boolean, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_participant_import(jsonb, boolean, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_participant_import(jsonb, text, boolean, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_participant_import(jsonb, boolean, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_participant_import(jsonb, text, boolean, jsonb, jsonb, jsonb) TO authenticated;

-- Backfill exacto, sin crear instituciones ni perder textos que no coincidan.
UPDATE public.participants p SET high_school_id = h.id, high_school = h.name
FROM public.high_schools h
WHERE p.high_school_id IS NULL AND p.high_school IS NOT NULL
  AND public.fold_text(p.high_school) = public.fold_text(h.name);
