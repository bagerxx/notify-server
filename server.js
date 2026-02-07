import os from 'os';
import { randomUUID } from 'crypto';
import express from 'express';
import { setMaxListeners } from 'events';

import { loadConfig } from './lib/config.js';
import { NonceStore } from './lib/nonce-store.js';
import { createAuthMiddleware } from './lib/auth.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { createRequestLogger } from './lib/logger.js';
import { createHmacMiddleware } from './lib/hmac.js';
import { createIpAllowlistMiddleware } from './lib/ip-allowlist.js';
import { validateNotify } from './lib/validation.js';
import { HttpError, badRequest, notFound } from './lib/http-errors.js';
import { sendApns, shutdownApnsProviders } from './apns.js';
import { sendFcm } from './fcm.js';
import { ConfigStore } from './lib/config-store.js';
import { createAdminRouter } from './lib/admin.js';
import { COLORS, colorize } from './lib/console-colors.js';
import { prisma } from './lib/prisma.js';

// Reduce apn/http2 listener warnings during burst sends.
setMaxListeners(200);

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function securityHeaders(req, res, next) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cross-origin-resource-policy', 'same-site');
  res.setHeader('x-permitted-cross-domain-policies', 'none');
  next();
}

function createHttpsEnforcer(config) {
  if (!config.requireHttps) {
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    if (req.secure) {
      return next();
    }
    if (config.trustProxy) {
      const forwarded = req.headers['x-forwarded-proto'];
      if (typeof forwarded === 'string' && forwarded.split(',')[0].trim() === 'https') {
        return next();
      }
    }
    return res.status(403).json({ ok: false, error: { message: 'HTTPS required' } });
  };
}

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return next(badRequest('Content-Type must be application/json'));
  }
  return next();
}

function assertPlatformConfigured(appConfig, platform) {
  if (platform === 'ios' && !appConfig.ios) {
    throw badRequest('iOS is not configured for this app');
  }
  if (platform === 'android' && !appConfig.android) {
    throw badRequest('Android is not configured for this app');
  }
}

function formatToggle(value) {
  return value ? colorize('on', COLORS.green) : colorize('off', COLORS.red);
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return colorize('none', COLORS.gray);
  }
  return values.join(', ');
}

function getHeaderValue(req, name) {
  const value = req.headers[name];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function resolveRequestId(req) {
  if (req.requestId && typeof req.requestId === 'string') {
    return req.requestId;
  }
  const header = getHeaderValue(req, 'x-request-id');
  const requestId = header || randomUUID();
  req.requestId = requestId;
  return requestId;
}

function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  if (token.length <= 10) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function summarizeTokens(tokens, limit = 5) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { count: 0, sample: [] };
  }
  return {
    count: tokens.length,
    sample: tokens.slice(0, limit).map(maskToken),
  };
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4') continue;
      if (entry.internal) continue;
      addresses.add(entry.address);
    }
  }

  return Array.from(addresses);
}

function formatUrls(addresses, port, suffix = '') {
  if (!addresses || addresses.length === 0) {
    return `http://0.0.0.0:${port}${suffix}`;
  }
  return addresses.map((address) => `http://${address}:${port}${suffix}`).join(', ');
}

function logInfo(message) {
  console.log(`${colorize('INFO', COLORS.green)} ${message}`);
}

function logWarn(message) {
  console.warn(`${colorize('WARN', COLORS.yellow)} ${message}`);
}

function logError(message, error) {
  if (error) {
    console.error(`${colorize('ERROR', COLORS.red)} ${message}`, error);
    return;
  }
  console.error(`${colorize('ERROR', COLORS.red)} ${message}`);
}

function logStartup(config, adminSettings) {
  const addresses = getNetworkAddresses();
  const divider = colorize('========================================', COLORS.gray);
  const label = (text) => colorize(text, COLORS.cyan);
  const value = (text) => colorize(text, COLORS.green);
  const lines = [
    '',
    divider,
    colorize(' Notify Server Ready', COLORS.green),
    divider,
    `${label('Listening')}: ${value(formatUrls(addresses, config.port))}`,
    `${label('Admin UI')}: ${value(formatUrls(addresses, config.port, adminSettings.adminPath))}`,
    `${label('Auth')}: ${formatToggle(config.requireAuth)} | ${label('HMAC')}: ${formatToggle(config.requireHmac)}`,
    `${label('HTTPS')}: ${formatToggle(config.requireHttps)} | ${label('Trust proxy')}: ${formatToggle(config.trustProxy)}`,
    `${label('IP allowlist')}: ${formatToggle(config.ipAllowlistEnabled)} (${formatList(config.allowedIps)})`,
    `${label('Rate limit')}: ${config.rateLimitMax} / ${(config.rateLimitWindowMs / 1000).toFixed(0)}s`,
  ];
  console.log(lines.join('\n'));
}

async function start() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    logError('DATABASE_URL is required');
    process.exit(1);
  }

  const configStore = new ConfigStore({
    prisma,
  });
  await configStore.init();

  const logRetentionHours = Number.isFinite(config.logRetentionHours) && config.logRetentionHours > 0
    ? config.logRetentionHours
    : 24;
  const logRetentionMs = logRetentionHours * 60 * 60 * 1000;
  const logCleanupIntervalMs = Number.isFinite(config.logCleanupIntervalMs) && config.logCleanupIntervalMs > 0
    ? config.logCleanupIntervalMs
    : 60 * 60 * 1000;
  const logCleanupIntervalSafe = Math.max(60 * 1000, logCleanupIntervalMs);

  async function cleanupNotifyLogs() {
    try {
      const result = await configStore.cleanupNotifyLogs(logRetentionMs);
      if (result && result.count) {
        logInfo(`Notify logs cleaned: ${result.count}`);
      }
    } catch (error) {
      logError('Notify log cleanup failed', error);
    }
  }

  await cleanupNotifyLogs();
  const logCleanupTimer = setInterval(cleanupNotifyLogs, logCleanupIntervalSafe);

  const adminSettings = await configStore.ensureAdminSettings({
    adminBasePath: config.adminBasePath,
    adminSessionSecret: config.adminSessionSecret,
  });
  if (adminSettings.adminPathGenerated) {
    logInfo(`Admin path generated: ${adminSettings.adminPath}`);
  }
  if (adminSettings.weakAdminPath) {
    logWarn('Admin path looks predictable. Set ADMIN_BASE_PATH to a stronger value.');
  }

  const adminUser = await configStore.ensureAdminUser({
    username: config.adminBootstrapUser,
    password: config.adminBootstrapPassword,
  });
  if (adminUser.created) {
    logInfo(`Admin user created: ${adminUser.username}`);
    if (adminUser.generatedPassword) {
      logInfo(`Admin password generated: ${adminUser.password}`);
    }
  }

  const nonceStore = new NonceStore(prisma);
  await nonceStore.init();

  async function recordNotifyLog(entry) {
    try {
      await configStore.createNotifyLog(entry);
    } catch (error) {
      logError('Notify log insert failed', error);
    }
  }

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(securityHeaders);
  app.use(createHttpsEnforcer(config));
  app.use(createIpAllowlistMiddleware(config.allowedIps, config.ipAllowlistEnabled));
  app.use(createRequestLogger(config.logRequests));
  app.use(express.json({
    limit: config.bodyLimit,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));
  app.use(createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    keyGenerator: (req) => req.ip || 'unknown',
  }));

  app.use(adminSettings.adminPath, createAdminRouter({
    store: configStore,
    sessionSecret: adminSettings.sessionSecret,
  }));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  const auth = createAuthMiddleware(configStore, config);
  const hmac = createHmacMiddleware(configStore, config, nonceStore);

  app.post('/v1/notify', requireJson, auth, hmac, asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    const baseLog = {
      createdAt: new Date(),
      requestId: resolveRequestId(req),
      clientIp: req.ip || null,
      userAgent: getHeaderValue(req, 'user-agent'),
      clientName: getHeaderValue(req, 'x-client-name'),
      appId: getHeaderValue(req, 'x-app-id')
        || (req.body && typeof req.body.appId === 'string' ? req.body.appId.trim() : null),
    };
    let input;
    let logResult = null;
    try {
      input = validateNotify(req.body);
      if (req.appId && input.appId !== req.appId) {
        throw badRequest('appId mismatch');
      }

      const appConfig = await configStore.getAppConfig(input.appId);
      if (!appConfig) {
        throw notFound('Unknown appId');
      }

      const payload = {
        notification: input.notification,
        data: input.data,
        ttlSeconds: input.ttlSeconds,
        apns: input.apns,
        fcm: input.fcm,
      };

      const results = {};
      const logResults = {};

      if (input.platform === 'ios') {
        assertPlatformConfigured(appConfig, 'ios');

        const iosTokens = input.tokens;
        const apnsResult = await sendApns(appConfig, iosTokens, payload);
        const invalidSummary = summarizeTokens(apnsResult.invalidTokens);

        results.ios = {
          requested: iosTokens.length,
          sent: apnsResult.sent,
          failed: apnsResult.failed,
          invalidTokens: apnsResult.invalidTokens,
        };

        logResults.ios = {
          requested: iosTokens.length,
          sent: apnsResult.sent,
          failed: apnsResult.failed,
          invalidTokensCount: invalidSummary.count,
          invalidTokenSamples: invalidSummary.sample,
          errors: apnsResult.errors,
        };
      }

      if (input.platform === 'android') {
        assertPlatformConfigured(appConfig, 'android');

        const androidTokens = input.tokens;
        const fcmResult = await sendFcm(appConfig, androidTokens, payload);
        const invalidSummary = summarizeTokens(fcmResult.invalidTokens);

        results.android = {
          requested: androidTokens.length,
          sent: fcmResult.sent,
          failed: fcmResult.failed,
          invalidTokens: fcmResult.invalidTokens,
        };

        logResults.android = {
          requested: androidTokens.length,
          sent: fcmResult.sent,
          failed: fcmResult.failed,
          invalidTokensCount: invalidSummary.count,
          invalidTokenSamples: invalidSummary.sample,
          errors: fcmResult.errors,
        };
      }

      const failedTotal = (logResults.ios ? logResults.ios.failed : 0)
        + (logResults.android ? logResults.android.failed : 0);
      const success = failedTotal === 0;
      logResult = logResults;

      await recordNotifyLog({
        ...baseLog,
        appId: input.appId,
        platform: input.platform,
        tokensCount: Array.isArray(input.tokens) ? input.tokens.length : null,
        title: input.notification ? input.notification.title : null,
        body: input.notification ? input.notification.body : null,
        data: input.data || null,
        status: 200,
        success,
        durationMs: Date.now() - startedAt,
        result: logResults,
        error: null,
      });
      req.notifyLogRecorded = true;

      res.json({
        ok: true,
        appId: input.appId,
        results,
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const payload = input || {};
      await recordNotifyLog({
        ...baseLog,
        appId: payload.appId || baseLog.appId || null,
        platform: payload.platform || null,
        tokensCount: Array.isArray(payload.tokens) ? payload.tokens.length : null,
        title: payload.notification ? payload.notification.title : null,
        body: payload.notification ? payload.notification.body : null,
        data: payload.data || null,
        status,
        success: false,
        durationMs: Date.now() - startedAt,
        result: logResult,
        error: error && error.message ? error.message : 'Unknown error',
      });
      req.notifyLogRecorded = true;
      throw error;
    }
  }));

  app.use(async (err, req, res, next) => {
    if (req.path === '/v1/notify' && !req.notifyLogRecorded) {
      const baseLog = {
        createdAt: new Date(),
        requestId: resolveRequestId(req),
        clientIp: req.ip || null,
        userAgent: getHeaderValue(req, 'user-agent'),
        clientName: getHeaderValue(req, 'x-client-name'),
        appId: getHeaderValue(req, 'x-app-id')
          || (req.body && typeof req.body.appId === 'string' ? req.body.appId.trim() : null),
      };
      const status = err instanceof HttpError ? err.status : 500;
      await recordNotifyLog({
        ...baseLog,
        status,
        success: false,
        error: err && err.message ? err.message : 'Unknown error',
      });
      req.notifyLogRecorded = true;
    }

    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: { message: 'Invalid JSON' } });
    }

    if (err instanceof HttpError) {
      return res.status(err.status).json({
        ok: false,
        error: {
          message: err.message,
          details: err.details,
        },
      });
    }

    logError('Unhandled error', err);
    return res.status(500).json({ ok: false, error: { message: 'Internal server error' } });
  });

  const server = app.listen(config.port, () => {
    logStartup(config, adminSettings);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logInfo('Shutting down');
    clearInterval(logCleanupTimer);
    shutdownApnsProviders();
    server.close(async () => {
      try {
        await configStore.close();
        await nonceStore.close();
        await prisma.$disconnect();
      } catch (error) {
        logError('Failed to close nonce store', error);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  logError('Failed to start server', error);
  process.exit(1);
});
