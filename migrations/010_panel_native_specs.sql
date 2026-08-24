-- WOW Artwork Engine — EON delivery goes panel-native + one master file
-- (Jeff, 2026-08-21 email: "Spines: 64w x 384h each · Faces: 256w x 384h each
-- · Total master size: 960w x 384 … If you are able to send it as one master
-- file that would speed up the turnaround time.")
-- Syncs the specs reference table with catalog.js SPECS (the runtime source):
-- spine-aware masters (spine + face per pillar, so 3 pods = 960 wide) and the
-- single-pod master. Idempotent.

BEGIN;

INSERT INTO specs (key, surface, width, height, format, max_duration_s) VALUES
  ('spectacular_wow1_8', 'spectacular', 3840, 1062, 'MP4 / JPEG / PNG', 60),
  ('eon_face',           'eon',          256,  384, 'MP4 / JPEG / PNG', 60),
  ('eon_spine',          'eon',           64,  384, 'MP4 / JPEG / PNG', 60),
  ('eon_master_3pod',    'eon',          960,  384, 'MP4',              60),
  ('eon_master_pod',     'eon',          320,  384, 'MP4',              60)
ON CONFLICT (key) DO UPDATE SET
  surface        = EXCLUDED.surface,
  width          = EXCLUDED.width,
  height         = EXCLUDED.height,
  format         = EXCLUDED.format,
  max_duration_s = EXCLUDED.max_duration_s;

COMMIT;
