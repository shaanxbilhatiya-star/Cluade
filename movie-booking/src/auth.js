'use strict';
/**
 * Authentication: scrypt password hashing + HMAC-signed stateless tokens
 * (same shape as a JWT: base64url(header).base64url(payload).base64url(sig)).
 * Uses only node:crypto.
 */
const crypto = require('crypto');
const db = require('./db');
const { HttpError } = require('./router');

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const meta = db.get('meta');
  if (!meta.tokenSecret) {
    meta.tokenSecret = crypto.randomBytes(48).toString('hex');
    db.markDirty('meta');
  }
  return meta.tokenSecret;
}

// ── Passwords ────────────────────────────────────────────────────────────────
function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 4) {
    throw new HttpError(400, 'Password must be at least 4 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  } catch (_e) {
    return false;
  }
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Tokens ───────────────────────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadObj) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify(
      Object.assign({}, payloadObj, {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      })
    )
  );
  const data = `${header}.${payload}`;
  const sig = b64url(crypto.createHmac('sha256', secret()).update(data).digest());
  return `${data}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret()).update(data).digest();
  const given = fromB64url(parts[2]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch (_e) {
    return null;
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// ── Middleware ───────────────────────────────────────────────────────────────
function bearer(ctx) {
  const header = ctx.req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (ctx.query.token) return ctx.query.token;
  return null;
}

/** Populates ctx.user when a valid token is present. Never throws. */
function attachUser(ctx) {
  const token = bearer(ctx);
  if (!token) return;
  const payload = verify(token);
  if (!payload) return;
  const user = db.byId('users', payload.sub);
  if (user && user.active !== false) ctx.user = user;
}

function requireAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Sign in to continue');
}

function requireAdmin(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Sign in to continue');
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'Admin access required');
}

/** Strip secrets before sending a user over the wire. */
function publicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

module.exports = {
  hashPassword,
  verifyPassword,
  sign,
  verify,
  attachUser,
  requireAuth,
  requireAdmin,
  publicUser,
  TOKEN_TTL_SECONDS,
};
