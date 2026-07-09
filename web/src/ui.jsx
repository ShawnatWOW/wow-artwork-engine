// Shared UI bits for the review dashboard. WOW palette: Blue #0247FE accents,
// Green confirmations — matching the existing Content Automation dashboard.
import { api } from './api.js';

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

export function Actions({ selected, status, busy, onSelect, onApprove, onReject }) {
  const btn = 'rounded px-2 py-1 text-xs font-medium transition disabled:opacity-40';
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={onSelect}
        className={`${btn} ${selected ? 'bg-[#0247FE] text-white' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}
      >
        {selected ? '★ Picked' : '☆ Pick'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onApprove}
        className={`${btn} ${status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-emerald-300 hover:bg-neutral-700'}`}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onReject}
        className={`${btn} ${status === 'rejected' ? 'bg-rose-700 text-white' : 'bg-neutral-800 text-rose-300 hover:bg-neutral-700'}`}
      >
        Reject
      </button>
    </div>
  );
}
