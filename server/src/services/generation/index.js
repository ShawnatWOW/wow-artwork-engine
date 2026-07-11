// Generation provider factory.
//
// Returns { still, motion } providers based on GENERATION_MODE. `fixture`
// (the default) synthesizes media locally and spends nothing. `live` returns
// the real paid providers and REQUIRES explicit opt-in plus configured keys,
// so a run can never spend credits by accident (Build Plan §8).
//
// Providers: motion = Seedance 2.0 via fal.ai, stills = Seedream via fal.ai.
// (Seedream replaced Nano Banana Pro — its stills feed Seedance image-to-video.)
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import * as fixture from './fixture.js';
import * as fal from './fal.js';
import * as seedream from './seedream.js';

export function getProviders(mode = config.generationMode) {
  if (mode === 'live') {
    if (!config.fal.key) {
      throw new Error(
        'GENERATION_MODE=live requires FAL_KEY (Seedream stills + Seedance motion, both on fal.ai). ' +
          'Confirm the key before enabling live generation.',
      );
    }
    logger.warn('Generation mode: LIVE — calls will spend credits.');
    return { mode, still: seedream.stillProvider, motion: fal.motionProvider };
  }
  logger.info('Generation mode: fixture — synthesizing media locally (no cost).');
  return { mode: 'fixture', still: fixture.stillProvider, motion: fixture.motionProvider };
}

export default { getProviders };
