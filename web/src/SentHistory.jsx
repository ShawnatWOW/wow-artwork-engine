// "Sent history" modal — the cross-run record of everything ever delivered to
// Jeff (Scott, 2026-07-21: "what have we already sent him?" had no answer
// without clicking through every old batch). Read-only: GET /api/deliveries,
// newest first, grouped by the batch each piece came from.
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

// Honest per-delivery outcome: 'sent' really went out; 'offline' was only
// written to a local folder; 'failed' never left.
const STATUS_CHIP = {
  sent: 'bg-emerald-600 text-white',
  offline: 'bg-neutral-700 text-neutral-200',
  failed: 'bg-rose-700 text-white',
};
const STATUS_TEXT = { sent: 'Sent', offline: 'Offline copy', failed: 'Failed' };

export default function SentHistory({ onClose }) {
  const [deliveries, setDeliveries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.deliveries().then((d) => setDeliveries(d.deliveries)).catch((e) => setError(e.message));
  }, []);

  // Group into per-batch sections. The server already sorts newest-first, so
  // insertion order keeps both the groups and the rows inside them in order.
  const groups = useMemo(() => {
    if (!deliveries) return [];
    const byRun = new Map();
    for (const d of deliveries) {
      const key = d.run?.id ?? 'unknown';
      if (!byRun.has(key)) byRun.set(key, { run: d.run, rows: [] });
      byRun.get(key).rows.push(d);
    }
    return [...byRun.values()];
  }, [deliveries]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-neutral-700 bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Sent history</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-1 text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0247FE]">✕</button>
        </div>

        {!deliveries && !error && <p className="text-sm text-neutral-400">Loading…</p>}
        {error && <p className="mb-3 rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}

        {deliveries?.length === 0 && (
          <p className="rounded bg-neutral-800 px-3 py-2 text-xs text-neutral-300">
            Nothing sent yet — approved videos appear here after you send them to Jeff.
          </p>
        )}

        {groups.length > 0 && (
          <div className="space-y-4 overflow-y-auto pr-1">
            {groups.map(({ run, rows }) => (
              <section key={run?.id ?? 'unknown'}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Week of {run?.week_of ?? '—'} · batch #{run?.id ?? '?'}
                </h3>
                <ul className="space-y-1.5">
                  {rows.map((d) => <DeliveryRow key={d.id} d={d} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryRow({ d }) {
  const a = d.artwork;
  return (
    <li className="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-950/60 p-2 text-xs">
      <img src={api.thumbUrl(a.id)} alt="" className="h-16 w-16 shrink-0 rounded object-cover" loading="lazy" decoding="async" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-neutral-200">{a.surface} · {a.width}×{a.height}</p>
        <p className="text-neutral-500">{d.sent_at ? new Date(d.sent_at).toLocaleString() : '—'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {d.jeff_notified_at && <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-300">Email ✓</span>}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_CHIP[d.status] || 'bg-neutral-700 text-neutral-200'}`}>
          {STATUS_TEXT[d.status] || d.status}
        </span>
        {String(d.destination || '').startsWith('http') && (
          <a href={d.destination} target="_blank" rel="noreferrer" className="text-[#0247FE] hover:underline">Open in Drive ↗</a>
        )}
      </div>
    </li>
  );
}
