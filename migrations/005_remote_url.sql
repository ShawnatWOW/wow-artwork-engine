-- WOW Artwork Engine — live still→motion chaining.
-- Stores the provider-hosted URL of a generated still (fal CDN). Seedance
-- image-to-video takes this URL directly as its first-frame reference, so no
-- re-upload is needed between Phase 1 and Phase 2. Idempotent.

BEGIN;

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS remote_url TEXT;

COMMIT;
