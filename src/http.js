'use strict';
/**
 * Tiny HTTP helpers - request body parsing, responses, static file serving.
 * No external dependencies.
 */
const fs = require('fs');
const path = require('path');

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message, extra) {
  sendJSON(res, status, Object.assign({ error: message, status }, extra || {}));
}

function sendText(res, status, text, type) {
  const body = String(text);
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Read + JSON-parse a request body. Returns {} for empty bodies. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        const err = new Error('Request body too large');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      const type = String(req.headers['content-type'] || '');
      try {
        if (type.includes('application/x-www-form-urlencoded')) {
          const out = {};
          for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
          return resolve(out);
        }
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : { value: parsed });
      } catch (_e) {
        const err = new Error('Invalid JSON body');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/** Guard against path traversal, then stream the file. */
function serveStatic(rootDir, urlPath, req, res) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const target = path.join(rootDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!target.startsWith(path.resolve(rootDir))) {
    sendError(res, 403, 'Forbidden');
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (_e) {
    return false;
  }
  if (stat.isDirectory()) return serveStatic(rootDir, rel + '/index.html', req, res);

  const ext = path.extname(target).toLowerCase();
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    'Cache-Control': 'no-cache',
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(target).pipe(res);
  return true;
}

module.exports = { sendJSON, sendError, sendText, readBody, serveStatic, MIME };
