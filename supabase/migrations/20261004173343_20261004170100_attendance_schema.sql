-- 1. session_credentials table
CREATE TABLE IF NOT EXISTS session_credentials (
  session_id uuid PRIMARY KEY REFERENCES activity_sessions(id) ON DELETE CASCADE,
  qr_token_hash text NOT NULL,
  manual_code_hash text NOT NULL,
  qr_token_encrypted bytea NOT NULL,
  manual_code_encrypted bytea NOT NULL,
  rotated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_credentials_qr_hash_idx ON session_credentials (qr_token_hash);
CREATE INDEX IF NOT EXISTS session_credentials_manual_hash_idx ON session_credentials (manual_code_hash);

-- 2. Add columns to attendances
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES activities(id) ON DELETE RESTRICT;
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS credits_granted smallint NOT NULL DEFAULT 1 CHECK (credits_granted >= 0);
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'qr' CHECK (method IN ('qr', 'codigo_manual'));
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS reservation_id uuid;
ALTER TABLE attendances ALTER COLUMN recorded_by DROP NOT NULL;

-- 3. Add check-in window columns to editions
ALTER TABLE editions ADD COLUMN IF NOT EXISTS checkin_open_before_minutes int NOT NULL DEFAULT 5 CHECK (checkin_open_before_minutes >= 0);
ALTER TABLE editions ADD COLUMN IF NOT EXISTS checkin_close_after_minutes int NOT NULL DEFAULT 20 CHECK (checkin_close_after_minutes >= 0);

-- 4. Backfill existing demo attendances with activity_id and credits
UPDATE attendances a
SET activity_id = s.activity_id,
    credits_granted = coalesce(s.credits, 1)
FROM activity_sessions s
WHERE a.session_id = s.id AND a.activity_id IS NULL;

-- 5. RLS on session_credentials
ALTER TABLE session_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON session_credentials FROM PUBLIC, anon, authenticated;

-- 6. Revoke direct SELECT on attendances from authenticated (defense in depth, like reservations)
REVOKE ALL ON attendances FROM PUBLIC, anon, authenticated;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;