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

const DEFAULT_BODY_LIMIT = '200kb';
const DEFAULT_LOG_REQUESTS = 'errors';
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_HMAC_WINDOW_MS = 300_000;

function loadConfig() {
  const rootDir = path.resolve(__dirname, '..');
  const port = parseInteger(process.env.PORT, 3000);
  const databaseUrl = process.env.DATABASE_URL || '';
  const bodyLimit = DEFAULT_BODY_LIMIT;
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const requireHttps = process.env.REQUIRE_HTTPS === 'true';
  const requireHmac = process.env.REQUIRE_HMAC !== 'false';
  const requireAuth = process.env.REQUIRE_AUTH !== undefined
    ? process.env.REQUIRE_AUTH !== 'false'
    : !requireHmac;
  const logRequests = DEFAULT_LOG_REQUESTS;
  const rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS;
  const rateLimitMax = DEFAULT_RATE_LIMIT_MAX;
  const hmacWindowMs = DEFAULT_HMAC_WINDOW_MS;
  const logRetentionHours = parseInteger(process.env.NOTIFY_LOG_RETENTION_HOURS, 24);
  const logCleanupIntervalMs = parseInteger(process.env.NOTIFY_LOG_CLEANUP_INTERVAL_MS, 24 * 60_000 * 60);
  const allowedIps = parseAllowedIps(process.env.ALLOWED_IPS || '');
  const ipAllowlistEnabled = process.env.IP_ALLOWLIST_ENABLED === 'true';

  const adminBasePath = process.env.ADMIN_BASE_PATH || '';
  const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || '';
  const adminBootstrapUser = process.env.ADMIN_BOOTSTRAP_USER || '';
  const adminBootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';

  return {
    rootDir,
    port,
    databaseUrl,
    bodyLimit,
    trustProxy,
    requireHttps,
    requireAuth,
    requireHmac,
    logRequests,
    rateLimitWindowMs,
    rateLimitMax,
    hmacWindowMs,
    logRetentionHours,
    logCleanupIntervalMs,
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
