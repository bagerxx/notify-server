import { connect, constants as http2Constants } from 'http2';
import { createHash, createPrivateKey, sign as signJwt } from 'crypto';

const APNS_PRODUCTION_ORIGIN = 'https://api.push.apple.com';
const APNS_SANDBOX_ORIGIN = 'https://api.sandbox.push.apple.com';
const APNS_SEND_CONCURRENCY = 20;
const APNS_REQUEST_TIMEOUT_MS = 15_000;
const APNS_TOKEN_TTL_SECONDS = 50 * 60;
const MAX_APNS_ERROR_DETAILS = 50;

const apnsClients = new Map();
const sendQueues = new Map();

function isInlineApnsKey(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.includes('BEGIN PRIVATE KEY') || trimmed.includes('BEGIN EC PRIVATE KEY');
}

function normalizeApnsKey(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return trimmed.replace(/\\n/g, '\n');
}

function keyFingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function buildClientSignature(appConfig) {
  const ios = appConfig.ios || {};
  const keyValue = normalizeApnsKey(ios.keyPath || '');
  return [
    appConfig.appId || '',
    ios.bundleId || '',
    ios.teamId || '',
    ios.keyId || '',
    ios.production ? 'prod' : 'sandbox',
    keyFingerprint(keyValue),
  ].join('|');
}

function closeSession(session) {
  if (!session) return;
  try {
    session.close();
  } catch (error) {
    // ignore close errors
  }
  if (!session.closed && !session.destroyed) {
    const timeout = setTimeout(() => {
      if (!session.closed && !session.destroyed) {
        try {
          session.destroy();
        } catch (error) {
          // ignore destroy errors
        }
      }
    }, 1000);
    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }
  }
}

function closeClient(client) {
  if (!client) return;
  closeSession(client.session);
  client.session = null;
  client.jwtToken = null;
  client.jwtExpiresAt = 0;
}

function createApnsClient(appConfig) {
  if (!appConfig.ios) {
    return null;
  }

  if (!isInlineApnsKey(appConfig.ios.keyPath)) {
    throw new Error('APNs key must be provided inline');
  }

  const keyValue = normalizeApnsKey(appConfig.ios.keyPath);
  const privateKey = createPrivateKey({ key: keyValue, format: 'pem' });

  return {
    appId: appConfig.appId,
    signature: buildClientSignature(appConfig),
    origin: appConfig.ios.production ? APNS_PRODUCTION_ORIGIN : APNS_SANDBOX_ORIGIN,
    bundleId: appConfig.ios.bundleId,
    keyId: appConfig.ios.keyId,
    teamId: appConfig.ios.teamId,
    privateKey,
    session: null,
    jwtToken: null,
    jwtExpiresAt: 0,
  };
}

function getApnsClient(appConfig) {
  if (!appConfig || !appConfig.ios) {
    return null;
  }

  const signature = buildClientSignature(appConfig);
  const existing = apnsClients.get(appConfig.appId);
  if (existing && existing.signature === signature) {
    return existing;
  }

  if (existing) {
    closeClient(existing);
    apnsClients.delete(appConfig.appId);
  }

  const created = createApnsClient(appConfig);
  apnsClients.set(appConfig.appId, created);
  return created;
}

function ensureSession(client) {
  if (client.session && !client.session.closed && !client.session.destroyed) {
    return client.session;
  }

  const session = connect(client.origin);
  const detach = () => {
    if (client.session === session) {
      closeSession(session);
      client.session = null;
    }
  };

  session.on('error', detach);
  session.on('goaway', detach);
  session.on('frameError', detach);
  session.on('close', () => {
    if (client.session === session) {
      client.session = null;
    }
  });

  client.session = session;
  return session;
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getBearerToken(client) {
  const now = Math.floor(Date.now() / 1000);
  if (client.jwtToken && client.jwtExpiresAt - 60 > now) {
    return client.jwtToken;
  }

  const header = base64Url(JSON.stringify({
    alg: 'ES256',
    kid: client.keyId,
  }));
  const payload = base64Url(JSON.stringify({
    iss: client.teamId,
    iat: now,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = signJwt('sha256', Buffer.from(unsigned, 'utf8'), {
    key: client.privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  client.jwtToken = `${unsigned}.${base64Url(signature)}`;
  client.jwtExpiresAt = now + APNS_TOKEN_TTL_SECONDS;
  return client.jwtToken;
}

function buildApnsRequest(payload, appConfig) {
  const hasAlert = Boolean(payload.notification && (payload.notification.title || payload.notification.body));

  const topic = (payload.apns && payload.apns.topic) || appConfig.ios.bundleId;
  const pushType = (payload.apns && payload.apns.pushType)
    || (payload.apns && payload.apns.contentAvailable && !hasAlert ? 'background' : 'alert');

  const aps = {};
  if (hasAlert) {
    const alert = {};
    if (payload.notification && payload.notification.title) {
      alert.title = payload.notification.title;
    }
    if (payload.notification && payload.notification.body) {
      alert.body = payload.notification.body;
    }
    aps.alert = alert;
  }

  if (payload.apns && payload.apns.sound !== undefined) {
    aps.sound = payload.apns.sound;
  } else if (hasAlert) {
    aps.sound = 'default';
  }

  if (payload.apns && payload.apns.badge !== undefined) {
    aps.badge = payload.apns.badge;
  }
  if (payload.apns && payload.apns.category) {
    aps.category = payload.apns.category;
  }
  if (payload.apns && payload.apns.threadId) {
    aps['thread-id'] = payload.apns.threadId;
  }
  if (payload.apns && payload.apns.mutableContent) {
    aps['mutable-content'] = 1;
  }
  if (payload.apns && payload.apns.contentAvailable) {
    aps['content-available'] = 1;
  }

  const ttlSeconds = (payload.apns && payload.apns.ttlSeconds !== undefined)
    ? payload.apns.ttlSeconds
    : payload.ttlSeconds;
  const expiry = Math.floor(Date.now() / 1000) + (ttlSeconds !== undefined ? ttlSeconds : 3600);
  const priority = pushType === 'background' ? 5 : 10;

  const body = JSON.stringify({
    ...(payload.data || {}),
    aps,
  });

  return {
    topic,
    pushType,
    priority: String(priority),
    expiry: String(expiry),
    body,
  };
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function isInvalidApnsFailure(failure) {
  const status = failure.status;
  const reason = failure.reason;

  if (status === 410) {
    return true;
  }

  if (reason && ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
    return true;
  }

  return false;
}

function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  if (token.length <= 10) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function enqueueApnsSend(appId, task) {
  const previous = sendQueues.get(appId) || Promise.resolve();
  const next = previous
    .catch(() => {
      // Keep queue chain alive after a failed send.
    })
    .then(task);

  sendQueues.set(appId, next);
  try {
    return await next;
  } finally {
    if (sendQueues.get(appId) === next) {
      sendQueues.delete(appId);
    }
  }
}

function sendToToken(session, headers, body) {
  return new Promise((resolve) => {
    let done = false;
    let responseStatus = null;
    let responseBody = '';

    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    let stream;
    try {
      stream = session.request(headers);
    } catch (error) {
      finish({ ok: false, status: null, reason: null, error: String(error) });
      return;
    }

    stream.setEncoding('utf8');
    stream.setTimeout(APNS_REQUEST_TIMEOUT_MS, () => {
      try {
        stream.close(http2Constants.NGHTTP2_CANCEL);
      } catch (error) {
        // ignore close errors
      }
      finish({ ok: false, status: null, reason: null, error: 'APNs request timeout' });
    });

    stream.on('response', (responseHeaders) => {
      const status = responseHeaders[':status'];
      responseStatus = typeof status === 'number' ? status : Number(status);
    });

    stream.on('data', (chunkValue) => {
      responseBody += chunkValue;
    });

    stream.on('error', (error) => {
      finish({
        ok: false,
        status: Number.isFinite(responseStatus) ? responseStatus : null,
        reason: null,
        error: String(error),
      });
    });

    stream.on('end', () => {
      if (responseStatus === 200) {
        finish({ ok: true, status: 200, reason: null, error: null });
        return;
      }

      let reason = null;
      if (responseBody) {
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed && typeof parsed.reason === 'string') {
            reason = parsed.reason;
          }
        } catch (error) {
          // ignore parse errors
        }
      }

      finish({
        ok: false,
        status: Number.isFinite(responseStatus) ? responseStatus : null,
        reason,
        error: null,
      });
    });

    stream.end(body);
  });
}

async function sendWithRetry(client, token, requestTemplate) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const bearer = getBearerToken(client);
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${bearer}`,
      'apns-topic': requestTemplate.topic,
      'apns-push-type': requestTemplate.pushType,
      'apns-priority': requestTemplate.priority,
      'apns-expiration': requestTemplate.expiry,
      'content-type': 'application/json',
    };

    let session;
    try {
      session = ensureSession(client);
    } catch (error) {
      if (attempt === maxAttempts) {
        return { ok: false, status: null, reason: null, error: String(error) };
      }
      continue;
    }

    const result = await sendToToken(session, headers, requestTemplate.body);
    if (result.ok) {
      return result;
    }

    if (result.status === 403 && result.reason === 'ExpiredProviderToken' && attempt < maxAttempts) {
      client.jwtToken = null;
      client.jwtExpiresAt = 0;
      continue;
    }

    if (result.error && attempt < maxAttempts) {
      closeSession(session);
      if (client.session === session) {
        client.session = null;
      }
      continue;
    }

    return result;
  }

  return { ok: false, status: null, reason: null, error: 'APNs send failed' };
}

async function sendApns(appConfig, deviceTokens, payload) {
  if (!appConfig.ios) {
    throw new Error(`APNs not configured for app ${appConfig.appId}`);
  }

  const tokens = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  return enqueueApnsSend(appConfig.appId, async () => {
    const client = getApnsClient(appConfig);
    const requestTemplate = buildApnsRequest(payload, appConfig);
    const tokenChunks = chunk(tokens, APNS_SEND_CONCURRENCY);

    let sent = 0;
    let failed = 0;
    const invalidTokens = [];
    const errors = [];

    for (const tokenChunk of tokenChunks) {
      const results = await Promise.all(tokenChunk.map(async (token) => ({
        token,
        result: await sendWithRetry(client, token, requestTemplate),
      })));

      for (const item of results) {
        const { token, result } = item;
        if (result.ok) {
          sent += 1;
          continue;
        }

        failed += 1;
        if (isInvalidApnsFailure(result)) {
          invalidTokens.push(token);
        }
        if (errors.length < MAX_APNS_ERROR_DETAILS) {
          errors.push({
            device: maskToken(token),
            status: result.status,
            reason: result.reason,
            error: result.error,
          });
        }
      }
    }

    return {
      sent,
      failed,
      invalidTokens,
      errors,
    };
  });
}

function invalidateApnsProvider(appId) {
  if (!appId) return;
  const client = apnsClients.get(appId);
  if (!client) return;
  closeClient(client);
  apnsClients.delete(appId);
  sendQueues.delete(appId);
}

function shutdownApnsProviders() {
  for (const client of apnsClients.values()) {
    closeClient(client);
  }
  apnsClients.clear();
  sendQueues.clear();
}

export {
  sendApns,
  shutdownApnsProviders,
  invalidateApnsProvider,
};
