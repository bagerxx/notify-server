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

// Reduce apn/http2 listener warnings during burst sends.
setMaxListeners(30);

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

async function start() {
  const config = loadConfig();
  const configStore = new ConfigStore({
    databasePath: config.configDbPath,
  });
  await configStore.init();

  const adminSettings = await configStore.ensureAdminSettings({
    adminBasePath: config.adminBasePath,
    adminSessionSecret: config.adminSessionSecret,
  });
  if (adminSettings.adminPathGenerated) {
    console.log(`Admin path generated: ${adminSettings.adminPath}`);
  }
  if (adminSettings.weakAdminPath) {
    console.warn('Admin path looks predictable. Set ADMIN_BASE_PATH to a stronger value.');
  }

  const adminUser = await configStore.ensureAdminUser({
    username: config.adminBootstrapUser,
    password: config.adminBootstrapPassword,
  });
  if (adminUser.created) {
    console.log(`Admin user created: ${adminUser.username}`);
    if (adminUser.generatedPassword) {
      console.log(`Admin password generated: ${adminUser.password}`);
    }
  }

  const nonceStore = new NonceStore(config.databasePath);
  await nonceStore.init();

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
    const input = validateNotify(req.body);
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

    if (input.platform === 'ios') {
      assertPlatformConfigured(appConfig, 'ios');

      const iosTokens = input.tokens;
      const apnsResult = await sendApns(appConfig, iosTokens, payload);

      results.ios = {
        requested: iosTokens.length,
        sent: apnsResult.sent,
        failed: apnsResult.failed,
        invalidTokens: apnsResult.invalidTokens,
      };
    }

    if (input.platform === 'android') {
      assertPlatformConfigured(appConfig, 'android');

      const androidTokens = input.tokens;
      const fcmResult = await sendFcm(appConfig, androidTokens, payload);

      results.android = {
        requested: androidTokens.length,
        sent: fcmResult.sent,
        failed: fcmResult.failed,
        invalidTokens: fcmResult.invalidTokens,
      };
    }

    res.json({
      ok: true,
      appId: input.appId,
      results,
    });
  }));

  app.use((err, req, res, next) => {
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

    console.error('Unhandled error', err);
    return res.status(500).json({ ok: false, error: { message: 'Internal server error' } });
  });

  const server = app.listen(config.port, () => {
    console.log(`Notify server listening on port ${config.port}`);
  });

  const shutdown = () => {
    console.log('Shutting down');
    shutdownApnsProviders();
    server.close(async () => {
      try {
        await configStore.close();
        await nonceStore.close();
      } catch (error) {
        console.error('Failed to close nonce store', error);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
