CREATE TABLE IF NOT EXISTS editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  event_date date NOT NULL,
  start_time text NOT NULL DEFAULT '08:30',
  venue text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'America/Cancun',
  is_active boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'preparacion' CHECK (mode IN ('preparacion', 'operacion_real')),
  real_operation_at timestamptz,
  theme_unlock_until timestamptz,
  interests_prompt_min_attendances int NOT NULL DEFAULT 2 CHECK (interests_prompt_min_attendances >= 0),
  interests_prompt_at timestamptz,
  interests_close_at timestamptz,
  privacy_notice_version text NOT NULL DEFAULT 'v1',
  privacy_notice_summary text NOT NULL DEFAULT '',
  privacy_notice_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS editions_single_active ON editions (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS careers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  division_id uuid NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS careers_division_idx ON careers (division_id);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  division_id uuid NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_edition_idx ON activities (edition_id);
CREATE INDEX IF NOT EXISTS activities_division_idx ON activities (division_id);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity int NOT NULL CHECK (capacity > 0),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS activity_sessions_activity_idx ON activity_sessions (activity_id);

CREATE TABLE IF NOT EXISTS staff_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('coordinacion', 'staff')),
  full_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  full_name text NOT NULL,
  birth_date date NOT NULL,
  phone text,
  high_school text,
  initial_career_id uuid REFERENCES careers(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('forms', 'manual', 'demo')),
  import_batch_id uuid,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  forms_consent boolean,
  forms_consent_at timestamptz,
  forms_consent_version text,
  manual_consent_captured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manual_consent_at timestamptz,
  manual_consent_version text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, email)
);

CREATE TABLE IF NOT EXISTS participant_profiles (
  participant_id uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  high_school text,
  platform_consent_at timestamptz,
  platform_consent_version text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, session_id)
);
CREATE INDEX IF NOT EXISTS attendances_session_idx ON attendances (session_id);

CREATE TABLE IF NOT EXISTS post_event_interests (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  preference smallint NOT NULL CHECK (preference BETWEEN 1 AND 3),
  career_id uuid NOT NULL REFERENCES careers(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, preference),
  UNIQUE (participant_id, career_id)
);

CREATE TABLE IF NOT EXISTS access_attempts (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_attempts_lookup_idx ON access_attempts (email_hash, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  edition_id uuid REFERENCES editions(id) ON DELETE SET NULL,
  actor_user_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION is_coordinacion()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_members
    WHERE user_id = auth.uid() AND role = 'coordinacion' AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION current_participant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM participants WHERE auth_user_id = auth.uid() AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION active_edition_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM editions WHERE is_active LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION is_coordinacion() FROM anon;
REVOKE EXECUTE ON FUNCTION current_participant_id() FROM anon;

CREATE OR REPLACE FUNCTION guard_is_demo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    RAISE EXCEPTION 'is_demo cannot change after creation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_demo AND EXISTS (
    SELECT 1 FROM editions WHERE is_active AND mode = 'operacion_real'
  ) THEN
    RAISE EXCEPTION 'demo data cannot be created during real operation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['divisions','careers','activities','activity_sessions','staff_members','participants'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_guard_is_demo ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_guard_is_demo BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_is_demo()', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION sync_participant_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name, high_school)
  VALUES (NEW.id, NEW.auth_user_id, split_part(btrim(NEW.full_name), ' ', 1), NEW.high_school)
  ON CONFLICT (participant_id) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        display_name = EXCLUDED.display_name,
        high_school = EXCLUDED.high_school,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participants_sync_profile ON participants;
CREATE TRIGGER participants_sync_profile
AFTER INSERT OR UPDATE OF full_name, high_school, auth_user_id ON participants
FOR EACH ROW EXECUTE FUNCTION sync_participant_profile();

ALTER TABLE editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE careers ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_event_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON participants FROM anon, authenticated;
REVOKE ALL ON access_attempts FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON editions, divisions, careers, activities, activity_sessions,
  staff_members, participant_profiles, attendances, post_event_interests, audit_log FROM anon, authenticated;
REVOKE ALL ON participant_profiles, attendances, post_event_interests, audit_log, staff_members FROM anon;

DROP POLICY IF EXISTS "Public can read editions" ON editions;
CREATE POLICY "Public can read editions" ON editions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read divisions" ON divisions;
CREATE POLICY "Public can read divisions" ON divisions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read careers" ON careers;
CREATE POLICY "Public can read careers" ON careers FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read activities" ON activities;
CREATE POLICY "Public can read activities" ON activities FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read sessions" ON activity_sessions;
CREATE POLICY "Public can read sessions" ON activity_sessions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Staff read own membership" ON staff_members;
CREATE POLICY "Staff read own membership" ON staff_members FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Participant reads own profile" ON participant_profiles;
CREATE POLICY "Participant reads own profile" ON participant_profiles FOR SELECT TO authenticated
USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Participant reads own attendances" ON attendances;
CREATE POLICY "Participant reads own attendances" ON attendances FOR SELECT TO authenticated
USING (participant_id = current_participant_id());

DROP POLICY IF EXISTS "Participant reads own interests" ON post_event_interests;
CREATE POLICY "Participant reads own interests" ON post_event_interests FOR SELECT TO authenticated
USING (participant_id = current_participant_id());

DROP POLICY IF EXISTS "Coordinacion reads audit log" ON audit_log;
CREATE POLICY "Coordinacion reads audit log" ON audit_log FOR SELECT TO authenticated
USING (is_coordinacion());