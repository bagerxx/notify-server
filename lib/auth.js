import * as crypto from 'crypto';
import { unauthorized, badRequest } from './http-errors.js';

function getAppId(req) {
  if (req.body && typeof req.body.appId === 'string') {
    return req.body.appId.trim();
  }
  const header = req.headers['x-app-id'];
  if (typeof header === 'string' && header.trim() !== '') {
    return header.trim();
  }
  return null;
}

function getApiKey(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }

  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim() !== '') {
    return apiKey.trim();
  }

  return null;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createAuthMiddleware(store, config) {
  if (!config.requireAuth) {
    return (req, res, next) => next();
  }

  return async (req, res, next) => {
    try {
      const appId = getAppId(req);
      if (!appId) {
        return next(badRequest('appId is required'));
      }

      const apiKey = getApiKey(req);
      if (!apiKey) {
        return next(unauthorized('Missing API key'));
      }

      const expected = await store.getApiSecret(appId);
      if (!expected || !safeEqual(apiKey, expected)) {
        return next(unauthorized('Invalid API key'));
      }

      req.appId = appId;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export {
  createAuthMiddleware,
  getAppId,
};
