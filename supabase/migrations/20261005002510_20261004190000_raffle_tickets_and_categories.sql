DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activities' AND column_name = 'activity_type') THEN
    ALTER TABLE activities ADD COLUMN activity_type text NOT NULL DEFAULT 'academica';
  END IF;
END $$;
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check CHECK (activity_type IN ('academica', 'liderazgo'));

CREATE TABLE IF NOT EXISTS raffle_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  required_academic int NOT NULL DEFAULT 0 CHECK (required_academic >= 0),
  required_leadership int NOT NULL DEFAULT 0 CHECK (required_leadership >= 0),
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  visual_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);
CREATE INDEX IF NOT EXISTS raffle_categories_edition_idx ON raffle_categories (edition_id);

CREATE TABLE IF NOT EXISTS raffle_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES raffle_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  quantity int NOT NULL CHECK (quantity >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS raffle_prizes_edition_idx ON raffle_prizes (edition_id);
CREATE INDEX IF NOT EXISTS raffle_prizes_category_idx ON raffle_prizes (category_id);

CREATE TABLE IF NOT EXISTS raffle_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES raffle_categories(id) ON DELETE RESTRICT,
  prize_id uuid NOT NULL REFERENCES raffle_prizes(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'seleccionado' CHECK (status IN ('seleccionado', 'confirmado', 'no_presentado', 'invalidado')),
  drawn_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  drawn_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  invalidated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invalidated_at timestamptz,
  invalidation_reason text,
  origin text NOT NULL DEFAULT 'online',
  idempotency_key text UNIQUE,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS raffle_winners_edition_idx ON raffle_winners (edition_id);
CREATE INDEX IF NOT EXISTS raffle_winners_prize_idx ON raffle_winners (prize_id, status);
CREATE INDEX IF NOT EXISTS raffle_winners_participant_idx ON raffle_winners (participant_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['raffle_categories','raffle_prizes','raffle_winners'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_guard_is_demo ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_guard_is_demo BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_is_demo()', t, t);
  END LOOP;
END $$;

ALTER TABLE raffle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_winners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON raffle_categories, raffle_prizes, raffle_winners FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.participant_tickets(p_pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('academic_tickets', count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'academica'), 'leadership_tickets', count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'liderazgo'))
  FROM attendances at JOIN activities a ON a.id = at.activity_id WHERE at.participant_id = p_pid;
$$;
CREATE OR REPLACE FUNCTION public.participant_has_won(p_pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p_pid AND rw.status = 'confirmado');
$$;
CREATE OR REPLACE FUNCTION public.participant_raffle_category(p_pid uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tickets AS (SELECT count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'academica') AS academic, count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'liderazgo') AS leadership FROM attendances at JOIN activities a ON a.id = at.activity_id WHERE at.participant_id = p_pid),
  has_won AS (SELECT EXISTS (SELECT 1 FROM raffle_winners rw WHERE rw.participant_id = p_pid AND rw.status = 'confirmado') AS won)
  SELECT rc.id FROM raffle_categories rc JOIN participants p ON p.edition_id = rc.edition_id CROSS JOIN tickets, has_won
  WHERE p.id = p_pid AND rc.is_active AND rc.is_demo IS NOT DISTINCT FROM p.is_demo AND rc.required_academic <= tickets.academic AND rc.required_leadership <= tickets.leadership AND NOT has_won.won
  ORDER BY rc.sort_order DESC, rc.required_academic DESC, rc.required_leadership DESC LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.participant_tickets(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.participant_tickets(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.participant_raffle_category(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.participant_raffle_category(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.participant_has_won(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.participant_has_won(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_sorteo_or_coordinacion() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN IF NOT (has_staff_role('sorteo') OR has_staff_role('coordinacion')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF; END;
$$;
REVOKE EXECUTE ON FUNCTION public.require_sorteo_or_coordinacion() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_activity(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := nullif(p->>'id','')::uuid; v_title text := btrim(coalesce(p->>'title','')); v_div uuid := nullif(p->>'division_id','')::uuid; v_ed uuid := active_edition_id(); v_type text := coalesce(p->>'activity_type','academica');
BEGIN
  PERFORM require_coordinacion();
  IF length(v_title) < 2 OR length(v_title) > 150 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF NOT EXISTS (SELECT 1 FROM divisions WHERE id = v_div) THEN RAISE EXCEPTION 'INVALID_DIVISION'; END IF;
  IF v_type NOT IN ('academica','liderazgo') THEN RAISE EXCEPTION 'INVALID_ACTIVITY_TYPE'; END IF;
  IF EXISTS (SELECT 1 FROM activities WHERE edition_id = v_ed AND division_id = v_div AND lower(title) = lower(v_title) AND id IS DISTINCT FROM v_id) THEN RAISE EXCEPTION 'ACTIVITY_EXISTS'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type) VALUES (v_ed, v_div, v_title, left(coalesce(p->>'description',''),1000), left(coalesce(p->>'location',''),150), coalesce((p->>'is_demo')::boolean,false), v_type) RETURNING id INTO v_id;
  ELSE
    UPDATE activities SET division_id = v_div, title = v_title, description = left(coalesce(p->>'description',''),1000), location = left(coalesce(p->>'location',''),150), activity_type = v_type WHERE id = v_id AND edition_id = v_ed;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM write_audit('catalog.activity_saved', jsonb_build_object('id', v_id, 'activity_type', v_type));
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_activity(jsonb) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.save_activity(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_progress() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := require_participant(false); v_ed editions%ROWTYPE; v_stamps int; v_attended int; v_reserved int; v_divs uuid[]; v_level int; v_next rank_levels%ROWTYPE; v_consent boolean; v_tickets jsonb; v_category uuid; v_cat_name text; v_has_won boolean;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  v_stamps := my_stamp_count(v_pid); v_attended := my_attended_workshop_count(v_pid);
  SELECT coalesce(array_agg(DISTINCT a2.division_id),'{}') INTO v_divs FROM attendances at JOIN activities a2 ON a2.id = at.activity_id WHERE at.participant_id = v_pid;
  SELECT count(*) INTO v_reserved FROM reservations WHERE participant_id = v_pid AND status = 'vigente';
  v_level := participant_rank_level(v_pid);
  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;
  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;
  v_tickets := participant_tickets(v_pid); v_has_won := participant_has_won(v_pid);
  IF NOT v_has_won THEN v_category := participant_raffle_category(v_pid); IF v_category IS NOT NULL THEN SELECT name INTO v_cat_name FROM raffle_categories WHERE id = v_category; END IF;
  ELSE v_category := NULL; v_cat_name := NULL; END IF;
  RETURN jsonb_build_object('level', v_level, 'stamps', v_stamps, 'attended_workshops', v_attended, 'reserved_workshops', v_reserved, 'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object('level', v_next.level, 'required_attendances', v_next.required_attendances, 'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'interests_prompt', v_attended >= v_ed.interests_prompt_min_attendances OR (v_ed.interests_prompt_at IS NOT NULL AND now() >= v_ed.interests_prompt_at),
    'interests_open', v_ed.interests_close_at IS NULL OR now() < v_ed.interests_close_at,
    'academic_tickets', (v_tickets->>'academic_tickets')::int, 'leadership_tickets', (v_tickets->>'leadership_tickets')::int,
    'raffle_category', v_category, 'raffle_category_name', v_cat_name, 'has_won', v_has_won);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_progress() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.my_progress() TO authenticated;