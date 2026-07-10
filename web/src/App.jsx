// WOW Artwork Engine — weekly review dashboard (Build Plan M2).
//
// Standalone shell for dev; the reusable review surface is <ReviewDashboard/>,
// written to lift into the shared WOW dashboard (unstuckllc/wow-contract-query)
// as the "Artwork Engine" tab. Data comes from the /api/runs + /api/artworks
// endpoints; media streams from the asset store.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Preview, Actions, StatusBadge, Details, Card } from './ui.jsx';

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
  const [detail, setDetail] = useState(null); // { run, artworks, eonSequences, selections }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadRuns = useCallback(async () => {
    const { runs: list } = await api.listRuns();
    setRuns(list);
    setRunId((cur) => cur ?? list[0]?.id ?? null);
    return list;
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    setDetail(await api.getRun(id));
  }, []);

  useEffect(() => { loadRuns().catch((e) => setError(e.message)); }, [loadRuns]);
  useEffect(() => { loadDetail(runId).catch((e) => setError(e.message)); }, [runId, loadDetail]);

  // Poll while a run is still generating so cards fill in live.
  useEffect(() => {
    if (detail?.run?.status !== 'running') return undefined;
    const t = setInterval(() => loadDetail(runId).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [detail?.run?.status, runId, loadDetail]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { runId: newId } = await api.generate();
      await loadRuns();
      setRunId(newId);
      await loadDetail(newId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); await loadDetail(runId); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Header
        runs={runs}
        runId={runId}
        onSelectRun={setRunId}
        onGenerate={generate}
        busy={busy}
        run={detail?.run}
      />
      {error && <p className="mb-4 rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {!detail && <Empty onGenerate={generate} busy={busy} />}
      {detail && <RunView detail={detail} onAct={act} busy={busy} />}
    </main>
  );
}

function Header({ runs, runId, onSelectRun, onGenerate, busy, run }) {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.health().then(setHealth); }, []);
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
      <div>
        <h1 className="text-xl font-semibold">
          WOW Artwork Engine <span className="text-[#0247FE]">·</span> Weekly Review
        </h1>
        <p className="text-xs text-neutral-500">
          backend <span className={health?.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>{health?.status ?? '…'}</span>
          {run && <> · run #{run.id} · week of {run.week_of} · <StatusBadge status={run.status} /></>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {runs.length > 0 && (
          <select
            value={runId ?? ''}
            onChange={(e) => onSelectRun(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>#{r.id} · {r.week_of} · {r.status}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="rounded bg-[#0247FE] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0235c9] disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Generate this week'}
        </button>
      </div>
    </header>
  );
}

function Empty({ onGenerate, busy }) {
  return (
    <div className="grid place-items-center rounded border border-dashed border-neutral-800 py-24 text-center">
      <div>
        <p className="text-neutral-400">No runs yet.</p>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="mt-3 rounded bg-[#0247FE] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Generating…' : 'Generate this week (fixtures, $0)'}
        </button>
      </div>
    </div>
  );
}

function RunView({ detail, onAct, busy }) {
  const { artworks, eonSequences, selections } = detail;
  const selected = useMemo(() => new Set(selections.map((s) => s.artwork_id)), [selections]);
  const byId = useMemo(() => new Map(artworks.map((a) => [a.id, a])), [artworks]);

  const spectacular = artworks.filter((a) => a.style === 'frame_break');
  const eonSingle = artworks.filter((a) => a.style === 'eon_single');

  const actionsFor = (a) => ({
    selected: selected.has(a.id),
    status: a.status,
    busy,
    onSelect: () => onAct(() => (selected.has(a.id) ? api.unselect(a.id) : api.select(a.id))),
    onApprove: () => onAct(() => api.approve(a.id)),
    onReject: () => onAct(() => api.reject(a.id)),
  });

  return (
    <div className="space-y-10">
      <Section title="Spectacular" subtitle="1692×468 · frame-break · 3 options">
        <div className="space-y-4">
          {spectacular.map((a) => (
            <Card key={a.id} artwork={a} aspectClass="aspect-spectacular" actions={actionsFor(a)} />
          ))}
        </div>
      </Section>

      <Section title="EON — Connected pods" subtitle="768×384 master → 3 × 256×384 faces · travels across the pod">
        <div className="space-y-6">
          {eonSequences.map((seq, i) => (
            <ConnectedSet
              key={seq.id}
              index={i + 1}
              faces={[seq.face1_artwork_id, seq.face2_artwork_id, seq.face3_artwork_id].map((id) => byId.get(id)).filter(Boolean)}
              actionsFor={actionsFor}
            />
          ))}
        </div>
      </Section>

      <Section title="EON — Single face" subtitle="256×384 · 3 options">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {eonSingle.map((a) => (
            <Card key={a.id} artwork={a} aspectClass="aspect-eon-face" actions={actionsFor(a)} />
          ))}
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

// A connected EON option: the three pod faces shown side by side (as they sit
// on the network) with one set of actions applied to the whole set.
function ConnectedSet({ index, faces, actionsFor }) {
  const setAct = (method) => () => faces.forEach((f) => actionsFor(f)[method]());
  const anySelected = faces.some((f) => actionsFor(f).selected);
  const status = faces[0]?.status;
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-neutral-400">Option {index}</span>
        <StatusBadge status={status} />
      </div>
      <div className="flex items-end gap-1">
        {faces.map((f, i) => (
          <div key={f.id} className="w-28">
            <Preview artworkId={f.id} aspectClass="aspect-eon-face" />
            <p className="mt-1 text-center text-[10px] text-neutral-600">pod {i + 1}</p>
          </div>
        ))}
      </div>
      <Actions
        selected={anySelected}
        status={status}
        onSelect={setAct('onSelect')}
        onApprove={setAct('onApprove')}
        onReject={setAct('onReject')}
      />
      {faces[0] && <Details artwork={faces[0]} />}
    </div>
  );
}
