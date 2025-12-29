import path from 'path';
import { fileURLToPath } from 'url';

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseAllowedIps(raw) {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const rootDir = path.resolve(__dirname, '..');
  const port = parseInteger(process.env.PORT, 3000);
  const databasePath = process.env.DATABASE_PATH || path.join(rootDir, 'data', 'notify.sqlite');
  const configDbPath = process.env.CONFIG_DB_PATH || path.join(rootDir, 'data', 'notify-config.sqlite');
  const bodyLimit = process.env.BODY_LIMIT || '200kb';
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const requireHttps = process.env.REQUIRE_HTTPS === 'true';
  const requireHmac = process.env.REQUIRE_HMAC !== 'false';
  const requireAuth = process.env.REQUIRE_AUTH !== undefined
    ? process.env.REQUIRE_AUTH !== 'false'
    : !requireHmac;
  const logRequests = process.env.LOG_REQUESTS || 'true';
  const rateLimitWindowMs = parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
  const rateLimitMax = parseInteger(process.env.RATE_LIMIT_MAX, 120);
  const hmacWindowMs = parseInteger(process.env.HMAC_WINDOW_MS, 300_000);
  const allowedIps = parseAllowedIps(process.env.ALLOWED_IPS || '');
  const ipAllowlistEnabled = process.env.IP_ALLOWLIST_ENABLED === 'true';

  const adminBasePath = process.env.ADMIN_BASE_PATH || '';
  const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || '';
  const adminBootstrapUser = process.env.ADMIN_BOOTSTRAP_USER || '';
  const adminBootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';

  return {
    rootDir,
    port,
    databasePath,
    configDbPath,
    bodyLimit,
    trustProxy,
    requireHttps,
    requireAuth,
    requireHmac,
    logRequests,
    rateLimitWindowMs,
    rateLimitMax,
    hmacWindowMs,
    allowedIps,
    ipAllowlistEnabled,
    adminBasePath,
    adminSessionSecret,
    adminBootstrapUser,
    adminBootstrapPassword,
  };
}

export {
  loadConfig,
};
