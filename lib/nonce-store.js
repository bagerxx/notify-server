import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

class NonceStore {
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
      CREATE TABLE IF NOT EXISTS nonces (
        app_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (app_id, nonce)
      );
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nonces_expires_at
      ON nonces (expires_at);
    `);
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async consumeNonce(appId, nonce, now, expiresAt) {
    await this.db.run('DELETE FROM nonces WHERE expires_at <= ?', [now]);

    const result = await this.db.run(
      `
        INSERT INTO nonces (app_id, nonce, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(app_id, nonce) DO NOTHING
      `,
      [appId, nonce, now, expiresAt]
    );

    return result.changes > 0;
  }
}

export {
  NonceStore,
};
