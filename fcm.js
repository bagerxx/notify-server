import admin from 'firebase-admin';

const messagingCache = new Map();
const FCM_BATCH_SIZE = 500;
const MAX_FCM_ERROR_DETAILS = 50;

function isInlineServiceAccount(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('{');
}

function getMessaging(appConfig) {
  if (!appConfig.android) {
    return null;
  }

  const existing = messagingCache.get(appConfig.appId);
  if (existing) {
    return existing;
  }

  const existingApp = admin.apps.find((app) => app.name === appConfig.appId);
  if (existingApp) {
    const messaging = existingApp.messaging();
    messagingCache.set(appConfig.appId, messaging);
    return messaging;
  }

  if (!isInlineServiceAccount(appConfig.android.serviceAccountPath)) {
    throw new Error('FCM service account must be provided inline');
  }
  const serviceAccount = JSON.parse(appConfig.android.serviceAccountPath);
  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    appConfig.appId
  );

  const messaging = app.messaging();
  messagingCache.set(appConfig.appId, messaging);
  return messaging;
}

async function invalidateFcmMessaging(appId) {
  if (!appId) return;
  messagingCache.delete(appId);
  const existingApp = admin.apps.find((app) => app.name === appId);
  if (!existingApp) return;
  try {
    await existingApp.delete();
  } catch (error) {
    // ignore delete errors
  }
}

function buildMessage(payload, tokens) {
  const message = { tokens };

  if (payload.notification && (payload.notification.title || payload.notification.body)) {
    message.notification = {
      title: payload.notification.title,
      body: payload.notification.body,
    };
  }

  if (payload.data && Object.keys(payload.data).length > 0) {
    message.data = payload.data;
  }

  const android = {};
  const ttlSeconds = payload.fcm && payload.fcm.ttlSeconds !== undefined
    ? payload.fcm.ttlSeconds
    : payload.ttlSeconds;

  if (ttlSeconds !== undefined) {
    android.ttl = ttlSeconds * 1000;
  }
  if (payload.fcm && payload.fcm.priority) {
    android.priority = payload.fcm.priority;
  }
  if (payload.fcm && payload.fcm.collapseKey) {
    android.collapseKey = payload.fcm.collapseKey;
  }

  if (Object.keys(android).length > 0) {
    message.android = android;
  }

  return message;
}

function chunkTokens(tokens, size) {
  const chunks = [];
  for (let i = 0; i < tokens.length; i += size) {
    chunks.push(tokens.slice(i, i + size));
  }
  return chunks;
}

function isInvalidFcmError(error) {
  if (!error || typeof error.code !== 'string') {
    return false;
  }
  return [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ].includes(error.code);
}

function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  if (token.length <= 10) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function sendFcm(appConfig, deviceTokens, payload) {
  if (!appConfig.android) {
    throw new Error(`FCM not configured for app ${appConfig.appId}`);
  }

  const tokens = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const messaging = getMessaging(appConfig);
  const batches = chunkTokens(tokens, FCM_BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  const invalidTokens = [];
  const errors = [];

  for (const batch of batches) {
    const message = buildMessage(payload, batch);
    const response = await messaging.sendEachForMulticast(message);

    sent += response.successCount;
    failed += response.failureCount;

    response.responses.forEach((resp, index) => {
      if (!resp.success) {
        if (isInvalidFcmError(resp.error)) {
          invalidTokens.push(batch[index]);
        }
        if (errors.length < MAX_FCM_ERROR_DETAILS) {
          errors.push({
            token: maskToken(batch[index]),
            code: resp.error && resp.error.code ? resp.error.code : null,
            message: resp.error && resp.error.message ? resp.error.message : null,
          });
        }
      }
    });
  }

  return {
    sent,
    failed,
    invalidTokens,
    errors,
  };
}

export {
  sendFcm,
  invalidateFcmMessaging,
};
