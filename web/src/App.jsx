// WOW Artwork Engine — weekly review dashboard (Build Plan M2 · two-phase M2.5).
//
// Phase 1: review the Seedream STILLS (styles) + their proposed motion prompt,
// approve the ones Scott likes. Phase 2: "Animate approved" runs Seedance only
// on approved stills. Standalone shell for dev; ReviewDashboard lifts into the
// wow-contract-query "Artwork Engine" tab.
//
// 2026-07-22 UX/perf pass (CEO feedback: slow load, clunky, unclear flow):
//   · videos stream only while on screen (ui.jsx LazyVideo)
//   · card actions are optimistic with per-card pending — no global lock
//   · skeleton first paint, visibility-aware polling, spend refetched on
//     run transitions + animate/send instead of every poll/action
//   · 3-step guide, single primary CTA, per-section review chips, toasts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import {
  Preview, Actions, StatusBadge, Details, Card, AnchorCard, VariationCard,
  ModePill, SpendPill, Stepper, Spinner, SkeletonCard, Toasts, useToasts,
  focusRing, progressLabel,
} from './ui.jsx';
import SendDialog from './SendDialog.jsx';
import SentHistory from './SentHistory.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <ReviewDashboard />
    </div>
  );
}

// Merge a fetched run detail over local state without clobbering cards whose
// optimistic action is still in flight: their local status / saved flag wins
// until the API settles — the next poll agrees with the server anyway.
function mergeDetail(fetched, cur, pendingIds) {
  if (!cur || pendingIds.size === 0) return fetched;
  const curById = new Map(cur.artworks.map((a) => [a.id, a]));
  const artworks = fetched.artworks.map((a) => {
    const local = pendingIds.has(a.id) ? curById.get(a.id) : null;
    return local ? { ...a, status: local.status } : a;
  });
  const locallySaved = new Set((cur.selections || []).map((s) => s.artwork_id));
  const selections = (fetched.selections || [])
    .filter((s) => !pendingIds.has(s.artwork_id) || locallySaved.has(s.artwork_id));
  for (const id of pendingIds) {
    if (locallySaved.has(id) && !selections.some((s) => s.artwork_id === id)) {
      selections.push({ artwork_id: id });
    }
  }
  return { ...fetched, artworks, selections };
}

// Optimistic status helpers (pure — safe to share across renders).
const setStatuses = (ids, status) => (d) => ({
  ...d,
  artworks: d.artworks.map((a) => (ids.includes(a.id) ? { ...a, status } : a)),
});
const restoreStatuses = (prev) => (d) => ({
  ...d,
  artworks: d.artworks.map((a) => (prev.has(a.id) ? { ...a, status: prev.get(a.id) } : a)),
});

// Group a surface's stills into "Keep & explore" families for rendering.
// A family = stills sharing a family_id (or a kept still with none). The kept
// member (its id is in keptSet) is the ANCHOR; its other non-rejected members
// are its variations rail. Stills with no family and no keeper — and any family
// that has lost its keeper — fall through as plain cards. Every still lands in
// exactly ONE place: an anchor, a variation, or a plain card (never double).
function partitionFamilies(stills, keptSet) {
  const byFamily = new Map();
  const loners = [];
  for (const s of stills) {
    if (s.family_id != null) {
      if (!byFamily.has(s.family_id)) byFamily.set(s.family_id, []);
      byFamily.get(s.family_id).push(s);
    } else if (keptSet.has(s.id)) {
      byFamily.set(`solo:${s.id}`, [s]); // kept, no family yet → anchor, empty rail
    } else {
      loners.push(s);
    }
  }
  const anchors = [];
  for (const members of byFamily.values()) {
    const live = members.filter((m) => m.status !== 'rejected'); // dismissed variations vanish
    if (!live.length) continue;
    const keeper = live.find((m) => keptSet.has(m.id));
    if (keeper) {
      const variations = live.filter((m) => m.id !== keeper.id).sort((a, b) => a.id - b.id);
      anchors.push({ keeper, variations });
    } else {
      for (const m of live) loners.push(m); // keeper gone → members become plain cards
    }
  }
  anchors.sort((a, b) => a.keeper.id - b.keeper.id);
  loners.sort((a, b) => a.id - b.id);
  return { anchors, loners };
}

export function ReviewDashboard() {
  const [runs, setRuns] = useState([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [runId, setRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  // Global lock ONLY for the heavy actions (generate/animate/regenerate/send).
  const [busy, setBusy] = useState(false);
  // Per-card in-flight optimistic actions — only the clicked card disables.
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [showSend, setShowSend] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [spend, setSpend] = useState(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const runIdRef = useRef(null);
  const pendingIdsRef = useRef(new Set());
  const detailRef = useRef(null); // latest detail, for snapshot-based optimistic reverts

  const markPending = useCallback((ids, on) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      pendingIdsRef.current = next;
      return next;
    });
  }, []);

  const refreshSpend = useCallback(() => { api.spend().then(setSpend).catch(() => {}); }, []);

  const refreshRuns = useCallback(async () => {
    const { runs: list } = await api.listRuns();
    setRuns(list);
    return list;
  }, []);

  // Fetch a run's detail. Drops the payload if the user switched runs while it
  // was in flight, and keeps optimistic statuses for still-pending cards.
  const loadDetail = useCallback(async (id) => {
    if (id == null) { setDetail(null); return; }
    const d = await api.getRun(id);
    if (runIdRef.current !== id) return; // stale — user moved on
    setDetail((cur) => mergeDetail(d, cur, pendingIdsRef.current));
  }, []);

  // First paint: runs list and spend fetch in PARALLEL (spend used to wait for
  // runs, and detail then waited for both).
  useEffect(() => {
    refreshSpend();
    refreshRuns()
      .then((list) => setRunId((cur) => cur ?? list[0]?.id ?? null))
      .catch((e) => setError(e.message))
      .finally(() => setRunsLoaded(true));
  }, [refreshRuns, refreshSpend]);

  // Detail loads the moment the run id is known (and on every week switch).
  useEffect(() => {
    runIdRef.current = runId;
    setError(null);
    if (runId == null) { setDetail(null); return undefined; }
    let cancelled = false;
    loadDetail(runId).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [runId, loadDetail]);

  const detailReady = !!detail && detail.run?.id === runId;
  const running = detailReady && detail.run.status === 'running';

  // Mirror detail into a ref so optimistic handlers can snapshot the pre-click
  // state for an exact rollback without re-subscribing to every change.
  useEffect(() => { detailRef.current = detail; }, [detail]);

  // Poll every 2s ONLY while a job runs — and not in a hidden tab. Resuming
  // visibility refetches immediately so the page catches up at a glance.
  useEffect(() => {
    if (!running) return undefined;
    let timer = null;
    const tick = () => loadDetail(runId).catch(() => {});
    const start = () => { if (timer == null) timer = setInterval(tick, 2000); };
    const stop = () => { if (timer != null) { clearInterval(timer); timer = null; } };
    const onVisibility = () => { if (document.hidden) stop(); else { tick(); start(); } };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [running, runId, loadDetail]);

  // Spend only moves when money is spent: refetch on running → done/failed
  // (was refetched on every poll and every card action).
  const lastRunState = useRef({ id: null, status: null });
  useEffect(() => {
    const id = detail?.run?.id ?? null;
    const status = detail?.run?.status ?? null;
    const last = lastRunState.current;
    if (id != null && id === last.id && last.status === 'running' && status && status !== 'running') {
      refreshSpend();
    }
    lastRunState.current = { id, status };
  }, [detail?.run?.id, detail?.run?.status, refreshSpend]);

  // ---- Heavy actions: global lock + full refetch (they replace whole cards
  // or kick off paid jobs — optimism would lie about what exists). ----

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const { runId: newId } = await api.generate();
      await refreshRuns();
      setRunId(newId); // the detail effect fetches the new run immediately
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const animate = async () => {
    setBusy(true); setError(null);
    try { await api.animate(runId); await loadDetail(runId); refreshSpend(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Per-sign regenerate: fresh options for ONE surface, others untouched.
  const regenerate = async (surfaceKey) => {
    setBusy(true); setError(null);
    try { await api.regenerate(runId, surfaceKey); await loadDetail(runId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Per-design regenerate: replace ONE card only — its siblings stay.
  const regenerateOne = async (artworkId) => {
    setBusy(true); setError(null);
    try { await api.regenerateOne(artworkId); await loadDetail(runId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Explicit retry for an approved design whose video errored (UX P0) —
  // an animate, so it keeps the global lock + spend refresh.
  const retryAnimate = async (artworkId) => {
    setBusy(true); setError(null);
    try { await api.animateOne(artworkId); await loadDetail(runId); refreshSpend(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // ---- Card actions: OPTIMISTIC. Local state flips instantly, the API call
  // settles in the background, a failure rolls back and explains. No
  // loadDetail() here — the 2s poll or the next navigation reconciles. ----
  const runOptimistic = useCallback(async ({ ids, apply, revert, call, success, tone }) => {
    markPending(ids, true);
    setDetail((d) => (d ? apply(d) : d));
    try {
      await call();
      if (success) pushToast(success, tone);
    } catch (e) {
      setDetail((d) => (d ? revert(d) : d)); // roll back just the touched cards
      pushToast(`Couldn't save that — ${e.message}`, 'error');
    } finally {
      markPending(ids, false);
    }
  }, [markPending, pushToast]);

  // Approve one card, or a whole EON 3-pillar set at once.
  const approveArtworks = useCallback((arts) => {
    const ids = arts.map((a) => a.id);
    const prev = new Map(arts.map((a) => [a.id, a.status]));
    const video = arts.length > 1 || arts[0].stage === 'motion';
    return runOptimistic({
      ids,
      apply: setStatuses(ids, 'approved'),
      revert: restoreStatuses(prev),
      call: () => Promise.all(ids.map((id) => api.approve(id))),
      success: video ? 'Video approved' : 'Design approved',
      tone: 'success',
    });
  }, [runOptimistic]);

  const rejectArtworks = useCallback((arts) => {
    const ids = arts.map((a) => a.id);
    const prev = new Map(arts.map((a) => [a.id, a.status]));
    return runOptimistic({
      ids,
      apply: setStatuses(ids, 'rejected'),
      revert: restoreStatuses(prev),
      call: () => Promise.all(ids.map((id) => api.reject(id))),
      success: 'Passed',
      tone: 'neutral',
    });
  }, [runOptimistic]);

  // ---- Keep & explore. keep/unkeep/promote only move the keeper marker, so
  // they're OPTIMISTIC like the other card actions (the 2s poll / next nav
  // reconciles). vary/tweak GENERATE a family member — heavy path below. ----

  // Anchor a favourite so regeneration skips it and its variations rail opens.
  const keepArtwork = useCallback((art) => runOptimistic({
    ids: [art.id],
    apply: (d) => ((d.selections || []).some((s) => s.artwork_id === art.id)
      ? d
      : { ...d, selections: [...(d.selections || []), { artwork_id: art.id }] }),
    revert: (d) => ({ ...d, selections: (d.selections || []).filter((s) => s.artwork_id !== art.id) }),
    call: () => api.keep(art.id),
    success: 'Kept — exploring versions',
    tone: 'violet',
  }), [runOptimistic]);

  const unkeepArtwork = useCallback((art) => runOptimistic({
    ids: [art.id],
    apply: (d) => ({ ...d, selections: (d.selections || []).filter((s) => s.artwork_id !== art.id) }),
    revert: (d) => ((d.selections || []).some((s) => s.artwork_id === art.id)
      ? d
      : { ...d, selections: [...(d.selections || []), { artwork_id: art.id }] }),
    call: () => api.unkeep(art.id),
    success: 'No longer keeping that one',
    tone: 'neutral',
  }), [runOptimistic]);

  // Promote a variation to keeper: the old keeper in its family steps down.
  // familyIds carries every member so the previous keeper's marker is cleared.
  const promoteArtwork = useCallback((art, familyIds) => {
    const prevSelections = detailRef.current?.selections || [];
    return runOptimistic({
      // Whole family pending: a concurrent poll must not resurrect the old
      // keeper's selection mid-swap (mergeDetail holds pending selections).
      ids: [...familyIds],
      apply: (d) => ({
        ...d,
        selections: [
          ...(d.selections || []).filter((s) => !familyIds.has(s.artwork_id)),
          { artwork_id: art.id },
        ],
      }),
      revert: (d) => ({ ...d, selections: prevSelections }),
      call: () => api.promote(art.id),
      success: 'New keeper set',
      tone: 'violet',
    });
  }, [runOptimistic]);

  // vary / tweak spawn a new variation ($0.03): 202 + the run flips to
  // 'running', so they take the global lock + the existing poll/progress path.
  const vary = async (artworkId) => {
    setBusy(true); setError(null);
    try { await api.vary(artworkId); await loadDetail(runId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const tweak = async (artworkId, instruction) => {
    setBusy(true); setError(null);
    try { await api.tweak(artworkId, instruction); await loadDetail(runId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Everything below derives from the CURRENT run only — while switching
  // weeks the stale detail shows skeletons, never last week's art.
  const view = detailReady ? detail : null;

  // Approved stills not yet animated → the Animate button's count. Stills whose
  // last attempt ERRORED are excluded — they get an explicit per-card Retry
  // instead of a silent re-spend (UX P0).
  const pendingAnimate = useMemo(() => {
    if (!view) return 0;
    const animated = new Set(view.artworks.map((a) => a.source_still_id).filter(Boolean));
    // "qa:" notes are advisory warnings, not failures — they don't block.
    return view.artworks.filter(
      (a) => a.stage === 'still' && a.status === 'approved' && !animated.has(a.id)
        && !(a.error && !a.error.startsWith('qa:')),
    ).length;
  }, [view]);

  const mode = view?.generationMode;

  // Approved animated pieces → ready to send to Jeff.
  const readyToSend = useMemo(
    () => (view ? view.artworks.filter((a) => a.stage === 'motion' && a.status === 'approved').length : 0),
    [view],
  );

  // Is a job actively running, and is it the video-making phase?
  const makingVideos = useMemo(() => {
    if (!running || !view) return false;
    const animated = new Set(view.artworks.map((a) => a.source_still_id).filter(Boolean));
    return view.artworks.some((a) => a.stage === 'still' && a.status === 'approved' && !animated.has(a.id));
  }, [running, view]);

  // Skeletons while the first runs/detail fetches are in flight (or when
  // switching weeks) — never a blank page, never last week's cards.
  const showSkeleton = !error && (!runsLoaded || (runId != null && !detailReady));

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Header
        runs={runs} runId={runId} onSelectRun={setRunId}
        onGenerate={generate} onAnimate={animate} pendingAnimate={pendingAnimate}
        readyToSend={readyToSend} onSend={() => setShowSend(true)}
        onHistory={() => setShowHistory(true)}
        busy={busy} run={view?.run} mode={mode} detail={view}
        running={running} makingVideos={makingVideos} spend={spend}
      />
      {error && <p className="mb-4 rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {/* A failed batch says exactly WHY — never a silent page of missing art. */}
      {view?.run?.status === 'failed' && (
        <p className="mb-4 rounded border border-rose-900 bg-rose-950 px-3 py-2 text-sm text-rose-200">
          <span className="font-semibold">This batch failed.</span>{' '}
          {view.run.error || 'Some designs could not be generated — the cards below show details.'}{' '}
          You can retry with a new batch, or regenerate just the affected designs below.
        </p>
      )}
      {showSkeleton ? (
        <SkeletonPage />
      ) : view ? (
        <RunView
          detail={view} busy={busy} running={running} pendingIds={pendingIds}
          onApprove={approveArtworks} onReject={rejectArtworks}
          onKeep={keepArtwork} onUnkeep={unkeepArtwork}
          onVary={vary} onTweak={tweak} onPromote={promoteArtwork}
          onRetry={retryAnimate} onRegenerate={regenerate} onRegenerateOne={regenerateOne}
          mode={mode}
        />
      ) : (
        <Empty onGenerate={generate} busy={busy} mode={mode} />
      )}
      {showSend && (
        <SendDialog
          runId={runId} onClose={() => setShowSend(false)}
          onSent={() => { loadDetail(runId).catch(() => {}); refreshSpend(); }}
        />
      )}
      {showHistory && <SentHistory onClose={() => setShowHistory(false)} />}
      <Toasts items={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function Header({ runs, runId, onSelectRun, onGenerate, onAnimate, pendingAnimate, readyToSend, onSend, onHistory, busy, run, mode, detail, running, makingVideos, spend }) {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.health().then(setHealth); }, []);
  const effectiveMode = mode || health?.generationMode;
  // ONE primary CTA at a time — the next step in the flow is solid, everything
  // else drops to a quiet outline (CEO feedback: three loud buttons = "which?").
  const primary = pendingAnimate > 0 ? 'animate' : readyToSend > 0 ? 'send' : 'generate';
  const btnBase = `rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${focusRing}`;
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          WOW Artwork Engine
          <ModePill mode={effectiveMode} />
          <SpendPill spend={spend} />
        </h1>
        <p className="text-xs text-neutral-500">
          Weekly AI artwork for the WOW signs — you approve everything before anything is made or sent
          <span className={health?.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'}> · backend {health?.status ?? '…'}</span>
          {run && <> · week of {run.week_of} · <StatusBadge status={run.status} /></>}
        </p>
        <Stepper detail={detail} />
      </div>
      <div className="flex items-center gap-2">
        {running ? (
          <span className="flex items-center gap-2 rounded-md bg-amber-950 px-3 py-1.5 text-sm font-medium text-amber-200">
            <Spinner className="border-amber-700 border-t-amber-300" />
            {progressLabel(run) || (makingVideos ? 'Making videos… (a few minutes each)' : 'Creating designs… (about 1 min)')}
          </span>
        ) : (
          <>
            {runs.length > 0 && (
              <select
                value={runId ?? ''}
                onChange={(e) => onSelectRun(Number(e.target.value))}
                title="Look back at earlier weeks"
                className={`rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm transition-colors ${focusRing}`}
              >
                {runs.map((r) => <option key={r.id} value={r.id}>Week of {r.week_of} · batch #{r.id}</option>)}
              </select>
            )}
            <button
              type="button" onClick={onHistory}
              title="Everything ever sent to Jeff, across all weeks"
              className={`${btnBase} border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500 hover:text-white`}
            >
              📤 Sent history
            </button>
            {pendingAnimate > 0 && (
              <button
                type="button" onClick={onAnimate} disabled={busy}
                title="Turns every design you approved into a video"
                className={`${btnBase} ${primary === 'animate'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'border border-emerald-700/70 bg-transparent text-emerald-300 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white'}`}
              >
                {busy ? 'Starting…' : `🎬 Make ${pendingAnimate} video${pendingAnimate === 1 ? '' : 's'}`}
              </button>
            )}
            {readyToSend > 0 && (
              <button
                type="button" onClick={onSend} disabled={busy}
                title="Review the email, then deliver the approved videos to Jeff"
                className={`${btnBase} ${primary === 'send'
                  ? 'bg-amber-500 text-neutral-950 hover:bg-amber-400'
                  : 'border border-amber-600/70 bg-transparent text-amber-300 hover:border-amber-500 hover:bg-amber-500 hover:text-neutral-950'}`}
              >
                ✉ Send {readyToSend} to Jeff
              </button>
            )}
            <button
              type="button" onClick={onGenerate} disabled={busy}
              title="Makes 9 brand-new design options — 3 per sign type. To redo just one sign, use the button next to that sign below."
              className={`${btnBase} ${primary === 'generate'
                ? 'bg-[#0247FE] text-white hover:bg-[#0235c9]'
                : 'border border-neutral-700 bg-transparent text-neutral-400 hover:border-[#0247FE] hover:text-white'}`}
            >
              {busy ? 'Starting…' : effectiveMode === 'live' ? '✨ New batch — all signs (~$0.30)' : '✨ Create sample designs (free)'}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function Empty({ onGenerate, busy, mode }) {
  const live = mode === 'live';
  return (
    <div className="grid place-items-center rounded border border-dashed border-neutral-800 py-24 text-center">
      <div className="max-w-md">
        <p className="text-neutral-400">No artwork yet this week.</p>
        <p className="mt-1 text-xs text-neutral-600">
          Click below to create 9 design options (3 per sign type). Nothing becomes a video
          and nothing goes to Jeff until you approve it.
        </p>
        <button
          type="button" onClick={onGenerate} disabled={busy}
          className={`mt-3 rounded bg-[#0247FE] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0235c9] disabled:opacity-50 ${focusRing}`}
        >
          {busy ? 'Creating designs…' : live ? 'Create new designs (~$0.30)' : 'Create sample designs (free)'}
        </button>
      </div>
    </div>
  );
}

// Pulse placeholders in the real page shape — 3 per section at each sign's
// true aspect ratio — so the first paint reads "loading", not "broken".
function SkeletonPage() {
  return (
    <div className="space-y-10" aria-hidden="true">
      <section>
        <SkeletonHeading />
        <div className="space-y-4">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} aspect="3840 / 1062" />)}
        </div>
      </section>
      <section>
        <SkeletonHeading />
        <div className="max-w-2xl space-y-6">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} aspect="2 / 1" />)}
        </div>
      </section>
      <section>
        <SkeletonHeading />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} aspect="2 / 3" />)}
        </div>
      </section>
    </div>
  );
}

function SkeletonHeading() {
  return (
    <div className="mb-3 space-y-1.5">
      <div className="h-3.5 w-56 max-w-full animate-pulse rounded bg-neutral-800" />
      <div className="h-3 w-80 max-w-full animate-pulse rounded bg-neutral-800" />
    </div>
  );
}

function RunView({ detail, busy, running, pendingIds, onApprove, onReject, onKeep, onUnkeep, onVary, onTweak, onPromote, onRetry, onRegenerate, onRegenerateOne, mode }) {
  const { artworks } = detail;
  // Saved (bookmarked) design ids — kept while regenerating, without approving.
  const savedSet = useMemo(() => new Set((detail.selections || []).map((s) => s.artwork_id)), [detail.selections]);
  // An approved design with no video yet, while a job is running → it's being made.
  const isAnimating = (still, motion) => running && !motion && still.status === 'approved';
  const motionsByStill = useMemo(() => {
    const m = new Map();
    for (const a of artworks) {
      if (a.stage === 'motion' && a.source_still_id) {
        if (!m.has(a.source_still_id)) m.set(a.source_still_id, []);
        m.get(a.source_still_id).push(a);
      }
    }
    return m;
  }, [artworks]);

  // Per-card busy: only the clicked card's buttons disable while its call is
  // in flight; the global lock still applies during heavy actions/runs.
  const actionsFor = (a) => ({
    status: a.status, busy: busy || running || pendingIds.has(a.id),
    onApprove: () => onApprove([a]),
    onReject: () => onReject([a]),
    // Explicit retry for an approved design whose video errored (UX P0).
    // "qa:" notes are warnings, not failures — no retry needed.
    ...(a.stage === 'still' && a.status === 'approved' && a.error && !a.error.startsWith('qa:')
      ? { onRetry: () => onRetry(a.id) }
      : {}),
    // Plain stills get "⭐ Keep & explore" — anchor a favourite, then spin off
    // variations (Scott: keep one he likes while re-rolling the rest, 2026-07-21).
    // A kept still isn't a plain card anymore — it renders as an anchor instead.
    ...(a.stage === 'still' && a.status !== 'superseded' && !savedSet.has(a.id)
      ? { onKeep: () => onKeep(a) }
      : {}),
    // Replace just THIS design (approved and saved ones are protected —
    // Pass / unsave first).
    ...(a.stage === 'still' && a.status !== 'approved' && !savedSet.has(a.id)
      ? { onRegen: () => onRegenerateOne(a.id) }
      : {}),
  });
  // For a set of faces, apply one action to all three.
  const groupActions = (faces) => ({
    status: faces[0]?.status,
    busy: busy || faces.some((f) => pendingIds.has(f.id)),
    onApprove: () => onApprove(faces),
    onReject: () => onReject(faces),
  });

  // Superseded = retired by a per-sign regenerate; hidden from review.
  const stillsOf = (style) =>
    artworks.filter((a) => a.stage === 'still' && a.style === style && a.status !== 'superseded');

  // "n of N reviewed" — counts each surface's families/plain cards (NOT every
  // variation, which would inflate the total). A kept anchor counts as
  // reviewed; a plain card counts once it's approved or passed. `extra` folds
  // in already-animated designs that live outside the family partition.
  const chipFromUnits = ({ anchors, loners }, extra = []) => {
    const items = [...loners, ...extra];
    const total = anchors.length + items.length;
    if (!total) return null;
    const reviewed = anchors.length
      + items.filter((s) => s.status === 'approved' || s.status === 'rejected').length;
    return { reviewed, total };
  };

  // Per-sign "Redo unsaved designs" button, shown in each section header.
  const regenFor = (surfaceKey) => (
    <button
      type="button" disabled={busy || running} onClick={() => onRegenerate(surfaceKey)}
      title="Replaces only the designs you haven't saved or approved — saved ones stay."
      className={`rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition-colors hover:border-[#0247FE] hover:text-white disabled:opacity-40 ${focusRing}`}
    >
      ↻ Redo unsaved designs{mode === 'live' ? ' (~$0.03 each)' : ' (free)'}
    </button>
  );

  const spectacular = stillsOf('frame_break');
  const connected = stillsOf('eon_connected');
  const singles = stillsOf('eon_single');

  // Keep & explore grouping. keep/unkeep/promote flow to the whole family; the
  // per-card approve/pass/vary/tweak are bound inside ExplorationFamily.
  const familyHandlers = { onApprove, onReject, onUnkeep, onVary, onTweak, onPromote };
  const spectacularU = partitionFamilies(spectacular, savedSet);
  const singlesU = partitionFamilies(singles, savedSet);
  // Connected: a design that's already been animated keeps its 3-pillar
  // ConnectedSet view (past the exploration stage); only the still-stage
  // designs go through family grouping so a kept wide design can be explored.
  const connectedFaces = (still) => motionsByStill.get(still.id)?.slice(-3);
  const connectedAnimated = connected.filter((s) => connectedFaces(s)?.length);
  const connectedU = partitionFamilies(connected.filter((s) => !connectedFaces(s)?.length), savedSet);
  const connectedRest = [...connectedAnimated, ...connectedU.loners].sort((a, b) => a.id - b.id);

  // Anchors (kept designs + their variation rails) render full-width above each
  // surface's plain-card layout. getMotion swaps in the keeper's video once it's
  // been animated (connected keepers stay stills — their motion is a face set).
  const renderAnchors = (anchors, getMotion) => (anchors.length > 0 ? (
    <div className="mb-6 space-y-6">
      {anchors.map(({ keeper, variations }) => {
        const keeperMotion = getMotion(keeper);
        return (
          <ExplorationFamily
            key={keeper.id} keeper={keeper} keeperMotion={keeperMotion} variations={variations}
            animating={isAnimating(keeper, keeperMotion || null)} busy={busy} running={running}
            pendingIds={pendingIds} handlers={familyHandlers}
          />
        );
      })}
    </div>
  ) : null);
  const latestMotion = (k) => motionsByStill.get(k.id)?.at(-1);
  const noMotion = () => undefined;

  return (
    <div className="space-y-10">
      <Section title="Spectacular — big street billboard" subtitle="3 design options · the one(s) you approve become 4K (3840×1062) videos with the black-frame look" chip={chipFromUnits(spectacularU)} action={regenFor('spectacular')}>
        {renderAnchors(spectacularU.anchors, latestMotion)}
        <div className="space-y-4">
          {spectacularU.loners.map((still) => {
            // .at(-1): after a re-roll, show the LATEST video.
            const motion = motionsByStill.get(still.id)?.at(-1);
            const a = motion || still;
            return <Card key={still.id} artwork={a} actions={actionsFor(a)} animating={isAnimating(still, motion)} saved={savedSet.has(a.id)} />;
          })}
        </div>
      </Section>

      <Section title="EON — 3-pillar set" subtitle="one wide design · its video gets split across the three pillars so the artwork travels from pillar to pillar" chip={chipFromUnits(connectedU, connectedAnimated)} action={regenFor('eon_connected')}>
        {renderAnchors(connectedU.anchors, noMotion)}
        <div className="space-y-6">
          {connectedRest.map((still) => {
            const faces = connectedFaces(still); // latest set of 3 after re-rolls
            return faces?.length
              ? <ConnectedSet key={still.id} faces={faces} actions={groupActions(faces)} />
              : <div key={still.id} className="max-w-2xl"><Card artwork={still} actions={actionsFor(still)} animating={isAnimating(still, null)} saved={savedSet.has(still.id)} /></div>;
          })}
        </div>
      </Section>

      <Section title="EON — single pillar" subtitle="3 design options · approved ones become 4K-class (1280×1920) videos" chip={chipFromUnits(singlesU)} action={regenFor('eon_single')}>
        {renderAnchors(singlesU.anchors, latestMotion)}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {singlesU.loners.map((still) => {
            const motion = motionsByStill.get(still.id)?.at(-1);
            const a = motion || still;
            return <Card key={still.id} artwork={a} actions={actionsFor(a)} animating={isAnimating(still, motion)} saved={savedSet.has(a.id)} />;
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, chip, action, children }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-300">
            {title}
            {chip && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal ${
                chip.reviewed >= chip.total
                  ? 'border-emerald-800 bg-emerald-950 text-emerald-300'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-400'
              }`}
              >
                {chip.reviewed} of {chip.total} reviewed
              </span>
            )}
          </h2>
          <p className="text-xs text-neutral-500">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// An animated connected EON option: the three pod faces side by side.
function ConnectedSet({ faces, actions }) {
  return (
    <div className="card-in rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-neutral-400">The 3-pillar video — watch the artwork cross from one pillar to the next</span>
        <StatusBadge status={faces[0]?.status} stage="motion" />
      </div>
      <div className="flex items-end gap-1">
        {faces.map((f, i) => (
          <div key={f.id} className="w-28">
            <Preview artwork={f} />
            <p className="mt-1 text-center text-[10px] text-neutral-600">pillar {i + 1}</p>
          </div>
        ))}
      </div>
      <Actions {...actions} />
      {faces[0] && <Details artwork={faces[0]} />}
    </div>
  );
}

// A Keep & explore family: the kept ANCHOR up top, its variations rail beneath.
// Approve/Pass/Un-keep settle optimistically; Vary/Tweak generate ($0.03) and
// flip the run to 'running'. Every button is pre-bound to the right artwork id
// here so AnchorCard/VariationCard stay purely presentational.
function ExplorationFamily({ keeper, keeperMotion, variations, animating, busy, running, pendingIds, handlers }) {
  const { onApprove, onReject, onUnkeep, onVary, onTweak, onPromote } = handlers;
  const preview = keeperMotion || keeper; // show the keeper's video once animated
  const familyIds = useMemo(
    () => new Set([keeper.id, ...variations.map((v) => v.id)]),
    [keeper.id, variations],
  );
  const gen = busy || running; // a generation locks the whole family
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.03] p-3">
      <AnchorCard
        artwork={preview}
        animating={animating}
        busy={gen || pendingIds.has(keeper.id)}
        onApprove={() => onApprove([preview])}
        onReject={() => onReject([preview])}
        onVary={() => onVary(keeper.id)}
        onTweak={(t) => onTweak(keeper.id, t)}
        onUnkeep={() => onUnkeep(keeper)}
      />
      <div className="mt-3">
        <p className="mb-2 text-[11px] leading-snug text-neutral-400">
          Each new version is just $0.03 — your kept design stays safe. Promote one to make it the keeper.
        </p>
        {variations.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {variations.map((v) => (
              <VariationCard
                key={v.id}
                artwork={v}
                busy={gen || pendingIds.has(v.id)}
                onApprove={() => onApprove([v])}
                onReject={() => onReject([v])}
                onPromote={() => onPromote(v, familyIds)}
                onVary={() => onVary(v.id)}
                onTweak={(t) => onTweak(v.id, t)}
              />
            ))}
          </div>
        ) : (
          <p className="rounded border border-dashed border-neutral-800 px-3 py-2 text-[11px] text-neutral-500">
            No other versions yet — use ↻ Vary for a fresh take, or ✎ Tweak to describe a change. Your kept design stays safe.
          </p>
        )}
      </div>
    </div>
  );
}
