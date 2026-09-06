'use strict';
/**
 * CineFlex - Movie Ticket Booking System
 * Zero-dependency Node.js server (HTTP API + static app hosting).
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js  -> http://localhost:8080
 */
const http = require('http');
const os = require('os');
const path = require('path');

const db = require('./src/db');
const auth = require('./src/auth');
const { Router } = require('./src/router');
const { serveStatic, sendError, sendJSON } = require('./src/http');
const seed = require('./src/seed');
const { releaseExpiredHolds } = require('./src/seats');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Boot: load data, seed on first run ───────────────────────────────────────
db.load();
if (db.isEmpty()) {
  console.log('[boot] Empty database detected - seeding demo catalogue...');
  seed.run();
}
seed.ensureRollingShowtimes();
seed.reseedFood(); // Always sync food catalog from catalog.js

// ── Router ───────────────────────────────────────────────────────────────────
const api = new Router();
api.use(auth.attachUser);

api.mount('/api', require('./src/routes/auth.routes'));
api.mount('/api', require('./src/routes/home.routes'));
api.mount('/api', require('./src/routes/movies.routes'));
api.mount('/api', require('./src/routes/cinemas.routes'));
api.mount('/api', require('./src/routes/showtimes.routes'));
api.mount('/api', require('./src/routes/bookings.routes'));
api.mount('/api', require('./src/routes/food.routes'));
api.mount('/api', require('./src/routes/users.routes'));
api.mount('/api', require('./src/routes/admin.routes'));

api.get('/api/health', () => ({
  ok: true,
  service: 'cineflex-movie-booking',
  version: require('./package.json').version,
  uptimeSeconds: Math.round(process.uptime()),
  counts: {
    movies: db.get('movies').length,
    cinemas: db.get('cinemas').length,
    showtimes: db.get('showtimes').length,
    bookings: db.get('bookings').length,
    users: db.get('users').length,
    foodItems: db.get('foodItems').length,
  },
}));

// ── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_e) {
    sendError(res, 400, 'Bad request URL');
    return;
  }

  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  try {
    if (await api.handle(req, res, url)) return;

    if (url.pathname.startsWith('/api/')) {
      sendError(res, 404, `No API route for ${req.method} ${url.pathname}`);
      return;
    }

    // Static assets
    if (serveStatic(PUBLIC_DIR, url.pathname, req, res)) return;

    // SPA fallbacks
    if (url.pathname.startsWith('/admin')) {
      if (serveStatic(PUBLIC_DIR, '/admin/index.html', req, res)) return;
    }
    if (serveStatic(PUBLIC_DIR, '/index.html', req, res)) return;

    sendError(res, 404, 'Not found');
  } catch (err) {
    console.error('[fatal]', err);
    if (!res.writableEnded) sendError(res, 500, 'Internal server error');
  }
});

// Housekeeping: drop expired seat holds every 30s
setInterval(() => {
  const freed = releaseExpiredHolds();
  if (freed) console.log(`[holds] released ${freed} expired seat hold(s)`);
}, 30_000).unref();

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const lan = localAddresses();
  console.log('');
  console.log('  \x1b[35m\u2588\u2588\x1b[0m  CineFlex Movie Booking System');
  console.log('  ---------------------------------------------');
  console.log(`  Customer app :  http://localhost:${PORT}/`);
  console.log(`  Admin panel  :  http://localhost:${PORT}/admin/`);
  console.log(`  API health   :  http://localhost:${PORT}/api/health`);
  if (lan.length) {
    console.log('');
    console.log('  On your phone (same Wi-Fi):');
    lan.forEach((ip) => console.log(`     http://${ip}:${PORT}/`));
  }
  console.log('');
  console.log('  Demo logins  ->  customer: andrew@example.com / 1234');
  console.log('                   admin:    admin@cineflex.com / admin123');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try:  PORT=3001 node server.js\n`);
    process.exit(1);
  }
  throw err;
});

module.exports = server;
