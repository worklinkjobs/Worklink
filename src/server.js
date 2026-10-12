

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const PUBLIC_DIRECTORY = path.join(process.cwd(), 'public');

const VALID_ROLES = ['admin', 'manager', 'member'];

function getAuthConfig() {
  return {
    username: process.env.WORKLINK_USERNAME || 'admin',
    password: process.env.WORKLINK_PASSWORD || 'admin',
    secret: process.env.WORKLINK_SECRET || 'worklink-dev-secret',
  };
}

function normalizeRole(value, fallback = 'member') {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return VALID_ROLES.includes(normalized) ? normalized : fallback;
}

function createToken(username, role, secret) {
  const issuedAt = Date.now();
  const encodedUser = Buffer.from(username).toString('base64url');
  const encodedRole = Buffer.from(role).toString('base64url');
  const payload = `${encodedUser}.${encodedRole}.${issuedAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const [encodedUser, encodedRole, issuedAtRaw, signature] = parts;
  const payload = `${encodedUser}.${encodedRole}.${issuedAtRaw}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (signature !== expectedSignature) {
    return null;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 12 * 60 * 60 * 1000) {
    return null;
  }

  try {
    return {
      username: Buffer.from(encodedUser, 'base64url').toString('utf8'),
      role: Buffer.from(encodedRole, 'base64url').toString('utf8'),
      issuedAt,
    };
  } catch {
    return null;
  }
}

function requireAuth(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return null;
  }

  const { secret } = getAuthConfig();
  return verifyToken(match[1], secret);
}

function createUserStore(databasePath = path.join(process.cwd(), 'data', 'worklink.sqlite')) {
  const directory = path.dirname(databasePath);
  fs.mkdirSync(directory, { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      createdAt TEXT NOT NULL
    );
  `);

  const authConfig = getAuthConfig();
  const adminUsername = String(authConfig.username || 'admin').trim() || 'admin';
  const adminPassword = String(authConfig.password || 'admin').trim() || 'admin';
  const seedUsers = [
    [adminUsername, adminPassword, 'admin'],
    ['manager', 'manager', 'manager'],
    ['member', 'member', 'member'],
  ];

  for (const [username, password, role] of seedUsers) {
    db.prepare('INSERT OR IGNORE INTO users (username, password, role, createdAt) VALUES (?, ?, ?, ?)').run(username, password, normalizeRole(role, 'member'), new Date().toISOString());
    db.prepare('UPDATE users SET password = ?, role = ? WHERE username = ?').run(password, normalizeRole(role, 'member'), username);
  }

  return {
    findByUsername(username) {
      const value = String(username || '').trim();
      if (!value) {
        return null;
      }

      const row = db.prepare('SELECT id, username, password, role FROM users WHERE username = ?').get(value);
      return row ? { ...row, role: normalizeRole(row.role, 'member') } : null;
    },
    verifyCredentials(username, password) {
      const user = this.findByUsername(username);
      if (!user) {
        return null;
      }

      if (user.password !== String(password || '')) {
        return null;
      }

      return { id: user.id, username: user.username, role: user.role };
    },
  };
}

function normalizeJob(row) {
  return {
    id: String(row.id),
    title: row.title,
    description: row.description || '',
    status: row.status,
    priority: row.priority || 'medium',
    assignee: row.assignee || '',
    createdAt: row.createdAt,
  };
}

function normalizeStatus(value, fallback = 'queued') {
  const status = String(value ?? fallback).trim().toLowerCase();
  const valid = ['queued', 'in_progress', 'done', 'blocked'];
  return valid.includes(status) ? status : fallback;
}

function normalizePriority(value, fallback = 'medium') {
  const priority = String(value ?? fallback).trim().toLowerCase();
  const valid = ['low', 'medium', 'high'];
  return valid.includes(priority) ? priority : fallback;
}

function ensureJobColumns(db) {
  const columns = db.prepare('PRAGMA table_info(jobs)').all();
  const columnNames = new Set(columns.map((column) => column.name));

  const additions = [
    ['description', 'TEXT DEFAULT ""'],
    ['priority', 'TEXT NOT NULL DEFAULT "medium"'],
    ['assignee', 'TEXT DEFAULT ""'],
  ];

  for (const [name, definition] of additions) {
    if (!columnNames.has(name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition};`);
    }
  }
}

function createJobStore(databasePath = path.join(process.cwd(), 'data', 'worklink.sqlite')) {
  const directory = path.dirname(databasePath);
  fs.mkdirSync(directory, { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee TEXT DEFAULT '',
      createdAt TEXT NOT NULL
    );
  `);
  ensureJobColumns(db);

  return {
    list() {
      const rows = db.prepare('SELECT id, title, description, status, priority, assignee, createdAt FROM jobs ORDER BY id ASC').all();
      return rows.map(normalizeJob);
    },
    get(id) {
      const row = db.prepare('SELECT id, title, description, status, priority, assignee, createdAt FROM jobs WHERE id = ?').get(Number(id));
      return row ? normalizeJob(row) : undefined;
    },
    create(jobInput) {
      const title = String(jobInput?.title || '').trim();
      const description = String(jobInput?.description || '').trim();
      const status = normalizeStatus(jobInput?.status, 'queued');
      const priority = normalizePriority(jobInput?.priority, 'medium');
      const assignee = String(jobInput?.assignee || '').trim();

      if (!title) {
        throw new Error('Job title is required');
      }

      const createdAt = new Date().toISOString();
      const result = db.prepare('INSERT INTO jobs (title, description, status, priority, assignee, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(title, description, status, priority, assignee, createdAt);
      const row = db.prepare('SELECT id, title, description, status, priority, assignee, createdAt FROM jobs WHERE id = ?').get(Number(result.lastInsertRowid));
      return normalizeJob(row);
    },
    update(id, updates) {
      const current = this.get(id);
      if (!current) {
        return undefined;
      }

      const title = updates?.title !== undefined ? String(updates.title).trim() : current.title;
      if (!title) {
        throw new Error('Job title is required');
      }

      const description = updates?.description !== undefined ? String(updates.description).trim() : current.description;
      const status = updates?.status !== undefined ? normalizeStatus(updates.status, current.status) : current.status;
      const priority = updates?.priority !== undefined ? normalizePriority(updates.priority, current.priority) : current.priority;
      const assignee = updates?.assignee !== undefined ? String(updates.assignee).trim() : current.assignee;

      db.prepare('UPDATE jobs SET title = ?, description = ?, status = ?, priority = ?, assignee = ? WHERE id = ?').run(title, description, status, priority, assignee, Number(id));
      return this.get(id);
    },
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: 'File not found' });
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(content);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function createApp() {
  const store = createJobStore();
  const userStore = createUserStore();

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'worklink' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const acceptHeader = req.headers.accept || '';

      if (acceptHeader.includes('text/html')) {
        serveStaticFile(res, path.join(PUBLIC_DIRECTORY, 'index.html'));
        return;
      }

      sendJson(res, 200, {
        message: 'Welcome to Worklink',
        routes: ['/health', '/jobs'],
      });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/styles.css' || url.pathname === '/app.js')) {
      const filePath = path.join(PUBLIC_DIRECTORY, url.pathname.replace(/^\//, ''));
      serveStaticFile(res, filePath);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/login') {
      readJsonBody(req)
        .then((payload) => {
          const authConfig = getAuthConfig();
          const directAdmin = payload.username === authConfig.username && payload.password === authConfig.password;
          const user = userStore.verifyCredentials(payload.username, payload.password) || (directAdmin ? { username: authConfig.username, role: 'admin' } : null);

          if (!user) {
            sendJson(res, 401, { error: 'Invalid credentials' });
            return;
          }

          sendJson(res, 200, {
            token: createToken(user.username, normalizeRole(user.role, 'member'), getAuthConfig().secret),
            user: { username: user.username, role: normalizeRole(user.role, 'member') },
          });
        })
        .catch(() => {
          sendJson(res, 400, { error: 'Invalid JSON body' });
        });
      return;
    }

    const auth = requireAuth(req);
    if ((req.method === 'GET' && url.pathname === '/me') || (url.pathname === '/jobs' || /^\/jobs\/(.+)$/.test(url.pathname))) {
      if (!auth) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
    }

    if (req.method === 'GET' && url.pathname === '/me') {
      sendJson(res, 200, { username: auth.username, role: normalizeRole(auth.role, 'member') });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/jobs') {
      sendJson(res, 200, store.list());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/jobs') {
      if (!auth || !['admin', 'manager'].includes(auth.role)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }

      readJsonBody(req)
        .then((payload) => {
          try {
            const job = store.create(payload);
            sendJson(res, 201, job);
          } catch (error) {
            sendJson(res, 400, { error: error.message || 'Invalid job payload' });
          }
        })
        .catch(() => {
          sendJson(res, 400, { error: 'Invalid JSON body' });
        });
      return;
    }

    const jobIdMatch = /^\/jobs\/(.+)$/.exec(url.pathname);

    if (jobIdMatch) {
      const id = jobIdMatch[1];

      if (req.method === 'GET') {
        const job = store.get(id);
        if (!job) {
          sendJson(res, 404, { error: 'Job not found' });
          return;
        }

        sendJson(res, 200, job);
        return;
      }

      if (req.method === 'PATCH') {
        if (!auth || !['admin', 'manager'].includes(auth.role)) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }

        readJsonBody(req)
          .then((payload) => {
            try {
              const updated = store.update(id, payload || {});
              if (!updated) {
                sendJson(res, 404, { error: 'Job not found' });
                return;
              }

              sendJson(res, 200, updated);
            } catch (error) {
              sendJson(res, 400, { error: error.message || 'Invalid job payload' });
            }
          })
          .catch(() => {
            sendJson(res, 400, { error: 'Invalid JSON body' });
          });
        return;
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const server = createApp();
  server.listen(port, () => {
    console.log(`Worklink server listening on http://localhost:${port}`);
  });
}

module.exports = { createApp, createJobStore, createToken, verifyToken, getAuthConfig, createUserStore };
