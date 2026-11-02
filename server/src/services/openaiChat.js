// One place that shapes a Chat Completions request body for whichever model the config names.
//
// The gpt-5 and gpt-6 families reject `temperature` and want `max_completion_tokens` instead of
// `max_tokens`, and take a reasoning (thinking) level. Older models (gpt-4o, gpt-4o-mini) pass
// through untouched, so a rollback through ARTWORK_*_MODEL behaves exactly as before.
import config from '../config/index.js';

const REASONING_FAMILY = /^(gpt-5|gpt-6|o[1-9])/i;

export function chatBody(model, body = {}) {
  const out = { ...body, model };
  if (!REASONING_FAMILY.test(String(model || ''))) return out;
  delete out.temperature;
  delete out.top_p;
  if (out.max_tokens != null) {
    if (out.max_completion_tokens == null) out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  if (out.reasoning_effort == null) out.reasoning_effort = config.openai.reasoning || 'none';
  return out;
}
