import { badRequest } from './http-errors.js';

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 2048;
const MAX_TOKEN_LENGTH = 4096;
const MAX_TOKENS_PER_REQUEST = 500;

function assertString(value, field, { allowEmpty = false, maxLength } = {}) {
  if (typeof value !== 'string') {
    throw badRequest(`Invalid ${field}`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw badRequest(`Missing ${field}`);
  }
  if (maxLength && trimmed.length > maxLength) {
    throw badRequest(`${field} exceeds max length`);
  }
  return trimmed;
}

function assertEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw badRequest(`Invalid ${field}`);
  }
  return value;
}

function normalizeData(data) {
  if (data === undefined) {
    return undefined;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badRequest('data must be an object');
  }

  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw badRequest('data keys must be strings');
    }
    if (value === null || value === undefined) {
      throw badRequest('data values cannot be null');
    }
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = String(value);
    } else {
      throw badRequest('data values must be string, number, or boolean');
    }
  }
  return out;
}

function normalizeNotification(body) {
  const source = body.notification && typeof body.notification === 'object'
    ? body.notification
    : body;

  const title = source.title !== undefined
    ? assertString(source.title, 'notification.title', { allowEmpty: true, maxLength: MAX_TITLE_LENGTH })
    : '';
  const message = source.body !== undefined
    ? assertString(source.body, 'notification.body', { allowEmpty: true, maxLength: MAX_BODY_LENGTH })
    : '';

  return {
    title: title || undefined,
    body: message || undefined,
  };
}

function validateNotify(body) {
  if (!body || typeof body !== 'object') {
    throw badRequest('Invalid request body');
  }

  const appId = assertString(body.appId, 'appId');
  if (body.broadcast) {
    throw badRequest('broadcast is disabled; send tokens instead');
  }

  const platform = assertEnum(body.platform, 'platform', ['ios', 'android']);
  if (body.tokens === undefined) {
    throw badRequest('tokens is required');
  }
  const tokens = normalizeTokens(body.tokens);

  if (tokens.length > MAX_TOKENS_PER_REQUEST) {
    throw badRequest(`tokens cannot exceed ${MAX_TOKENS_PER_REQUEST}`);
  }

  const notification = normalizeNotification(body);
  const data = normalizeData(body.data);

  if (!notification.title && !notification.body && (!data || Object.keys(data).length === 0)) {
    throw badRequest('notification or data payload is required');
  }

  const ttlSeconds = body.ttlSeconds !== undefined ? normalizeTtl(body.ttlSeconds, 'ttlSeconds') : undefined;

  const apns = body.apns ? normalizeApns(body.apns) : undefined;
  const fcm = body.fcm ? normalizeFcm(body.fcm) : undefined;

  return {
    appId,
    platform,
    tokens,
    notification,
    data,
    ttlSeconds,
    apns,
    fcm,
  };
}

function normalizeTokens(tokens) {
  if (!Array.isArray(tokens)) {
    throw badRequest('tokens must be an array');
  }
  const normalized = [];
  const seen = new Set();
  for (const token of tokens) {
    const value = assertString(token, 'token', { maxLength: MAX_TOKEN_LENGTH });
    if (!seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  }
  if (normalized.length === 0) {
    throw badRequest('tokens array cannot be empty');
  }
  return normalized;
}

function normalizeTtl(value, field) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw badRequest(`Invalid ${field}`);
  }
  return Math.floor(value);
}

function normalizeApns(apns) {
  if (!apns || typeof apns !== 'object' || Array.isArray(apns)) {
    throw badRequest('apns must be an object');
  }

  const normalized = {};
  if (apns.topic) {
    normalized.topic = assertString(apns.topic, 'apns.topic');
  }
  if (apns.pushType) {
    normalized.pushType = assertString(apns.pushType, 'apns.pushType');
  }
  if (apns.sound !== undefined) {
    normalized.sound = assertString(apns.sound, 'apns.sound', { allowEmpty: true });
  }
  if (apns.badge !== undefined) {
    if (typeof apns.badge !== 'number' || !Number.isInteger(apns.badge)) {
      throw badRequest('apns.badge must be an integer');
    }
    normalized.badge = apns.badge;
  }
  if (apns.category) {
    normalized.category = assertString(apns.category, 'apns.category');
  }
  if (apns.threadId) {
    normalized.threadId = assertString(apns.threadId, 'apns.threadId');
  }
  if (apns.mutableContent !== undefined) {
    normalized.mutableContent = Boolean(apns.mutableContent);
  }
  if (apns.contentAvailable !== undefined) {
    normalized.contentAvailable = Boolean(apns.contentAvailable);
  }
  if (apns.ttlSeconds !== undefined) {
    normalized.ttlSeconds = normalizeTtl(apns.ttlSeconds, 'apns.ttlSeconds');
  }

  return normalized;
}

function normalizeFcm(fcm) {
  if (!fcm || typeof fcm !== 'object' || Array.isArray(fcm)) {
    throw badRequest('fcm must be an object');
  }

  const normalized = {};
  if (fcm.priority) {
    const priority = assertString(fcm.priority, 'fcm.priority');
    if (!['high', 'normal'].includes(priority)) {
      throw badRequest('fcm.priority must be high or normal');
    }
    normalized.priority = priority;
  }
  if (fcm.collapseKey) {
    normalized.collapseKey = assertString(fcm.collapseKey, 'fcm.collapseKey');
  }
  if (fcm.ttlSeconds !== undefined) {
    normalized.ttlSeconds = normalizeTtl(fcm.ttlSeconds, 'fcm.ttlSeconds');
  }

  return normalized;
}

export {
  validateNotify,
};
