// Brand-safety guardrails (Build Plan M1 · backend).
//
// Locked policy: loose — the only hard rule is NO NUDITY. The rule set is
// config-driven (config.guardrails) so faces/text/colors or other blocks can
// be added later without code changes. Two checkpoints:
//   - checkPrompt()  : screen a generation prompt BEFORE spending credits.
//   - reviewArtwork(): post-generation hook (wire an image-moderation API in
//                      live mode); for now it passes through.

import config from '../config/index.js';

// Terms that signal explicit/nude content in a prompt. Deliberately focused —
// the policy is loose, this is not a profanity or general-content filter.
const NUDITY_TERMS = [
  'nude', 'nudity', 'naked', 'nsfw', 'explicit', 'pornographic', 'porn',
  'topless', 'bottomless', 'genitalia', 'genitals',
];

/**
 * Screen a prompt against the active guardrails.
 * Pure + testable. @returns {{ allowed: boolean, reasons: string[] }}
 */
export function checkPrompt(prompt, guardrails = config.guardrails) {
  const text = String(prompt || '').toLowerCase();
  const reasons = [];

  if (guardrails.blockNudity) {
    const hit = NUDITY_TERMS.find((t) => new RegExp(`\\b${t}\\b`).test(text));
    if (hit) reasons.push(`nudity term: "${hit}"`);
  }
  for (const term of guardrails.extraDenyTerms || []) {
    if (term && new RegExp(`\\b${term}\\b`).test(text)) reasons.push(`denied term: "${term}"`);
  }

  return { allowed: reasons.length === 0, reasons };
}

/**
 * Post-generation review hook. In live mode this is where an image/video
 * moderation API would run a coverage/safety sanity check and auto-reject.
 * For now it is a pass-through so the fixture pipeline runs end to end.
 * @returns {Promise<{ allowed: boolean, reasons: string[] }>}
 */
export async function reviewArtwork(_artwork, guardrails = config.guardrails) {
  void guardrails;
  return { allowed: true, reasons: [] };
}

export default { checkPrompt, reviewArtwork, NUDITY_TERMS };
