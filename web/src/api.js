// API client for the Artwork Engine dashboard.
//
// Base path is configurable so this module drops into the shared WOW dashboard
// (unstuckllc/wow-contract-query) unchanged — set VITE_API_BASE if the engine's
// routes are mounted somewhere other than /api. In standalone dev, Vite proxies
// /api and /health to the Express backend on :4000 (see vite.config.js).

// Trailing slashes stripped: a base of "/" would otherwise produce "//artworks/…"
// — a protocol-relative URL (host "artworks") that breaks every <img>/<video>.
const API = (((import.meta.env && import.meta.env.VITE_API_BASE) || '/api')).replace(/\/+$/, '');

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // Surface the server's explanation, not just the status code (UX review).
    let message;
    try {
      const data = await res.json();
      message = data.message || data.error;
    } catch { /* non-JSON error body */ }
    throw new Error(message || `${method} ${path} → ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  base: API,
  health: () => fetch('/health').then((r) => r.json()).catch(() => ({ status: 'unreachable' })),
  listRuns: () => req('GET', '/runs'),
  spend: () => req('GET', '/spend'),
  getRun: (id) => req('GET', `/runs/${id}`),
  generate: (weekOf) => req('POST', '/runs', { triggeredBy: 'dashboard', ...(weekOf ? { weekOf } : {}) }),
  animate: (runId) => req('POST', `/runs/${runId}/animate`),
  // Fresh design options for ONE sign only — other signs untouched.
  regenerate: (runId, surface) => req('POST', `/runs/${runId}/regenerate`, { surface }),
  // Append another option to one sign — retires nothing (vs regenerate, which
  // replaces the unsaved ones and refuses when everything is saved/approved).
  addDesign: (runId, surface, count) => req('POST', `/runs/${runId}/add`, { surface, count }),
  // Replace ONE design card only — its siblings stay.
  regenerateOne: (artworkId) => req('POST', `/artworks/${artworkId}/regenerate`),
  animateOne: (artworkId) => req('POST', `/artworks/${artworkId}/animate`),
  select: (id) => req('POST', `/artworks/${id}/select`),
  unselect: (id) => req('DELETE', `/artworks/${id}/select`),
  approve: (id) => req('POST', `/artworks/${id}/approve`),
  reject: (id) => req('POST', `/artworks/${id}/reject`),
  // Keep & explore: anchor a favourite design, then explore variations of it.
  // keep/unkeep/promote settle instantly (they only move the keeper marker);
  // vary/tweak are 202 + poll — they generate a new family member ($0.03).
  keep: (id) => req('POST', `/artworks/${id}/keep`),
  unkeep: (id) => req('DELETE', `/artworks/${id}/keep`),
  vary: (id) => req('POST', `/artworks/${id}/vary`),
  tweak: (id, instruction) => req('POST', `/artworks/${id}/tweak`, { instruction }),
  promote: (id) => req('POST', `/artworks/${id}/promote`),
  handoffPreview: (runId) => req('GET', `/runs/${runId}/handoff`),
  sendHandoff: (runId, payload) => req('POST', `/runs/${runId}/handoff`, payload),
  // Cross-run history of everything ever sent to Jeff.
  deliveries: () => req('GET', '/deliveries'),
  mediaUrl: (id) => `${API}/artworks/${id}/media`,
  thumbUrl: (id) => `${API}/artworks/${id}/thumbnail`,
  // Storyboard: the closing frame the 30s piece ends on (thumb by default,
  // ?full=1 for the master — lightbox only, it's a multi-MB PNG).
  closingUrl: (id, full) => `${API}/artworks/${id}/closing${full ? '?full=1' : ''}`,
  // Video prompt editing (Scott: see + edit before the video spend).
  setMotionPrompt: (id, acts) => req('PATCH', `/artworks/${id}/motion-prompt`, acts),
  resetMotionPrompt: (id) => req('POST', `/artworks/${id}/motion-prompt/reset`),
};

export default api;
