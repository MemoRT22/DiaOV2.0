ALTER TABLE participants ALTER COLUMN birth_date DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'participants' AND column_name = 'manual_overrides') THEN
    ALTER TABLE participants ADD COLUMN manual_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('participants', 'careers', 'workshops')),
  file_name text NOT NULL DEFAULT '',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participant_import_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  field text NOT NULL CHECK (field IN ('full_name', 'birth_date', 'phone', 'high_school', 'initial_career_id')),
  imported_value text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'kept')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conflicts_one_pending ON participant_import_conflicts (participant_id, field) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS conflicts_status_idx ON participant_import_conflicts (status);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_import_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON import_batches, participant_import_conflicts FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS activities_unique_title ON activities (edition_id, division_id, lower(title));
CREATE UNIQUE INDEX IF NOT EXISTS sessions_unique_start ON activity_sessions (activity_id, starts_at);
CREATE INDEX IF NOT EXISTS participants_name_idx ON participants (edition_id, lower(full_name));