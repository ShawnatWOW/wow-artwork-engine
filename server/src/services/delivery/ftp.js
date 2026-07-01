// FTP delivery (OPTIONAL fallback — primary handoff is Google Drive).
//
// Uploads a final artwork file to the WOW FTP site. Creds come from config
// (Secrets Manager in prod). Kept behind the same interface as the Drive
// provider so the delivery method is a one-line config switch.
import { basename } from 'node:path';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

/** @returns {Promise<{ destination, method }>} */
export async function deliver({ filePath, fileName }, cfg = config.ftp) {
  if (!cfg.host) throw new Error('FTP_HOST not set (FTP is the fallback method).');
  let ClientCtor;
  try {
    ({ Client: ClientCtor } = await import('basic-ftp'));
  } catch {
    throw new Error('basic-ftp not installed. Run `npm install` in server/.');
  }
  const name = fileName || basename(filePath);
  const client = new ClientCtor();
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      secure: cfg.secure,
    });
    await client.ensureDir(cfg.remoteDir);
    await client.uploadFrom(filePath, name);
    const destination = `${cfg.remoteDir}/${name}`;
    logger.info({ destination }, 'Delivered to FTP');
    return { destination, method: 'ftp' };
  } finally {
    client.close();
  }
}

export default { deliver };
