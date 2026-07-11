-- WOW Artwork Engine — M1 Generation Engine columns.
-- Records why an artwork or a run failed: a guardrail block (before spend) or a
-- generation/post-processing error. Idempotent; safe to re-run.

BEGIN;

ALTER TABLE artworks        ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE generation_runs ADD COLUMN IF NOT EXISTS error TEXT;

COMMIT;
