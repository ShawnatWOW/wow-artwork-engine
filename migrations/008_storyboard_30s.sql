-- 008: First/last storyboard + two-act 30s spectaculars (Scott's notes, 2026-08-05).
--
-- A spectacular STILL row now carries its whole storyboard:
--   closing_prompt      — the Seedream prompt for the CLOSING frame (the
--                         "ends with" panel; regenerated stills rebuild it)
--   closing_key         — stored closing still (full res)
--   closing_thumb_key   — review-grid thumbnail of the closing still
--   closing_remote_url  — fal-hosted URL; Seedance segment B's end_image_url
--   motion_prompt_act2  — segment B's motion prompt (act 2 of the scene arc).
--                         motion_prompt (004) stays act 1 / the only act for
--                         single-segment surfaces, so EON rows are untouched.
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS closing_prompt     TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS closing_key        TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS closing_thumb_key  TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS closing_remote_url TEXT;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS motion_prompt_act2 TEXT;
