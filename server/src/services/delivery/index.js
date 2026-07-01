// Delivery factory. Picks the handoff method from config (locked default:
// drive). FTP is an optional fallback. Both providers share the same
// deliver({ filePath, fileName }) signature.
import config from '../../config/index.js';
import * as drive from './drive.js';
import * as ftp from './ftp.js';

const PROVIDERS = { drive, ftp };

export function getDeliveryProvider(method = config.delivery.method) {
  const provider = PROVIDERS[method];
  if (!provider) throw new Error(`Unknown delivery method: ${method} (expected drive | ftp)`);
  return provider;
}

export default { getDeliveryProvider };
