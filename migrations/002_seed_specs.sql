-- WOW Artwork Engine — seed the specs reference table (Build Plan §4)
-- Idempotent via ON CONFLICT. Applied by server/src/db/migrate.js.

BEGIN;

INSERT INTO specs (key, surface, width, height, format, max_duration_s) VALUES
  ('spectacular_wow1_8', 'spectacular', 1692, 468, 'MP4 / JPEG / PNG', 60),
  ('eon_face',           'eon',          256, 384, 'MP4 / JPEG / PNG', 60),
  ('eon_spine',          'eon',           64, 384, 'MP4 / JPEG / PNG', 60),
  ('eon_master_3pod',    'eon',          768, 384, 'MP4',              60)
ON CONFLICT (key) DO UPDATE SET
  surface        = EXCLUDED.surface,
  width          = EXCLUDED.width,
  height         = EXCLUDED.height,
  format         = EXCLUDED.format,
  max_duration_s = EXCLUDED.max_duration_s;

COMMIT;
