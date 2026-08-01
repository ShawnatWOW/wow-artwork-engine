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
    <div className="absolute inset-0 z-10 grid place-items-center overflow-hidden rounded bg-black/70 backdrop-blur-sm">
      {/* Row layout below sm: a 3.6:1 card is only ~90px tall on a phone, and
          the stacked spinner + two lines measured taller than the card itself
          (mobile audit 2026-08-01). */}
      <div className="flex items-center gap-2 px-3 text-center sm:flex-col">
        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-neutral-500 border-t-[#0247FE] sm:h-8 sm:w-8" />
        <span className="text-xs font-semibold text-white">{label}</span>
        <span className="hidden text-[10px] text-neutral-300 sm:block">{sub}</span>
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
    // A button, not a title-only span: tooltips never fire on touch, and the
    // itemized breakdown is load-bearing money information (mobile audit
    // 2026-08-01). Tap toggles it; desktop hover still gets the tooltip.
    <SpendPillButton lines={lines} monthName={monthName} total={spend.totalUsd} />
  );
}

function SpendPillButton({ lines, monthName, total }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button" onClick={() => setOpen((v) => !v)} title={lines} aria-expanded={open}
        className={`min-h-11 rounded-full bg-neutral-800 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 sm:min-h-0 sm:px-2 ${focusRing}`}
      >
        💰 {monthName} spend: ${total.toFixed(2)}
      </button>
      {open && (
        <span className="absolute left-0 top-full z-30 mt-1 block w-72 max-w-[80vw] whitespace-pre-line rounded-md border border-neutral-700 bg-neutral-900 p-2.5 text-[11px] font-normal normal-case tracking-normal text-neutral-200 shadow-lg shadow-black/50">
          {lines}
        </span>
      )}
    </span>
  );
}

// Honest LIVE (spends) vs TEST ($0) indicator. Short label below sm: the full
// sentence wrapped into a two-line shouting banner on a phone (screenshot
// review 2026-08-01) — the load-bearing bit is LIVE-costs-money vs TEST-free,
// not the prose.
export function ModePill({ mode }) {
  if (!mode) return null;
  const live = mode === 'live';
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${live ? 'bg-rose-600 text-white' : 'bg-emerald-700 text-emerald-100'}`}>
      <span className="sm:hidden">{live ? '● Live — costs money' : '● Test — free'}</span>
      <span className="hidden sm:inline">{live ? '● Live — makes real art, costs money' : '● Test mode — free placeholders'}</span>
    </span>
  );
}

// Error/warning ribbon. Red for hard failures, amber for QA warnings.
export function ErrorRibbon({ artwork }) {
  if (!artwork.error) return null;
  const hard = artwork.status === 'failed' || /refus|moderation|likeness|guardrail|no video/i.test(artwork.error);
  return (
    // text-xs on phones: 11px error explanations are the layer that tells a
    // non-technical reviewer WHY something failed (mobile audit 2026-08-01).
    <p className={`mt-1.5 break-words rounded px-2 py-1 text-xs leading-snug sm:text-[11px] ${hard ? 'bg-rose-950 text-rose-200' : 'bg-amber-950 text-amber-200'}`}>
      {hard ? '⚠ ' : '△ '}{artwork.error}
    </p>
  );
}

// Lock the page scroll while a modal is open. On touch, a fling that starts
// (or ends) on the backdrop otherwise scrolls the page underneath and the
// reviewer loses his place (mobile audit 2026-08-01).
export function useBodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}

// True on devices whose PRIMARY pointer can't hover (phones, tablets).
// Width is the wrong test — a 768px iPad is still all thumbs.
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = (e) => setCoarse(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return coarse;
}

// Data-saver signal: never open multi-MB streams uninvited on a metered link.
const wantsDataSaver = () => typeof navigator !== 'undefined' && !!navigator.connection?.saveData;

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
  const [attached, setAttached] = useState(false); // on while near the viewport
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false); // touch tap-to-pause state
  const reducedMotion = usePrefersReducedMotion();
  const coarse = useCoarsePointer();
  const saveData = wantsDataSaver();

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
    // Release the stream once the card is far off-screen. `attached` used to
    // latch forever, so one long scroll accumulated every 4K stream on the page
    // (mobile audit 2026-08-01: 5-6 ultra-wide cards latch in a single
    // screenful). Three viewports of margin means casual back-and-forth
    // scrolling never drops a stream, but a real departure frees it.
    const release = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setAttached(false);
    }, { rootMargin: '300% 0px' });
    release.observe(el);
    return () => { io.disconnect(); release.disconnect(); };
  }, []);

  // Drive playback from visibility. play() may reject (autoplay policy) — fine.
  // Reduced-motion or data-saver: no uninvited playback — tap is the invite.
  useEffect(() => {
    const el = ref.current;
    if (!el || !attached) return;
    if (inView && !reducedMotion && !saveData && !paused) el.play().catch(() => {});
    else el.pause();
  }, [attached, inView, reducedMotion, saveData, paused]);

  // Native controls covered ~half of a 90px-tall billboard frame on a phone
  // (mobile audit 2026-08-01). On coarse pointers the frame itself is the
  // play/pause control and a thumb-sized ⛶ opens real fullscreen — where the
  // native controls belong.
  const goFullscreen = (e) => {
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen(); // iPhone Safari
  };

  const video = (
    <video
      ref={ref}
      className={className}
      src={attached ? api.mediaUrl(artworkId) : undefined}
      poster={api.thumbUrl(artworkId)}
      preload="none"
      muted loop playsInline controls={!coarse}
      aria-label="Video preview"
    />
  );
  if (!coarse) return video;
  return (
    <div className="relative h-full w-full" onClick={() => { setAttached(true); setPaused((p) => !p); }}>
      {video}
      {(paused || reducedMotion || saveData) && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center text-2xl text-white/90 drop-shadow">▶</span>
      )}
      <button
        type="button" onClick={goFullscreen} aria-label="Watch fullscreen"
        className={`absolute bottom-1 right-1 inline-flex h-11 w-11 items-center justify-center rounded-md bg-black/55 text-base text-white backdrop-blur-sm ${focusRing}`}
      >
        ⛶
      </button>
    </div>
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

// ---------------------------------------------------------------------------
// EON pods. Every EON pillar carries a narrow LED spine down its left side as
// well as its face, and both are cut from ONE design so the artwork wraps
// around the corner (WOW template spec sheet). A pod is 1 part spine to 4 parts
// face, which is the ratio these components render at.

// Plain-language names for the three sign types, used for image alt text.
const SURFACE_NAMES = {
  frame_break: 'Spectacular billboard',
  eon_connected: 'EON 3-pillar',
  eon_single: 'EON single pillar',
};

const PODS_FOR_STYLE = { eon_connected: 3, eon_single: 1 };
const SPINE_SHARE = 0.2; // a spine is 320 of a pod's 1600 delivery pixels

/** How many pods an un-cut design covers (0 = not an EON design). Pure. */
export const podsForStyle = (style) => PODS_FOR_STYLE[style] || 0;

/** Sort key for a panel row — pod 1→N, spine before face. Pure. */
export function panelOrder(artwork) {
  const m = /^pod(\d+)_(spine|face)$/.exec(artwork.panel || '');
  return m ? [Number(m[1]), m[2] === 'spine' ? 0 : 1] : [99, 9];
}

/**
 * The latest complete set of panels for one design. Re-animating appends a
 * fresh set, so the newest row for each panel id wins (rows arrive id-ascending).
 *
 * Rows generated before pods had spines (pre-2026-07-25) carry no panel id —
 * they are faces only. They're labelled by position so those runs still play
 * their videos instead of falling back to the un-cut design.
 */
export function latestPanels(motions, style) {
  const list = motions || [];
  const tagged = list.filter((m) => m.panel);
  if (tagged.length) {
    const byPanel = new Map();
    for (const m of tagged) byPanel.set(m.panel, m);
    return [...byPanel.values()].sort((a, b) => {
      const [pa, ka] = panelOrder(a);
      const [pb, kb] = panelOrder(b);
      return pa - pb || ka - kb;
    });
  }
  const pods = podsForStyle(style);
  if (!pods || !list.length) return [];
  return list.slice(-pods).map((m, i) => ({ ...m, panel: `pod${i + 1}_face` }));
}

// Where an un-cut EON design gets cut, drawn over its preview: a faint tint on
// each pillar's spine band plus a rule at each pillar boundary. It answers the
// question the flat design can't — "which bit of this wraps onto the side?"
export function WrapGuide({ pods }) {
  if (!pods) return null;
  const slab = 100 / pods;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {Array.from({ length: pods }, (_, i) => (
        <div key={i}>
          <div
            className="absolute inset-y-0 border-r border-[#0247FE]/60 bg-[#0247FE]/25"
            style={{ left: `${i * slab}%`, width: `${slab * SPINE_SHARE}%` }}
          />
          {i > 0 && <div className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${i * slab}%` }} />}
        </div>
      ))}
    </div>
  );
}

// Full-screen loupe for a design still. The grid preview of a 3.6:1 billboard
// is a ~90px-tall sliver on a phone — an approval decision needs the real
// pixels. Renders the MASTER (multi-MB) — on demand only, never in the grid.
// The container pans; the browser's pinch-zoom does the rest (the viewport
// meta deliberately allows scaling).
function Lightbox({ artwork, onClose }) {
  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] overflow-auto overscroll-contain bg-black/95" onClick={onClose} role="dialog" aria-label="Design close-up">
      <button
        type="button" onClick={onClose} aria-label="Close close-up"
        className={`fixed right-3 top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900/80 text-lg text-white ${focusRing}`}
      >
        ✕
      </button>
      <div className="grid min-h-full place-items-center p-2">
        <img
          src={api.mediaUrl(artwork.id)} alt={`${SURFACE_NAMES[artwork.style] || 'Artwork'} design, full size`}
          className="max-w-none"
          style={{ width: artwork.width && artwork.width > 2000 ? `${artwork.width / 2}px` : '100%', maxWidth: 'none' }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <p className="pointer-events-none fixed inset-x-0 bottom-2 text-center text-[11px] text-neutral-400">Pinch to zoom · drag to pan · tap outside to close</p>
    </div>
  );
}

// Preview an artwork at its true aspect ratio: design → image, video → video.
// An un-cut EON design also gets its wrap guide. Stills open a fullscreen
// pinch-zoom loupe on tap (mobile audit 2026-08-01 — there was no way to
// actually SEE a phone-width billboard before approving it).
export function Preview({ artwork }) {
  const [zoom, setZoom] = useState(false);
  const aspect = artwork.width && artwork.height ? `${artwork.width} / ${artwork.height}` : '16 / 9';
  const guidePods = artwork.stage === 'still' ? podsForStyle(artwork.style) : 0;
  return (
    <div className="relative overflow-hidden rounded bg-black" style={{ aspectRatio: aspect }}>
      {artwork.media_type === 'still' ? (
        // The THUMBNAIL, not the master. A design master is a 2-5 MB 4K PNG and
        // nothing here renders wider than ~1400px, so pointing the grid at the
        // master downloaded ~30 MB to show nine cards (perf audit 2026-07-26).
        // The thumbnail is the same picture at ~45 KB.
        <button type="button" onClick={() => setZoom(true)} className={`block h-full w-full ${focusRing}`} title="Tap to see it full size">
          <FadeImg
            className="h-full w-full object-cover"
            src={api.thumbUrl(artwork.id)}
            // The artwork IS the thing being reviewed, so it needs a real name —
            // an empty alt tells a screen reader there is nothing here at all.
            alt={`${SURFACE_NAMES[artwork.style] || 'Artwork'} design, ${statusLabel(artwork.status, artwork.stage)} — opens full size`}
          />
          <span aria-hidden="true" className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90">⤢</span>
        </button>
      ) : (
        <LazyVideo artworkId={artwork.id} />
      )}
      <WrapGuide pods={guidePods} />
      {zoom && <Lightbox artwork={artwork} onClose={() => setZoom(false)} />}
    </div>
  );
}

// The blue-band legend, shown once under an EON section rather than on every card.
export function WrapLegend({ pods }) {
  if (!pods) return null;
  return (
    // items-start + shrink-0: on a narrow screen the sentence wraps to several
    // lines and the swatch must stay square beside the first one, not squash.
    <p className="mb-3 flex items-start gap-1.5 text-[11px] leading-snug text-neutral-400">
      <span className="mt-0.5 inline-block h-3 w-2 shrink-0 rounded-sm border-r border-[#0247FE]/60 bg-[#0247FE]/25" />
      <span>
        {pods === 1
          ? 'Blue = the strip that wraps onto the pillar’s side.'
          : 'Blue = the strip that wraps onto each pillar’s side. White lines = where one pillar ends.'}
      </span>
    </p>
  );
}

// One finished EON piece, laid out the way the hardware actually stands: each
// pillar is its narrow spine hard against its face (the corner), pillars spaced
// apart. This is what Scott approves — the full set, not a lone face.
//
// The pillars are sized FLUIDLY (a grid of equal fractions, spine 1/5 of its
// pillar) rather than at fixed pixel widths. On a phone fixed widths pushed the
// third pillar onto its own line, which breaks the one thing this view exists
// to show — the artwork travelling from pillar to pillar. Now the row holds its
// shape at any width and just gets smaller.
// --- Synced pod playback -----------------------------------------------------
//
// A pillar set is ONE piece of art cut into panels, but each panel used to be
// an independent <video> (LazyVideo): each attached its stream when it
// personally crossed the viewport threshold, started when it personally
// finished buffering, and looped on its own clock — so the six cuts of one
// 15s clip played visibly out of sync and the travel illusion fell apart
// (Shawn, 2026-07-31). This conductor makes the set behave as one player:
//
//   attach together   one IntersectionObserver on the whole set, not six
//   start together    nothing plays until EVERY panel can play through
//   stay together     a 400ms tick snaps stragglers to the first panel's
//                     clock whenever they drift past 80ms (loop wraps are just
//                     a big drift, so the same snap re-syncs each cycle)
//   pause together    one Play/Pause for the set; off-screen pauses all
//
// Per-panel native controls are deliberately gone — pausing one cut of a
// six-cut artwork is never what a reviewer means.
function useSyncedSet(count) {
  const containerRef = useRef(null);
  const videoRefs = useRef(new Map());
  const readyIds = useRef(new Set());
  const [attached, setAttached] = useState(false); // latched: srcs stay on
  const [inView, setInView] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  // 'auto' = play when ready+visible · 'play' = user insisted (overrides
  // reduced-motion) · 'pause' = user stopped the set
  const [intent, setIntent] = useState('auto');
  // Escape hatch: iOS downgrades preload under Low Power Mode / cellular, so
  // one stalled panel used to pin the ONLY transport control at "Loading…
  // n/6" forever (mobile audit 2026-08-01). After 6s of being attached we
  // stop waiting for stragglers — the 400ms sync tick reels them in once
  // they do buffer.
  const [forced, setForced] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setAttached(true); setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) setAttached(true);
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!attached) return undefined;
    const t = setTimeout(() => setForced(true), 6000);
    return () => clearTimeout(t);
  }, [attached]);

  const ready = forced || (count > 0 && readyCount >= count);
  const shouldPlay = ready && inView
    && (intent === 'play' || (intent === 'auto' && !reducedMotion));

  useEffect(() => {
    const vids = [...videoRefs.current.values()].filter(Boolean);
    if (!vids.length) return undefined;
    if (!shouldPlay) {
      for (const v of vids) v.pause();
      return undefined;
    }
    const lead = vids[0];
    for (const v of vids) {
      if (Math.abs(v.currentTime - lead.currentTime) > 0.05) v.currentTime = lead.currentTime;
    }
    for (const v of vids) v.play().catch(() => {});
    const timer = setInterval(() => {
      if (lead.paused || lead.readyState < 3) return;
      for (const v of vids) {
        if (v !== lead && Math.abs(v.currentTime - lead.currentTime) > 0.08) {
          v.currentTime = lead.currentTime;
        }
      }
    }, 400);
    return () => clearInterval(timer);
  }, [shouldPlay]);

  const markReady = (id) => {
    if (readyIds.current.has(id)) return;
    readyIds.current.add(id);
    setReadyCount(readyIds.current.size);
  };
  const setVideoRef = (id) => (el) => {
    if (el) {
      videoRefs.current.set(id, el);
      if (el.readyState >= 2) markReady(id); // cache hit: first frame already decodable
    } else {
      videoRefs.current.delete(id);
    }
  };
  // A tap on the transport must always work: it forces the attach (data-saver
  // paths may not have latched yet) and stops waiting for stragglers.
  const insistPlay = () => { setAttached(true); setForced(true); setIntent('play'); };
  return { containerRef, setVideoRef, markReady, attached, ready, readyCount, shouldPlay, setIntent, insistPlay };
}

// One panel of a synced set. No native controls — the set's single button is
// the transport (see useSyncedSet).
function SyncedPanel({ panel, attached, setVideoRef, markReady }) {
  const aspect = panel.width && panel.height ? `${panel.width} / ${panel.height}` : '2 / 3';
  return (
    <div className="overflow-hidden rounded bg-black" style={{ aspectRatio: aspect }}>
      <video
        ref={setVideoRef(panel.id)}
        className="h-full w-full object-cover"
        src={attached ? api.mediaUrl(panel.id) : undefined}
        poster={api.thumbUrl(panel.id)}
        preload={attached ? 'auto' : 'none'}
        // loadeddata (first frame), not canplaythrough: iOS frequently never
        // fires canplaythrough on cellular/Low Power Mode, which dead-locked
        // the whole set behind its slowest panel (mobile audit 2026-08-01).
        onLoadedData={() => markReady(panel.id)}
        muted loop playsInline
        aria-label={`Pillar video, ${panel.panel || 'panel'}`}
      />
    </div>
  );
}

export function PodSet({ panels, actions, caption }) {
  const pods = [];
  for (const p of panels) {
    const n = panelOrder(p)[0];
    let pod = pods.find((x) => x.n === n);
    if (!pod) { pod = { n, spine: null, face: null }; pods.push(pod); }
    pod[p.panel?.endsWith('spine') ? 'spine' : 'face'] = p;
  }
  const sync = useSyncedSet(panels.length);
  const panelProps = {
    attached: sync.attached, setVideoRef: sync.setVideoRef, markReady: sync.markReady,
  };
  return (
    <div className="card-in rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      {/* flex-col below sm: the caption used to share one row with a shrink-0
          Play button, leaving it a 46px-wide column rendering one word per
          line, ~300px tall (mobile audit 2026-08-01, blocker #1). */}
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span className="text-xs leading-snug text-neutral-400 sm:min-w-0 sm:flex-1">{caption}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            // Never disabled: a stalled panel must not brick the only
            // transport control. Tapping while loading insists on playback.
            onClick={() => (sync.shouldPlay ? sync.setIntent('pause') : sync.insistPlay())}
            title={sync.ready
              ? (sync.shouldPlay ? 'Pause the whole set' : 'Play all panels together, in sync')
              : 'Still loading — tap to start as soon as the panels can play'}
            aria-label={sync.shouldPlay ? 'Pause the set' : 'Play the set'}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded border px-3 text-xs font-medium transition-colors ${focusRing} ${
              sync.shouldPlay
                ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                : 'border-[#0247FE] bg-[#0247FE] text-white hover:bg-[#0235c9]'}`}
          >
            {!sync.ready
              ? <><Spinner className="h-3.5 w-3.5" /> Loading… {sync.readyCount}/{panels.length} — tap to play</>
              : sync.shouldPlay ? '❚❚ Pause' : '▶ Play'}
          </button>
          <StatusBadge status={panels[0]?.status} stage="motion" />
        </span>
      </div>
      <div
        ref={sync.containerRef}
        className={`grid items-end gap-2 sm:gap-4 ${pods.length > 1 ? 'max-w-2xl' : 'max-w-[280px] sm:max-w-[220px]'}`}
        style={{ gridTemplateColumns: `repeat(${pods.length}, minmax(0, 1fr))` }}
      >
        {pods.map((pod) => (
          <div key={pod.n} className="min-w-0">
            {/* gap-px = the corner; basis-1/5 = the spine's true share of a
                pillar (320 of 1600 delivery pixels). */}
            <div className="flex items-end gap-px">
              {pod.spine && <div className="basis-1/5 shrink-0"><SyncedPanel panel={pod.spine} {...panelProps} /></div>}
              {pod.face && <div className="min-w-0 flex-1"><SyncedPanel panel={pod.face} {...panelProps} /></div>}
            </div>
            <p className="mt-1 truncate text-center text-[10px] text-neutral-400">
              Pillar {pod.n}
            </p>
          </div>
        ))}
      </div>
      <Actions {...actions} stage="motion" />
      {panels[0] && <Details artwork={panels[0]} />}
    </div>
  );
}

// Two clear choices per card: use it, or pass. (The old "Pick" button
// duplicated Approve and confused first-time reviewers — removed.) A plain
// still also gets "⭐ Keep & explore" — anchor a favourite and spin off
// variations of it (the original is never lost).
// Hierarchy (CEO pass, 2026-07-22): Approve is the decision — solid once
// taken, outlined invitation until then. Keep is the amber-star invitation.
// Pass and Replace this design are quiet ghosts that fill on hover.
export function Actions({ status, busy, stage, saved, onApprove, onReject, onRetry, onRegen, onKeep, onToggleSave }) {
  // min-h-11 (44px) UNCONDITIONALLY — not gated on width. The old h-10 (40px)
  // missed the iOS/Android minimum on every card action, and width gates like
  // sm:min-h-0 re-shrank buttons on touch iPads (mobile audit 2026-08-01).
  const btn = `inline-flex min-h-11 items-center gap-1 rounded border px-2.5 text-xs font-medium transition-colors disabled:opacity-40 ${focusRing}`;
  const ghost = 'border-neutral-700 bg-transparent text-neutral-400 hover:bg-neutral-800';
  const approveLabel = status === 'approved' ? '✓ Approved' : stage === 'still' ? '✓ Use this design' : '✓ Approve video';
  // Already delivered — the decision is history, not a live choice.
  if (status === 'sent') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-1.5">
        <span className="inline-flex min-h-11 items-center gap-1 rounded border border-sky-700/60 bg-sky-950 px-2.5 text-xs font-medium text-sky-300">
          ✓ Sent to Jeff
        </span>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-1.5">
      <button
        type="button" disabled={busy} onClick={onApprove}
        title={stage === 'still' ? 'Approve this design — approved designs get turned into videos' : 'Approve this video — approved videos can be sent to Jeff'}
        className={`${btn} ${status === 'approved'
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-emerald-700/60 bg-transparent text-emerald-300 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white'}`}
      >
        {approveLabel}
      </button>
      {/* Save is the light commitment: set it aside WITHOUT approving it, and
          a "Replace unsaved designs" can't replace it. Keep & explore is the
          heavier one — it also opens a variations rail. */}
      {onToggleSave && (
        <button
          type="button" disabled={busy} onClick={onToggleSave}
          title={saved
            ? 'Unsave this design — a redo will be free to replace it again'
            : 'Save this design for later — you don’t have to approve it, and a redo won’t replace it'}
          className={`${btn} ${saved
            ? 'border-violet-500 bg-violet-600 text-white'
            : 'border-violet-500/50 bg-transparent text-violet-300 hover:border-violet-400 hover:bg-violet-600 hover:text-white'}`}
        >
          {saved ? '🔖 Saved' : '🔖 Save'}
        </button>
      )}
      {onKeep && (
        <button
          type="button" disabled={busy} onClick={onKeep}
          title="Keep this as your favourite and generate more versions of it — the original is never lost."
          className={`${btn} border-amber-500/60 bg-transparent text-amber-300 hover:border-amber-400 hover:bg-amber-500 hover:text-neutral-950`}
        >
          ⭐ Keep &amp; explore
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
          title="Replaces this design only. The others stay."
          className={`${btn} ${ghost} hover:text-sky-300`}
        >
          ↻ Replace this design
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
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-400">
      <img src={api.thumbUrl(stillId)} alt="" className="h-8 w-12 rounded object-cover" loading="lazy" decoding="async" />
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
        className={`-mx-1 flex min-h-11 items-center gap-1 rounded px-1 py-2 text-xs text-neutral-400 transition-colors hover:text-neutral-200 ${focusRing}`}
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span> How the AI was instructed
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded bg-neutral-950/60 p-2 text-[11px] leading-snug text-neutral-300">
          <div>
            <p className="mb-0.5 text-neutral-400">Design instructions</p>
            <p className="whitespace-pre-wrap break-words">{artwork.prompt || '—'}</p>
          </div>
          {artwork.motion_prompt && (
            <div>
              <p className="mb-0.5 text-neutral-400">Video motion instructions</p>
              <p className="whitespace-pre-wrap break-words">{artwork.motion_prompt}</p>
            </div>
          )}
          {artwork.duration_s ? <p className="text-neutral-400">{artwork.duration_s} seconds</p> : null}
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
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
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

// ---------------------------------------------------------------------------
// Keep & explore — the reviewer anchors a design he likes, then explores
// variations of it in a rail beneath it. The original (keeper) is never lost.

// Inline "describe a change" box. Enter submits, Esc cancels. Autofocuses.
function TweakBox({ busy, onSubmit, onCancel }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { const t = text.trim(); if (t) onSubmit(t); };
  return (
    // Stacked below sm: side-by-side inside a narrow card left the input ~35px
    // wide — unusable for typing a sentence (mobile audit 2026-08-01).
    <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
      <input
        ref={ref} type="text" value={text} disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        placeholder="more electric blue · calmer background · bigger subject"
        aria-label="Describe the change you want"
        className={`h-11 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 text-base text-neutral-100 placeholder:text-neutral-400 disabled:opacity-50 sm:flex-1 sm:text-[11px] ${focusRing}`}
      />
      <button
        type="button" onClick={submit} disabled={busy}
        title="Make this change (Enter)"
        className={`h-11 w-full shrink-0 rounded border border-[#0247FE] bg-[#0247FE] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#0235c9] disabled:opacity-50 sm:w-auto sm:text-[11px] ${focusRing}`}
      >
        Make version
      </button>
    </div>
  );
}

// The kept design, rendered as a highlighted anchor (amber ring + "Kept —
// exploring" badge). Vary/Tweak spin off variations; the original stays put.
export function AnchorCard({ artwork, animating, busy, onApprove, onReject, onVary, onTweak, onUnkeep, cost = ' (~$0.03)' }) {
  const [tweaking, setTweaking] = useState(false);
  const btn = `inline-flex min-h-11 items-center gap-1 rounded border px-2.5 text-xs font-medium transition-colors disabled:opacity-40 ${focusRing}`;
  const ghost = 'border-neutral-700 bg-transparent text-neutral-400 hover:bg-neutral-800';
  const approved = artwork.status === 'approved';
  const rejected = artwork.status === 'rejected';
  const sent = artwork.status === 'sent';
  return (
    <div className="card-in rounded-lg border border-amber-500/50 bg-neutral-900 p-2 ring-1 ring-amber-500/40 sm:p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">⭐ Kept — exploring</span>
      </div>
      <div className="relative">
        <Preview artwork={artwork} />
        {animating && <GeneratingOverlay />}
      </div>
      <div className="mt-2 flex items-center justify-end px-0.5">
        <StatusBadge status={animating ? 'generating' : artwork.status} stage={artwork.stage} />
      </div>
      <div className="px-0.5">
        <ErrorRibbon artwork={artwork} />
        {artwork.stage === 'motion' && <SourceStill stillId={artwork.source_still_id} />}
        {animating ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300"><Spinner className="h-3 w-3" /> Making the video…</p>
        ) : sent ? (
          /* Already delivered — the decision is history, not a live choice. */
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-1.5">
            <span className="inline-flex min-h-11 items-center gap-1 rounded border border-sky-700/60 bg-sky-950 px-2.5 text-xs font-medium text-sky-300">
              ✓ Sent to Jeff
            </span>
          </div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-1.5">
              {/* Once the keeper has been animated this card IS the video, so
                  approving it queues it for Jeff — it must not still say
                  "design" (QA, 2026-07-26). */}
              <button
                type="button" disabled={busy} onClick={onApprove}
                title={artwork.stage === 'still'
                  ? 'Approve this design — approved designs get turned into videos'
                  : 'Approve this video — approved videos can be sent to Jeff'}
                className={`${btn} ${approved ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-700/60 bg-transparent text-emerald-300 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white'}`}
              >
                {approved ? '✓ Approved' : artwork.stage === 'still' ? '✓ Use this design' : '✓ Approve video'}
              </button>
              <button
                type="button" disabled={busy} onClick={() => setTweaking((v) => !v)}
                title="Describe a change in plain words — makes a new version ($0.03), original kept"
                className={`${btn} ${ghost} hover:text-sky-300`}
              >
                ✎ Tweak…{cost}
              </button>
              <button
                type="button" disabled={busy} onClick={onVary}
                title="Generate another version of this design ($0.03) — the original is kept"
                className={`${btn} ${ghost} hover:text-sky-300`}
              >
                ↻ Vary{cost}
              </button>
              <button
                type="button" disabled={busy} onClick={onReject}
                title="Pass on this one — nothing else happens with it"
                className={`${btn} ${rejected ? 'border-rose-700 bg-rose-700 text-white' : `${ghost} hover:text-rose-300`}`}
              >
                {rejected ? '✕ Passed' : '✕ Pass'}
              </button>
              <button
                type="button" disabled={busy} onClick={onUnkeep}
                title="Stop keeping this as your favourite (its versions stay in this batch)"
                className={`${btn} border-transparent bg-neutral-800 text-neutral-300 hover:bg-neutral-700`}
              >
                Un-keep
              </button>
            </div>
            {tweaking && (
              <TweakBox busy={busy} onCancel={() => setTweaking(false)} onSubmit={(t) => { setTweaking(false); onTweak(t); }} />
            )}
          </>
        )}
        <Details artwork={artwork} />
      </div>
    </div>
  );
}

// A single variation in the rail beneath the anchor: compact preview + its
// one-line change note, and the actions to use / promote / tweak / vary / dismiss.
export function VariationCard({ artwork, busy, onApprove, onReject, onPromote, onVary, onTweak, cost = ' (~$0.03)' }) {
  const [tweaking, setTweaking] = useState(false);
  const btn = `inline-flex min-h-11 items-center gap-1 rounded border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${focusRing}`;
  const ghost = 'border-neutral-700 bg-transparent text-neutral-400 hover:bg-neutral-800';
  const approved = artwork.status === 'approved';
  return (
    <div className="card-in rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
      <Preview artwork={artwork} />
      {artwork.change_note && (
        <p className="mt-1 px-0.5 text-[10px] italic leading-snug text-neutral-400">{artwork.change_note}</p>
      )}
      <div className="mt-1 flex items-center justify-end px-0.5">
        <StatusBadge status={artwork.status} stage={artwork.stage} />
      </div>
      <div className="px-0.5">
        <ErrorRibbon artwork={artwork} />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:gap-1">
          <button
            type="button" disabled={busy} onClick={onApprove}
            title="Approve this version — it becomes a video"
            className={`${btn} ${approved ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-700/60 bg-transparent text-emerald-300 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white'}`}
          >
            {approved ? '✓ Using' : '✓ Use'}
          </button>
          <button
            type="button" disabled={busy} onClick={onPromote}
            title="Make this the keeper — your anchor design. The current keeper becomes one of the versions."
            className={`${btn} border-amber-500/60 bg-transparent text-amber-300 hover:border-amber-400 hover:bg-amber-500 hover:text-neutral-950`}
          >
            ⭐ Make keeper
          </button>
          <button
            type="button" disabled={busy} onClick={() => setTweaking((v) => !v)}
            title="Describe a change to this version ($0.03)"
            className={`${btn} ${ghost} hover:text-sky-300`}
          >
            ✎ Tweak{cost}
          </button>
          <button
            type="button" disabled={busy} onClick={onVary}
            title="Another version like this one ($0.03)"
            className={`${btn} ${ghost} hover:text-sky-300`}
          >
            ↻ Vary{cost}
          </button>
          <button
            type="button" disabled={busy} onClick={onReject}
            title="Dismiss this version — removes it from the rail"
            className={`${btn} ${ghost} hover:text-rose-300`}
          >
            ✕ Dismiss
          </button>
        </div>
        {tweaking && (
          <TweakBox busy={busy} onCancel={() => setTweaking(false)} onSubmit={(t) => { setTweaking(false); onTweak(t); }} />
        )}
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
          <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              aria-hidden="true"
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                state === 'done' ? 'bg-emerald-600 text-white'
                  : state === 'current' ? 'bg-[#0247FE] text-white'
                    : 'border border-neutral-700 text-neutral-400'
              }`}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={
              state === 'done' ? 'font-medium text-emerald-400'
                : state === 'current' ? 'font-semibold text-white'
                  : 'text-neutral-400'
            }
            >
              {label}
            </span>
            {/* Hidden below sm — when the row wraps, an arrow strands at a line
                start pointing at nothing (mobile audit 2026-08-01). */}
            {i < steps.length - 1 && <span aria-hidden="true" className="hidden text-neutral-400 sm:inline">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

// Pulse placeholder shown while a batch's details load — the page keeps its
// real shape (true aspect ratios) instead of flashing an empty state.
// A design that is being generated RIGHT NOW, shown in the slot it will occupy.
//
// Clicking "Add another design" used to give feedback only in the page header —
// often thousands of pixels above the button, and nothing at all where the new
// design would land (Shawn, 2026-07-29). This card makes the wait visible in
// place: it scrolls itself into view on mount, so you always see that something
// is coming and where.
export function PendingDesignCard({ aspect = '16 / 9', label = 'Making a new design…', sub }) {
  const ref = useRef(null);
  useEffect(() => {
    // 'nearest': scroll only if it is actually off-screen, and only as far as
    // needed. 'center' yanked the page away from the button just clicked.
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);
  return (
    <div
      ref={ref} role="status" aria-live="polite"
      className="card-in rounded-lg border border-[#0247FE]/70 bg-neutral-900 p-2 ring-1 ring-[#0247FE]/30"
    >
      {/* Row layout below sm — the ultra-wide slot is ~90px tall on a phone and
          the stacked spinner + two lines overflowed it (mobile audit 2026-08-01). */}
      <div className="grid place-items-center overflow-hidden rounded bg-neutral-950" style={{ aspectRatio: aspect }}>
        <div className="flex items-center gap-2 px-3 text-center sm:flex-col">
          <Spinner className="h-5 w-5 shrink-0 sm:h-7 sm:w-7" />
          <span className="text-xs font-semibold text-white">{label}</span>
          <span className="hidden text-[11px] text-neutral-400 sm:block">{sub || 'about 20 seconds'}</span>
        </div>
      </div>
    </div>
  );
}

export function SkeletonCard({ aspect = '16 / 9' }) {
  return (
    <div className="motion-safe:animate-pulse rounded-lg border border-neutral-800 bg-neutral-900 p-2" aria-hidden="true">
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
    // inset-x-4 below sm (full-width toasts are easier thumb targets) and
    // safe-area padding so the bottom toast clears the iPhone home indicator.
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-stretch gap-2 pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:right-4 sm:w-72 sm:max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
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
