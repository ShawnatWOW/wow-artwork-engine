// In-memory repository — same interface as db/repo.js (pgRepo).
//
// Backs the orchestrator's unit tests and the demo CLI so the full weekly
// pipeline runs end-to-end with no Postgres. Returns snake_case rows to mirror
// the pg rows callers already read.
//
// Optional `persistPath`: snapshot every mutation to a JSON file (atomic
// tmp+rename) and hydrate from it on boot. Production runs without a
// DATABASE_URL, so this is what makes runs survive pm2 restarts and deploys —
// without it every deploy wiped the reviewer's artwork (live finding,
// 2026-07-12). Tests omit the path and stay purely in-memory.

import fs from 'node:fs';
import path from 'node:path';

export function createMemoryRepo({ persistPath = null } = {}) {
  let runs = [];
  let artworks = [];
  let eonSequences = [];
  let selections = [];
  let deliveries = [];

  // Hydrate from the snapshot, if one exists. A corrupt file starts fresh —
  // persistence is best-effort, never fatal.
  if (persistPath && fs.existsSync(persistPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      if (Array.isArray(s.runs)) runs = s.runs;
      if (Array.isArray(s.artworks)) artworks = s.artworks;
      if (Array.isArray(s.eonSequences)) eonSequences = s.eonSequences;
      if (Array.isArray(s.selections)) selections = s.selections;
      if (Array.isArray(s.deliveries)) deliveries = s.deliveries;
      // A restart mid-generation leaves rows stuck at running/generating that
      // can never finish — fail them so the dashboard doesn't poll forever.
      const INTERRUPTED = 'interrupted — the server restarted during generation; start a new batch or retry';
      for (const r of runs) if (r.status === 'running') { r.status = 'failed'; r.error = INTERRUPTED; }
      for (const a of artworks) if (a.status === 'generating') { a.status = 'failed'; a.error = a.error || INTERRUPTED; }
    } catch {
      runs = []; artworks = []; eonSequences = []; selections = []; deliveries = [];
    }
  }

  const maxId = (rows) => rows.reduce((m, r) => Math.max(m, r.id || 0), 0);
  let runSeq = maxId(runs);
  let artSeq = maxId(artworks);
  let seqSeq = maxId(eonSequences);
  let selSeq = maxId(selections);
  let delSeq = maxId(deliveries);

  const clone = (o) => ({ ...o });

  // Atomic snapshot after every mutation. The state is a few KB and mutations
  // are infrequent (only during generation/review), so a sync write is fine.
  const persist = () => {
    if (!persistPath) return;
    try {
      fs.mkdirSync(path.dirname(persistPath), { recursive: true });
      const tmp = `${persistPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ runs, artworks, eonSequences, selections, deliveries }));
      fs.renameSync(tmp, persistPath);
    } catch {
      // best-effort — never let persistence break the request
    }
  };
  persist(); // re-snapshot post-hydration (writes the interrupted-run cleanup)

  return {
    async createRun({ weekOf, triggeredBy, status = 'running' }) {
      const row = {
        id: (runSeq += 1),
        week_of: weekOf,
        status,
        triggered_by: triggeredBy ?? null,
        error: null,
        // Live generation progress: { phase: 'designs'|'videos', done, total }.
        // Written by the orchestrator as each item completes so the dashboard
        // can show "Creating designs… 3/9" instead of an opaque spinner.
        progress: null,
        created_at: new Date().toISOString(), // pg stamps this via DEFAULT now()
      };
      runs.push(row);
      persist();
      return clone(row);
    },

    async setRunStatus(id, status, error = null) {
      const row = runs.find((r) => r.id === id);
      if (!row) return null;
      row.status = status;
      row.error = error;
      persist();
      return clone(row);
    },

    async setRunProgress(id, progress) {
      const row = runs.find((r) => r.id === id);
      if (!row) return null;
      row.progress = progress ? { ...progress } : null;
      persist();
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
        stage: a.stage ?? 'motion',
        motion_prompt: a.motionPrompt ?? null,
        source_still_id: a.sourceStillId ?? null,
        remote_url: a.remoteUrl ?? null,
        // "Keep & explore" lineage: every design in one exploration family shares
        // family_id (= the family's ORIGINAL design id); parent_artwork_id points
        // at the design a variation was spawned from; change_note is a tweak's
        // one-line summary of what it changed. All null for a plain still.
        family_id: a.familyId ?? null,
        parent_artwork_id: a.parentArtworkId ?? null,
        change_note: a.changeNote ?? null,
        // Immutable cost ledger: the fal request id(s) that produced this row and
        // the USD it cost, computed at generation time from falPricing so spend
        // is never retroactively re-priced. null on old rows / fixtures.
        fal_request_id: a.falRequestId ?? null,
        upscale_request_id: a.upscaleRequestId ?? null,
        cost_usd: a.costUsd ?? null,
        created_at: new Date().toISOString(), // pg stamps this via DEFAULT now()
      };
      artworks.push(row);
      persist();
      return clone(row);
    },

    async updateArtwork(id, patch) {
      const row = artworks.find((r) => r.id === id);
      if (!row) return null;
      const map = {
        width: 'width', height: 'height', durationS: 'duration_s', prompt: 'prompt',
        model: 'model', s3KeyRaw: 's3_key_raw', s3KeyFinal: 's3_key_final',
        thumbnailKey: 'thumbnail_key', status: 'status', error: 'error',
        stage: 'stage', motionPrompt: 'motion_prompt', remoteUrl: 'remote_url',
        falRequestId: 'fal_request_id', upscaleRequestId: 'upscale_request_id', costUsd: 'cost_usd',
        familyId: 'family_id', parentArtworkId: 'parent_artwork_id', changeNote: 'change_note',
      };
      for (const [key, col] of Object.entries(map)) {
        if (patch[key] !== undefined) row[col] = patch[key];
      }
      persist();
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
      persist();
      return clone(row);
    },

    async listEonSequences(runId) {
      return eonSequences.filter((r) => r.run_id === runId).map(clone);
    },

    async addSelection(artworkId, selectedBy = null) {
      let row = selections.find((s) => s.artwork_id === artworkId);
      if (row) {
        row.selected_by = selectedBy;
      } else {
        row = { id: (selSeq += 1), artwork_id: artworkId, selected_by: selectedBy, selected_at: null };
        selections.push(row);
      }
      persist();
      return clone(row);
    },

    async removeSelection(artworkId) {
      const i = selections.findIndex((s) => s.artwork_id === artworkId);
      if (i !== -1) selections.splice(i, 1);
      persist();
    },

    async listSelections(runId) {
      const ids = new Set(artworks.filter((a) => a.run_id === runId).map((a) => a.id));
      return selections.filter((s) => ids.has(s.artwork_id)).map(clone);
    },

    async insertDelivery({ artworkId, method, destination, status = 'pending', sentAt = null, error = null }) {
      const row = {
        id: (delSeq += 1), artwork_id: artworkId, method, destination,
        status, sent_at: sentAt, jeff_notified_at: null, error, created_at: null,
      };
      deliveries.push(row);
      persist();
      return clone(row);
    },

    async updateDelivery(id, patch) {
      const row = deliveries.find((r) => r.id === id);
      if (!row) return null;
      const map = { status: 'status', destination: 'destination', sentAt: 'sent_at', jeffNotifiedAt: 'jeff_notified_at', error: 'error' };
      for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) row[col] = patch[k];
      persist();
      return clone(row);
    },

    async listDeliveries(runId) {
      const ids = new Set(artworks.filter((a) => a.run_id === runId).map((a) => a.id));
      return deliveries.filter((d) => ids.has(d.artwork_id)).map(clone);
    },

    // Cross-run "Sent to Jeff" history: every delivery ever recorded, enriched
    // with just enough artwork + run context that the dashboard needs no
    // follow-up lookups. Newest first by when it was actually sent (falling
    // back to when the record was created); undated rows sink to the bottom.
    async listAllDeliveries() {
      const when = (d) => {
        const t = Date.parse(d.sent_at || d.created_at || '');
        return Number.isNaN(t) ? -Infinity : t; // nulls last under a desc sort
      };
      return deliveries
        .map((d) => {
          const a = artworks.find((x) => x.id === d.artwork_id);
          if (!a) return null; // artwork purged — the row has nothing to show
          const r = runs.find((x) => x.id === a.run_id);
          return {
            ...d,
            artwork: { id: a.id, surface: a.surface, style: a.style, spec_key: a.spec_key, width: a.width, height: a.height },
            run: r ? { id: r.id, week_of: r.week_of } : null,
          };
        })
        .filter(Boolean)
        .sort((x, y) => when(y) - when(x));
    },
  };
}

export default { createMemoryRepo };
