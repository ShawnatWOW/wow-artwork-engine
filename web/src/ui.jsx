// Shared UI bits for the review dashboard. WOW palette: Blue #0247FE accents.
// Language is written for a first-time reviewer: designs → videos → send.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// One keyboard-focus treatment for every interactive control (a11y polish).
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0247FE]';

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

// True when the OS asks for reduced motion — then we never autoplay video.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange); // older Safari
    return () => mq.removeListener(onChange);
  }, []);
  return reduced;
}

// Poster-first video that only streams while actually on screen.
//
// First paint used to open every motion card's 15s 4K stream at once (9+
// simultaneous downloads — the "slow load" complaint). Now each card shows its
// lightweight poster (preload="none"); an IntersectionObserver attaches the
// real src and plays at ~40% visibility, and pauses off-screen. Once attached
// the src never changes for a given artwork, so the 2s status polls re-render
// without reloading the stream. prefers-reduced-motion: no autoplay — poster +
// controls, play is the viewer's choice.
export function LazyVideo({ artworkId, className = 'h-full w-full object-cover' }) {
  const ref = useRef(null);
  const [attached, setAttached] = useState(false); // latched once in view
  const [inView, setInView] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setAttached(true); setInView(true); // ancient browser: behave like before
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) setAttached(true);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Drive playback from visibility. play() may reject (autoplay policy) — fine.
  useEffect(() => {
    const el = ref.current;
    if (!el || !attached) return;
    if (inView && !reducedMotion) el.play().catch(() => {});
    else el.pause();
  }, [attached, inView, reducedMotion]);

  return (
    <video
      ref={ref}
      className={className}
      src={attached ? api.mediaUrl(artworkId) : undefined}
      poster={api.thumbUrl(artworkId)}
      preload="none"
      muted loop playsInline controls
      aria-label="Video preview"
    />
  );
}

// Image that fades in when its bytes arrive — no gray pop on slow links.
function FadeImg({ src, alt = '', className = '' }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  // Cached images can be complete before onLoad is wired up.
  useEffect(() => { if (ref.current?.complete) setReady(true); }, [src]);
  return (
    <img
      ref={ref} src={src} alt={alt} loading="lazy" decoding="async"
      onLoad={() => setReady(true)}
      className={`${className} transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

// Preview an artwork at its true aspect ratio: design → image, video → video.
export function Preview({ artwork }) {
  const aspect = artwork.width && artwork.height ? `${artwork.width} / ${artwork.height}` : '16 / 9';
  return (
    <div className="overflow-hidden rounded bg-black" style={{ aspectRatio: aspect }}>
      {artwork.media_type === 'still' ? (
        <FadeImg className="h-full w-full object-cover" src={api.mediaUrl(artwork.id)} alt="" />
      ) : (
        <LazyVideo artworkId={artwork.id} />
      )}
    </div>
  );
}

// Two clear choices per card: use it, or pass. (The old "Pick" button
// duplicated Approve and confused first-time reviewers — removed.) Stills also
// get a Save toggle — keep a design out of regeneration without approving it.
// Hierarchy (CEO pass, 2026-07-22): Approve is the decision — solid once
// taken, outlined invitation until then. Save keeps its violet identity.
// Pass and New design are quiet ghosts that fill on hover.
export function Actions({ status, busy, stage, saved, onApprove, onReject, onRetry, onRegen, onToggleSave }) {
  const btn = `inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${focusRing}`;
  const ghost = 'border-neutral-700 bg-transparent text-neutral-400 hover:bg-neutral-800';
  const approveLabel = status === 'approved' ? '✓ Approved' : stage === 'still' ? '✓ Use this design' : '✓ Approve video';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button" disabled={busy} onClick={onApprove}
        title={stage === 'still' ? 'Approve this design — approved designs get turned into videos' : 'Approve this video — approved videos can be sent to Jeff'}
        className={`${btn} ${status === 'approved'
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-emerald-700/60 bg-transparent text-emerald-300 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white'}`}
      >
        {approveLabel}
      </button>
      {onToggleSave && (
        <button
          type="button" disabled={busy} onClick={onToggleSave}
          title="Keep this design — saved designs are never replaced by a regeneration"
          className={`${btn} ${saved ? 'border-violet-600 bg-violet-600 text-white' : 'border-transparent bg-neutral-800 text-violet-300 hover:bg-neutral-700'}`}
        >
          {saved ? '🔖 Saved' : '🔖 Save'}
        </button>
      )}
      <button
        type="button" disabled={busy} onClick={onReject}
        title="Pass on this one — nothing else happens with it"
        className={`${btn} ${status === 'rejected' ? 'border-rose-700 bg-rose-700 text-white' : `${ghost} hover:text-rose-300`}`}
      >
        {status === 'rejected' ? '✕ Passed' : '✕ Pass'}
      </button>
      {onRetry && (
        <button type="button" disabled={busy} onClick={onRetry} title="Try making the video again" className={`${btn} border-amber-600 bg-amber-600 text-white hover:bg-amber-500`}>
          ↻ Try again
        </button>
      )}
      {onRegen && (
        <button
          type="button" disabled={busy} onClick={onRegen}
          title="Replace just this design with a brand-new one — the other options stay"
          className={`${btn} ${ghost} hover:text-sky-300`}
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
      <img src={api.thumbUrl(stillId)} alt="" className="h-8 w-12 rounded object-cover" loading="lazy" decoding="async" />
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
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={`flex items-center gap-1 rounded text-[11px] text-neutral-400 transition-colors hover:text-neutral-200 ${focusRing}`}
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
    <div className={`card-in rounded-lg border border-neutral-800 bg-neutral-900 p-2 transition-colors${saved ? ' ring-1 ring-violet-500/60' : ''}`}>
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

// The 3-step flow guide, prominent enough that a first-time reviewer always
// knows where they are: pick → videos → send. Done = emerald ✓, current =
// WOW blue, upcoming = dim.
export function Stepper({ detail }) {
  const artworks = detail?.artworks || [];
  const stills = artworks.filter((a) => a.stage === 'still' && a.status !== 'superseded');
  const motions = artworks.filter((a) => a.stage === 'motion');
  const done = [
    stills.some((a) => a.status === 'approved') || motions.length > 0,
    motions.length > 0,
    motions.some((a) => a.status === 'sent'),
  ];
  const current = done.findIndex((d) => !d);
  const steps = ['Pick designs', 'Make videos', 'Send to Jeff'];
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-2 text-xs" aria-label="Review progress">
      {steps.map((label, i) => {
        const state = done[i] ? 'done' : i === current ? 'current' : 'upcoming';
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                state === 'done' ? 'bg-emerald-600 text-white'
                  : state === 'current' ? 'bg-[#0247FE] text-white'
                    : 'border border-neutral-700 text-neutral-500'
              }`}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={
              state === 'done' ? 'font-medium text-emerald-400'
                : state === 'current' ? 'font-semibold text-white'
                  : 'text-neutral-600'
            }
            >
              {label}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="text-neutral-700">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

// Pulse placeholder shown while a batch's details load — the page keeps its
// real shape (true aspect ratios) instead of flashing an empty state.
export function SkeletonCard({ aspect = '16 / 9' }) {
  return (
    <div className="animate-pulse rounded-lg border border-neutral-800 bg-neutral-900 p-2" aria-hidden="true">
      <div className="rounded bg-neutral-800" style={{ aspectRatio: aspect }} />
      <div className="mt-2 flex items-center justify-between px-0.5">
        <div className="h-3 w-16 rounded bg-neutral-800" />
        <div className="h-4 w-20 rounded bg-neutral-800" />
      </div>
      <div className="mt-2 flex gap-1.5 px-0.5">
        <div className="h-6 w-24 rounded bg-neutral-800" />
        <div className="h-6 w-14 rounded bg-neutral-800" />
        <div className="h-6 w-14 rounded bg-neutral-800" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts — tiny self-made confirmations (bottom-right, auto-dismiss 2.5s) so
// every card action answers instantly while its API call settles in the
// background. Click a toast to dismiss it early.

const TOAST_TONES = {
  success: 'border-emerald-800 bg-emerald-950 text-emerald-200',
  violet: 'border-violet-800 bg-violet-950 text-violet-200',
  neutral: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  error: 'border-rose-800 bg-rose-950 text-rose-200',
};

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());
  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);
  const push = useCallback((message, tone = 'neutral') => {
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]); // keep the stack short
    timers.current.set(id, setTimeout(() => dismiss(id), 2500));
  }, [dismiss]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  return { toasts, push, dismiss };
}

export function Toasts({ items, onDismiss }) {
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-72 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id} type="button" onClick={() => onDismiss(t.id)}
          className={`card-in pointer-events-auto rounded-md border px-3 py-2 text-left text-xs shadow-lg shadow-black/40 transition-colors ${TOAST_TONES[t.tone] || TOAST_TONES.neutral} ${focusRing}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
