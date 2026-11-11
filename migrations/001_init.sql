CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gift_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS participants_name_key ON participants (name);

CREATE TABLE IF NOT EXISTS assignments (
  receiver_id TEXT PRIMARY KEY REFERENCES participants (id) ON DELETE CASCADE,
  giver_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  revealed_at TIMESTAMPTZ,
  CONSTRAINT assignments_not_self CHECK (receiver_id <> giver_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS assignments_giver_key ON assignments (giver_id);
