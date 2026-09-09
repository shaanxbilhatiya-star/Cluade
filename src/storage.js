'use strict';
/**
 * Where persistent state lives.
 *
 * Two kinds of state have to survive a redeploy:
 *   1. the JSON collections (bookings, rooms, prices, …)
 *   2. images uploaded from the admin panel (room photos, experience covers)
 *
 * Both used to sit inside the deployed app directory, which on Railway/Render/
 * Fly/Heroku is rebuilt from the repo on every deploy — so everything the admin
 * had entered or uploaded disappeared. Both now resolve to a single directory
 * that can be backed by a mounted volume.
 *
 * Resolution order (first hit wins):
 *   DATA_DIR / UPLOAD_DIR      explicit override
 *   RAILWAY_VOLUME_MOUNT_PATH  set automatically when a Railway volume is attached
 *   VOLUME_PATH                generic escape hatch for other hosts
 *   <app>/data                 local development
 *
 * Uploads default to <DATA_DIR>/uploads, so attaching one volume is enough to
 * make the whole app persistent — no second setting to forget.
 */
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');

/** Mounted volume, if the host advertises one. */
const VOLUME = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.VOLUME_PATH || null;

// The volume root is used as-is (not <volume>/data) so that auto-detection
// lands on exactly the same place as the previously documented DATA_DIR=/data.
// Anyone already running that setup keeps their data when they drop the env var.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : VOLUME
    ? path.resolve(VOLUME)
    : path.join(APP_ROOT, 'data');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(DATA_DIR, 'uploads');

/** Public URL prefix that maps onto UPLOAD_DIR (served by server.js). */
const UPLOAD_URL_PREFIX = '/uploads';

function insideApp(dir) {
  return path.resolve(dir).startsWith(path.resolve(APP_ROOT) + path.sep);
}

/**
 * True when state can actually survive a redeploy: either the host told us a
 * volume is mounted (it may legitimately sit inside /app), or the data
 * directory was pointed somewhere outside the deployed app tree.
 */
const persistent = Boolean(VOLUME) || !insideApp(DATA_DIR);

function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/** Absolute path for an upload, e.g. uploadPath('hotels', 'a.jpg'). */
function uploadPath(folder, filename) {
  return path.join(UPLOAD_DIR, folder, filename);
}

/** Public URL for an upload, e.g. '/uploads/hotels/a.jpg'. */
function uploadUrl(folder, filename) {
  return `${UPLOAD_URL_PREFIX}/${folder}/${filename}`;
}

/** Human-readable summary, logged at boot and exposed on /api/health. */
function describe() {
  return {
    dataDir: DATA_DIR,
    uploadDir: UPLOAD_DIR,
    volumeDetected: Boolean(VOLUME),
    volumePath: VOLUME || null,
    persistent,
  };
}

/** Warns loudly when uploads and bookings will be wiped by the next deploy. */
function warnIfEphemeral() {
  if (persistent) {
    console.log(`[storage] persistent  data=${DATA_DIR}  uploads=${UPLOAD_DIR}`);
    return;
  }

  console.warn('');
  console.warn('  ⚠  [storage] EPHEMERAL STORAGE — bookings and uploaded photos will be');
  console.warn(`     lost on the next deploy. Currently writing to ${DATA_DIR}`);
  console.warn('     Fix: attach a volume (Railway sets RAILWAY_VOLUME_MOUNT_PATH');
  console.warn('     automatically), or set DATA_DIR to a path on a mounted disk.');
  console.warn('');
}

module.exports = {
  APP_ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  UPLOAD_URL_PREFIX,
  VOLUME,
  persistent,
  ensureDirs,
  uploadPath,
  uploadUrl,
  describe,
  warnIfEphemeral,
};


/**
 * Moves photos uploaded under the old scheme (public/img/<folder>/…, which a
 * deploy wipes) onto the persistent upload directory and rewrites the stored
 * paths to /uploads/….
 *
 * Only bitmap uploads are touched: every generated placeholder in public/img is
 * an .svg, so keying off the extension keeps the artwork references intact.
 *
 * Safe to run on every boot — it is a no-op once there is nothing left to move.
 */
function migrateLegacyUploads(db) {
  const LEGACY_RE = /^\/img\/(experiences|hotels)\/(.+\.(?:png|jpe?g|webp))$/i;
  const publicImg = path.join(APP_ROOT, 'public', 'img');

  let moved = 0;
  let rewritten = 0;

  /** '/img/hotels/x.jpg' -> '/uploads/hotels/x.jpg', copying the file if present. */
  function convert(value) {
    if (typeof value !== 'string') return value;
    const m = LEGACY_RE.exec(value);
    if (!m) return value;

    const folder = m[1].toLowerCase();
    const filename = m[2];
    const from = path.join(publicImg, folder, filename);
    const to = uploadPath(folder, filename);

    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        moved += 1;
      }
    } catch (err) {
      console.warn(`[storage] could not move ${filename}: ${err.message}`);
    }

    rewritten += 1;
    return uploadUrl(folder, filename);
  }

  // Experiences carry a single cover image; hotels and rooms carry galleries.
  for (const exp of db.get('experiences')) {
    const next = convert(exp.image);
    if (next !== exp.image) db.update('experiences', exp.id, { image: next });
  }

  for (const name of ['hotels', 'hotelRooms']) {
    for (const record of db.get(name)) {
      if (!Array.isArray(record.photos)) continue;
      const next = record.photos.map(convert);
      if (next.some((url, i) => url !== record.photos[i])) db.update(name, record.id, { photos: next });
    }
  }

  if (rewritten) {
    db.flushNow();
    console.log(`[storage] migrated ${rewritten} uploaded photo reference(s); copied ${moved} file(s) onto the volume.`);
  }

  return { rewritten, moved };
}

module.exports.migrateLegacyUploads = migrateLegacyUploads;
