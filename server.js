// Marginalia — bookstore catalog backend
// Deliberately zero external dependencies: only Node's built-in http/fs/path.
// Run with: node server.js   (Node 18+)

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'books.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- tiny JSON "database" ----------
function loadData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function nextId(books) {
  return books.reduce((max, b) => Math.max(max, b.id), 0) + 1;
}

// ---------- helpers ----------
function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res, message = 'Not found') {
  sendJSON(res, 404, { error: message });
}

function badRequest(res, message = 'Bad request') {
  sendJSON(res, 400, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (chunk) => {
      chunks += chunk;
      if (chunks.length > 2_000_000) req.destroy(); // 2MB safety cap
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) return notFound(res);

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      // SPA-friendly fallback for unknown paths that aren't asset requests
      if (!path.extname(filePath)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexContent) => {
          if (err2) return notFound(res);
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(indexContent);
        });
      }
      return notFound(res);
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- validation ----------
function validateBookPayload(payload, categories, { partial = false } = {}) {
  const errors = [];
  const validCategoryIds = new Set(categories.map((c) => c.id));

  const required = ['title', 'author', 'categoryId', 'price', 'pages', 'year'];
  if (!partial) {
    for (const field of required) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        errors.push(`Missing field: ${field}`);
      }
    }
  }
  if (payload.categoryId !== undefined && !validCategoryIds.has(payload.categoryId)) {
    errors.push(`Unknown categoryId: ${payload.categoryId}`);
  }
  if (payload.price !== undefined && (typeof payload.price !== 'number' || payload.price < 0)) {
    errors.push('price must be a non-negative number');
  }
  if (payload.pages !== undefined && (!Number.isInteger(payload.pages) || payload.pages <= 0)) {
    errors.push('pages must be a positive integer');
  }
  if (payload.year !== undefined && (!Number.isInteger(payload.year))) {
    errors.push('year must be an integer');
  }
  if (payload.rating !== undefined && (typeof payload.rating !== 'number' || payload.rating < 0 || payload.rating > 5)) {
    errors.push('rating must be a number between 0 and 5');
  }
  if (payload.stock !== undefined && (!Number.isInteger(payload.stock) || payload.stock < 0)) {
    errors.push('stock must be a non-negative integer');
  }
  return errors;
}

// ---------- API ----------
async function handleApi(req, res, pathname, query) {
  const data = loadData();
  const segments = pathname.split('/').filter(Boolean); // ['api','books', '3']

  // GET /api/categories
  if (req.method === 'GET' && segments[1] === 'categories' && segments.length === 2) {
    return sendJSON(res, 200, data.categories);
  }

  // /api/books  and /api/books/:id
  if (segments[1] === 'books') {
    const id = segments[2] ? Number(segments[2]) : null;

    if (req.method === 'GET' && segments.length === 2) {
      let results = data.books;

      if (query.category) {
        results = results.filter((b) => b.categoryId === query.category);
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        results = results.filter(
          (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
        );
      }
      if (query.minPrice) results = results.filter((b) => b.price >= Number(query.minPrice));
      if (query.maxPrice) results = results.filter((b) => b.price <= Number(query.maxPrice));
      if (query.featured === 'true') results = results.filter((b) => b.featured);

      const sort = query.sort || 'title';
      const sorters = {
        title: (a, b) => a.title.localeCompare(b.title),
        price_asc: (a, b) => a.price - b.price,
        price_desc: (a, b) => b.price - a.price,
        rating: (a, b) => b.rating - a.rating,
        newest: (a, b) => b.year - a.year,
      };
      results = [...results].sort(sorters[sort] || sorters.title);

      const withCategory = results.map((b) => ({
        ...b,
        category: data.categories.find((c) => c.id === b.categoryId) || null,
      }));

      return sendJSON(res, 200, { count: withCategory.length, books: withCategory });
    }

    if (req.method === 'GET' && id) {
      const book = data.books.find((b) => b.id === id);
      if (!book) return notFound(res, `No book with id ${id}`);
      const category = data.categories.find((c) => c.id === book.categoryId) || null;
      return sendJSON(res, 200, { ...book, category });
    }

    if (req.method === 'POST' && segments.length === 2) {
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        return badRequest(res, 'Malformed JSON body');
      }
      const errors = validateBookPayload(payload, data.categories);
      if (errors.length) return badRequest(res, errors.join('; '));

      const book = {
        id: nextId(data.books),
        title: payload.title,
        author: payload.author,
        categoryId: payload.categoryId,
        price: payload.price,
        pages: payload.pages,
        year: payload.year,
        rating: payload.rating ?? 0,
        stock: payload.stock ?? 0,
        featured: Boolean(payload.featured),
        description: payload.description || '',
      };
      data.books.push(book);
      saveData(data);
      return sendJSON(res, 201, book);
    }

    if (req.method === 'PUT' && id) {
      const idx = data.books.findIndex((b) => b.id === id);
      if (idx === -1) return notFound(res, `No book with id ${id}`);
      let payload;
      try {
        payload = await readBody(req);
      } catch {
        return badRequest(res, 'Malformed JSON body');
      }
      const errors = validateBookPayload(payload, data.categories, { partial: true });
      if (errors.length) return badRequest(res, errors.join('; '));

      data.books[idx] = { ...data.books[idx], ...payload, id };
      saveData(data);
      return sendJSON(res, 200, data.books[idx]);
    }

    if (req.method === 'DELETE' && id) {
      const idx = data.books.findIndex((b) => b.id === id);
      if (idx === -1) return notFound(res, `No book with id ${id}`);
      const [removed] = data.books.splice(idx, 1);
      saveData(data);
      return sendJSON(res, 200, { deleted: removed.id });
    }
  }

  return notFound(res, 'Unknown API route');
}

// ---------- accounts (per-user login, not one shared password) ----------
const crypto = require('crypto');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return { users: [] };
  }
}
function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createUser(username, password) {
  const data = loadUsers();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const user = { username, salt, hash };
  data.users.push(user);
  saveUsers(data);
  return user;
}

function findUser(username) {
  const data = loadUsers();
  return data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

function verifyPassword(user, password) {
  const attempt = hashPassword(password, user.salt);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- sessions (cookie-based, in memory) ----------
// Note: sessions reset if the server restarts (e.g. a free host waking back
// up), so users may occasionally need to log in again. That's a reasonable
// tradeoff for a project this size — see README for how to persist sessions
// if you outgrow it.
const sessions = new Map(); // sessionId -> { username, expires }
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseCookies(req) {
  const header = req.headers['cookie'];
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function getSessionUsername(req) {
  const { session } = parseCookies(req);
  if (!session) return null;
  const record = sessions.get(session);
  if (!record) return null;
  if (Date.now() > record.expires) {
    sessions.delete(session);
    return null;
  }
  return record.username;
}

function createSession(res, username) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { username, expires: Date.now() + SESSION_MS });
  res.setHeader(
    'Set-Cookie',
    `session=${id}; HttpOnly; Path=/; Max-Age=${SESSION_MS / 1000}; SameSite=Lax`
  );
}

function clearSession(req, res) {
  const { session } = parseCookies(req);
  if (session) sessions.delete(session);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

// ---------- auth API ----------
async function handleAuthApi(req, res, pathname) {
  if (pathname === '/api/register' && req.method === 'POST') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { username, password } = payload;
    if (!username || username.trim().length < 3) return badRequest(res, 'Username must be at least 3 characters');
    if (!password || password.length < 6) return badRequest(res, 'Password must be at least 6 characters');
    if (findUser(username)) return badRequest(res, 'That username is already taken');

    createUser(username.trim(), password);
    createSession(res, username.trim());
    return sendJSON(res, 201, { username: username.trim() });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    let payload;
    try { payload = await readBody(req); } catch { return badRequest(res, 'Malformed JSON body'); }
    const { username, password } = payload;
    const user = username && findUser(username);
    if (!user || !verifyPassword(user, password || '')) {
      return sendJSON(res, 401, { error: 'Incorrect username or password' });
    }
    createSession(res, user.username);
    return sendJSON(res, 200, { username: user.username });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    clearSession(req, res);
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    const username = getSessionUsername(req);
    if (!username) return sendJSON(res, 401, { error: 'Not logged in' });
    return sendJSON(res, 200, { username });
  }

  return notFound(res, 'Unknown auth route');
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // Basic CORS so the frontend can also be opened from a different origin/port if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const AUTH_ROUTES = ['/api/register', '/api/login', '/api/logout', '/api/me'];

  try {
    if (AUTH_ROUTES.includes(pathname)) {
      return await handleAuthApi(req, res, pathname);
    }

    if (pathname.startsWith('/api/')) {
      const username = getSessionUsername(req);
      if (!username) return sendJSON(res, 401, { error: 'Please log in first' });
      return await handleApi(req, res, pathname, parsed.query);
    }

    // Gate the main page: show the login/register screen unless there's a valid session
    if (pathname === '/' || pathname === '/index.html') {
      const username = getSessionUsername(req);
      if (!username) {
        return fs.readFile(path.join(PUBLIC_DIR, 'login.html'), (err, content) => {
          if (err) return notFound(res);
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(content);
        });
      }
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Marginalia is on the shelf at http://localhost:${PORT}`);
});
