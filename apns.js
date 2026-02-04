import apn from 'apn';

const providers = new Map();
const apnsMetricsIntervals = new Map();
const APNS_BATCH_SIZE = 1000;
// Default to a higher per-connection listener cap to avoid http2 "wakeup" warnings during bursts.
const DEFAULT_APNS_MAX_LISTENERS = 75;
const DEFAULT_APNS_METRICS_INTERVAL_MS = 60_000;

function resolveApnsMaxListeners() {
  if (!process.env.APNS_MAX_LISTENERS) {
    return DEFAULT_APNS_MAX_LISTENERS;
  }
  const parsed = Number.parseInt(process.env.APNS_MAX_LISTENERS, 10);
  return Number.isNaN(parsed) ? DEFAULT_APNS_MAX_LISTENERS : parsed;
}

function configureApnsListenerLimits(provider) {
  const endpointManager = provider?.client?.endpointManager;
  if (!endpointManager || endpointManager._listenerLimitConfigured) {
    return;
  }

  const maxListeners = resolveApnsMaxListeners();
  const originalCreateEndpoint = endpointManager.createEndpoint.bind(endpointManager);

  endpointManager.createEndpoint = function createEndpointWithListenerLimit() {
    originalCreateEndpoint();
    const endpoint = this._currentConnection;
    if (!endpoint) {
      return;
    }

    const applyLimit = () => {
      if (endpoint._connection && typeof endpoint._connection.setMaxListeners === 'function') {
        endpoint._connection.setMaxListeners(maxListeners);
      }
    };

    applyLimit();
    endpoint.once('connect', applyLimit);
  };

  endpointManager._listenerLimitConfigured = true;
}

function resolveApnsMetricsInterval() {
  if (!process.env.APNS_LISTENER_METRICS_INTERVAL_MS) {
    return DEFAULT_APNS_METRICS_INTERVAL_MS;
  }
  const parsed = Number.parseInt(process.env.APNS_LISTENER_METRICS_INTERVAL_MS, 10);
  return Number.isNaN(parsed) ? DEFAULT_APNS_METRICS_INTERVAL_MS : parsed;
}

function startApnsListenerMetrics(provider, appId) {
  if (process.env.APNS_LISTENER_METRICS !== 'true') {
    return;
  }
  if (apnsMetricsIntervals.has(appId)) {
    return;
  }
  const endpointManager = provider?.client?.endpointManager;
  if (!endpointManager) {
    return;
  }
  const intervalMs = resolveApnsMetricsInterval();
  const intervalId = setInterval(() => {
    const endpoints = Array.isArray(endpointManager._endpoints) ? endpointManager._endpoints : [];
    const metrics = endpoints.map((endpoint) => {
      const connection = endpoint?._connection;
      if (!connection || typeof connection.listenerCount !== 'function') {
        return null;
      }
      return {
        wakeup: connection.listenerCount('wakeup'),
        error: connection.listenerCount('error'),
        goaway: connection.listenerCount('GOAWAY'),
      };
    }).filter(Boolean);
    console.info('[APNS] listener metrics', {
      appId,
      endpoints: endpoints.length,
      metrics,
    });
  }, intervalMs);
  apnsMetricsIntervals.set(appId, intervalId);
}

function stopApnsListenerMetrics(appId) {
  const intervalId = apnsMetricsIntervals.get(appId);
  if (!intervalId) {
    return;
  }
  clearInterval(intervalId);
  apnsMetricsIntervals.delete(appId);
}

function isInlineApnsKey(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.includes('BEGIN PRIVATE KEY') || trimmed.includes('BEGIN EC PRIVATE KEY');
}

function getApnsProvider(appConfig) {
  if (!appConfig.ios) {
    return null;
  }

  const existing = providers.get(appConfig.appId);
  if (existing) {
    return existing;
  }

  if (!isInlineApnsKey(appConfig.ios.keyPath)) {
    throw new Error('APNs key must be provided inline');
  }
  const key = Buffer.from(appConfig.ios.keyPath, 'utf8');
  const provider = new apn.Provider({
    token: {
      key,
      keyId: appConfig.ios.keyId,
      teamId: appConfig.ios.teamId,
    },
    production: appConfig.ios.production,
  });
  configureApnsListenerLimits(provider);
  startApnsListenerMetrics(provider, appConfig.appId);

  providers.set(appConfig.appId, provider);
  return provider;
}

function invalidateApnsProvider(appId) {
  if (!appId) return;
  const provider = providers.get(appId);
  if (!provider) return;
  try {
    provider.shutdown();
  } catch (error) {
    // ignore shutdown errors
  }
  providers.delete(appId);
  stopApnsListenerMetrics(appId);
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
  for (const intervalId of apnsMetricsIntervals.values()) {
    clearInterval(intervalId);
  }
  apnsMetricsIntervals.clear();
}

export {
  sendApns,
  shutdownApnsProviders,
  invalidateApnsProvider,
};
