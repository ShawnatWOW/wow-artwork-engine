// Shared UI bits for the review dashboard. WOW palette: Blue #0247FE accents.
import { useState } from 'react';
import { api } from './api.js';

const ACCENT = '#0247FE';

const STATUS_STYLES = {
  ready: 'bg-neutral-700 text-neutral-200',
  approved: 'bg-emerald-600 text-white',
  rejected: 'bg-rose-700 text-white',
  generating: 'bg-amber-600 text-white',
  failed: 'bg-rose-900 text-rose-200',
  sent: 'bg-sky-600 text-white',
};

// Stage-aware labels: "ready" means different things for a still (style
// awaiting review) vs a motion (animation awaiting final approval).
export function statusLabel(status, stage) {
  if (status === 'ready') return stage === 'still' ? 'review style' : 'review animation';
  return status;
}

export function StatusBadge({ status, stage }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[status] || 'bg-neutral-700 text-neutral-200'}`}>
      {statusLabel(status, stage)}
    </span>
  );
}

// LIVE (spends money) vs FIXTURES ($0) — always visible, honest (UX P0).
export function ModePill({ mode }) {
  if (!mode) return null;
  const live = mode === 'live';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${live ? 'bg-rose-600 text-white' : 'bg-emerald-700 text-emerald-100'}`}>
      {live ? '● Live — real generation costs' : '● Fixtures — $0'}
    </span>
  );
}

// Error/warning ribbon (UX P0: failures were invisible). Red for hard
// failures, amber for QA warnings on otherwise-ready pieces.
export function ErrorRibbon({ artwork }) {
  if (!artwork.error) return null;
  const hard = artwork.status === 'failed' || /refus|moderation|likeness|guardrail|no video/i.test(artwork.error);
  return (
    <p className={`mt-1.5 rounded px-2 py-1 text-[11px] leading-snug ${hard ? 'bg-rose-950 text-rose-200' : 'bg-amber-950 text-amber-200'}`}>
      {hard ? '⚠ ' : '△ '}{artwork.error}
    </p>
  );
}

// Preview an artwork at its true aspect ratio: still → image, motion → video.
export function Preview({ artwork }) {
  const aspect = artwork.width && artwork.height ? `${artwork.width} / ${artwork.height}` : '16 / 9';
  return (
    <div className="overflow-hidden rounded bg-black" style={{ aspectRatio: aspect }}>
      {artwork.media_type === 'still' ? (
        <img className="h-full w-full object-cover" src={api.mediaUrl(artwork.id)} alt="" loading="lazy" />
      ) : (
        <video
          className="h-full w-full object-cover"
          src={api.mediaUrl(artwork.id)}
          poster={api.thumbUrl(artwork.id)}
          muted loop autoPlay playsInline controls
        />
      )}
    </div>
  );
}

// Compact action row; wraps in narrow cards instead of overflowing.
export function Actions({ selected, status, busy, stage, onSelect, onApprove, onReject, onRetry }) {
  const btn = 'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition disabled:opacity-40';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button" disabled={busy} onClick={onSelect}
        className={`${btn} ${selected ? 'text-white' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}
        style={selected ? { backgroundColor: ACCENT } : undefined}
      >
        {selected ? '★ Picked' : '☆ Pick'}
      </button>
      <button
        type="button" disabled={busy} onClick={onApprove}
        className={`${btn} ${status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-emerald-300 hover:bg-neutral-700'}`}
      >
        {stage === 'still' ? 'Approve style' : 'Approve'}
      </button>
      <button
        type="button" disabled={busy} onClick={onReject}
        className={`${btn} ${status === 'rejected' ? 'bg-rose-700 text-white' : 'bg-neutral-800 text-rose-300 hover:bg-neutral-700'}`}
      >
        Reject
      </button>
      {onRetry && (
        <button type="button" disabled={busy} onClick={onRetry} className={`${btn} bg-amber-600 text-white hover:bg-amber-500`}>
          ↻ Retry animation
        </button>
      )}
    </div>
  );
}

// Small "source style" chip on a motion card, so the approved still stays
// visible/comparable after the animation replaces it (UX P0).
export function SourceStill({ stillId }) {
  if (!stillId) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
      <img src={api.thumbUrl(stillId)} alt="" className="h-8 w-12 rounded object-cover" loading="lazy" />
      <span>approved style ✓</span>
    </div>
  );
}

// Collapsible details: the still prompt, the proposed motion prompt, + model.
export function Details({ artwork }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span> Prompt
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded bg-neutral-950/60 p-2 text-[11px] leading-snug text-neutral-300">
          <div>
            <p className="mb-0.5 text-neutral-500">Still prompt</p>
            <p className="whitespace-pre-wrap break-words">{artwork.prompt || '—'}</p>
          </div>
          {artwork.motion_prompt && (
            <div>
              <p className="mb-0.5 text-neutral-500">Proposed motion (Seedance)</p>
              <p className="whitespace-pre-wrap break-words">{artwork.motion_prompt}</p>
            </div>
          )}
          <p className="text-neutral-500">
            {artwork.model || 'model n/a'}
            {artwork.duration_s ? ` · ${artwork.duration_s}s` : ''}
            {artwork.spec_key ? ` · ${artwork.spec_key}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

// A self-contained option card used across surfaces.
export function Card({ artwork, actions }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-2">
      <Preview artwork={artwork} />
      <div className="mt-2 flex items-center justify-between px-0.5">
        <span className="text-[11px] text-neutral-500">{artwork.width}×{artwork.height}</span>
        <StatusBadge status={artwork.status} stage={artwork.stage} />
      </div>
      <div className="px-0.5">
        <ErrorRibbon artwork={artwork} />
        {artwork.stage === 'motion' && <SourceStill stillId={artwork.source_still_id} />}
        <Actions {...actions} stage={artwork.stage} />
        <Details artwork={artwork} />
      </div>
    </div>
  );
}

// The 4-step flow indicator (UX P0: the two-phase model was unexplained).
export function Stepper({ detail }) {
  const artworks = detail?.artworks || [];
  const stills = artworks.filter((a) => a.stage === 'still');
  const motions = artworks.filter((a) => a.stage === 'motion');
  const done = [
    stills.length > 0,
    stills.some((a) => a.status === 'approved'),
    motions.length > 0,
    motions.some((a) => a.status === 'approved'),
  ];
  const current = done.findIndex((d) => !d);
  const steps = ['Generate styles', 'Approve styles', 'Animate', 'Approve & send'];
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-1">
          <span
            className={
              done[i] ? 'text-emerald-400'
                : i === current ? 'font-semibold text-white'
                  : 'text-neutral-600'
            }
          >
            {done[i] ? '✓' : `${i + 1}.`} {label}
          </span>
          {i < steps.length - 1 && <span className="text-neutral-700">→</span>}
        </li>
      ))}
    </ol>
  );
}
