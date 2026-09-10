'use strict';
/**
 * Promo sliders — the auto-scrolling banner at the top of a tab.
 *
 * One slider per tab (Movie, Stay, Dine-In, Water Park). Each is a list of
 * admin-managed slides plus two settings: whether the slider shows at all, and
 * how fast it advances. Everything is editable from the admin console, so a
 * campaign can be swapped without a deploy.
 *
 * Slides live in their own `promoSlides` collection (a list, ordered by the
 * admin) while the per-section settings are a singleton on `meta`, which is the
 * same split the rest of the app uses for "records + how they behave".
 *
 * A slide may link somewhere, but only to an in-app path. Anything else —
 * `javascript:`, an external origin, a protocol-relative `//host` — is refused
 * rather than sanitised, because a banner that silently loses its link is
 * harder to notice than one that would not save.
 */
const db = require('./db');
const { HttpError } = require('./router');
const { isSeedRemoved } = require('./seed');

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
  /** Milliseconds between slides. */
  intervalMs: 4500,
};

const INTERVAL_BOUNDS = { min: 1500, max: 30000 };

const TEXT_LIMITS = {
  title: 60,
  subtitle: 120,
  ctaLabel: 24,
  ctaPath: 120,
  imageUrl: 400,
};

/**
 * Starter slides, drawn with artwork already in the repo so the feature is
 * visible on a fresh install. Seeded once per id and then owned by the admin:
 * editing sets `adminEdited`, deleting leaves a tombstone, and neither is
 * undone by a restart.
 */
const SEEDS = [
  {
    id: 'promo_movie_offers',
    section: 'movie',
    title: 'Best ticket offers',
    subtitle: 'Save on every show this week',
    imageUrl: '/img/promos/movie-tickets.svg',
    ctaLabel: 'Browse movies',
    ctaPath: '/movies/now_playing',
  },
  {
    id: 'promo_movie_combo',
    section: 'movie',
    title: 'Combo saver',
    subtitle: 'Popcorn and a drink for less',
    imageUrl: '/img/promos/movie-snacks.svg',
    ctaLabel: 'Order food',
    ctaPath: '/food',
  },
  {
    id: 'promo_movie_firstshow',
    section: 'movie',
    title: 'First show, flat off',
    subtitle: 'Morning shows at their best price',
    imageUrl: '/img/promos/movie-morning.svg',
    ctaLabel: '',
    ctaPath: '',
  },
  {
    id: 'promo_stay_weekend',
    section: 'stay',
    title: 'Weekend cashback',
    subtitle: 'Stay two nights, save on the second',
    imageUrl: '/img/promos/stay-weekend.svg',
    ctaLabel: 'See rooms',
    ctaPath: '/hotels',
  },
  {
    id: 'promo_stay_suite',
    section: 'stay',
    title: 'Room upgrades',
    subtitle: 'Suites and executive rooms at the resort',
    imageUrl: '/img/promos/stay-suite.svg',
    ctaLabel: 'See rooms',
    ctaPath: '/hotels',
  },
  {
    id: 'promo_dinein_reserved',
    section: 'dinein',
    title: 'Book a table, save more',
    subtitle: 'Reserve ahead and pay from your seat',
    imageUrl: '/img/promos/dinein-table.svg',
    ctaLabel: 'Reserve a table',
    ctaPath: '/dine-in/reserve',
  },
  {
    id: 'promo_dinein_bill',
    section: 'dinein',
    title: 'Pay your bill in the app',
    subtitle: 'Instant discount, no queue',
    imageUrl: '/img/promos/dinein-bill.svg',
    ctaLabel: 'Pay bill',
    ctaPath: '/dine-in/bill',
  },
  {
    id: 'promo_waterpark_family',
    section: 'waterpark',
    title: 'Family Fun Day',
    subtitle: 'Water park, movie and more in one package',
    imageUrl: '/img/promos/waterpark-family.svg',
    ctaLabel: 'See packages',
    ctaPath: '/waterpark',
  },
  {
    id: 'promo_waterpark_addons',
    section: 'waterpark',
    title: 'Add-ons from \u20B999',
    subtitle: 'Fish spa, bull ride, photography',
    imageUrl: '/img/promos/waterpark-addons.svg',
    ctaLabel: 'Build my day',
    ctaPath: '/waterpark/book?mode=individual',
  },
];

// ── Sections ────────────────────────────────────────────────────────────────
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
/** Every section's slider settings, shipped defaults merged under saved values. */
function settings() {
  const saved = db.get('meta').promoSliders || {};
  const out = {};
  for (const id of SECTION_IDS) {
    out[id] = Object.assign({}, SLIDER_DEFAULTS, saved[id] || {});
  }
  return out;
}

function sliderSettings(section) {
  return settings()[assertSection(section)];
}

/** Validates and persists one section's settings. */
function saveSliderSettings(section, patch = {}) {
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
        `Slide interval must be between ${INTERVAL_BOUNDS.min} and ${INTERVAL_BOUNDS.max} ms ` +
          '(1.5s is the fastest that is still readable; 30s is the slowest that still feels alive)'
      );
    }
    next.intervalMs = Math.round(ms);
  }

  const meta = db.get('meta');
  meta.promoSliders = Object.assign({}, all, { [id]: next });
  db.markDirty('meta');
  return next;
}

// ── Slides ──────────────────────────────────────────────────────────────────
function slideById(id) {
  return db.byId('promoSlides', id);
}

function byOrder(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

/** A section's slides in the admin's chosen order. */
function slidesFor(section, { includeInactive = false } = {}) {
  const id = assertSection(section);
  return db
    .find('promoSlides', (s) => s.section === id && (includeInactive || s.active !== false))
    .sort(byOrder);
}

function text(value, limit) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, limit);
}

/**
 * An in-app destination, or ''. Refused rather than blanked when it is not a
 * local path, so a mistake surfaces at save time instead of shipping a dead
 * banner. `//host` is rejected too: the browser reads it as a protocol-relative
 * external URL, not a path.
 */
function ctaPath(value) {
  const raw = text(value, TEXT_LIMITS.ctaPath);
  if (!raw) return '';
  if (raw.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    throw new HttpError(400, 'The slide link must be an in-app path such as /waterpark, not an external URL');
  }
  if (!raw.startsWith('/')) {
    throw new HttpError(400, 'The slide link must start with "/", e.g. /waterpark');
  }
  return raw;
}

/** Creates or updates a slide. */
function saveSlide(patch = {}) {
  const existing = patch.id ? slideById(patch.id) : null;
  if (patch.id && !existing) throw new HttpError(404, 'Slide not found');

  const section = assertSection(patch.section !== undefined ? patch.section : existing && existing.section);
  const imageUrl = text(patch.imageUrl !== undefined ? patch.imageUrl : existing && existing.imageUrl, TEXT_LIMITS.imageUrl);
  if (!imageUrl) throw new HttpError(400, 'A slide needs an image');

  const record = {
    section,
    title: text(patch.title !== undefined ? patch.title : existing && existing.title, TEXT_LIMITS.title),
    subtitle: text(patch.subtitle !== undefined ? patch.subtitle : existing && existing.subtitle, TEXT_LIMITS.subtitle),
    imageUrl,
    ctaLabel: text(patch.ctaLabel !== undefined ? patch.ctaLabel : existing && existing.ctaLabel, TEXT_LIMITS.ctaLabel),
    ctaPath: ctaPath(patch.ctaPath !== undefined ? patch.ctaPath : existing && existing.ctaPath),
    active: patch.active === undefined
      ? (existing ? existing.active !== false : true)
      : patch.active === true || patch.active === 'true',
  };

  // A label with nowhere to go would render a dead button.
  if (record.ctaLabel && !record.ctaPath) {
    throw new HttpError(400, `"${record.ctaLabel}" needs a link, or clear the button label`);
  }

  if (existing) {
    // Any edit hands ownership to the admin, so a restart will not overwrite it.
    return db.update('promoSlides', existing.id, Object.assign({}, record, { adminEdited: true }));
  }

  const last = slidesFor(section, { includeInactive: true }).slice(-1)[0];
  return db.insert('promoSlides', Object.assign({ id: db.id('promo') }, record, {
    order: last ? (Number(last.order) || 0) + 1 : 1,
  }));
}

function removeSlide(id) {
  const slide = slideById(id);
  if (!slide) throw new HttpError(404, 'Slide not found');
  db.remove('promoSlides', id);
  return slide;
}

/**
 * Moves a slide one place within its section by swapping order with its
 * neighbour, so the admin never has to type order numbers.
 */
function moveSlide(id, direction) {
  const slide = slideById(id);
  if (!slide) throw new HttpError(404, 'Slide not found');
  const step = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  if (!step) throw new HttpError(400, 'Direction must be "up" or "down"');

  const list = slidesFor(slide.section, { includeInactive: true });
  const index = list.findIndex((s) => s.id === id);
  const target = list[index + step];
  if (!target) return { moved: false, slides: list };

  const slideOrder = Number(slide.order) || index + 1;
  const targetOrder = Number(target.order) || index + 1 + step;
  db.update('promoSlides', slide.id, { order: targetOrder });
  db.update('promoSlides', target.id, { order: slideOrder });

  return { moved: true, slides: slidesFor(slide.section, { includeInactive: true }) };
}

// ── Payloads ────────────────────────────────────────────────────────────────
/** What a slide looks like to the customer app. */
function publicSlide(slide) {
  return {
    id: slide.id,
    title: slide.title || '',
    subtitle: slide.subtitle || '',
    imageUrl: slide.imageUrl,
    ctaLabel: slide.ctaLabel || '',
    ctaPath: slide.ctaPath || '',
  };
}

/**
 * The slider for one tab. `slides` is empty when the admin has switched the
 * slider off, so the client has one thing to check.
 */
function publicSlider(section) {
  const id = assertSection(section);
  const config = sliderSettings(id);
  const on = config.active !== false;
  return {
    section: id,
    active: on,
    intervalMs: config.intervalMs,
    slides: on ? slidesFor(id).map(publicSlide) : [],
  };
}

/** Everything the admin Sliders page renders. */
function adminPayload() {
  const config = settings();
  return {
    sections: SECTIONS.map((s) => {
      const slides = slidesFor(s.id, { includeInactive: true });
      return {
        id: s.id,
        label: s.label,
        tabPath: s.tabPath,
        settings: config[s.id],
        slides,
        liveCount: slides.filter((x) => x.active !== false).length,
      };
    }),
    defaults: SLIDER_DEFAULTS,
    intervalBounds: INTERVAL_BOUNDS,
  };
}

// ── Seeding ─────────────────────────────────────────────────────────────────
/**
 * Adds the starter slides once. A slide the admin has edited is left alone and
 * one they deleted is not resurrected, matching how the experiences and hotel
 * catalogues behave.
 */
function ensureSlides() {
  let added = 0;
  for (let i = 0; i < SEEDS.length; i += 1) {
    const seed = SEEDS[i];
    if (slideById(seed.id) || isSeedRemoved(seed.id)) continue;
    db.insert('promoSlides', Object.assign({}, seed, { order: i + 1, active: true }));
    added += 1;
  }
  if (added) console.log(`[promos] seeded ${added} starter slide(s)`);
  return added;
}

// ── Tab photos ───────────────────────────────────────────────────────────────
/**
 * Per-tab photo galleries — a cover photo plus a slider gallery — that appear
 * at the top of each customer tab.  Stored on `meta.tabPhotos` as:
 *   { movie: { coverPhoto: '/uploads/...', photos: [...] }, ... }
 */

const TAB_PHOTO_LIMIT = 20;

/** Returns all sections' photo configs (cover + gallery). */
function allTabPhotos() {
  const saved = db.get('meta').tabPhotos || {};
  const out = {};
  for (const s of SECTIONS) {
    out[s.id] = Object.assign({ coverPhoto: '', photos: [] }, saved[s.id] || {});
  }
  return out;
}

/** Returns one section's photos. */
function tabPhotosFor(section) {
  const id = assertSection(section);
  return allTabPhotos()[id];
}

/**
 * Saves cover photo and/or gallery for one section.
 * Callers have already resolved data: URLs to saved file paths.
 */
function saveTabPhotos(section, patch = {}) {
  const id = assertSection(section);
  const all = allTabPhotos();
  const current = all[id];

  if (patch.coverPhoto !== undefined) current.coverPhoto = String(patch.coverPhoto || '');
  if (patch.photos !== undefined) {
    const list = Array.isArray(patch.photos)
      ? patch.photos
      : String(patch.photos || '').split('\n').map((s) => s.trim()).filter(Boolean);
    current.photos = list.slice(0, TAB_PHOTO_LIMIT);
  }

  const meta = db.get('meta');
  meta.tabPhotos = Object.assign({}, all, { [id]: current });
  db.markDirty('meta');
  return current;
}

/** What the client app receives for a section's photos. */
function publicTabPhotos(section) {
  const id = assertSection(section);
  const p = tabPhotosFor(id);
  return {
    section: id,
    coverPhoto: p.coverPhoto || '',
    photos: p.photos || [],
  };
}

module.exports = {
  SECTIONS,
  SECTION_IDS,
  SLIDER_DEFAULTS,
  INTERVAL_BOUNDS,
  TAB_PHOTO_LIMIT,
  isSection,
  assertSection,
  sectionLabel,
  settings,
  sliderSettings,
  saveSliderSettings,
  slideById,
  slidesFor,
  saveSlide,
  removeSlide,
  moveSlide,
  publicSlide,
  publicSlider,
  adminPayload,
  ensureSlides,
  allTabPhotos,
  tabPhotosFor,
  saveTabPhotos,
  publicTabPhotos,
};
