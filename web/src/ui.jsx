// Shared UI bits for the review dashboard. WOW palette: Blue #0247FE accents,
// Green confirmations — matching the existing Content Automation dashboard.
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

export function StatusBadge({ status }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[status] || 'bg-neutral-700 text-neutral-200'}`}>
      {status}
    </span>
  );
}

// One artwork's video preview in its true-to-sign aspect box.
export function Preview({ artworkId, aspectClass }) {
  return (
    <div className={`overflow-hidden rounded bg-black ${aspectClass}`}>
      <video
        className="h-full w-full object-cover"
        src={api.mediaUrl(artworkId)}
        poster={api.thumbUrl(artworkId)}
        muted
        loop
        autoPlay
        playsInline
        controls
      />
    </div>
  );
}

// Compact action row. `wrap` lets buttons flow onto a second line in narrow
// cards instead of overflowing.
export function Actions({ selected, status, busy, onSelect, onApprove, onReject }) {
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
        Approve
      </button>
      <button
        type="button" disabled={busy} onClick={onReject}
        className={`${btn} ${status === 'rejected' ? 'bg-rose-700 text-white' : 'bg-neutral-800 text-rose-300 hover:bg-neutral-700'}`}
      >
        Reject
      </button>
    </div>
  );
}

// Collapsible "Prompt & details" panel: the exact prompt + model behind a piece.
export function Details({ artwork }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span> Prompt
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded bg-neutral-950/60 p-2 text-[11px] leading-snug text-neutral-300">
          <p className="whitespace-pre-wrap break-words">{artwork.prompt || '—'}</p>
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
export function Card({ artwork, aspectClass, actions }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-2">
      <Preview artworkId={artwork.id} aspectClass={aspectClass} />
      <div className="mt-2 flex items-center justify-between px-0.5">
        <span className="text-[11px] text-neutral-500">{artwork.width}×{artwork.height}</span>
        <StatusBadge status={artwork.status} />
      </div>
      <div className="px-0.5">
        <Actions {...actions} />
        <Details artwork={artwork} />
      </div>
    </div>
  );
}
