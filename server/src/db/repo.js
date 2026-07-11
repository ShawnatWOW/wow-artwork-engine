// Postgres repository for the generation engine (Build Plan §6).
//
// One narrow module for every read/write the orchestrator, routes, and
// scheduler need, so SQL lives in exactly one place. The in-memory equivalent
// in memoryRepo.js implements the same interface for tests and the demo CLI.
//
// Column names are snake_case in SQL; this layer accepts camelCase input and
// returns rows as-is (snake_case) — callers read `row.s3_key_final` etc.

import { query } from './pool.js';

// Whitelisted artwork columns that updateArtwork may set (camelCase → column).
const ARTWORK_COLUMNS = {
  width: 'width',
  height: 'height',
  durationS: 'duration_s',
  prompt: 'prompt',
  model: 'model',
  s3KeyRaw: 's3_key_raw',
  s3KeyFinal: 's3_key_final',
  thumbnailKey: 'thumbnail_key',
  status: 'status',
  error: 'error',
  stage: 'stage',
  motionPrompt: 'motion_prompt',
  remoteUrl: 'remote_url',
};

export const pgRepo = {
  async createRun({ weekOf, triggeredBy, status = 'running' }) {
    const { rows } = await query(
      `INSERT INTO generation_runs (week_of, status, triggered_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [weekOf, status, triggeredBy],
    );
    return rows[0];
  },

  async setRunStatus(id, status, error = null) {
    const { rows } = await query(
      `UPDATE generation_runs SET status = $2, error = $3 WHERE id = $1 RETURNING *`,
      [id, status, error],
    );
    return rows[0];
  },

  async getRun(id) {
    const { rows } = await query('SELECT * FROM generation_runs WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async listRuns({ limit = 50 } = {}) {
    const { rows } = await query(
      'SELECT * FROM generation_runs ORDER BY id DESC LIMIT $1',
      [limit],
    );
    return rows;
  },

  async insertArtwork(a) {
    const { rows } = await query(
      `INSERT INTO artworks
         (run_id, surface, style, media_type, spec_key, width, height,
          duration_s, prompt, model, s3_key_raw, s3_key_final, thumbnail_key, status, error,
          stage, motion_prompt, source_still_id, remote_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        a.runId, a.surface, a.style, a.mediaType, a.specKey,
        a.width ?? null, a.height ?? null, a.durationS ?? null,
        a.prompt ?? null, a.model ?? null, a.s3KeyRaw ?? null,
        a.s3KeyFinal ?? null, a.thumbnailKey ?? null,
        a.status ?? 'generating', a.error ?? null,
        a.stage ?? 'motion', a.motionPrompt ?? null, a.sourceStillId ?? null,
        a.remoteUrl ?? null,
      ],
    );
    return rows[0];
  },

  async updateArtwork(id, patch) {
    const sets = [];
    const values = [id];
    for (const [key, col] of Object.entries(ARTWORK_COLUMNS)) {
      if (patch[key] !== undefined) {
        values.push(patch[key]);
        sets.push(`${col} = $${values.length}`);
      }
    }
    if (sets.length === 0) return this.getArtwork(id);
    const { rows } = await query(
      `UPDATE artworks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      values,
    );
    return rows[0];
  },

  async getArtwork(id) {
    const { rows } = await query('SELECT * FROM artworks WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async listArtworks(runId) {
    const { rows } = await query(
      'SELECT * FROM artworks WHERE run_id = $1 ORDER BY id ASC',
      [runId],
    );
    return rows;
  },

  async insertEonSequence({ runId, masterS3Key, face1ArtworkId, face2ArtworkId, face3ArtworkId }) {
    const { rows } = await query(
      `INSERT INTO eon_sequences
         (run_id, master_s3_key, face1_artwork_id, face2_artwork_id, face3_artwork_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [runId, masterS3Key, face1ArtworkId, face2ArtworkId, face3ArtworkId],
    );
    return rows[0];
  },

  async listEonSequences(runId) {
    const { rows } = await query(
      'SELECT * FROM eon_sequences WHERE run_id = $1 ORDER BY id ASC',
      [runId],
    );
    return rows;
  },

  // --- Selections (the reviewer's picks) ---------------------------------
  async addSelection(artworkId, selectedBy = null) {
    const { rows } = await query(
      `INSERT INTO selections (artwork_id, selected_by)
       VALUES ($1, $2)
       ON CONFLICT (artwork_id) DO UPDATE SET selected_by = EXCLUDED.selected_by, selected_at = now()
       RETURNING *`,
      [artworkId, selectedBy],
    );
    return rows[0];
  },

  async removeSelection(artworkId) {
    await query('DELETE FROM selections WHERE artwork_id = $1', [artworkId]);
  },

  async listSelections(runId) {
    const { rows } = await query(
      `SELECT s.* FROM selections s
         JOIN artworks a ON a.id = s.artwork_id
        WHERE a.run_id = $1
        ORDER BY s.id ASC`,
      [runId],
    );
    return rows;
  },

  // --- Deliveries (the handoff to Jeff) ----------------------------------
  async insertDelivery({ artworkId, method, destination, status = 'pending', sentAt = null, error = null }) {
    const { rows } = await query(
      `INSERT INTO deliveries (artwork_id, method, destination, status, sent_at, error)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [artworkId, method, destination, status, sentAt, error],
    );
    return rows[0];
  },

  async updateDelivery(id, patch) {
    const map = { status: 'status', destination: 'destination', sentAt: 'sent_at', jeffNotifiedAt: 'jeff_notified_at', error: 'error' };
    const sets = [];
    const values = [id];
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) { values.push(patch[k]); sets.push(`${col} = $${values.length}`); }
    }
    if (!sets.length) return null;
    const { rows } = await query(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
    return rows[0];
  },

  async listDeliveries(runId) {
    const { rows } = await query(
      `SELECT d.* FROM deliveries d JOIN artworks a ON a.id = d.artwork_id
        WHERE a.run_id = $1 ORDER BY d.id ASC`,
      [runId],
    );
    return rows;
  },
};

export default pgRepo;
