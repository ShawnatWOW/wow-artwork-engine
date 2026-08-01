// "Review & send" dialog (Build Plan M3 · handoff doc §3.5).
//
// Review the exact email before it goes to Jeff: pick the sender, choose
// test-to-me vs live-to-Jeff, edit subject + body, see a delivery preflight
// banner and the pieces that will attach. Honest result on send.
//
// Mobile shape (audit 2026-08-01): bottom sheet below sm with a scrollable
// body between a pinned header and a pinned action row — the old centered
// panel had no max-height or scroll, so on a phone Cancel/Send (and with the
// keyboard up, the fields themselves) were physically unreachable. Inputs are
// 16px below sm because iOS force-zooms any focused field smaller than that.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { focusRing, useBodyScrollLock, useCoarsePointer } from './ui.jsx';

export default function SendDialog({ runId, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [sender, setSender] = useState('');
  const [test, setTest] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useBodyScrollLock();

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
  // 16px on ANY coarse-pointer device (iPads too, not just <sm) — iOS/iPadOS
  // force-zoom a focused field whose font is smaller, then clip the dialog.
  const coarse = useCoarsePointer();
  const input = `mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-2.5 text-base sm:py-1.5 ${coarse ? '' : 'sm:text-sm'} ${focusRing}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-black/60 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Send to Jeff"
    >
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-lg border border-neutral-700 bg-neutral-900 sm:max-h-[85dvh] sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between p-4 pb-2 sm:p-5 sm:pb-3">
          <h2 className="text-base font-semibold">Send to Jeff</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`-mr-2 inline-flex h-11 w-11 items-center justify-center rounded text-neutral-400 transition-colors hover:text-white ${focusRing}`}>✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 sm:px-5">
          {!preview && !error && <p className="text-sm text-neutral-400">Loading…</p>}
          {error && <p className="mb-3 break-words rounded bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</p>}

          {result ? (
            <Result result={result} onClose={onClose} />
          ) : preview && (
            <div className="space-y-3 text-sm">
              {/* Preflight banner. The env-var specifics live behind a
                  disclosure — they filled a third of a phone screen with
                  developer jargon the reviewer can do nothing about. */}
              <div className={`rounded px-3 py-2 text-xs ${live ? 'bg-emerald-950 text-emerald-200' : 'bg-amber-950 text-amber-200'}`}>
                {live ? '● Delivery is live — files upload to Drive and the email really sends.'
                  : '● OFFLINE — files save to a local folder and the email is written as a draft file (NOT sent).'}
                {!live && pf.missing.length > 0 && (
                  <details className="mt-1 opacity-80">
                    <summary className="cursor-pointer">Why offline? (setup details)</summary>
                    <span className="break-words">Missing: {pf.missing.join('; ')}</span>
                  </details>
                )}
              </div>

              {preview.items.length === 0 && (
                <p className="rounded bg-neutral-800 px-3 py-2 text-xs text-neutral-300">No approved pieces yet — approve at least one animated piece first.</p>
              )}

              <label className="block">
                <span className="text-xs text-neutral-400">From</span>
                <select value={sender} onChange={(e) => setSender(e.target.value)} className={input}>
                  {(pf.gmail.senders.length ? pf.gmail.senders : [sender]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              <div>
                <span className="text-xs text-neutral-400">Recipient</span>
                {/* flex-wrap + truncate: the Live button embeds a full email
                    address and overflowed the panel on phones. 44px tall —
                    this is the safety-critical test-vs-live choice. */}
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setTest(true)} className={`inline-flex min-h-11 items-center rounded px-3 text-xs transition-colors ${focusRing} ${test ? 'bg-[#0247FE] text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>Test to me ({sender.split('@')[0]})</button>
                  <button type="button" onClick={() => setTest(false)} className={`inline-flex min-h-11 max-w-full items-center truncate rounded px-3 text-xs transition-colors ${focusRing} ${!test ? 'bg-rose-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>Live → {pf.gmail.to}</button>
                </div>
                {!test && <p className="mt-1 text-[11px] text-rose-300">This goes to the real recipient.</p>}
              </div>

              <label className="block">
                <span className="text-xs text-neutral-400">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
              </label>

              <label className="block">
                <span className="text-xs text-neutral-400">Message</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={`${input} min-h-[7rem] font-mono !text-base leading-snug ${coarse ? '' : 'sm:!text-xs'}`} />
              </label>

              <div className="break-words text-xs text-neutral-400">
                Sending {preview.items.length} approved video{preview.items.length === 1 ? '' : 's'}: {preview.items.map((i) => `${i.surface}/${i.style}`).join(', ') || '—'}
              </div>
            </div>
          )}
        </div>

        {!result && preview && (
          // Pinned action row: reachable regardless of scroll or keyboard.
          // col-reverse below sm puts Send above Cancel, apart from it —
          // "Send to Jeff" is irreversible and costs money.
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-neutral-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:border-0 sm:p-5 sm:pt-2">
            <button type="button" onClick={onClose} className={`min-h-11 rounded bg-neutral-800 px-4 text-sm text-neutral-200 transition-colors hover:bg-neutral-700 ${focusRing}`}>Cancel</button>
            <button type="button" onClick={send} disabled={busy || preview.items.length === 0}
              className="min-h-11 rounded bg-[#0247FE] px-4 text-sm font-medium text-white transition-colors hover:bg-[#0235c9] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              {busy ? 'Sending…' : test ? 'Send test to me' : 'Send to Jeff'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Result({ result, onClose }) {
  const ok = result.delivered;
  return (
    <div className="space-y-3 pb-4 text-sm">
      <div className={`break-words rounded px-3 py-2 ${ok ? 'bg-emerald-950 text-emerald-200' : 'bg-amber-950 text-amber-200'}`}>
        {ok ? `✓ Sent to ${result.to} — ${result.count} piece(s) delivered to Drive.`
          : result.email === 'failed'
            ? `✕ Not sent — ${result.detail?.error || 'send failed'}.`
            : `● Offline — ${result.count} piece(s) saved locally, email written as .eml. NOT actually sent.`}
      </div>
      <div className="flex justify-end"><button type="button" onClick={onClose} className={`min-h-11 rounded bg-neutral-800 px-4 text-sm text-neutral-200 ${focusRing}`}>Close</button></div>
    </div>
  );
}
