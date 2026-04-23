import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === '' || v.startsWith('your-')) {
    throw new Error(
      `Missing or unconfigured environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`
    );
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return v.trim();
}

function optionalBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return v.trim().toLowerCase() === 'true';
}

function buildConfig() {
  const baseUrl = required('COLLIBRA_BASE_URL').replace(/\/+$/, '');
  return {
    baseUrl,
    apiBase: `${baseUrl}/rest/2.0`,
    username: required('COLLIBRA_USERNAME'),
    password: required('COLLIBRA_PASSWORD'),
    dryRun: optional('DRY_RUN', 'false').toLowerCase() === 'true',
    allowSelfSignedCert: optionalBool('ALLOW_SELF_SIGNED_CERT', false),
    timeoutMs: parseInt(optional('HTTP_TIMEOUT_MS', '30000'), 10),
    logLevel: optional('LOG_LEVEL', 'info').toLowerCase(),
  };
}

export const config = buildConfig();
