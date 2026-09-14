-- Style Library (Shawn, 2026-09-14): Scott uploads artwork he likes (an
-- Instagram post, a screenshot, a screen recording), names it, and the engine
-- writes a style card in the exact shape prompts.js already rolls from — so
-- every design can pick that look, or roll it at random.
--
-- The 28 built-in styles are seeded from code at boot (services/styles/
-- library.js ensureBuiltins) so the pool has ONE source of truth per key:
-- rows here win, code entries only fill in what is missing.

BEGIN;

CREATE TABLE IF NOT EXISTS styles (
  id             SERIAL PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE,            -- slug; prompts seed on it
  label          TEXT NOT NULL,                   -- what the card shows
  style          TEXT NOT NULL,                   -- the prompt-ready sentence
  cast           JSONB NOT NULL DEFAULT '{}',     -- { keeper, hero, companion }
  source_type    TEXT NOT NULL DEFAULT 'builtin', -- builtin | upload | link
  source_url     TEXT,                            -- the Instagram/link URL
  source_name    TEXT,                            -- original upload filename
  source_key     TEXT,                            -- stored source file
  frame_keys     JSONB NOT NULL DEFAULT '[]',     -- extracted reference frames
  thumbnail_key  TEXT,                            -- card thumbnail (a frame)
  preview_key    TEXT,                            -- the $0.03 "on a sign" still
  preview_thumb_key TEXT,
  analysis       JSONB NOT NULL DEFAULT '{}',     -- palette, medium, era, motion…
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,   -- in the random pool
  favorite       BOOLEAN NOT NULL DEFAULT FALSE,  -- weighted x2 when rolling
  weight         REAL NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'ready',   -- analyzing | ready | failed
  error          TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_styles_enabled ON styles (enabled);

-- Which style a design rolled or was given. theme_label (009) stays as the
-- display name; the key is what usage stats and "use this again" need.
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS style_key TEXT;
CREATE INDEX IF NOT EXISTS idx_artworks_style_key ON artworks (style_key);

COMMIT;
