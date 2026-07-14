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
  getRun: (id) => req('GET', `/runs/${id}`),
  generate: (weekOf) => req('POST', '/runs', { triggeredBy: 'dashboard', ...(weekOf ? { weekOf } : {}) }),
  animate: (runId) => req('POST', `/runs/${runId}/animate`),
  // Fresh design options for ONE sign only — other signs untouched.
  regenerate: (runId, surface) => req('POST', `/runs/${runId}/regenerate`, { surface }),
  animateOne: (artworkId) => req('POST', `/artworks/${artworkId}/animate`),
  select: (id) => req('POST', `/artworks/${id}/select`),
  unselect: (id) => req('DELETE', `/artworks/${id}/select`),
  approve: (id) => req('POST', `/artworks/${id}/approve`),
  reject: (id) => req('POST', `/artworks/${id}/reject`),
  handoffPreview: (runId) => req('GET', `/runs/${runId}/handoff`),
  sendHandoff: (runId, payload) => req('POST', `/runs/${runId}/handoff`, payload),
  mediaUrl: (id) => `${API}/artworks/${id}/media`,
  thumbUrl: (id) => `${API}/artworks/${id}/thumbnail`,
};

export default api;
