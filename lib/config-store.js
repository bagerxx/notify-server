import * as crypto from 'crypto';
import { hashPassword } from './passwords.js';

const ADMIN_PATH_KEY = 'admin_path';
const ADMIN_SESSION_SECRET_KEY = 'admin_session_secret';

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function normalizeAdminPath(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const cleaned = withSlash.replace(/\/+$/, '');
  if (!cleaned || cleaned === '/') {
    throw new Error('ADMIN_BASE_PATH must not be empty');
  }
  if (/\s/.test(cleaned)) {
    throw new Error('ADMIN_BASE_PATH must not contain whitespace');
  }
  return cleaned;
}

function isWeakAdminPath(adminPath) {
  if (!adminPath) return true;
  const sample = adminPath.toLowerCase();
  if (adminPath.length < 12) return true;
  return ['admin', 'panel', 'manage', 'sys'].some((word) => sample.includes(word));
}

class ConfigStore {
  constructor({ prisma }) {
    this.prisma = prisma;
  }

  async init() {
    await this.prisma.$connect();
  }

  async close() {
    // Prisma client lifecycle is managed by the caller.
  }

  async getSetting(key) {
    const row = await this.prisma.adminSetting.findUnique({ where: { key } });
    return row ? row.value : null;
  }

  async setSetting(key, value) {
    await this.prisma.adminSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async ensureAdminSettings({ adminBasePath, adminSessionSecret }) {
    const existingPath = await this.getSetting(ADMIN_PATH_KEY);
    let adminPath = existingPath;
    let adminPathGenerated = false;

    if (!adminPath) {
      const normalized = normalizeAdminPath(adminBasePath);
      adminPath = normalized || `/${randomToken(10)}`;
      await this.setSetting(ADMIN_PATH_KEY, adminPath);
      adminPathGenerated = true;
    }

    const existingSecret = await this.getSetting(ADMIN_SESSION_SECRET_KEY);
    let sessionSecret = existingSecret;
    let sessionSecretGenerated = false;

    if (!sessionSecret) {
      sessionSecret = (adminSessionSecret && adminSessionSecret.trim()) || randomToken(32);
      await this.setSetting(ADMIN_SESSION_SECRET_KEY, sessionSecret);
      sessionSecretGenerated = !adminSessionSecret;
    }

    return {
      adminPath,
      sessionSecret,
      adminPathGenerated,
      sessionSecretGenerated,
      weakAdminPath: isWeakAdminPath(adminPath),
    };
  }

  async ensureAdminUser({ username, password }) {
    const existing = await this.prisma.adminUser.findFirst({ select: { id: true } });
    if (existing) {
      return { created: false };
    }

    const adminUsername = (username && username.trim()) || 'admin';
    let adminPassword = password && password.trim();
    let generatedPassword = false;

    if (!adminPassword) {
      adminPassword = randomToken(12);
      generatedPassword = true;
    }

    const now = new Date();
    const passwordHash = hashPassword(adminPassword);
    await this.prisma.adminUser.create({
      data: {
        username: adminUsername,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    });

    return {
      created: true,
      username: adminUsername,
      password: generatedPassword ? adminPassword : null,
      generatedPassword,
    };
  }

  async getAdminByUsername(username) {
    if (!username) return null;
    const user = await this.prisma.adminUser.findUnique({
      where: { username },
      select: { id: true, username: true, passwordHash: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      password_hash: user.passwordHash,
    };
  }

  async updateAdminPassword(username, passwordHash) {
    const now = new Date();
    await this.prisma.adminUser.update({
      where: { username },
      data: { passwordHash, updatedAt: now },
    });
  }

  async listApps() {
    const rows = await this.prisma.app.findMany({
      orderBy: { appId: 'asc' },
      select: {
        appId: true,
        displayName: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        ios: { select: { appId: true } },
        android: { select: { appId: true } },
      },
    });

    return rows.map((row) => ({
      appId: row.appId,
      displayName: row.displayName,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      iosConfigured: Boolean(row.ios),
      androidConfigured: Boolean(row.android),
    }));
  }

  async getApp(appId) {
    const app = await this.prisma.app.findUnique({
      where: { appId },
      include: { ios: true, android: true },
    });

    if (!app) return null;

    const ios = app.ios
      ? {
        bundleId: app.ios.bundleId,
        teamId: app.ios.teamId,
        keyId: app.ios.keyId,
        keyPath: app.ios.keyPath,
        production: app.ios.production,
        createdAt: app.ios.createdAt,
        updatedAt: app.ios.updatedAt,
      }
      : null;

    const android = app.android
      ? {
        serviceAccountPath: app.android.serviceAccountPath,
        createdAt: app.android.createdAt,
        updatedAt: app.android.updatedAt,
      }
      : null;

    return {
      appId: app.appId,
      displayName: app.displayName,
      apiSecret: app.apiSecret,
      enabled: app.enabled,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      ios,
      android,
    };
  }

  async getAppConfig(appId) {
    const app = await this.getApp(appId);
    if (!app || !app.enabled) {
      return null;
    }
    const ios = app.ios ? { ...app.ios } : null;
    const android = app.android ? { ...app.android } : null;

    return {
      appId: app.appId,
      displayName: app.displayName,
      ios: ios && this.isInlineKeyValue(ios.keyPath) ? ios : null,
      android: android && this.isInlineKeyValue(android.serviceAccountPath) ? android : null,
    };
  }

  async getApiSecret(appId) {
    const row = await this.prisma.app.findUnique({
      where: { appId },
      select: { apiSecret: true, enabled: true },
    });
    return row && row.enabled ? row.apiSecret : null;
  }

  async createApp({ appId, displayName }) {
    const existing = await this.prisma.app.findUnique({ where: { appId }, select: { appId: true } });
    if (existing) {
      throw new Error('appId already exists');
    }

    const now = new Date();
    const apiSecret = randomToken(32);
    const name = displayName && displayName.trim() ? displayName.trim() : appId;

    await this.prisma.app.create({
      data: {
        appId,
        displayName: name,
        apiSecret,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    return {
      appId,
      displayName: name,
      apiSecret,
    };
  }

  async updateApp(appId, { displayName, enabled }) {
    const updates = {};
    if (displayName !== undefined) {
      updates.displayName = displayName;
    }
    if (enabled !== undefined) {
      updates.enabled = enabled;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    updates.updatedAt = new Date();
    await this.prisma.app.update({
      where: { appId },
      data: updates,
    });
  }

  async rotateSecret(appId) {
    const apiSecret = randomToken(32);
    const now = new Date();
    await this.prisma.app.update({
      where: { appId },
      data: { apiSecret, updatedAt: now },
    });
    return apiSecret;
  }

  async upsertIosConfig(appId, ios) {
    const now = new Date();
    await this.prisma.appIos.upsert({
      where: { appId },
      update: {
        bundleId: ios.bundleId,
        teamId: ios.teamId,
        keyId: ios.keyId,
        keyPath: ios.keyPath,
        production: ios.production,
        updatedAt: now,
      },
      create: {
        appId,
        bundleId: ios.bundleId,
        teamId: ios.teamId,
        keyId: ios.keyId,
        keyPath: ios.keyPath,
        production: ios.production,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async deleteIosConfig(appId) {
    await this.prisma.appIos.deleteMany({ where: { appId } });
  }

  async upsertAndroidConfig(appId, android) {
    const now = new Date();
    await this.prisma.appAndroid.upsert({
      where: { appId },
      update: {
        serviceAccountPath: android.serviceAccountPath,
        updatedAt: now,
      },
      create: {
        appId,
        serviceAccountPath: android.serviceAccountPath,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async deleteAndroidConfig(appId) {
    await this.prisma.appAndroid.deleteMany({ where: { appId } });
  }

  isInlineKeyValue(value) {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('{')) return true;
    if (trimmed.includes('BEGIN PRIVATE KEY')) return true;
    if (trimmed.includes('BEGIN EC PRIVATE KEY')) return true;
    return false;
  }
}

export {
  ConfigStore,
  normalizeAdminPath,
  isWeakAdminPath,
};
