-- WOW Artwork Engine — M2.5 two-phase generation (stills-first cost gate).
--
-- A run now generates cheap Seedream STILLS first (style review); only approved
-- stills get animated with Seedance. These columns model that:
--   stage           — 'still' (a style option, first-frame reference) or
--                     'motion' (the animated deliverable)
--   motion_prompt   — the proposed Seedance motion prompt, shown on a still card
--   source_still_id — a motion row points back to the still it was animated from
-- Idempotent; safe to re-run.

BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS stage           TEXT NOT NULL DEFAULT 'motion';
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS motion_prompt   TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS source_still_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_artworks_stage ON artworks (stage);
CREATE INDEX IF NOT EXISTS idx_artworks_source_still ON artworks (source_still_id);

COMMIT;
