// Shared UI bits for the review dashboard. WOW palette: Blue #0247FE accents.
// Language is written for a first-time reviewer: designs → videos → send.
import { useState } from 'react';
import { api } from './api.js';

const STATUS_STYLES = {
  ready: 'bg-neutral-700 text-neutral-200',
  approved: 'bg-emerald-600 text-white',
  rejected: 'bg-rose-700 text-white',
  generating: 'bg-amber-600 text-white',
  failed: 'bg-rose-900 text-rose-200',
  sent: 'bg-sky-600 text-white',
};

// Plain-English labels: "ready" means "waiting for your review".
export function statusLabel(status, stage) {
  if (status === 'ready') return stage === 'still' ? 'needs review' : stage === 'motion' ? 'review video' : status;
  if (status === 'generating') return 'making video…';
  if (status === 'complete') return 'done';
  if (status === 'superseded') return 'replaced'; // retired by a per-sign regenerate (normally hidden)
  return status;
}

// A small spinner used in headers/inline.
export function Spinner({ className = '' }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-[#0247FE] ${className}`} />;
}

// Overlay shown on a card while its video is being generated.
export function GeneratingOverlay({ label = 'Making video…', sub = 'about 2–4 minutes' }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded bg-black/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-500 border-t-[#0247FE]" />
        <span className="text-xs font-semibold text-white">{label}</span>
        <span className="text-[10px] text-neutral-300">{sub}</span>
      </div>
    </div>
  );
}

export function StatusBadge({ status, stage }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[status] || 'bg-neutral-700 text-neutral-200'}`}>
      {statusLabel(status, stage)}
    </span>
  );
}

// Month-to-date spend strip — what THIS project's art has cost so far this
// month. Itemized (designs / motion / 4K upscale) at fal's real prices. Note:
// the fal account is shared with Content Automation + Broken News, so fal's own
// dashboard shows all three combined — this figure is artwork-only.
export function SpendPill({ spend }) {
  if (!spend) return null;
  const monthName = new Date(`${spend.month}-15T12:00:00Z`)
    .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const b = spend.breakdown;
  const lines = [
    `Artwork-only estimate at fal's real prices:`,
    `• ${spend.stills.count} design${spend.stills.count === 1 ? '' : 's'} → $${spend.stills.usd.toFixed(2)}`,
    b && `• ${spend.videos.count} video${spend.videos.count === 1 ? '' : 's'} / ${b.seedance.seconds}s motion → $${b.seedance.usd.toFixed(2)}`,
    b && b.topaz.usd > 0 && `• 4K upscale / ${b.topaz.seconds}s → $${b.topaz.usd.toFixed(2)}`,
    ``,
    `fal's account bill also covers Content Automation + Broken News — this is artwork only.`,
  ].filter(Boolean).join('\n');
  return (
    <span
      title={lines}
      className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300"
    >
      💰 {monthName} spend: ${spend.totalUsd.toFixed(2)}
    </span>
  );
}

// Honest LIVE (spends) vs TEST ($0) indicator.
export function ModePill({ mode }) {
  if (!mode) return null;
  const live = mode === 'live';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${live ? 'bg-rose-600 text-white' : 'bg-emerald-700 text-emerald-100'}`}>
      {live ? '● Live — makes real art, costs money' : '● Test mode — free placeholders'}
    </span>
  );
}

// Error/warning ribbon. Red for hard failures, amber for QA warnings.
export function ErrorRibbon({ artwork }) {
  if (!artwork.error) return null;
  const hard = artwork.status === 'failed' || /refus|moderation|likeness|guardrail|no video/i.test(artwork.error);
  return (
    <p className={`mt-1.5 rounded px-2 py-1 text-[11px] leading-snug ${hard ? 'bg-rose-950 text-rose-200' : 'bg-amber-950 text-amber-200'}`}>
      {hard ? '⚠ ' : '△ '}{artwork.error}
    </p>
  );
}

// Preview an artwork at its true aspect ratio: design → image, video → video.
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

// Two clear choices per card: use it, or pass. (The old "Pick" button
// duplicated Approve and confused first-time reviewers — removed.) Stills also
// get a Save toggle — keep a design out of regeneration without approving it.
export function Actions({ status, busy, stage, saved, onApprove, onReject, onRetry, onRegen, onToggleSave }) {
  const btn = 'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition disabled:opacity-40';
  const approveLabel = status === 'approved' ? '✓ Approved' : stage === 'still' ? '✓ Use this design' : '✓ Approve video';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button" disabled={busy} onClick={onApprove}
        title={stage === 'still' ? 'Approve this design — approved designs get turned into videos' : 'Approve this video — approved videos can be sent to Jeff'}
        className={`${btn} ${status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-emerald-300 hover:bg-neutral-700'}`}
      >
        {approveLabel}
      </button>
      {onToggleSave && (
        <button
          type="button" disabled={busy} onClick={onToggleSave}
          title="Keep this design — saved designs are never replaced by a regeneration"
          className={`${btn} ${saved ? 'bg-violet-600 text-white' : 'bg-neutral-800 text-violet-300 hover:bg-neutral-700'}`}
        >
          {saved ? '🔖 Saved' : '🔖 Save'}
        </button>
      )}
      <button
        type="button" disabled={busy} onClick={onReject}
        title="Pass on this one — nothing else happens with it"
        className={`${btn} ${status === 'rejected' ? 'bg-rose-700 text-white' : 'bg-neutral-800 text-rose-300 hover:bg-neutral-700'}`}
      >
        {status === 'rejected' ? '✕ Passed' : '✕ Pass'}
      </button>
      {onRetry && (
        <button type="button" disabled={busy} onClick={onRetry} title="Try making the video again" className={`${btn} bg-amber-600 text-white hover:bg-amber-500`}>
          ↻ Try again
        </button>
      )}
      {onRegen && (
        <button
          type="button" disabled={busy} onClick={onRegen}
          title="Replace just this design with a brand-new one — the other options stay"
          className={`${btn} bg-neutral-800 text-sky-300 hover:bg-neutral-700`}
        >
          ↻ New design
        </button>
      )}
    </div>
  );
}

// Live progress while a batch is generating: "Creating designs… 3/9".
export function progressLabel(run) {
  const p = run?.progress;
  if (!p || !p.total) return null;
  if (p.phase === 'videos') return `Making videos… ${p.done}/${p.total} (a few minutes each)`;
  return `Creating designs… ${p.done}/${p.total}`;
}

// The approved design stays visible next to its video.
export function SourceStill({ stillId }) {
  if (!stillId) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
      <img src={api.thumbUrl(stillId)} alt="" className="h-8 w-12 rounded object-cover" loading="lazy" />
      <span>made from this approved design</span>
    </div>
  );
}

// Collapsible: exactly what the AI was told to make.
export function Details({ artwork }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span> How the AI was instructed
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded bg-neutral-950/60 p-2 text-[11px] leading-snug text-neutral-300">
          <div>
            <p className="mb-0.5 text-neutral-500">Design instructions</p>
            <p className="whitespace-pre-wrap break-words">{artwork.prompt || '—'}</p>
          </div>
          {artwork.motion_prompt && (
            <div>
              <p className="mb-0.5 text-neutral-500">Video motion instructions</p>
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

// A self-contained option card used across surfaces. When `animating` is true
// (its video is being generated) the card shows a spinner overlay instead of
// the approve/pass buttons. `saved` marks a bookmarked design (violet ring +
// badge) so it's obvious at a glance which cards a regeneration will skip.
export function Card({ artwork, actions, animating, saved }) {
  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-900 p-2${saved ? ' ring-1 ring-violet-500/60' : ''}`}>
      <div className="relative">
        <Preview artwork={artwork} />
        {animating && <GeneratingOverlay />}
      </div>
      <div className="mt-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          {artwork.width}×{artwork.height}
          {saved && <span className="rounded bg-violet-950 px-1 py-0.5 text-[10px] font-medium text-violet-300">🔖 Saved</span>}
        </span>
        <StatusBadge status={animating ? 'generating' : artwork.status} stage={artwork.stage} />
      </div>
      <div className="px-0.5">
        <ErrorRibbon artwork={artwork} />
        {artwork.stage === 'motion' && <SourceStill stillId={artwork.source_still_id} />}
        {animating
          ? <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300"><Spinner className="h-3 w-3" /> Making the video…</p>
          : <Actions {...actions} stage={artwork.stage} />}
        <Details artwork={artwork} />
      </div>
    </div>
  );
}

// The 4-step flow indicator.
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
  const steps = ['Create designs', 'Approve favorites', 'Make videos', 'Approve & send to Jeff'];
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
