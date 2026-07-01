// Jeff notification email (Build Plan M3 · integration).
//
// Sends Jeff a notification when a pick is delivered, with file name, sign
// spec, and (for the Drive handoff) the Drive link. Uses nodemailer over SMTP;
// swap in SES transport in prod. Gated on SMTP config.
import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * @param delivery { fileName, specKey, surface, webViewLink?, destination? }
 * @returns {Promise<{ sent: boolean, messageId?: string }>}
 */
export async function notifyJeff(delivery, cfg = config.mail) {
  const subject = `New WOW artwork ready: ${delivery.fileName}`;
  const where = delivery.webViewLink
    ? `Drive: ${delivery.webViewLink}`
    : `Location: ${delivery.destination || 'see delivery record'}`;
  const text = [
    `A new piece is ready to run.`,
    ``,
    `File:    ${delivery.fileName}`,
    `Surface: ${delivery.surface} (${delivery.specKey})`,
    where,
    ``,
    `— WOW Artwork Engine`,
  ].join('\n');

  if (!cfg.smtp.host) {
    logger.warn({ to: cfg.jeffEmail, subject }, 'SMTP not configured; skipping Jeff email');
    return { sent: false };
  }

  let nodemailer;
  try {
    ({ default: nodemailer } = await import('nodemailer'));
  } catch {
    throw new Error('nodemailer not installed. Run `npm install` in server/.');
  }
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.password } : undefined,
  });
  const info = await transport.sendMail({ from: cfg.from, to: cfg.jeffEmail, subject, text });
  logger.info({ to: cfg.jeffEmail, messageId: info.messageId }, 'Notified Jeff');
  return { sent: true, messageId: info.messageId };
}

export default { notifyJeff };
