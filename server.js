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

// ---------- password protection ----------
// Set SITE_USERNAME and SITE_PASSWORD as environment variables wherever you
// host this. If neither is set, it falls back to the defaults below —
// change these before you put the site online.
const SITE_USERNAME = process.env.SITE_USERNAME || 'reader';
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'changeme123';

function isAuthorized(req) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const separatorIndex = decoded.indexOf(':');
  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  return user === SITE_USERNAME && pass === SITE_PASSWORD;
}

function requireAuth(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Marginalia"',
    'Content-Type': 'text/plain',
  });
  res.end('Username and password required.');
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

  if (!isAuthorized(req)) {
    return requireAuth(res);
  }

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsed.query);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Marginalia is on the shelf at http://localhost:${PORT}`);
});
