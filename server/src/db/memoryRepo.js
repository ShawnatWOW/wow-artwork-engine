// In-memory repository — same interface as db/repo.js (pgRepo).
//
// Backs the orchestrator's unit tests and the demo CLI so the full weekly
// pipeline runs end-to-end with no Postgres. Returns snake_case rows to mirror
// the pg rows callers already read.

export function createMemoryRepo() {
  const runs = [];
  const artworks = [];
  const eonSequences = [];
  let runSeq = 0;
  let artSeq = 0;
  let seqSeq = 0;

  const clone = (o) => ({ ...o });

  return {
    async createRun({ weekOf, triggeredBy, status = 'running' }) {
      const row = {
        id: (runSeq += 1),
        week_of: weekOf,
        status,
        triggered_by: triggeredBy ?? null,
        error: null,
        created_at: null,
      };
      runs.push(row);
      return clone(row);
    },

    async setRunStatus(id, status, error = null) {
      const row = runs.find((r) => r.id === id);
      if (!row) return null;
      row.status = status;
      row.error = error;
      return clone(row);
    },

    async getRun(id) {
      const row = runs.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async listRuns({ limit = 50 } = {}) {
      return runs.slice(-limit).reverse().map(clone);
    },

    async insertArtwork(a) {
      const row = {
        id: (artSeq += 1),
        run_id: a.runId,
        surface: a.surface,
        style: a.style,
        media_type: a.mediaType,
        spec_key: a.specKey,
        width: a.width ?? null,
        height: a.height ?? null,
        duration_s: a.durationS ?? null,
        prompt: a.prompt ?? null,
        model: a.model ?? null,
        s3_key_raw: a.s3KeyRaw ?? null,
        s3_key_final: a.s3KeyFinal ?? null,
        thumbnail_key: a.thumbnailKey ?? null,
        status: a.status ?? 'generating',
        error: a.error ?? null,
        created_at: null,
      };
      artworks.push(row);
      return clone(row);
    },

    async updateArtwork(id, patch) {
      const row = artworks.find((r) => r.id === id);
      if (!row) return null;
      const map = {
        width: 'width', height: 'height', durationS: 'duration_s', prompt: 'prompt',
        model: 'model', s3KeyRaw: 's3_key_raw', s3KeyFinal: 's3_key_final',
        thumbnailKey: 'thumbnail_key', status: 'status', error: 'error',
      };
      for (const [key, col] of Object.entries(map)) {
        if (patch[key] !== undefined) row[col] = patch[key];
      }
      return clone(row);
    },

    async getArtwork(id) {
      const row = artworks.find((r) => r.id === id);
      return row ? clone(row) : null;
    },

    async listArtworks(runId) {
      return artworks.filter((r) => r.run_id === runId).map(clone);
    },

    async insertEonSequence({ runId, masterS3Key, face1ArtworkId, face2ArtworkId, face3ArtworkId }) {
      const row = {
        id: (seqSeq += 1),
        run_id: runId,
        master_s3_key: masterS3Key ?? null,
        face1_artwork_id: face1ArtworkId ?? null,
        face2_artwork_id: face2ArtworkId ?? null,
        face3_artwork_id: face3ArtworkId ?? null,
        created_at: null,
      };
      eonSequences.push(row);
      return clone(row);
    },

    async listEonSequences(runId) {
      return eonSequences.filter((r) => r.run_id === runId).map(clone);
    },
  };
}

export default { createMemoryRepo };
