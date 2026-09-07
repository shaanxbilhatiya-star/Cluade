'use strict';
/**
 * File-backed JSON datastore.
 *  - Every collection lives in data/<name>.json
 *  - Loaded into memory once at boot, then served from memory (fast reads)
 *  - Writes are debounced + atomic (tmp file then rename) so a crash mid-write
 *    can never leave a half-written file behind.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// DATA_DIR can be overridden (used by the smoke test so it never touches your
// real data): DATA_DIR=/tmp/cineflex-test node server.js
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const COLLECTIONS = [
  'users',
  'movies',
  'cinemas',
  'screens',
  'showtimes',
  'bookings',
  'foodItems',
  'offers',
  'notifications',
  'reviews',
  'seatHolds',
  'meta',
];

const cache = new Map();
const dirty = new Set();
let flushTimer = null;

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  for (const name of COLLECTIONS) {
    const fp = filePath(name);
    if (!fs.existsSync(fp)) {
      cache.set(name, name === 'meta' ? {} : []);
      dirty.add(name);
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      cache.set(name, parsed);
    } catch (err) {
      console.error(`[db] ${name}.json is corrupt (${err.message}) - starting that collection empty.`);
      const backup = `${fp}.corrupt-${Date.now()}`;
      try { fs.renameSync(fp, backup); console.error(`[db] bad file moved to ${path.basename(backup)}`); } catch (_e) {}
      cache.set(name, name === 'meta' ? {} : []);
      dirty.add(name);
    }
  }
  flushNow();
}

function writeFileAtomic(name) {
  ensureDir();
  const fp = filePath(name);
  const tmp = `${fp}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache.get(name), null, 2));
  fs.renameSync(tmp, fp);
}

function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const name of dirty) {
    try {
      writeFileAtomic(name);
    } catch (err) {
      console.error(`[db] failed to persist ${name}:`, err.message);
    }
  }
  dirty.clear();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, 60);
}

/** Raw in-memory collection (array for lists, object for `meta`). */
function get(name) {
  if (!cache.has(name)) throw new Error(`Unknown collection "${name}"`);
  return cache.get(name);
}

function markDirty(name) {
  dirty.add(name);
  scheduleFlush();
}

function replace(name, value) {
  cache.set(name, value);
  markDirty(name);
  return value;
}

function id(prefix) {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${stamp}${rand}`;
}

/** Human-friendly booking reference, e.g. CF7K2M9Q (Code39-safe charset). */
function reference(prefix = 'CF') {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let out = prefix;
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function insert(name, doc) {
  const list = get(name);
  const now = new Date().toISOString();
  const record = Object.assign({ createdAt: now, updatedAt: now }, doc);
  list.push(record);
  markDirty(name);
  return record;
}

function update(name, matchId, patch) {
  const list = get(name);
  const idx = list.findIndex((d) => d.id === matchId);
  if (idx === -1) return null;
  list[idx] = Object.assign({}, list[idx], patch, { id: matchId, updatedAt: new Date().toISOString() });
  markDirty(name);
  return list[idx];
}

function remove(name, matchId) {
  const list = get(name);
  const idx = list.findIndex((d) => d.id === matchId);
  if (idx === -1) return null;
  const [gone] = list.splice(idx, 1);
  markDirty(name);
  return gone;
}

function find(name, predicate) {
  return get(name).filter(predicate);
}

function findOne(name, predicate) {
  return get(name).find(predicate) || null;
}

function byId(name, matchId) {
  return get(name).find((d) => d.id === matchId) || null;
}

function isEmpty() {
  return get('movies').length === 0 && get('users').length === 0;
}

process.on('exit', flushNow);
process.on('SIGINT', () => { flushNow(); process.exit(0); });
process.on('SIGTERM', () => { flushNow(); process.exit(0); });

module.exports = {
  DATA_DIR,
  COLLECTIONS,
  load,
  get,
  replace,
  markDirty,
  flushNow,
  id,
  reference,
  insert,
  update,
  remove,
  find,
  findOne,
  byId,
  isEmpty,
};
