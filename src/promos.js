'use strict';
/**
 * Tab sliders — the auto-scrolling photo strip at the top of a tab.
 *
 * One slider per tab (Movie, Stay, Dine-In, Water Park). A slider is simply a
 * list of photos the admin uploads, plus whether it shows and how fast it
 * advances. Nothing is overlaid on a photo: the images are finished creatives,
 * so they are shown whole and at the ratio they were uploaded at.
 *
 * This mirrors the hotel's "Property photos" gallery — same multi-upload
 * control in the admin, same newline-joined storage, same "first photo first"
 * ordering — so there is one way to manage photos across the console rather
 * than two.
 *
 * Everything lives on the `meta` singleton: a slider is configuration, not a
 * collection of records.
 */
const db = require('./db');
const { HttpError } = require('./router');

/** The tabs that can carry a slider. Ids are stable; labels are for the admin. */
const SECTIONS = [
  { id: 'movie', label: 'Movie', tabPath: '/home' },
  { id: 'stay', label: 'Stay', tabPath: '/hotels' },
  { id: 'dinein', label: 'Dine-In', tabPath: '/dine-in' },
  { id: 'waterpark', label: 'Water Park', tabPath: '/waterpark' },
];

const SECTION_IDS = SECTIONS.map((s) => s.id);

/** Per-section defaults, merged under whatever the admin has saved. */
const SLIDER_DEFAULTS = {
  active: true,
  /** Milliseconds between photos. */
  intervalMs: 4500,
  photos: [],
};

const INTERVAL_BOUNDS = { min: 1500, max: 30000 };

/** Plenty for a promo strip, and a bound on how much a single save can write. */
const MAX_PHOTOS = 10;

// ── Sections ────────────────────────────────────────────────────────────────
/**
 * A photo must be something the app can actually load: an uploaded file or a
 * local path. By this point the route has written any recognised upload to disk
 * and swapped in its /uploads path.
 *
 * A data: URL still being here therefore means the upload was NOT recognised, so
 * the message names that instead of talking about paths — the admin picked a
 * file, watched it preview correctly, and needs to know it was the format that
 * stopped it, not the path.
 */
function assertStorablePhoto(photo) {
  const value = String(photo || '').trim();

  if (value.startsWith('data:')) {
    const kind = /^data:([^;,]+)/.exec(value);
    throw new HttpError(
      400,
      `That image could not be uploaded${kind ? ` (${kind[1]})` : ''} — use a PNG, JPEG, WEBP, GIF or AVIF file`
    );
  }

  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new HttpError(400, 'Each slider photo must be an uploaded image or a local image path');
  }
  return value;
}

function isSection(id) {
  return SECTION_IDS.indexOf(String(id)) !== -1;
}

function assertSection(id) {
  if (!isSection(id)) {
    throw new HttpError(400, `Unknown section "${id}" — expected one of: ${SECTION_IDS.join(', ')}`);
  }
  return String(id);
}

function sectionLabel(id) {
  const match = SECTIONS.find((s) => s.id === id);
  return match ? match.label : id;
}

// ── Settings ────────────────────────────────────────────────────────────────
/** Every section's slider, shipped defaults merged under saved values. */
function settings() {
  const saved = db.get('meta').promoSliders || {};
  const out = {};
  for (const id of SECTION_IDS) {
    const mine = saved[id] || {};
    out[id] = Object.assign({}, SLIDER_DEFAULTS, mine, {
      // Cloned so a caller cannot mutate stored state by editing the array.
      photos: Array.isArray(mine.photos) ? mine.photos.slice() : [],
    });
  }
  return out;
}

function slider(section) {
  return settings()[assertSection(section)];
}

/**
 * Validates and persists one section's slider.
 *
 * `photos` is expected to already hold storable paths — the admin route turns
 * any freshly uploaded data: URL into a file first, the same way the hotel
 * galleries do.
 */
function saveSlider(section, patch = {}) {
  const id = assertSection(section);
  const all = settings();
  const next = Object.assign({}, all[id]);

  if (patch.active !== undefined) {
    next.active = patch.active === true || patch.active === 'true';
  }

  if (patch.intervalMs !== undefined && patch.intervalMs !== '') {
    const ms = Number(patch.intervalMs);
    if (!Number.isFinite(ms)) throw new HttpError(400, 'Slide interval must be a number of milliseconds');
    if (ms < INTERVAL_BOUNDS.min || ms > INTERVAL_BOUNDS.max) {
      throw new HttpError(
        400,
        `Slide interval must be between ${INTERVAL_BOUNDS.min / 1000} and ${INTERVAL_BOUNDS.max / 1000} seconds`
      );
    }
    next.intervalMs = Math.round(ms);
  }

  if (patch.photos !== undefined) {
    const list = Array.isArray(patch.photos)
      ? patch.photos
      : String(patch.photos || '').split(/[\n,]/);

    next.photos = list
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, MAX_PHOTOS)
      .map(assertStorablePhoto);
  }

  const meta = db.get('meta');
  meta.promoSliders = Object.assign({}, all, { [id]: next });
  db.markDirty('meta');
  return next;
}

// ── Payloads ────────────────────────────────────────────────────────────────
/**
 * The slider for one tab. `photos` is empty when the admin has switched it off
 * or has not added any, so the client has exactly one thing to check.
 */
function publicSlider(section) {
  const id = assertSection(section);
  const config = slider(id);
  const on = config.active !== false && config.photos.length > 0;
  return {
    section: id,
    active: on,
    intervalMs: config.intervalMs,
    photos: on ? config.photos.slice() : [],
  };
}

/** Everything the admin Tab Sliders page renders. */
function adminPayload() {
  const config = settings();
  return {
    sections: SECTIONS.map((s) => ({
      id: s.id,
      label: s.label,
      tabPath: s.tabPath,
      active: config[s.id].active !== false,
      intervalMs: config[s.id].intervalMs,
      photos: config[s.id].photos,
    })),
    defaults: SLIDER_DEFAULTS,
    intervalBounds: INTERVAL_BOUNDS,
    maxPhotos: MAX_PHOTOS,
  };
}

module.exports = {
  SECTIONS,
  SECTION_IDS,
  SLIDER_DEFAULTS,
  INTERVAL_BOUNDS,
  MAX_PHOTOS,
  isSection,
  assertSection,
  sectionLabel,
  settings,
  slider,
  saveSlider,
  publicSlider,
  adminPayload,
};
