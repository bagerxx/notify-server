import apn from 'apn';
import fs from 'fs';

const providers = new Map();
const APNS_BATCH_SIZE = 1000;

function getApnsProvider(appConfig) {
  if (!appConfig.ios) {
    return null;
  }

  const existing = providers.get(appConfig.appId);
  if (existing) {
    return existing;
  }

  const key = fs.readFileSync(appConfig.ios.keyPath);
  const provider = new apn.Provider({
    token: {
      key,
      keyId: appConfig.ios.keyId,
      teamId: appConfig.ios.teamId,
    },
    production: appConfig.ios.production,
  });

  providers.set(appConfig.appId, provider);
  return provider;
}

function buildNotification(payload, appConfig) {
  const note = new apn.Notification();
  const hasAlert = Boolean(payload.notification && (payload.notification.title || payload.notification.body));

  note.topic = (payload.apns && payload.apns.topic) || appConfig.ios.bundleId;
  if (hasAlert) {
    note.alert = {
      title: payload.notification.title,
      body: payload.notification.body,
    };
  }

  note.payload = payload.data || {};

  const pushType = (payload.apns && payload.apns.pushType)
    || (payload.apns && payload.apns.contentAvailable && !hasAlert ? 'background' : 'alert');
  note.pushType = pushType;

  if (payload.apns && payload.apns.sound !== undefined) {
    note.sound = payload.apns.sound;
  } else if (hasAlert) {
    note.sound = 'default';
  }

  if (payload.apns && payload.apns.badge !== undefined) {
    note.badge = payload.apns.badge;
  }
  if (payload.apns && payload.apns.category) {
    note.category = payload.apns.category;
  }
  if (payload.apns && payload.apns.threadId) {
    note.threadId = payload.apns.threadId;
  }
  if (payload.apns && payload.apns.mutableContent) {
    note.mutableContent = 1;
  }
  if (payload.apns && payload.apns.contentAvailable) {
    note.contentAvailable = 1;
  }

  const ttlSeconds = (payload.apns && payload.apns.ttlSeconds !== undefined)
    ? payload.apns.ttlSeconds
    : payload.ttlSeconds;

  note.expiry = Math.floor(Date.now() / 1000) + (ttlSeconds !== undefined ? ttlSeconds : 3600);
  note.priority = pushType === 'background' ? 5 : 10;

  return note;
}

function chunkTokens(tokens, size) {
  const chunks = [];
  for (let i = 0; i < tokens.length; i += size) {
    chunks.push(tokens.slice(i, i + size));
  }
  return chunks;
}

function isInvalidApnsFailure(failure) {
  const status = failure.status;
  const reason = failure.response && failure.response.reason;

  if (status === 410) {
    return true;
  }

  if (reason && ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
    return true;
  }

  return false;
}

async function sendApns(appConfig, deviceTokens, payload) {
  if (!appConfig.ios) {
    throw new Error(`APNs not configured for app ${appConfig.appId}`);
  }

  const tokens = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const provider = getApnsProvider(appConfig);
  const note = buildNotification(payload, appConfig);
  const batches = chunkTokens(tokens, APNS_BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  const invalidTokens = [];

  for (const batch of batches) {
    const result = await provider.send(note, batch);
    sent += result.sent.length;
    failed += result.failed.length;

    for (const failure of result.failed) {
      if (isInvalidApnsFailure(failure)) {
        invalidTokens.push(failure.device);
      }
    }
  }

  return {
    sent,
    failed,
    invalidTokens,
  };
}

function shutdownApnsProviders() {
  for (const provider of providers.values()) {
    try {
      provider.shutdown();
    } catch (error) {
      // ignore shutdown errors
    }
  }
  providers.clear();
}

export {
  sendApns,
  shutdownApnsProviders,
};
