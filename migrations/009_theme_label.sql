-- WOW Artwork Engine — wild-theme slots (Shawn, 2026-08-18).
-- One option per screen rolls a randomized era/world theme (cyberpunk, the
-- twenties, …) each batch: spectacular option 3 and EON-connected option 2.
-- theme_label records the rolled theme's human-readable name so the dashboard
-- can mark the wild design and say what it rolled. NULL on house-style rows.
-- Idempotent.

BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS theme_label TEXT;

COMMIT;
