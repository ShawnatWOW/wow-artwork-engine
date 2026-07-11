// WOW Artwork Engine — weekly review dashboard (Build Plan M2 · two-phase M2.5).
//
// Phase 1: review the Seedream STILLS (styles) + their proposed motion prompt,
// approve the ones Scott likes. Phase 2: "Animate approved" runs Seedance only
// on approved stills. Standalone shell for dev; ReviewDashboard lifts into the
// wow-contract-query "Artwork Engine" tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Preview, Actions, StatusBadge, Details, Card, ModePill, Stepper } from './ui.jsx';
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
    return detail.artworks.filter(
      (a) => a.stage === 'still' && a.status === 'approved' && !animated.has(a.id) && !a.error,
    ).length;
  }, [detail]);

  const mode = detail?.generationMode;

  // Approved animated pieces → ready to send to Jeff.
  const readyToSend = useMemo(
    () => (detail ? detail.artworks.filter((a) => a.stage === 'motion' && a.status === 'approved').length : 0),
    [detail],
  );

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Header
        runs={runs} runId={runId} onSelectRun={setRunId}
        onGenerate={generate} onAnimate={animate} pendingAnimate={pendingAnimate}
        readyToSend={readyToSend} onSend={() => setShowSend(true)}
        busy={busy} run={detail?.run} mode={mode} detail={detail}
      />
      {error && <p className="mb-4 rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {!detail && <Empty onGenerate={generate} busy={busy} mode={mode} />}
      {detail && <RunView detail={detail} onAct={act} busy={busy} />}
      {showSend && <SendDialog runId={runId} onClose={() => setShowSend(false)} onSent={() => loadDetail(runId)} />}
    </main>
  );
}

function Header({ runs, runId, onSelectRun, onGenerate, onAnimate, pendingAnimate, readyToSend, onSend, busy, run, mode, detail }) {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.health().then(setHealth); }, []);
  const effectiveMode = mode || health?.generationMode;
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          WOW Artwork Engine <span className="text-[#0247FE]">·</span> Weekly Review
          <ModePill mode={effectiveMode} />
        </h1>
        <p className="text-xs text-neutral-500">
          backend <span className={health?.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>{health?.status ?? '…'}</span>
          {run && <> · run #{run.id} · week of {run.week_of} · <StatusBadge status={run.status} /></>}
        </p>
        <Stepper detail={detail} />
      </div>
      <div className="flex items-center gap-2">
        {runs.length > 0 && (
          <select
            value={runId ?? ''}
            onChange={(e) => onSelectRun(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            {runs.map((r) => <option key={r.id} value={r.id}>#{r.id} · {r.week_of} · {r.status}</option>)}
          </select>
        )}
        {pendingAnimate > 0 && (
          <button
            type="button" onClick={onAnimate} disabled={busy}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Working…' : `▶ Animate approved (${pendingAnimate})`}
          </button>
        )}
        {readyToSend > 0 && (
          <button
            type="button" onClick={onSend} disabled={busy}
            className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
          >
            ✉ Send to Jeff ({readyToSend})
          </button>
        )}
        <button
          type="button" onClick={onGenerate} disabled={busy}
          className="rounded bg-[#0247FE] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0235c9] disabled:opacity-50"
        >
          {busy ? 'Working…' : effectiveMode === 'live' ? 'Generate styles (~$0.30)' : 'Generate styles ($0)'}
        </button>
      </div>
    </header>
  );
}

function Empty({ onGenerate, busy, mode }) {
  const live = mode === 'live';
  return (
    <div className="grid place-items-center rounded border border-dashed border-neutral-800 py-24 text-center">
      <div>
        <p className="text-neutral-400">No runs yet.</p>
        <p className="mt-1 text-xs text-neutral-600">Step 1 generates style stills. You approve; Step 2 animates only those.</p>
        <button
          type="button" onClick={onGenerate} disabled={busy}
          className="mt-3 rounded bg-[#0247FE] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Generating…' : live ? 'Generate styles (~$0.30 real spend)' : 'Generate styles (fixtures, $0)'}
        </button>
      </div>
    </div>
  );
}

function RunView({ detail, onAct, busy }) {
  const { artworks, selections } = detail;
  const selected = useMemo(() => new Set(selections.map((s) => s.artwork_id)), [selections]);
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
    selected: selected.has(a.id), status: a.status, busy,
    onSelect: () => onAct(() => (selected.has(a.id) ? api.unselect(a.id) : api.select(a.id))),
    onApprove: () => onAct(() => api.approve(a.id)),
    onReject: () => onAct(() => api.reject(a.id)),
    // Explicit retry for an approved still whose animation errored (UX P0).
    ...(a.stage === 'still' && a.status === 'approved' && a.error
      ? { onRetry: () => onAct(() => api.animateOne(a.id)) }
      : {}),
  });
  // For a set of faces, apply one action to all three.
  const groupActions = (faces) => ({
    selected: faces.some((f) => selected.has(f.id)), status: faces[0]?.status, busy,
    onSelect: () => onAct(() => Promise.all(faces.map((f) => (selected.has(f.id) ? api.unselect(f.id) : api.select(f.id))))),
    onApprove: () => onAct(() => Promise.all(faces.map((f) => api.approve(f.id)))),
    onReject: () => onAct(() => Promise.all(faces.map((f) => api.reject(f.id)))),
  });

  const stillsOf = (style) => artworks.filter((a) => a.stage === 'still' && a.style === style);

  return (
    <div className="space-y-10">
      <Section title="Spectacular" subtitle="frame-break · 3 styles → 1692×468 motion">
        <div className="space-y-4">
          {stillsOf('frame_break').map((still) => {
            // .at(-1): after a re-roll, show the LATEST animation.
            const motion = motionsByStill.get(still.id)?.at(-1);
            return motion
              ? <Card key={still.id} artwork={motion} actions={actionsFor(motion)} />
              : <Card key={still.id} artwork={still} actions={actionsFor(still)} />;
          })}
        </div>
      </Section>

      <Section title="EON — Connected pods" subtitle="one wide style → animates & slices into 3 × 256×384 faces that travel pod-to-pod">
        <div className="space-y-6">
          {stillsOf('eon_connected').map((still) => {
            const faces = motionsByStill.get(still.id)?.slice(-3); // latest set of 3 after re-rolls
            return faces?.length
              ? <ConnectedSet key={still.id} faces={faces} actions={groupActions(faces)} />
              : <div key={still.id} className="max-w-2xl"><Card artwork={still} actions={actionsFor(still)} /></div>;
          })}
        </div>
      </Section>

      <Section title="EON — Single face" subtitle="256×384 · 3 styles">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {stillsOf('eon_single').map((still) => {
            const motion = motionsByStill.get(still.id)?.at(-1);
            return <Card key={still.id} artwork={motion || still} actions={actionsFor(motion || still)} />;
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
        <span className="text-xs text-neutral-400">Connected · animated</span>
        <StatusBadge status={faces[0]?.status} stage="motion" />
      </div>
      <div className="flex items-end gap-1">
        {faces.map((f, i) => (
          <div key={f.id} className="w-28">
            <Preview artwork={f} />
            <p className="mt-1 text-center text-[10px] text-neutral-600">pod {i + 1}</p>
          </div>
        ))}
      </div>
      <Actions {...actions} />
      {faces[0] && <Details artwork={faces[0]} />}
    </div>
  );
}
