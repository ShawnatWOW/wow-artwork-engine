-- WOW Artwork Engine — "Keep & explore" design families.
-- A kept still anchors a family; a re-roll or a plain-language tweak spawns a
-- variation of it, and the original is never lost. These columns model that
-- lineage (mirrored in memoryRepo.js / repo.js so both backends match):
--   family_id         — every design in one exploration family shares this
--                       (= the id of the family's ORIGINAL / anchor design).
--   parent_artwork_id — the design a variation was spawned from (null for originals).
--   change_note       — an LLM-written one-line summary of what a tweak changed
--                       (null for re-rolls and plain stills).
-- Idempotent; safe to re-run.

BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS family_id         INTEGER REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS parent_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS change_note       TEXT;

CREATE INDEX IF NOT EXISTS idx_artworks_family_id ON artworks (family_id);

COMMIT;
