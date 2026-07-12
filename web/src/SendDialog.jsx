// "Review & send" dialog (Build Plan M3 · handoff doc §3.5).
//
// Review the exact email before it goes to Jeff: pick the sender, choose
// test-to-me vs live-to-Jeff, edit subject + body, see a delivery preflight
// banner and the pieces that will attach. Honest result on send.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function SendDialog({ runId, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [sender, setSender] = useState('');
  const [test, setTest] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.handoffPreview(runId).then((p) => {
      setPreview(p);
      setSender(p.preflight.gmail.defaultFrom || p.preflight.gmail.senders[0] || '');
      setSubject(p.draft.subject);
      setBody(p.draft.body);
    }).catch((e) => setError(e.message));
  }, [runId]);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.sendHandoff(runId, { sender, recipient: preview.preflight.gmail.to, subject, body, test });
      setResult(r);
      onSent?.(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const pf = preview?.preflight;
  const live = pf?.overall === 'live';
  const to = test ? sender : pf?.gmail.to;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Send to Jeff</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-white">✕</button>
        </div>

        {!preview && !error && <p className="text-sm text-neutral-400">Loading…</p>}
        {error && <p className="mb-3 rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}

        {result ? (
          <Result result={result} onClose={onClose} />
        ) : preview && (
          <div className="space-y-3 text-sm">
            {/* Preflight banner */}
            <div className={`rounded px-3 py-2 text-xs ${live ? 'bg-emerald-950 text-emerald-200' : 'bg-amber-950 text-amber-200'}`}>
              {live ? '● Delivery is live — files upload to Drive and the email really sends.'
                : '● OFFLINE — files save to a local folder and the email is written as a .eml (NOT sent).'}
              {!live && pf.missing.length > 0 && <div className="mt-1 opacity-80">Missing: {pf.missing.join('; ')}</div>}
            </div>

            {preview.items.length === 0 && (
              <p className="rounded bg-neutral-800 px-3 py-2 text-xs text-neutral-300">No approved pieces yet — approve at least one animated piece first.</p>
            )}

            <label className="block">
              <span className="text-xs text-neutral-400">From</span>
              <select value={sender} onChange={(e) => setSender(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5">
                {(pf.gmail.senders.length ? pf.gmail.senders : [sender]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <div>
              <span className="text-xs text-neutral-400">Recipient</span>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setTest(true)} className={`rounded px-2 py-1 text-xs ${test ? 'bg-[#0247FE] text-white' : 'bg-neutral-800 text-neutral-300'}`}>Test to me ({sender.split('@')[0]})</button>
                <button type="button" onClick={() => setTest(false)} className={`rounded px-2 py-1 text-xs ${!test ? 'bg-rose-700 text-white' : 'bg-neutral-800 text-neutral-300'}`}>Live → {pf.gmail.to}</button>
              </div>
              {!test && <p className="mt-1 text-[11px] text-rose-300">This goes to the real recipient.</p>}
            </div>

            <label className="block">
              <span className="text-xs text-neutral-400">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5" />
            </label>

            <label className="block">
              <span className="text-xs text-neutral-400">Message</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs" />
            </label>

            <div className="text-xs text-neutral-400">
              Sending {preview.items.length} approved video{preview.items.length === 1 ? '' : 's'}: {preview.items.map((i) => `${i.surface}/${i.style}`).join(', ') || '—'}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200">Cancel</button>
              <button type="button" onClick={send} disabled={busy || preview.items.length === 0}
                className="rounded bg-[#0247FE] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Sending…' : test ? 'Send test to me' : 'Send to Jeff'}
              </button>
            </div>
            <p className="text-[11px] text-neutral-600">→ {to}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Result({ result, onClose }) {
  const ok = result.delivered;
  return (
    <div className="space-y-3 text-sm">
      <div className={`rounded px-3 py-2 ${ok ? 'bg-emerald-950 text-emerald-200' : 'bg-amber-950 text-amber-200'}`}>
        {ok ? `✓ Sent to ${result.to} — ${result.count} piece(s) delivered to Drive.`
          : result.email === 'failed'
            ? `✕ Not sent — ${result.detail?.error || 'send failed'}.`
            : `● Offline — ${result.count} piece(s) saved locally, email written as .eml. NOT actually sent.`}
      </div>
      {result.offlineDir && <p className="text-xs text-neutral-500 break-all">Saved to: {result.offlineDir}</p>}
      <div className="flex justify-end"><button type="button" onClick={onClose} className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200">Close</button></div>
    </div>
  );
}
