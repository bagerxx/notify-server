import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

function normalizeBaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.endsWith('/') ? withScheme.slice(0, -1) : withScheme;
}

function normalizeSecret(appSecret, appId) {
  if (!appSecret) return '';
  if (appId && appSecret.startsWith(`${appId}:`)) {
    return appSecret.slice(appId.length + 1);
  }
  return appSecret;
}

function buildSignature({ method, path, timestamp, nonce, body, secret }) {
  const canonical = [method.toUpperCase(), path, String(timestamp), nonce, body].join('\n');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function requestJson({ url, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (_) {
            parsed = null;
          }
          resolve({ status: res.statusCode || 0, data: parsed, raw });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Notify request timeout'));
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function createNotifyClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.NOTIFY_SERVER_URL || '');
  const appId = options.appId || process.env.NOTIFY_APP_ID || '';
  const appSecret = normalizeSecret(
    options.appSecret || process.env.NOTIFY_APP_SECRET || '',
    appId
  );
  const requireAuth = options.requireAuth !== undefined
    ? Boolean(options.requireAuth)
    : process.env.NOTIFY_REQUIRE_AUTH === 'true';
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : Number.parseInt(process.env.NOTIFY_TIMEOUT_MS || '10000', 10);

  if (!baseUrl) {
    throw new Error('NOTIFY_SERVER_URL is required');
  }
  if (!appId || !appSecret) {
    throw new Error('NOTIFY_APP_ID and NOTIFY_APP_SECRET are required');
  }

  async function send({ platform, tokens, title, body, data, ttlSeconds, apns, fcm }) {
    if (!platform || !['ios', 'android'].includes(platform)) {
      throw new Error('platform must be ios or android');
    }
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('tokens must be a non-empty array');
    }

    // Extra options are reserved for future use.
    void data;
    void ttlSeconds;
    void apns;
    void fcm;

    const payload = {
      appId,
      platform,
      tokens,
      notification: { title, body },
    };

    const rawBody = JSON.stringify(payload);
    const path = '/v1/notify';
    const timestamp = Date.now().toString();
    const nonce = crypto.randomUUID();
    const signature = buildSignature({
      method: 'POST',
      path,
      timestamp,
      nonce,
      body: rawBody,
      secret: appSecret,
    });

    const headers = {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': signature,
    };
    if (requireAuth) {
      headers.authorization = `Bearer ${appSecret}`;
    }

    const response = await requestJson({
      url: `${baseUrl}${path}`,
      method: 'POST',
      headers,
      body: rawBody,
      timeoutMs: Number.isNaN(timeoutMs) ? 10000 : timeoutMs,
    });

    if (response.status >= 200 && response.status < 300) {
      return { success: true, data: response.data };
    }

    const message = response.data && response.data.error && response.data.error.message
      ? response.data.error.message
      : `Notify server error (${response.status})`;
    return {
      success: false,
      status: response.status,
      message,
      data: response.data,
    };
  }

  return { send };
}

export {
  createNotifyClient,
};
