// Secret loading. Order of precedence:
//   1. AWS Secrets Manager (if SECRETS_MANAGER_IDS is set)  — production
//   2. process.env (typically populated from a gitignored .env)  — local
//
// Secrets Manager values are expected to be JSON objects; their keys are
// merged into process.env *without* overwriting anything already set, so an
// explicit env var always wins for local overrides.
import logger from './logger.js';

export async function loadSecrets() {
  const ids = (process.env.SECRETS_MANAGER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    logger.debug('No SECRETS_MANAGER_IDS configured; using process.env only.');
    return;
  }

  let SecretsManagerClient, GetSecretValueCommand;
  try {
    ({ SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    ));
  } catch {
    logger.warn(
      '@aws-sdk/client-secrets-manager not installed; skipping Secrets Manager. Run `npm install` in server/.',
    );
    return;
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  for (const id of ids) {
    try {
      const res = await client.send(new GetSecretValueCommand({ SecretId: id }));
      const parsed = JSON.parse(res.SecretString || '{}');
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = String(v);
      }
      logger.info({ secretId: id, keys: Object.keys(parsed).length }, 'Loaded secret');
    } catch (err) {
      logger.error({ secretId: id, err: err.message }, 'Failed to load secret');
      throw err;
    }
  }
}
