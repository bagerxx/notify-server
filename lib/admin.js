import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import session from 'express-session';
import { hashPassword, verifyPassword } from './passwords.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLayout({ title, baseUrl, user, message, content }) {
  const nav = user
    ? `
      <nav class="nav">
        <div class="brand">Notify Admin</div>
        <div class="links">
          <a href="${baseUrl}/apps">Apps</a>
          <a href="${baseUrl}/settings">Settings</a>
          <a href="${baseUrl}/logout">Logout</a>
        </div>
      </nav>
    `
    : '';

  const messageHtml = message
    ? `<div class="alert ${message.type}">${escapeHtml(message.text)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title || 'Notify Admin')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg: #f6f1ea;
        --ink: #1c1c1f;
        --muted: #665f59;
        --panel: #fffaf4;
        --line: #e3d6c7;
        --accent: #d1495b;
        --accent-2: #e6a85b;
        --success: #2a7a4a;
        --error: #b22b2b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top left, #fff8ef, var(--bg));
        color: var(--ink);
      }
      a { color: inherit; text-decoration: none; }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        margin-bottom: 28px;
        box-shadow: 0 12px 30px rgba(32, 19, 8, 0.08);
      }
      .brand { font-weight: 700; letter-spacing: 0.4px; }
      .links { display: flex; gap: 14px; font-weight: 500; }
      .hero {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 20px;
      }
      .hero h1 { margin: 0; font-size: 28px; }
      .hero p { margin: 6px 0 0; color: var(--muted); }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 22px;
        box-shadow: 0 12px 30px rgba(32, 19, 8, 0.06);
      }
      .grid {
        display: grid;
        gap: 18px;
      }
      .grid.two {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      .btn.primary {
        border-color: transparent;
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
        color: #fff;
      }
      .btn.ghost { background: transparent; }
      .btn.danger { background: #fff; border-color: #f0c9c9; color: var(--error); }
      .btn + .btn { margin-left: 10px; }
      .alert {
        padding: 12px 14px;
        border-radius: 12px;
        margin-bottom: 16px;
        font-weight: 600;
      }
      .alert.success { background: #e9f5ed; color: var(--success); }
      .alert.error { background: #fdecec; color: var(--error); }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      .table th, .table td {
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        text-align: left;
      }
      .tag {
        display: inline-flex;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: #f1e6da;
        color: #6a4d3b;
      }
      .tag.ok { background: #e9f5ed; color: var(--success); }
      .tag.warn { background: #fdecec; color: var(--error); }
      .form-group { margin-bottom: 14px; }
      label { display: block; font-weight: 600; margin-bottom: 6px; }
      input, select, textarea {
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: #fff;
        font-family: inherit;
      }
      .hint { font-size: 12px; color: var(--muted); margin-top: 6px; }
      .inline-actions form { display: inline; }
      code { background: #f4efe7; padding: 2px 6px; border-radius: 6px; }
      @media (max-width: 720px) {
        .nav { flex-direction: column; align-items: flex-start; gap: 10px; }
        .hero { flex-direction: column; align-items: flex-start; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      ${nav}
      ${messageHtml}
      ${content}
    </div>
  </body>
</html>`;
}

function parseMessage(req) {
  const error = typeof req.query.error === 'string' ? req.query.error : null;
  const success = typeof req.query.success === 'string' ? req.query.success : null;
  if (error) return { type: 'error', text: error };
  if (success) return { type: 'success', text: success };
  return null;
}

function normalizeAppId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return null;
  }
  if (!trimmed.includes('.')) {
    return null;
  }
  return trimmed;
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 8) return '********';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function ensureLoggedIn(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }
  return res.redirect(303, `${req.baseUrl}/login`);
}

function isInlineKeyValue(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{')) return true;
  if (trimmed.includes('BEGIN PRIVATE KEY')) return true;
  if (trimmed.includes('BEGIN EC PRIVATE KEY')) return true;
  return false;
}

async function readKeyFile(value, keysDir) {
  if (!value || typeof value !== 'string') return null;
  if (isInlineKeyValue(value)) return value;
  try {
    const filePath = path.isAbsolute(value) ? value : path.join(keysDir, value);
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

async function cleanupKeyFile(oldPath, keysDir) {
  if (!oldPath) return;
  if (isInlineKeyValue(oldPath)) return;
  try {
    const resolvedOld = path.isAbsolute(oldPath)
      ? path.resolve(oldPath)
      : path.resolve(keysDir, oldPath);
    const resolvedKeys = path.resolve(keysDir);
    if (resolvedOld.startsWith(resolvedKeys)) {
      await fs.promises.unlink(resolvedOld);
    }
  } catch (_) {
    // ignore cleanup errors
  }
}

function renderLoginPage({ baseUrl, message }) {
  const content = `
    <div class="panel">
      <div class="hero">
        <div>
          <h1>Admin Login</h1>
          <p>Sign in to manage apps and keys.</p>
        </div>
      </div>
      <form method="POST" action="${baseUrl}/login">
        <div class="form-group">
          <label for="username">Username</label>
          <input id="username" name="username" autocomplete="username" required />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn primary" type="submit">Sign In</button>
      </form>
    </div>
  `;
  return renderLayout({ title: 'Admin Login', baseUrl, message, content });
}

function renderAppsPage({ baseUrl, apps, message }) {
  const rows = apps
    .map((app) => {
      const iosTag = app.iosConfigured ? '<span class="tag ok">iOS</span>' : '<span class="tag warn">iOS</span>';
      const androidTag = app.androidConfigured
        ? '<span class="tag ok">Android</span>'
        : '<span class="tag warn">Android</span>';
      const enabledTag = app.enabled ? '<span class="tag ok">Enabled</span>' : '<span class="tag warn">Disabled</span>';
      return `
        <tr>
          <td>${escapeHtml(app.appId)}</td>
          <td>${escapeHtml(app.displayName)}</td>
          <td>${enabledTag}</td>
          <td>${iosTag} ${androidTag}</td>
          <td class="inline-actions">
            <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}">Edit</a>
            <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}/apns">APNs</a>
            <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm">FCM</a>
            <form method="POST" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}/rotate-secret">
              <button class="btn" type="submit">Rotate Secret</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join('');

  const content = `
    <div class="hero">
      <div>
        <h1>Apps</h1>
        <p>Manage app identities and push credentials.</p>
      </div>
      <a class="btn primary" href="${baseUrl}/apps/new">Create App</a>
    </div>
    <div class="panel">
      <table class="table">
        <thead>
          <tr>
            <th>Bundle ID</th>
            <th>Display Name</th>
            <th>Status</th>
            <th>Platforms</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5">No apps yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  return renderLayout({ title: 'Apps', baseUrl, user: true, message, content });
}

function renderAppCreatePage({ baseUrl, message }) {
  const content = `
    <div class="hero">
      <div>
        <h1>Create App</h1>
        <p>Define a new app identity for notify-server.</p>
      </div>
    </div>
    <div class="panel">
      <form method="POST" action="${baseUrl}/apps">
        <div class="form-group">
          <label for="appId">Bundle ID (App ID)</label>
          <input id="appId" name="appId" required placeholder="com.example.app" />
          <div class="hint">Bundle ID formatini kullan (or: com.example.app).</div>
        </div>
        <div class="form-group">
          <label for="displayName">Display Name</label>
          <input id="displayName" name="displayName" placeholder="My App" />
        </div>
        <button class="btn primary" type="submit">Create</button>
        <a class="btn ghost" href="${baseUrl}/apps">Cancel</a>
      </form>
    </div>
  `;
  return renderLayout({ title: 'Create App', baseUrl, user: true, message, content });
}

function renderSecretPage({ baseUrl, appId, secret }) {
  const content = `
    <div class="hero">
      <div>
        <h1>Secret Created</h1>
        <p>Save this secret now. You can rotate it later, but you will not see it again here.</p>
      </div>
    </div>
    <div class="panel grid">
      <div>
        <div class="form-group">
          <label>Bundle ID</label>
          <code>${escapeHtml(appId)}</code>
        </div>
        <div class="form-group">
          <label>API Secret</label>
          <code>${escapeHtml(secret)}</code>
        </div>
        <div class="hint">Use this secret in your backend module (NOTIFY_APP_SECRET).</div>
      </div>
      <div>
        <a class="btn primary" href="${baseUrl}/apps/${encodeURIComponent(appId)}">Go to App</a>
        <a class="btn ghost" href="${baseUrl}/apps">Back to Apps</a>
      </div>
    </div>
  `;
  return renderLayout({ title: 'Secret Created', baseUrl, user: true, content });
}

function renderAppDetailPage({ baseUrl, app, message }) {
  const content = `
    <div class="hero">
      <div>
        <h1>${escapeHtml(app.displayName || app.appId)}</h1>
        <p>Bundle ID: <code>${escapeHtml(app.appId)}</code></p>
      </div>
    </div>
    <div class="grid two">
      <div class="panel">
        <h3>App Details</h3>
        <form method="POST" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}">
          <div class="form-group">
            <label for="displayName">Display Name</label>
            <input id="displayName" name="displayName" value="${escapeHtml(app.displayName)}" />
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="enabled" ${app.enabled ? 'checked' : ''} />
              Enabled
            </label>
          </div>
          <button class="btn primary" type="submit">Save</button>
        </form>
      </div>
      <div class="panel">
        <h3>Credentials</h3>
        <div class="form-group">
          <label>Secret</label>
          <code>${escapeHtml(maskSecret(app.apiSecret))}</code>
        </div>
        <div class="inline-actions">
          <form method="POST" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}/rotate-secret">
            <button class="btn" type="submit">Rotate Secret</button>
          </form>
        </div>
        <div class="form-group">
          <label>Platforms</label>
          <div>${app.ios ? '<span class="tag ok">iOS</span>' : '<span class="tag warn">iOS missing</span>'}
          ${app.android ? '<span class="tag ok">Android</span>' : '<span class="tag warn">Android missing</span>'}</div>
        </div>
        <div class="inline-actions">
          <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}/apns">APNs</a>
          <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm">FCM</a>
        </div>
      </div>
    </div>
  `;
  return renderLayout({ title: 'App Details', baseUrl, user: true, message, content });
}

function renderApnsPage({ baseUrl, app, message }) {
  const content = `
    <div class="hero">
      <div>
        <h1>APNs Config</h1>
        <p>${escapeHtml(app.appId)}</p>
      </div>
    </div>
    <div class="panel">
      <form method="POST" enctype="multipart/form-data" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}/apns">
        <div class="form-group">
          <label>Bundle ID</label>
          <code>${escapeHtml(app.appId)}</code>
          <div class="hint">Bundle ID ile App ID aynidir.</div>
        </div>
        <div class="form-group">
          <label for="teamId">Team ID</label>
          <input id="teamId" name="teamId" value="${escapeHtml(app.ios ? app.ios.teamId : '')}" required />
        </div>
        <div class="form-group">
          <label for="keyId">Key ID</label>
          <input id="keyId" name="keyId" value="${escapeHtml(app.ios ? app.ios.keyId : '')}" required />
        </div>
        <div class="form-group">
          <label for="apnsKey">APNs Key (.p8)</label>
          <input id="apnsKey" name="apnsKey" type="file" accept=".p8" ${app.ios ? '' : 'required'} />
          <div class="hint">Leave empty to keep existing key.</div>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="production" ${app.ios && app.ios.production ? 'checked' : ''} />
            Production
          </label>
        </div>
        <button class="btn primary" type="submit">Save APNs</button>
        <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}">Back</a>
      </form>
    </div>
    <div class="panel">
      <h3>Remove APNs</h3>
      <form method="POST" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}/apns/delete">
        <button class="btn danger" type="submit">Delete APNs Config</button>
      </form>
    </div>
  `;
  return renderLayout({ title: 'APNs Config', baseUrl, user: true, message, content });
}

function renderFcmPage({ baseUrl, app, message }) {
  const android = app.android;
  const content = `
    <div class="hero">
      <div>
        <h1>FCM Config</h1>
        <p>${escapeHtml(app.appId)}</p>
      </div>
    </div>
    <div class="panel">
      <form method="POST" enctype="multipart/form-data" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm">
        <div class="form-group">
          <label for="fcmKey">Service Account JSON</label>
          <input id="fcmKey" name="fcmKey" type="file" accept=".json,application/json" ${android ? '' : 'required'} />
          <div class="hint">Leave empty to keep existing key.</div>
        </div>
        <button class="btn primary" type="submit">Save FCM</button>
        <a class="btn ghost" href="${baseUrl}/apps/${encodeURIComponent(app.appId)}">Back</a>
      </form>
    </div>
    <div class="panel">
      <h3>Remove FCM</h3>
      <form method="POST" action="${baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm/delete">
        <button class="btn danger" type="submit">Delete FCM Config</button>
      </form>
    </div>
  `;
  return renderLayout({ title: 'FCM Config', baseUrl, user: true, message, content });
}

function renderSettingsPage({ baseUrl, user, message }) {
  const content = `
    <div class="hero">
      <div>
        <h1>Settings</h1>
        <p>Update admin password.</p>
      </div>
    </div>
    <div class="panel">
      <form method="POST" action="${baseUrl}/settings/password">
        <div class="form-group">
          <label for="currentPassword">Current Password</label>
          <input id="currentPassword" name="currentPassword" type="password" required />
        </div>
        <div class="form-group">
          <label for="newPassword">New Password</label>
          <input id="newPassword" name="newPassword" type="password" required />
        </div>
        <button class="btn primary" type="submit">Update Password</button>
      </form>
    </div>
  `;
  return renderLayout({ title: 'Settings', baseUrl, user, message, content });
}

function createAdminRouter({ store, sessionSecret, keysDir }) {
  const router = express.Router();

  router.use(
    session({
      name: 'notify_admin',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
      },
    })
  );

  router.use(express.urlencoded({ extended: false }));

  router.get('/login', (req, res) => {
    if (req.session && req.session.adminUser) {
      return res.redirect(303, `${req.baseUrl}/apps`);
    }
    const message = parseMessage(req);
    return res.send(renderLoginPage({ baseUrl: req.baseUrl, message }));
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = normalizeText(req.body.username);
      const password = normalizeText(req.body.password);
      const user = await store.getAdminByUsername(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        return res.redirect(303, `${req.baseUrl}/login?error=Invalid%20credentials`);
      }
      req.session.adminUser = user.username;
      return res.redirect(303, `${req.baseUrl}/apps`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/logout', (req, res) => {
    if (req.session) {
      req.session.destroy(() => {
        res.redirect(303, `${req.baseUrl}/login`);
      });
      return;
    }
    return res.redirect(303, `${req.baseUrl}/login`);
  });

  router.use(ensureLoggedIn);

  router.get('/', (req, res) => res.redirect(303, `${req.baseUrl}/apps`));

  router.get('/apps', async (req, res, next) => {
    try {
      const apps = await store.listApps();
      const message = parseMessage(req);
      return res.send(renderAppsPage({ baseUrl: req.baseUrl, apps, message }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/apps/new', (req, res) => {
    const message = parseMessage(req);
    return res.send(renderAppCreatePage({ baseUrl: req.baseUrl, message }));
  });

  router.post('/apps', async (req, res, next) => {
    try {
      const appId = normalizeAppId(req.body.appId);
      const displayName = normalizeText(req.body.displayName);
      if (!appId) {
        return res.redirect(303, `${req.baseUrl}/apps/new?error=Invalid%20appId`);
      }
      const created = await store.createApp({ appId, displayName });
      return res.send(renderSecretPage({ baseUrl: req.baseUrl, appId: created.appId, secret: created.apiSecret }));
    } catch (error) {
      const msg = error && error.message ? error.message : 'Failed to create app';
      return res.redirect(303, `${req.baseUrl}/apps/new?error=${encodeURIComponent(msg)}`);
    }
  });

  router.get('/apps/:appId', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      const message = parseMessage(req);
      return res.send(renderAppDetailPage({ baseUrl: req.baseUrl, app, message }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/apps/:appId', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      const displayNameRaw = normalizeText(req.body.displayName);
      const displayName = displayNameRaw || app.displayName || app.appId;
      const enabled = Boolean(req.body.enabled);
      await store.updateApp(app.appId, { displayName, enabled });
      return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}?success=Saved`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/apps/:appId/rotate-secret', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      const secret = await store.rotateSecret(app.appId);
      return res.send(renderSecretPage({ baseUrl: req.baseUrl, appId: app.appId, secret }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/apps/:appId/apns', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      const message = parseMessage(req);
      return res.send(renderApnsPage({ baseUrl: req.baseUrl, app, message }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/apps/:appId/apns', upload.single('apnsKey'), async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      const teamId = normalizeText(req.body.teamId);
      const keyId = normalizeText(req.body.keyId);
      const production = Boolean(req.body.production);

      if (!teamId || !keyId) {
        return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/apns?error=Missing%20fields`);
      }

      let keyPath = app.ios ? app.ios.keyPath : null;
      const previousKeyPath = keyPath;
      if (req.file && req.file.buffer) {
        keyPath = req.file.buffer.toString('utf8');
      } else if (!keyPath) {
        return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/apns?error=APNs%20key%20file%20required`);
      } else if (!isInlineKeyValue(keyPath)) {
        const loaded = await readKeyFile(keyPath, keysDir);
        if (!loaded) {
          return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/apns?error=APNs%20key%20file%20missing`);
        }
        keyPath = loaded;
      }

      await store.upsertIosConfig(app.appId, {
        bundleId: app.appId,
        teamId,
        keyId,
        keyPath,
        production,
      });
      return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/apns?success=Saved`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/apps/:appId/apns/delete', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app || !app.ios) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      await store.deleteIosConfig(app.appId);
      return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}?success=APNs%20removed`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/apps/:appId/fcm', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      const message = parseMessage(req);
      return res.send(renderFcmPage({ baseUrl: req.baseUrl, app, message }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/apps/:appId/fcm', upload.single('fcmKey'), async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }

      let serviceAccountPath = app.android ? app.android.serviceAccountPath : null;
      const previousServiceAccountPath = serviceAccountPath;
      if (req.file && req.file.buffer) {
        const jsonRaw = req.file.buffer.toString('utf8');
        let parsed;
        try {
          parsed = JSON.parse(jsonRaw);
        } catch (_) {
          return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?error=Invalid%20JSON`);
        }
        if (!parsed || !parsed.client_email || !parsed.private_key) {
          return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?error=Missing%20service%20account%20fields`);
        }
        serviceAccountPath = JSON.stringify(parsed);
      } else if (!serviceAccountPath) {
        return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?error=Service%20account%20required`);
      } else if (!isInlineKeyValue(serviceAccountPath)) {
        const loaded = await readKeyFile(serviceAccountPath, keysDir);
        if (!loaded) {
          return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?error=Service%20account%20file%20missing`);
        }
        let parsed;
        try {
          parsed = JSON.parse(loaded);
        } catch (_) {
          return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?error=Invalid%20JSON`);
        }
        if (!parsed || !parsed.client_email || !parsed.private_key) {
          return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?error=Missing%20service%20account%20fields`);
        }
        serviceAccountPath = JSON.stringify(parsed);
      }

      await store.upsertAndroidConfig(app.appId, { serviceAccountPath });
      return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}/fcm?success=Saved`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/apps/:appId/fcm/delete', async (req, res, next) => {
    try {
      const app = await store.getApp(req.params.appId);
      if (!app || !app.android) {
        return res.redirect(303, `${req.baseUrl}/apps?error=App%20not%20found`);
      }
      await store.deleteAndroidConfig(app.appId);
      return res.redirect(303, `${req.baseUrl}/apps/${encodeURIComponent(app.appId)}?success=FCM%20removed`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/settings', (req, res) => {
    const message = parseMessage(req);
    return res.send(renderSettingsPage({ baseUrl: req.baseUrl, user: true, message }));
  });

  router.post('/settings/password', async (req, res, next) => {
    try {
      const userName = req.session.adminUser;
      const currentPassword = normalizeText(req.body.currentPassword);
      const newPassword = normalizeText(req.body.newPassword);
      const user = await store.getAdminByUsername(userName);
      if (!user || !verifyPassword(currentPassword, user.password_hash)) {
        return res.redirect(303, `${req.baseUrl}/settings?error=Invalid%20password`);
      }
      if (!newPassword || newPassword.length < 6) {
        return res.redirect(303, `${req.baseUrl}/settings?error=Password%20too%20short`);
      }
      const newHash = hashPassword(newPassword);
      await store.updateAdminPassword(userName, newHash);
      return res.redirect(303, `${req.baseUrl}/settings?success=Password%20updated`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export {
  createAdminRouter,
};
