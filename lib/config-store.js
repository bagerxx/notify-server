import * as crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
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
  constructor(databasePath) {
    this.databasePath = databasePath;
    this.db = null;
  }

  async init() {
    await fs.promises.mkdir(path.dirname(this.databasePath), { recursive: true });

    this.db = await open({
      filename: this.databasePath,
      driver: sqlite3.Database,
    });

    await this.db.exec('PRAGMA journal_mode = WAL;');
    await this.db.exec('PRAGMA foreign_keys = ON;');

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        app_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        api_secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_ios (
        app_id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        key_path TEXT NOT NULL,
        production INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(app_id) REFERENCES apps(app_id) ON DELETE CASCADE
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_android (
        app_id TEXT PRIMARY KEY,
        service_account_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(app_id) REFERENCES apps(app_id) ON DELETE CASCADE
      );
    `);

    await this.db.exec(`
      UPDATE app_ios
      SET bundle_id = app_id
      WHERE bundle_id IS NULL OR bundle_id != app_id
    `);
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async getSetting(key) {
    const row = await this.db.get('SELECT value FROM admin_settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async setSetting(key, value) {
    await this.db.run(
      `
      INSERT INTO admin_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
      [key, value]
    );
  }

  async ensureAdminSettings({ adminBasePath, adminSessionSecret }) {
    const existingPath = await this.getSetting(ADMIN_PATH_KEY);
    let adminPath = existingPath;
    let adminPathGenerated = false;

    if (!adminPath) {
      const normalized = normalizeAdminPath(adminBasePath);
      adminPath = normalized || `/${randomToken(16)}`;
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
    const existing = await this.db.get('SELECT id FROM admin_users LIMIT 1');
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

    const now = Date.now();
    const passwordHash = hashPassword(adminPassword);
    await this.db.run(
      `
      INSERT INTO admin_users (username, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `,
      [adminUsername, passwordHash, now, now]
    );

    return {
      created: true,
      username: adminUsername,
      password: generatedPassword ? adminPassword : null,
      generatedPassword,
    };
  }

  async getAdminByUsername(username) {
    if (!username) return null;
    return this.db.get(
      'SELECT id, username, password_hash FROM admin_users WHERE username = ?',
      [username]
    );
  }

  async updateAdminPassword(username, passwordHash) {
    const now = Date.now();
    await this.db.run(
      'UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE username = ?',
      [passwordHash, now, username]
    );
  }

  async listApps() {
    const rows = await this.db.all(
      `
      SELECT apps.app_id, apps.display_name, apps.enabled, apps.created_at, apps.updated_at,
             ios.app_id AS ios_app_id, android.app_id AS android_app_id
      FROM apps
      LEFT JOIN app_ios AS ios ON ios.app_id = apps.app_id
      LEFT JOIN app_android AS android ON android.app_id = apps.app_id
      ORDER BY apps.app_id ASC
    `
    );

    return rows.map((row) => ({
      appId: row.app_id,
      displayName: row.display_name,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      iosConfigured: Boolean(row.ios_app_id),
      androidConfigured: Boolean(row.android_app_id),
    }));
  }

  async getApp(appId) {
    const app = await this.db.get(
      `
      SELECT app_id, display_name, api_secret, enabled, created_at, updated_at
      FROM apps
      WHERE app_id = ?
    `,
      [appId]
    );

    if (!app) return null;

    const ios = await this.db.get(
      `
      SELECT bundle_id, team_id, key_id, key_path, production, created_at, updated_at
      FROM app_ios
      WHERE app_id = ?
    `,
      [appId]
    );

    const android = await this.db.get(
      `
      SELECT service_account_path, created_at, updated_at
      FROM app_android
      WHERE app_id = ?
    `,
      [appId]
    );

    return {
      appId: app.app_id,
      displayName: app.display_name,
      apiSecret: app.api_secret,
      enabled: app.enabled === 1,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
      ios: ios
        ? {
          bundleId: ios.bundle_id,
          teamId: ios.team_id,
          keyId: ios.key_id,
          keyPath: ios.key_path,
          production: ios.production === 1,
          createdAt: ios.created_at,
          updatedAt: ios.updated_at,
        }
        : null,
      android: android
        ? {
          serviceAccountPath: android.service_account_path,
          createdAt: android.created_at,
          updatedAt: android.updated_at,
        }
        : null,
    };
  }

  async getAppConfig(appId) {
    const app = await this.getApp(appId);
    if (!app || !app.enabled) {
      return null;
    }
    return {
      appId: app.appId,
      displayName: app.displayName,
      ios: app.ios,
      android: app.android,
    };
  }

  async getApiSecret(appId) {
    const row = await this.db.get(
      'SELECT api_secret FROM apps WHERE app_id = ? AND enabled = 1',
      [appId]
    );
    return row ? row.api_secret : null;
  }

  async createApp({ appId, displayName }) {
    const existing = await this.db.get('SELECT app_id FROM apps WHERE app_id = ?', [appId]);
    if (existing) {
      throw new Error('appId already exists');
    }

    const now = Date.now();
    const apiSecret = randomToken(32);
    const name = displayName && displayName.trim() ? displayName.trim() : appId;

    await this.db.run(
      `
      INSERT INTO apps (app_id, display_name, api_secret, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `,
      [appId, name, apiSecret, now, now]
    );

    return {
      appId,
      displayName: name,
      apiSecret,
    };
  }

  async updateApp(appId, { displayName, enabled }) {
    const updates = [];
    const params = [];

    if (displayName !== undefined) {
      updates.push('display_name = ?');
      params.push(displayName);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return;
    }

    const now = Date.now();
    params.push(now, appId);
    await this.db.run(
      `UPDATE apps SET ${updates.join(', ')}, updated_at = ? WHERE app_id = ?`,
      params
    );
  }

  async rotateSecret(appId) {
    const apiSecret = randomToken(32);
    const now = Date.now();
    await this.db.run(
      'UPDATE apps SET api_secret = ?, updated_at = ? WHERE app_id = ?',
      [apiSecret, now, appId]
    );
    return apiSecret;
  }

  async upsertIosConfig(appId, ios) {
    const now = Date.now();
    const existing = await this.db.get('SELECT app_id FROM app_ios WHERE app_id = ?', [appId]);
    if (existing) {
      await this.db.run(
        `
        UPDATE app_ios
        SET bundle_id = ?, team_id = ?, key_id = ?, key_path = ?, production = ?, updated_at = ?
        WHERE app_id = ?
      `,
        [ios.bundleId, ios.teamId, ios.keyId, ios.keyPath, ios.production ? 1 : 0, now, appId]
      );
      return;
    }

    await this.db.run(
      `
      INSERT INTO app_ios (app_id, bundle_id, team_id, key_id, key_path, production, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [appId, ios.bundleId, ios.teamId, ios.keyId, ios.keyPath, ios.production ? 1 : 0, now, now]
    );
  }

  async deleteIosConfig(appId) {
    await this.db.run('DELETE FROM app_ios WHERE app_id = ?', [appId]);
  }

  async upsertAndroidConfig(appId, android) {
    const now = Date.now();
    const existing = await this.db.get('SELECT app_id FROM app_android WHERE app_id = ?', [appId]);
    if (existing) {
      await this.db.run(
        `
        UPDATE app_android
        SET service_account_path = ?, updated_at = ?
        WHERE app_id = ?
      `,
        [android.serviceAccountPath, now, appId]
      );
      return;
    }

    await this.db.run(
      `
      INSERT INTO app_android (app_id, service_account_path, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `,
      [appId, android.serviceAccountPath, now, now]
    );
  }

  async deleteAndroidConfig(appId) {
    await this.db.run('DELETE FROM app_android WHERE app_id = ?', [appId]);
  }
}

export {
  ConfigStore,
  normalizeAdminPath,
  isWeakAdminPath,
};
