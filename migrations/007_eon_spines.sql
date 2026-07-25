-- WOW Artwork Engine — EON spines (2026-07-25).
--
-- Every EON pod carries a narrow LED spine down its left side as well as its
-- face (WOW template spec sheet: 3 spines & 3 faces per pod). Artwork is now
-- generated as one wrapped panorama and cut into BOTH panels, so a motion row
-- needs to say which panel of which pod it is:
--   panel — 'pod1_spine' | 'pod1_face' | 'pod2_spine' | … (null for
--           spectacular, for stills, and for pre-spine EON rows).
-- Jeff's delivery filenames and the dashboard's pod grouping both read it.
--
-- eon_sequences gains the three spine links alongside its three face links so
-- one wrapped master still resolves to the complete set of panels it produced.
-- Idempotent; safe to re-run.

BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS panel TEXT;

ALTER TABLE eon_sequences ADD COLUMN IF NOT EXISTS spine1_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE eon_sequences ADD COLUMN IF NOT EXISTS spine2_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE eon_sequences ADD COLUMN IF NOT EXISTS spine3_artwork_id INTEGER REFERENCES artworks(id) ON DELETE SET NULL;

-- The masters grow to their true wrapped width (panel-native, per Build Plan
-- §4): a pod slab is spine 64 + face 256 = 320 wide, so the 3-pod master is
-- 960x384 (was 768x384, faces only) and a single pod is its own 320x384 master.
INSERT INTO specs (key, surface, width, height, format, max_duration_s) VALUES
  ('eon_master_3pod', 'eon', 960, 384, 'MP4', 60),
  ('eon_master_pod',  'eon', 320, 384, 'MP4', 60)
ON CONFLICT (key) DO UPDATE SET
  surface        = EXCLUDED.surface,
  width          = EXCLUDED.width,
  height         = EXCLUDED.height,
  format         = EXCLUDED.format,
  max_duration_s = EXCLUDED.max_duration_s;

COMMIT;
