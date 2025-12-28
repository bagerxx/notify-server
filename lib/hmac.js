import * as crypto from 'crypto';
import { badRequest, unauthorized } from './http-errors.js';
import { getAppId } from './auth.js';

const MAX_NONCE_LENGTH = 128;

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

function createHmacMiddleware(store, config, nonceStore) {
  if (!config.requireHmac) {
    return (req, res, next) => next();
  }

  return async (req, res, next) => {
    try {
      const appId = req.appId || getAppId(req);
      if (!appId) {
        return next(badRequest('appId is required for HMAC'));
      }

      const timestampRaw = req.headers['x-timestamp'];
      const nonce = req.headers['x-nonce'];
      const signature = req.headers['x-signature'];

      if (typeof timestampRaw !== 'string' || timestampRaw.trim() === '') {
        return next(unauthorized('Missing x-timestamp'));
      }
      if (typeof nonce !== 'string' || nonce.trim() === '') {
        return next(unauthorized('Missing x-nonce'));
      }
      if (typeof signature !== 'string' || signature.trim() === '') {
        return next(unauthorized('Missing x-signature'));
      }

      const timestamp = Number.parseInt(timestampRaw, 10);
      if (Number.isNaN(timestamp)) {
        return next(unauthorized('Invalid x-timestamp'));
      }
      const trimmedNonce = nonce.trim();
      if (trimmedNonce.length > MAX_NONCE_LENGTH) {
        return next(unauthorized('Invalid x-nonce'));
      }

      const now = Date.now();
      if (Math.abs(now - timestamp) > config.hmacWindowMs) {
        return next(unauthorized('Signature timestamp is outside allowed window'));
      }

      const secret = await store.getApiSecret(appId);
      if (!secret) {
        return next(unauthorized('Invalid appId'));
      }

      const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
      const canonical = [req.method.toUpperCase(), req.path, String(timestamp), trimmedNonce, rawBody].join('\n');
      const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

      if (!safeEqual(signature.trim(), expected)) {
        return next(unauthorized('Invalid signature'));
      }

      const expiresAt = timestamp + config.hmacWindowMs;
      const accepted = await nonceStore.consumeNonce(appId, trimmedNonce, now, expiresAt);
      if (!accepted) {
        return next(unauthorized('Nonce already used'));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export {
  createHmacMiddleware,
};
