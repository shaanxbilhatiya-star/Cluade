'use strict';
/**
 * Minimal Express-like router built on node:http.
 *   router.get('/api/movies/:id', handler)
 * Handlers receive (ctx) where ctx = { req, res, params, query, body, user }
 * A handler may return a value -> serialised as 200 JSON, or handle res itself.
 */
const { sendJSON, sendError, readBody } = require('./http');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg === '*') {
        keys.push('wildcard');
        return '(.*)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

class Router {
  constructor() {
    this.routes = [];
    this.middleware = [];
  }

  use(fn) {
    this.middleware.push(fn);
    return this;
  }

  add(method, pattern, ...handlers) {
    const { regex, keys } = compile(pattern);
    this.routes.push({ method, pattern, regex, keys, handlers });
    return this;
  }

  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  /** Merge another router's routes in (optionally under a prefix). */
  mount(prefix, other) {
    for (const r of other.routes) {
      this.add(r.method, (prefix === '/' ? '' : prefix) + r.pattern, ...r.handlers);
    }
    return this;
  }

  /** Returns true if a route matched and the request was handled. */
  async handle(req, res, url) {
    const pathname = url.pathname;
    let matched = null;
    const allowedMethods = new Set();

    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      allowedMethods.add(route.method);
      if (route.method === req.method) {
        matched = { route, values: m.slice(1) };
        break;
      }
    }

    if (!matched) {
      if (allowedMethods.size && pathname.startsWith('/api/')) {
        res.writeHead(405, { Allow: [...allowedMethods].join(', ') });
        res.end(JSON.stringify({ error: `Method ${req.method} not allowed`, status: 405 }));
        return true;
      }
      return false;
    }

    const params = {};
    matched.route.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(matched.values[i] ?? '');
    });

    const query = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    const ctx = { req, res, params, query, url, body: {}, user: null, state: {} };

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        ctx.body = await readBody(req);
      }
      for (const mw of this.middleware) {
        const out = await mw(ctx);
        if (out === false || res.writableEnded) return true;
      }
      for (const handler of matched.route.handlers) {
        const result = await handler(ctx);
        if (res.writableEnded) return true;
        if (result !== undefined) {
          sendJSON(res, ctx.state.status || 200, result);
          return true;
        }
      }
      if (!res.writableEnded) sendJSON(res, 204, null);
      return true;
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      if (status >= 500) {
        console.error(`[error] ${req.method} ${pathname} ->`, err);
      }
      if (!res.writableEnded) {
        sendError(res, status, err.message || 'Internal server error', err.details ? { details: err.details } : null);
      }
      return true;
    }
  }
}

module.exports = { Router, HttpError };
