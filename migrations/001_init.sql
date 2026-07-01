-- WOW Artwork Engine — initial schema (Build Plan §6)
-- Idempotent: safe to run repeatedly. Applied by server/src/db/migrate.js.

BEGIN;

-- ---------------------------------------------------------------------------
-- specs: the sign specifications. Seeded from §4 by 002_seed_specs.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS specs (
  id             SERIAL PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE,
  surface        TEXT NOT NULL,                 -- spectacular | eon
  width          INTEGER NOT NULL CHECK (width > 0),
  height         INTEGER NOT NULL CHECK (height > 0),
  format         TEXT NOT NULL,                 -- e.g. "MP4 / JPEG / PNG"
  max_duration_s INTEGER NOT NULL CHECK (max_duration_s > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users: reuse the existing WOW dashboard auth pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'reviewer',  -- reviewer | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- generation_runs: one weekly batch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_runs (
  id           SERIAL PRIMARY KEY,
  week_of      DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | running | complete | failed
  triggered_by TEXT,                            -- "cron" | user email
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generation_runs_week_of ON generation_runs (week_of);

-- ---------------------------------------------------------------------------
-- artworks: every generated piece.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artworks (
  id            SERIAL PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL,                  -- spectacular | eon
  style         TEXT NOT NULL,                  -- original | frame_break | eon_single | eon_connected
  media_type    TEXT NOT NULL,                  -- video | still
  spec_key      TEXT NOT NULL REFERENCES specs(key),
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  duration_s    INTEGER,
  prompt        TEXT,
  model         TEXT,
  s3_key_raw    TEXT,
  s3_key_final  TEXT,
  thumbnail_key TEXT,
  status        TEXT NOT NULL DEFAULT 'generating',
                -- generating | ready | failed | approved | rejected | sent
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artworks_run_id ON artworks (run_id);
CREATE INDEX IF NOT EXISTS idx_artworks_status ON artworks (status);

-- ---------------------------------------------------------------------------
-- eon_sequences: links a 3-pod master to its three sliced faces.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eon_sequences (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  master_s3_key   TEXT,
  face1_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL,
  face2_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL,
  face3_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eon_sequences_run_id ON eon_sequences (run_id);

-- ---------------------------------------------------------------------------
-- selections: Scott's picks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS selections (
  id          SERIAL PRIMARY KEY,
  artwork_id  INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  selected_by TEXT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artwork_id)
);

-- ---------------------------------------------------------------------------
-- deliveries: handoff to Jeff.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id              SERIAL PRIMARY KEY,
  artwork_id      INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  method          TEXT NOT NULL,                -- ftp | drive
  destination     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  sent_at         TIMESTAMPTZ,
  jeff_notified_at TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_artwork_id ON deliveries (artwork_id);

COMMIT;
