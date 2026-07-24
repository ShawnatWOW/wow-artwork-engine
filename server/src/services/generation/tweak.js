// Plain-language TWEAK of a still's text-to-image prompt.
//
// A reviewer keeps a design they like and asks for one specific change ("make
// the sky deeper purple"). This module hands the design's existing prompt +
// that plain-language change to an LLM which edits ONLY the requested change and
// returns the FULL prompt with everything else preserved — so a tweak is a
// surgical edit, not a rewrite. Ported from the proven wow-contract-query
// video-studio refineTweak (same STRICT-JSON contract + graceful fallback),
// with the system prompt adapted to ARTWORK rules.
//
// No `openai` npm dependency here (it is not in package.json), so we call the
// Chat Completions REST endpoint directly with the built-in fetch. The client
// is config-driven and NEVER throws: on a missing key or any error it returns
// the original prompt unchanged + the raw instruction as the note, so a tweak
// degrades to a labeled re-roll instead of a failure.

import config from '../../config/index.js';
import logger from '../../config/logger.js';

const TWEAK_SYSTEM = `You are EDITING an existing text-to-image art prompt for a psychedelic billboard artwork. Apply ONLY the reviewer's plain-language change and return the FULL prompt with EVERYTHING ELSE PRESERVED — same subject, composition, style and safety rules. Never add people, faces, text, logos or watermarks. Keep high-contrast readable-from-distance lighting. If the style is the 'frame_break' pop-out, keep the trompe-l'oeil black border + subject-bursting-through language intact. Return STRICT JSON {"prompt":"<full edited prompt>","change_note":"<one short sentence of what changed>"}.`;

/**
 * Edit `prompt` per the reviewer's `instruction`, preserving everything else.
 * @param {{ prompt: string, instruction: string, style?: string }} o
 * @returns {Promise<{ prompt: string, changeNote: string }>} edited prompt +
 *   one-line note, or the ORIGINAL prompt + the instruction as the note on any
 *   failure (missing key, network/API error, unparseable response). Never throws.
 */
export async function refineTweak({ prompt, instruction, style } = {}) {
  const base = String(prompt || '').trim();
  const note = String(instruction || '').trim();
  const fallback = { prompt: base, changeNote: note };

  // Read config at CALL time (not import time) — dotenv loads after this module,
  // and tests flip config.openai.apiKey to force the offline fallback path.
  const { apiKey, model, baseUrl } = config.openai;
  if (!apiKey || !base || !note) return fallback;

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: TWEAK_SYSTEM },
          {
            role: 'user',
            content:
              `ORIGINAL ${style ? `${style} ` : ''}art prompt:\n\n${base}\n\n` +
              `Apply ONLY this reviewer change and return the FULL edited prompt, ` +
              `keeping everything else intact: "${note}". Also give the change_note. JSON only.`,
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`openai ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    if (!parsed.prompt) return fallback;
    return {
      prompt: String(parsed.prompt).trim(),
      changeNote: String(parsed.change_note || note).slice(0, 200),
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Tweak refine failed; keeping the original prompt');
    return fallback;
  }
}

export default { refineTweak };
