'use strict';
/**
 * Property details for the cinema itself (the multiplex CineFlex operates),
 * shown as the hero at the top of the Movies/Cinemas experience — the same
 * shape as the Dine-In, Water Park and Hotel property panels, so every
 * admin-managed venue looks and behaves the same way.
 *
 * Unlike Dine-In/Water Park (which mix property details with operational
 * settings), this is nothing but property details: identity, rating, photos,
 * amenities and policies. There is no pricing or scheduling logic here.
 */
const db = require('./db');
const { HttpError } = require('./router');

const DEFAULTS = {
  active: true,
  name: 'CineFlex: Kingfisher',
  tagline: 'The best way to watch the movies you love',
  area: '',
  city: 'Mandla',
  address: 'Kingfisher Resort, Mandla',
  rating: 0,
  reviewCount: 0,
  coverPhoto: '',
  photos: [],
  amenities: [],
  policies: [],
};

const NUMERIC_FIELDS = {
  reviewCount: { min: 0, max: 10000000 },
};

const TEXT_FIELDS = ['name', 'tagline', 'area', 'city', 'address'];

/** Current settings: shipped defaults with the admin's saved values merged over. */
function settings() {
  const saved = db.get('meta').movieProperty || {};
  const merged = Object.assign({}, DEFAULTS, saved);
  merged.photos = (saved.photos || DEFAULTS.photos).slice();
  merged.amenities = (saved.amenities || DEFAULTS.amenities).slice();
  merged.policies = (saved.policies || DEFAULTS.policies).slice();
  return merged;
}

function clampNumber(value, bounds, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

/** Validates and persists a settings patch, mirroring dinein.js/hotels.js. */
function saveSettings(patch = {}) {
  const current = settings();
  const next = Object.assign({}, current);

  for (const [key, bounds] of Object.entries(NUMERIC_FIELDS)) {
    if (patch[key] === undefined || patch[key] === '') continue;
    if (!Number.isFinite(Number(patch[key]))) throw new HttpError(400, `${key} must be a number`);
    next[key] = clampNumber(patch[key], bounds, current[key]);
  }

  for (const key of TEXT_FIELDS) {
    if (patch[key] === undefined) continue;
    next[key] = String(patch[key]).trim().slice(0, 160);
  }

  if (patch.rating !== undefined && patch.rating !== '') {
    const r = Number(patch.rating);
    if (!Number.isFinite(r) || r < 0 || r > 5) throw new HttpError(400, 'Rating must be between 0 and 5');
    next.rating = r;
  }

  if (patch.coverPhoto !== undefined) {
    next.coverPhoto = String(patch.coverPhoto || '').trim();
  }
  if (patch.photos !== undefined) {
    const list = Array.isArray(patch.photos) ? patch.photos : String(patch.photos || '').split('\n');
    next.photos = list.map((s) => String(s).trim()).filter(Boolean);
  }
  if (patch.amenities !== undefined) {
    const list = Array.isArray(patch.amenities) ? patch.amenities : String(patch.amenities || '').split(',');
    next.amenities = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 24);
  }
  if (patch.policies !== undefined) {
    const list = Array.isArray(patch.policies) ? patch.policies : String(patch.policies || '').split('\n');
    next.policies = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 24);
  }

  if (patch.active !== undefined) next.active = patch.active === true || patch.active === 'true';

  const meta = db.get('meta');
  meta.movieProperty = next;
  db.markDirty('meta');
  return next;
}

module.exports = { DEFAULTS, settings, saveSettings };
