// Generation provider factory.
//
// Returns { still, motion } providers based on GENERATION_MODE. `fixture`
// (the default) synthesizes media locally and spends nothing. `live` returns
// the real paid providers and REQUIRES explicit opt-in plus configured keys,
// so a run can never spend credits by accident (Build Plan §8).
//
// Locked providers: motion = Seedance 2.0 via fal.ai, stills = Nano Banana Pro.
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import * as fixture from './fixture.js';
import * as fal from './fal.js';
import * as nanobanana from './nanobanana.js';

export function getProviders(mode = config.generationMode) {
  if (mode === 'live') {
    if (!config.fal.key || !config.gemini.apiKey) {
      throw new Error(
        'GENERATION_MODE=live requires FAL_KEY (Seedance motion) and GEMINI_API_KEY (Nano Banana stills). ' +
          'Confirm keys before enabling live generation.',
      );
    }
    logger.warn('Generation mode: LIVE — calls will spend credits.');
    return { mode, still: nanobanana.stillProvider, motion: fal.motionProvider };
  }
  logger.info('Generation mode: fixture — synthesizing media locally (no cost).');
  return { mode: 'fixture', still: fixture.stillProvider, motion: fixture.motionProvider };
}

export default { getProviders };
