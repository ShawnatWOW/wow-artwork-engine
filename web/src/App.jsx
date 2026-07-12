// WOW Artwork Engine — weekly review dashboard (Build Plan M2 · two-phase M2.5).
//
// Phase 1: review the Seedream STILLS (styles) + their proposed motion prompt,
// approve the ones Scott likes. Phase 2: "Animate approved" runs Seedance only
// on approved stills. Standalone shell for dev; ReviewDashboard lifts into the
// wow-contract-query "Artwork Engine" tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Preview, Actions, StatusBadge, Details, Card, ModePill, Stepper, Spinner, GeneratingOverlay } from './ui.jsx';
import SendDialog from './SendDialog.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <ReviewDashboard />
    </div>
  );
}

export function ReviewDashboard() {
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showSend, setShowSend] = useState(false);

  const loadRuns = useCallback(async () => {
    const { runs: list } = await api.listRuns();
    setRuns(list);
    setRunId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (id == null) return setDetail(null);
    setDetail(await api.getRun(id));
  }, []);

  useEffect(() => { loadRuns().catch((e) => setError(e.message)); }, [loadRuns]);
  useEffect(() => { loadDetail(runId).catch((e) => setError(e.message)); }, [runId, loadDetail]);

  useEffect(() => {
    if (detail?.run?.status !== 'running') return undefined;
    const t = setInterval(() => loadDetail(runId).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [detail?.run?.status, runId, loadDetail]);

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const { runId: newId } = await api.generate();
      await loadRuns();
      setRunId(newId);
      await loadDetail(newId);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const animate = async () => {
    setBusy(true); setError(null);
    try { await api.animate(runId); await loadDetail(runId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await loadDetail(runId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Approved stills not yet animated → the Animate button's count. Stills whose
  // last attempt ERRORED are excluded — they get an explicit per-card Retry
  // instead of a silent re-spend (UX P0).
  const pendingAnimate = useMemo(() => {
    if (!detail) return 0;
    const animated = new Set(detail.artworks.map((a) => a.source_still_id).filter(Boolean));
    // "qa:" notes are advisory warnings, not failures — they don't block.
    return detail.artworks.filter(
      (a) => a.stage === 'still' && a.status === 'approved' && !animated.has(a.id)
        && !(a.error && !a.error.startsWith('qa:')),
    ).length;
  }, [detail]);

  const mode = detail?.generationMode;

  // Approved animated pieces → ready to send to Jeff.
  const readyToSend = useMemo(
    () => (detail ? detail.artworks.filter((a) => a.stage === 'motion' && a.status === 'approved').length : 0),
    [detail],
  );

  // Is a job actively running, and is it the video-making phase?
  const running = detail?.run?.status === 'running';
  const makingVideos = useMemo(() => {
    if (!running) return false;
    const animated = new Set(detail.artworks.map((a) => a.source_still_id).filter(Boolean));
    return detail.artworks.some((a) => a.stage === 'still' && a.status === 'approved' && !animated.has(a.id));
  }, [running, detail]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Header
        runs={runs} runId={runId} onSelectRun={setRunId}
        onGenerate={generate} onAnimate={animate} pendingAnimate={pendingAnimate}
        readyToSend={readyToSend} onSend={() => setShowSend(true)}
        busy={busy} run={detail?.run} mode={mode} detail={detail}
        running={running} makingVideos={makingVideos}
      />
      {error && <p className="mb-4 rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {!detail && <Empty onGenerate={generate} busy={busy} mode={mode} />}
      {detail && <RunView detail={detail} onAct={act} busy={busy} running={running} />}
      {showSend && <SendDialog runId={runId} onClose={() => setShowSend(false)} onSent={() => loadDetail(runId)} />}
    </main>
  );
}

function Header({ runs, runId, onSelectRun, onGenerate, onAnimate, pendingAnimate, readyToSend, onSend, busy, run, mode, detail, running, makingVideos }) {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.health().then(setHealth); }, []);
  const effectiveMode = mode || health?.generationMode;
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          WOW Artwork Engine
          <ModePill mode={effectiveMode} />
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
            {makingVideos ? 'Making videos… (about 1–2 min each)' : 'Creating designs… (about 1 min)'}
          </span>
        ) : (
          <>
            {runs.length > 0 && (
              <select
                value={runId ?? ''}
                onChange={(e) => onSelectRun(Number(e.target.value))}
                title="Look back at earlier weeks"
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
              >
                {runs.map((r) => <option key={r.id} value={r.id}>Week of {r.week_of}</option>)}
              </select>
            )}
            {pendingAnimate > 0 && (
              <button
                type="button" onClick={onAnimate} disabled={busy}
                title="Turns every design you approved into a video"
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? 'Starting…' : `🎬 Make ${pendingAnimate} video${pendingAnimate === 1 ? '' : 's'}`}
              </button>
            )}
            {readyToSend > 0 && (
              <button
                type="button" onClick={onSend} disabled={busy}
                title="Review the email, then deliver the approved videos to Jeff"
                className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
              >
                ✉ Send {readyToSend} to Jeff
              </button>
            )}
            <button
              type="button" onClick={onGenerate} disabled={busy}
              title="Makes 9 brand-new design options (3 per sign type)"
              className="rounded bg-[#0247FE] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0235c9] disabled:opacity-50"
            >
              {busy ? 'Starting…' : effectiveMode === 'live' ? '✨ Create new designs (~$0.30)' : '✨ Create sample designs (free)'}
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
          className="mt-3 rounded bg-[#0247FE] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating designs…' : live ? 'Create new designs (~$0.30)' : 'Create sample designs (free)'}
        </button>
      </div>
    </div>
  );
}

function RunView({ detail, onAct, busy, running }) {
  const { artworks } = detail;
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

  const actionsFor = (a) => ({
    status: a.status, busy,
    onApprove: () => onAct(() => api.approve(a.id)),
    onReject: () => onAct(() => api.reject(a.id)),
    // Explicit retry for an approved design whose video errored (UX P0).
    // "qa:" notes are warnings, not failures — no retry needed.
    ...(a.stage === 'still' && a.status === 'approved' && a.error && !a.error.startsWith('qa:')
      ? { onRetry: () => onAct(() => api.animateOne(a.id)) }
      : {}),
  });
  // For a set of faces, apply one action to all three.
  const groupActions = (faces) => ({
    status: faces[0]?.status, busy,
    onApprove: () => onAct(() => Promise.all(faces.map((f) => api.approve(f.id)))),
    onReject: () => onAct(() => Promise.all(faces.map((f) => api.reject(f.id)))),
  });

  const stillsOf = (style) => artworks.filter((a) => a.stage === 'still' && a.style === style);

  return (
    <div className="space-y-10">
      <Section title="Spectacular — big street billboard" subtitle="3 design options · the one(s) you approve become 1692×468 videos with the black-frame look">
        <div className="space-y-4">
          {stillsOf('frame_break').map((still) => {
            // .at(-1): after a re-roll, show the LATEST video.
            const motion = motionsByStill.get(still.id)?.at(-1);
            const a = motion || still;
            return <Card key={still.id} artwork={a} actions={actionsFor(a)} animating={isAnimating(still, motion)} />;
          })}
        </div>
      </Section>

      <Section title="EON — 3-pillar set" subtitle="one wide design · its video gets split across the three pillars so the artwork travels from pillar to pillar">
        <div className="space-y-6">
          {stillsOf('eon_connected').map((still) => {
            const faces = motionsByStill.get(still.id)?.slice(-3); // latest set of 3 after re-rolls
            return faces?.length
              ? <ConnectedSet key={still.id} faces={faces} actions={groupActions(faces)} />
              : <div key={still.id} className="max-w-2xl"><Card artwork={still} actions={actionsFor(still)} animating={isAnimating(still, null)} /></div>;
          })}
        </div>
      </Section>

      <Section title="EON — single pillar" subtitle="3 design options · approved ones become 256×384 videos">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {stillsOf('eon_single').map((still) => {
            const motion = motionsByStill.get(still.id)?.at(-1);
            const a = motion || still;
            return <Card key={still.id} artwork={a} actions={actionsFor(a)} animating={isAnimating(still, motion)} />;
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{title}</h2>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

// An animated connected EON option: the three pod faces side by side.
function ConnectedSet({ faces, actions }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
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
