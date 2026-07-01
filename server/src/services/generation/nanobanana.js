// Nano Banana Pro (Gemini image API) still provider (LIVE — spends credits).
//
// Stubbed behind the same interface as the fixture provider. Left
// unimplemented until WOW confirms the Gemini key (Build Plan §9, §10).
import config from '../../config/index.js';
import logger from '../../config/logger.js';

export const MODEL_STILL = 'nano-banana-pro';

export const stillProvider = {
  model: MODEL_STILL,
  async generate({ prompt, width, height, output }) {
    if (!config.gemini.apiKey) {
      throw new Error(
        'GEMINI_API_KEY not set. Live generation is disabled until WOW confirms the key.',
      );
    }
    // ---- Intentionally not implemented yet ----
    // POST {prompt, size} to the Gemini image endpoint, download to `output`.
    // FFmpeg conforms to the exact spec downstream.
    logger.warn({ prompt, width, height }, 'Nano Banana Pro live call stubbed');
    throw new Error('Nano Banana Pro live generation not yet implemented — confirm keys to enable.');
  },
};

export default { stillProvider };
