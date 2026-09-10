'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../db');
const auth = require('../auth');
const hotels = require('../hotels');
const dine = require('../dinein');
const park = require('../waterpark');
const promos = require('../promos');
const storage = require('../storage');
const { notify } = require('../bookings');
const { computeWaterparkTotals, resolveWaterparkOffer } = require('../pricing');
const { LAYOUTS } = require('../catalog');
const { ensureRollingShowtimes, markSeedRemoved, unmarkSeedRemoved } = require('../seed');
const { Router, HttpError } = require('../router');
const {
  PROPERTY_PHOTO_CATEGORY_IDS,
  PHOTOS_PER_CATEGORY,
  isPropertyPhotoCategory,
} = require('../hotelPhotos');

const router = new Router();

const MOVIE_FIELDS = [
  'title', 'tagline', 'status', 'genres', 'languages', 'formats', 'certificate',
  'runtime', 'rating', 'votes', 'releaseDate', 'director', 'cast', 'castPhotos', 'synopsis',
  'trailerUrl', 'posterUrl', 'backdropUrl', 'accentColor', 'active', 'tmdbId',
  'tierPrices', // per-movie tier pricing: { sofa, recliner, platinum, gold, silver }
];
const CINEMA_FIELDS = ['name', 'brand', 'city', 'area', 'address', 'lat', 'lng', 'distanceKm', 'rating', 'facilities', 'active'];
const FOOD_FIELDS = ['name', 'category', 'price', 'description', 'size', 'veg', 'popular', 'imageUrl', 'available'];
const OFFER_FIELDS = ['title', 'subtitle', 'code', 'discountType', 'discountValue', 'maxDiscount', 'minAmount', 'appliesTo', 'bannerUrl', 'active'];
const EXPERIENCE_FIELDS = ['title', 'category', 'subtitle', 'icon', 'color', 'priceLabel', 'priceNote', 'features', 'badge', 'order', 'active', 'image'];
const HOTEL_FIELDS = [
  'name', 'tagline', 'area', 'city', 'address', 'phone', 'rating', 'reviewCount',
  'checkInTime', 'checkOutTime', 'coverPhoto', 'photos', 'propertyPhotos', 'amenities', 'policies', 'active',
];
const ROOM_FIELDS = [
  'name', 'subtitle', 'sizeSqft', 'sizeSqmt', 'view', 'bedType', 'bedCount', 'bathrooms',
  'maxGuests', 'maxChildren', 'totalRooms', 'mrpPerNight', 'pricePerNight', 'taxesPerNight',
  'badge', 'photos', 'popularAmenities', 'amenityGroups', 'inclusions', 'order', 'active',
];

// Uploaded photos arrive as a data: URL and are saved to disk here so the JSON
// db only ever stores a path. They go to the upload directory (a mounted volume
// in production) rather than into public/, which is rebuilt on every deploy.
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,/i;

/** Saves a data: URL into the upload directory and returns its public URL. */
function saveUploadedImage(folder, slug, dataUrl) {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) throw new HttpError(400, 'Image must be a PNG, JPEG or WEBP file');
  const ext = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  const base64 = dataUrl.slice(match[0].length);
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 10 * 1024 * 1024) throw new HttpError(400, 'Image is too large (max 10 MB)');

  const dir = path.join(storage.UPLOAD_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Random suffix so several photos saved in the same millisecond cannot collide.
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const filename = `${slug || 'photo'}-${unique}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return storage.uploadUrl(folder, filename);
}

function isDataUrl(value) {
  return typeof value === 'string' && DATA_URL_RE.test(value);
}

/** Mutates body.image in place: a data: URL becomes a saved file path, anything else passes through untouched. */
function resolveExperienceImage(body, slug) {
  if (isDataUrl(body.image)) body.image = saveUploadedImage('experiences', slug, body.image);
}

/**
 * Normalises a photo gallery: accepts an array or newline/comma separated text,
 * persists any freshly uploaded data: URLs and leaves existing paths alone.
 */
function resolvePhotoList(value, folder, slug, limit = 12) {
  if (value === undefined) return undefined;

  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]/)
        .map((s) => s.trim());

  return list
    .filter(Boolean)
    .slice(0, limit)
    .map((entry) => (isDataUrl(entry) ? saveUploadedImage(folder, slug, entry) : entry));
}

/**
 * Normalises the whole { category: [photos] } property gallery map. Unknown
 * categories are dropped and empty ones are omitted so the stored record only
 * ever holds categories that actually have photos.
 */
function resolvePropertyPhotos(value, slug) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'propertyPhotos must be an object keyed by category');
  }

  const out = {};
  for (const category of PROPERTY_PHOTO_CATEGORY_IDS) {
    if (value[category] === undefined) continue;
    const photos = resolvePhotoList(value[category], 'hotels', slug, PHOTOS_PER_CATEGORY);
    if (photos && photos.length) out[category] = photos;
  }
  return out;
}

function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === '' || body[f] === null);
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`);
}

/** 'a, b, c' -> ['a','b','c'] (already-arrays pass through). */
function csv(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** One item per line -> array. Used for policies and amenity groups. */
function lines(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Amenity groups are edited as plain text, one group per line:
 *   Bathroom: Towels, Slippers, Toiletries
 * which keeps the admin form simple while the app still gets structured data.
 */
function parseAmenityGroups(value) {
  if (Array.isArray(value)) {
    return value
      .filter((g) => g && (g.title || g.items))
      .map((g) => ({ title: String(g.title || '').trim(), items: csv(g.items) }))
      .filter((g) => g.title && g.items.length);
  }

  return lines(value)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return null;
      const title = line.slice(0, idx).trim();
      const items = csv(line.slice(idx + 1));
      return title && items.length ? { title, items } : null;
    })
    .filter(Boolean);
}

/** Coerces the room form's text inputs into the right types. */
function normaliseRoom(body, slug) {
  const numbers = [
    'sizeSqft', 'sizeSqmt', 'bedCount', 'bathrooms', 'maxGuests', 'maxChildren',
    'totalRooms', 'mrpPerNight', 'pricePerNight', 'taxesPerNight', 'order',
  ];
  for (const key of numbers) {
    if (body[key] !== undefined && body[key] !== '') body[key] = Math.max(0, Number(body[key]) || 0);
  }

  if (body.pricePerNight !== undefined && !(Number(body.pricePerNight) > 0)) {
    throw new HttpError(400, 'Nightly rate must be greater than zero');
  }
  if (body.totalRooms !== undefined && !(Number(body.totalRooms) > 0)) {
    throw new HttpError(400, 'Total rooms must be at least 1');
  }

  if (body.popularAmenities !== undefined) body.popularAmenities = csv(body.popularAmenities);
  if (body.inclusions !== undefined) body.inclusions = csv(body.inclusions);
  if (body.amenityGroups !== undefined) body.amenityGroups = parseAmenityGroups(body.amenityGroups);

  const photos = resolvePhotoList(body.photos, 'hotels', slug);
  if (photos !== undefined) body.photos = photos;

  return body;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/admin/stats', auth.requireAdmin, () => {
  const bookings = db.get('bookings');
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const revenue = active.reduce((s, b) => s + (b.amounts?.total || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todays = active.filter((b) => String(b.createdAt).slice(0, 10) === today);

  const perMovie = new Map();
  for (const b of active) {
    if (!b.movieId) continue;
    const entry = perMovie.get(b.movieId) || { movieId: b.movieId, bookings: 0, seats: 0, revenue: 0 };
    entry.bookings += 1;
    entry.seats += (b.seats || []).length;
    entry.revenue += b.amounts?.total || 0;
    perMovie.set(b.movieId, entry);
  }
  const topMovies = [...perMovie.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((e) => Object.assign(e, { title: (db.byId('movies', e.movieId) || {}).title || 'Unknown' }));

  // Revenue for the last 7 days, oldest first.
  const trend = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayBookings = active.filter((b) => String(b.createdAt).slice(0, 10) === key);
    trend.push({
      date: key,
      bookings: dayBookings.length,
      revenue: dayBookings.reduce((s, b) => s + (b.amounts?.total || 0), 0),
    });
  }

  const seatsSold = active.reduce((s, b) => s + (b.seats || []).length, 0);

  // Stay revenue is broken out separately: it does not sell seats, so it would
  // otherwise be invisible next to the movie numbers.
  const stays = active.filter((b) => b.type === 'hotel');
  const stayStats = {
    bookings: stays.length,
    revenue: stays.reduce((s, b) => s + (b.amounts?.total || 0), 0),
    roomNights: stays.reduce((s, b) => s + (Number(b.stay?.nights) || 0) * (Number(b.stay?.rooms) || 1), 0),
    upcoming: stays.filter((b) => (b.stay?.checkOut || '') >= new Date().toISOString().slice(0, 10)).length,
  };

  // Dine-In lives in its own collections, so it is summarised separately too.
  // `discountGiven` is the number that matters here: it is what the instant
  // 30%/10% offer actually cost, against the bills it brought in.
  const dineBills = db.get('dineBills');
  const dineStats = {
    bills: dineBills.length,
    revenue: dineBills.reduce((s, b) => s + (b.amounts?.total || 0), 0),
    billed: dineBills.reduce((s, b) => s + (b.amounts?.billAmount || 0), 0),
    discountGiven: dineBills.reduce((s, b) => s + (b.amounts?.discount || 0), 0),
    reservedBills: dineBills.filter((b) => b.mode === 'reserved').length,
    walkinBills: dineBills.filter((b) => b.mode === 'walkin').length,
    reservations: db.get('dineReservations').length,
    upcomingReservations: db.find(
      'dineReservations',
      (r) => r.status === 'confirmed' && new Date(r.startsAt).getTime() > Date.now()
    ).length,
  };

  // The water park sells day passes out of its own collection, so it is
  // summarised separately too. `savingGiven` is the number that matters here:
  // it is what the bundled package pricing cost against counter rates, set
  // against the guests it brought through the gate.
  const parkPasses = db.get('waterparkBookings').filter((b) => b.status === 'confirmed');
  const parkToday = new Date().toISOString().slice(0, 10);
  const parkStats = {
    bookings: parkPasses.length,
    revenue: parkPasses.reduce((s, b) => s + (b.amounts?.total || 0), 0),
    guests: parkPasses.reduce((s, b) => s + (b.guests?.total || 0), 0),
    savingGiven: parkPasses.reduce((s, b) => s + (b.amounts?.totalSaving || 0), 0),
    addOnRevenue: parkPasses.reduce((s, b) => s + (b.amounts?.addOnAmount || 0), 0),
    packageBookings: parkPasses.filter((b) => b.mode === 'package').length,
    individualBookings: parkPasses.filter((b) => b.mode === 'individual').length,
    upcoming: parkPasses.filter((b) => (b.date || '') >= parkToday).length,
    todayGuests: parkPasses.filter((b) => b.date === parkToday).reduce((s, b) => s + (b.guests?.total || 0), 0),
  };

  // Occupancy is only meaningful for shows that have actually run - measuring
  // sold seats against every future showtime would always round to ~0%.
  const now = Date.now();
  const pastShowIds = new Set();
  let pastCapacity = 0;
  for (const show of db.get('showtimes')) {
    if (new Date(show.startsAt).getTime() > now) continue;
    pastShowIds.add(show.id);
    const screen = db.byId('screens', show.screenId);
    if (screen) pastCapacity += (screen.layout || []).reduce((a, r) => a + r.seats, 0);
  }
  const seatsSoldOnPastShows = active
    .filter((b) => pastShowIds.has(b.showtimeId))
    .reduce((s, b) => s + (b.seats || []).length, 0);

  return {
    totals: {
      movies: db.get('movies').length,
      nowPlaying: db.find('movies', (m) => m.status === 'now_playing').length,
      comingSoon: db.find('movies', (m) => m.status === 'coming_soon').length,
      cinemas: db.get('cinemas').length,
      screens: db.get('screens').length,
      showtimes: db.get('showtimes').length,
      foodItems: db.get('foodItems').length,
      offers: db.get('offers').length,
      experiences: db.get('experiences').length,
      hotelRooms: db.get('hotelRooms').length,
      dineReservations: db.get('dineReservations').length,
      dineBills: db.get('dineBills').length,
      waterparkBookings: db.get('waterparkBookings').length,
      users: db.find('users', (u) => u.role === 'customer').length,
      bookings: bookings.length,
      cancelled: bookings.filter((b) => b.status === 'cancelled').length,
      seatsSold,
      revenue,
      occupancyPercent: pastCapacity ? Math.round((seatsSoldOnPastShows / pastCapacity) * 1000) / 10 : 0,
      showsCompleted: pastShowIds.size,
    },
    today: { bookings: todays.length, revenue: todays.reduce((s, b) => s + (b.amounts?.total || 0), 0) },
    stays: stayStats,
    dine: dineStats,
    park: parkStats,
    topMovies,
    trend,
  };
});

// ── TMDB lookup (movie autofill) ────────────────────────────────────────────
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

function tmdbHeaders() {
  const token = process.env.TMDB_API_TOKEN;
  if (!token) throw new HttpError(503, 'TMDB is not configured on the server (missing TMDB_API_TOKEN)');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

router.get('/admin/tmdb/search', auth.requireAdmin, async (ctx) => {
  const q = (ctx.query.q || '').trim();
  if (!q) return { results: [] };
  const url = `${TMDB_BASE}/search/movie?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`;
  const res = await fetch(url, { headers: tmdbHeaders() });
  if (!res.ok) throw new HttpError(res.status === 401 ? 503 : 502, 'TMDB search failed');
  const data = await res.json();
  return {
    results: (data.results || []).slice(0, 8).map((m) => ({
      id: m.id,
      title: m.title,
      year: (m.release_date || '').slice(0, 4),
      posterUrl: m.poster_path ? `${TMDB_IMG}/w185${m.poster_path}` : null,
      overview: m.overview,
    })),
  };
});

router.get('/admin/tmdb/movie/:id', auth.requireAdmin, async (ctx) => {
  const detailUrl = `${TMDB_BASE}/movie/${encodeURIComponent(ctx.params.id)}?append_to_response=credits,videos&language=en-US`;
  const res = await fetch(detailUrl, { headers: tmdbHeaders() });
  if (!res.ok) throw new HttpError(res.status === 401 ? 503 : 502, 'TMDB lookup failed');
  const m = await res.json();

  const director = (m.credits?.crew || []).find((c) => c.job === 'Director');
  const castPeople = (m.credits?.cast || []).slice(0, 8);
  const cast = castPeople.map((c) => c.name);
  const castPhotos = {};
  castPeople.forEach((c) => { if (c.profile_path) castPhotos[c.name] = `${TMDB_IMG}/w185${c.profile_path}`; });
  const trailer = (m.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const certLookup = { G: 'U', PG: 'UA', 'PG-13': 'UA', R: 'A', 'NC-17': 'A' };

  return {
    movie: {
      tmdbId: m.id,
      title: m.title || '',
      tagline: m.tagline || '',
      genres: (m.genres || []).map((g) => g.name),
      languages: [m.original_language ? m.original_language.toUpperCase() : ''].filter(Boolean),
      runtime: m.runtime || 120,
      rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : 0,
      votes: m.vote_count || 0,
      releaseDate: m.release_date || '',
      director: director ? director.name : '',
      cast,
      castPhotos,
      synopsis: m.overview || '',
      trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '',
      posterUrl: m.poster_path ? `${TMDB_IMG}/w500${m.poster_path}` : '',
      backdropUrl: m.backdrop_path ? `${TMDB_IMG}/w1280${m.backdrop_path}` : '',
      certificate: certLookup[m.certification] || 'UA',
    },
  };
});

// ── Movies ───────────────────────────────────────────────────────────────────
router.post('/admin/movies', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['title', 'status']);
  const slug = slugify(ctx.body.slug || ctx.body.title);
  if (db.findOne('movies', (m) => m.slug === slug)) throw new HttpError(409, 'A movie with that name already exists');

  const movie = db.insert('movies', Object.assign(
    {
      id: db.id('mov'),
      slug,
      genres: [],
      languages: [],
      formats: ['2D'],
      certificate: 'UA',
      runtime: 120,
      rating: 0,
      votes: 0,
      cast: [],
      castPhotos: {},
      tmdbId: null,
      synopsis: '',
      posterUrl: '/img/posters/_placeholder.svg',
      backdropUrl: '/img/posters/_placeholder.svg',
      accentColor: '#6D28D9',
      active: true,
      tierPrices: { sofa: 500, recliner: 500, platinum: 400, gold: 300, silver: 250 },
    },
    pick(ctx.body, MOVIE_FIELDS)
  ));
  ctx.state.status = 201;
  return { movie };
});

router.put('/admin/movies/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('movies', ctx.params.id)) throw new HttpError(404, 'Movie not found');
  return { movie: db.update('movies', ctx.params.id, pick(ctx.body, MOVIE_FIELDS)) };
});

router.delete('/admin/movies/:id', auth.requireAdmin, (ctx) => {
  const movie = db.byId('movies', ctx.params.id);
  if (!movie) throw new HttpError(404, 'Movie not found');

  const showIds = new Set(db.find('showtimes', (s) => s.movieId === movie.id).map((s) => s.id));
  const booked = db.find('bookings', (b) => showIds.has(b.showtimeId) && b.status === 'confirmed');
  if (booked.length) {
    // Never orphan a paid ticket - retire the title instead of deleting it.
    db.update('movies', movie.id, { active: false, status: 'archived' });
    return { archived: true, reason: `${booked.length} active booking(s) reference this movie`, movie: db.byId('movies', movie.id) };
  }

  db.replace('showtimes', db.get('showtimes').filter((s) => s.movieId !== movie.id));
  db.remove('movies', movie.id);
  return { deleted: true, id: movie.id };
});

// ── Cinemas & screens ────────────────────────────────────────────────────────
router.post('/admin/cinemas', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['name', 'city']);
  const slug = slugify(ctx.body.slug || ctx.body.name);
  if (db.findOne('cinemas', (c) => c.slug === slug)) throw new HttpError(409, 'A cinema with that name already exists');

  const cinema = db.insert('cinemas', Object.assign(
    { id: db.id('cin'), slug, brand: '', area: '', address: '', distanceKm: 0, rating: 4, facilities: [], active: true },
    pick(ctx.body, CINEMA_FIELDS)
  ));
  ctx.state.status = 201;
  return { cinema };
});

router.put('/admin/cinemas/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('cinemas', ctx.params.id)) throw new HttpError(404, 'Cinema not found');
  return { cinema: db.update('cinemas', ctx.params.id, pick(ctx.body, CINEMA_FIELDS)) };
});

router.delete('/admin/cinemas/:id', auth.requireAdmin, (ctx) => {
  const cinema = db.byId('cinemas', ctx.params.id);
  if (!cinema) throw new HttpError(404, 'Cinema not found');
  const showIds = new Set(db.find('showtimes', (s) => s.cinemaId === cinema.id).map((s) => s.id));
  if (db.find('bookings', (b) => showIds.has(b.showtimeId) && b.status === 'confirmed').length) {
    db.update('cinemas', cinema.id, { active: false });
    return { archived: true, reason: 'Active bookings exist for this cinema', cinema: db.byId('cinemas', cinema.id) };
  }
  db.replace('showtimes', db.get('showtimes').filter((s) => s.cinemaId !== cinema.id));
  db.replace('screens', db.get('screens').filter((s) => s.cinemaId !== cinema.id));
  db.remove('cinemas', cinema.id);
  return { deleted: true, id: cinema.id };
});

router.get('/admin/screens', auth.requireAdmin, (ctx) => {
  let list = db.get('screens');
  if (ctx.query.cinemaId) list = list.filter((s) => s.cinemaId === ctx.query.cinemaId);
  return {
    layoutPresets: Object.keys(LAYOUTS),
    screens: list.map((s) => Object.assign({}, s, {
      cinemaName: (db.byId('cinemas', s.cinemaId) || {}).name || '',
      capacity: (s.layout || []).reduce((a, r) => a + r.seats, 0),
    })),
  };
});

router.post('/admin/screens', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['cinemaId', 'name']);
  if (!db.byId('cinemas', ctx.body.cinemaId)) throw new HttpError(404, 'Cinema not found');
  // Must name a preset that actually exists, or creating a screen without an
  // explicit layout would always 400.
  const preset = ctx.body.layoutPreset || 'kingfisher-standard';
  if (!LAYOUTS[preset]) throw new HttpError(400, `Layout must be one of: ${Object.keys(LAYOUTS).join(', ')}`);

  const screen = db.insert('screens', {
    id: db.id('scr'),
    cinemaId: ctx.body.cinemaId,
    name: ctx.body.name,
    format: ctx.body.format || '2D',
    soundSystem: ctx.body.soundSystem || 'Dolby 7.1',
    layoutPreset: preset,
    layout: Array.isArray(ctx.body.layout) && ctx.body.layout.length ? ctx.body.layout : LAYOUTS[preset],
    blockedSeats: ctx.body.blockedSeats || [],
    active: true,
  });
  ctx.state.status = 201;
  return { screen };
});

router.put('/admin/screens/:id', auth.requireAdmin, (ctx) => {
  const screen = db.byId('screens', ctx.params.id);
  if (!screen) throw new HttpError(404, 'Screen not found');
  const patch = {};
  for (const f of ['name', 'format', 'soundSystem', 'blockedSeats', 'active']) {
    if (ctx.body[f] !== undefined) patch[f] = ctx.body[f];
  }
  if (ctx.body.layoutPreset && LAYOUTS[ctx.body.layoutPreset]) {
    patch.layoutPreset = ctx.body.layoutPreset;
    patch.layout = LAYOUTS[ctx.body.layoutPreset];
  }
  if (Array.isArray(ctx.body.layout) && ctx.body.layout.length) patch.layout = ctx.body.layout;
  return { screen: db.update('screens', screen.id, patch) };
});

router.delete('/admin/screens/:id', auth.requireAdmin, (ctx) => {
  const screen = db.byId('screens', ctx.params.id);
  if (!screen) throw new HttpError(404, 'Screen not found');
  const showIds = new Set(db.find('showtimes', (s) => s.screenId === screen.id).map((s) => s.id));
  if (db.find('bookings', (b) => showIds.has(b.showtimeId) && b.status === 'confirmed').length) {
    db.update('screens', screen.id, { active: false });
    return { archived: true, reason: 'Active bookings exist on this screen' };
  }
  db.replace('showtimes', db.get('showtimes').filter((s) => s.screenId !== screen.id));
  db.remove('screens', screen.id);
  return { deleted: true, id: screen.id };
});

// One-time cleanup: wipes every screen, showtime, booking and seat hold — including ones
// with confirmed bookings — so demo/dummy seating data can be cleared before adding real
// screens. This is intentionally forceful (skips the "archive instead of delete" guard
// used elsewhere) since it's meant for clearing out seed/demo data, not day-to-day use.
// Clear all showtimes and seat holds without touching bookings or screens.
router.post('/admin/clear-showtimes', auth.requireAdmin, () => {
  const counts = {
    showtimes: db.get('showtimes').length,
    seatHolds: db.get('seatHolds').length,
  };
  db.replace('showtimes', []);
  db.replace('seatHolds', []);
  return { cleared: counts };
});

router.post('/admin/purge-dummy-screens', auth.requireAdmin, () => {
  const counts = {
    screens: db.get('screens').length,
    showtimes: db.get('showtimes').length,
    bookings: db.get('bookings').length,
    seatHolds: db.get('seatHolds').length,
  };
  db.replace('screens', []);
  db.replace('showtimes', []);
  db.replace('bookings', []);
  db.replace('seatHolds', []);
  return { purged: counts };
});

// ── Showtimes ────────────────────────────────────────────────────────────────
router.post('/admin/showtimes', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['movieId', 'screenId', 'date', 'time']);
  const movie = db.byId('movies', ctx.body.movieId);
  if (!movie) throw new HttpError(404, 'Movie not found');
  const screen = db.byId('screens', ctx.body.screenId);
  if (!screen) throw new HttpError(404, 'Screen not found');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.body.date)) throw new HttpError(400, 'Date must be YYYY-MM-DD');
  if (!/^\d{2}:\d{2}$/.test(ctx.body.time)) throw new HttpError(400, 'Time must be HH:MM');

  if (db.findOne('showtimes', (s) => s.screenId === screen.id && s.date === ctx.body.date && s.time === ctx.body.time)) {
    throw new HttpError(409, 'That screen already has a show at this date and time');
  }

  const [y, m, d] = ctx.body.date.split('-').map(Number);
  const [hh, mm] = ctx.body.time.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm);

  // Prices come from the movie's tierPrices — not a base multiplier.
  const moviePrices = movie.tierPrices || { sofa: 500, recliner: 500, platinum: 400, gold: 300, silver: 250 };

  const showtime = db.insert('showtimes', {
    id: db.id('sht'),
    movieId: movie.id,
    cinemaId: screen.cinemaId,
    screenId: screen.id,
    date: ctx.body.date,
    time: ctx.body.time,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + (movie.runtime + 25) * 60_000).toISOString(),
    format: ctx.body.format || screen.format,
    language: ctx.body.language || movie.languages[0] || 'Hindi',
    prices: moviePrices,
    status: 'active',
  });
  ctx.state.status = 201;
  return { showtime };
});

router.put('/admin/showtimes/:id', auth.requireAdmin, (ctx) => {
  const show = db.byId('showtimes', ctx.params.id);
  if (!show) throw new HttpError(404, 'Showtime not found');
  const patch = {};
  for (const f of ['format', 'language', 'prices', 'status']) if (ctx.body[f] !== undefined) patch[f] = ctx.body[f];
  if (ctx.body.time) patch.time = ctx.body.time;
  if (ctx.body.date) patch.date = ctx.body.date;
  if (ctx.body.screenId) {
    const screen = db.byId('screens', ctx.body.screenId);
    if (!screen) throw new HttpError(404, 'Screen not found');
    // check for conflict
    const conflict = db.findOne('showtimes', (s) => s.id !== show.id && s.screenId === screen.id && s.date === (patch.date || show.date) && s.time === (patch.time || show.time));
    if (conflict) throw new HttpError(409, 'A showtime already exists for that screen/date/time');
    patch.screenId = screen.id;
    patch.cinemaId = screen.cinemaId;
    patch.format = screen.format;
  }
  return { showtime: db.update('showtimes', show.id, patch) };
});

router.delete('/admin/showtimes/:id', auth.requireAdmin, (ctx) => {
  const show = db.byId('showtimes', ctx.params.id);
  if (!show) throw new HttpError(404, 'Showtime not found');
  if (db.find('bookings', (b) => b.showtimeId === show.id && b.status === 'confirmed').length) {
    db.update('showtimes', show.id, { status: 'cancelled' });
    return { cancelled: true, reason: 'Active bookings exist - show marked cancelled instead of deleted' };
  }
  db.remove('showtimes', show.id);
  return { deleted: true, id: show.id };
});

router.post('/admin/showtimes/generate', auth.requireAdmin, () => ({
  created: ensureRollingShowtimes(),
  total: db.get('showtimes').length,
}));

// Backfill: update all existing showtime prices from their movie's tierPrices.
router.post('/admin/showtimes/sync-prices', auth.requireAdmin, () => {
  let updated = 0;
  for (const show of db.get('showtimes')) {
    const movie = db.byId('movies', show.movieId);
    if (!movie || !movie.tierPrices) continue;
    db.update('showtimes', show.id, { prices: movie.tierPrices });
    updated += 1;
  }
  return { updated };
});

// ── Food & offers ────────────────────────────────────────────────────────────
router.post('/admin/food', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['name', 'price']);
  const slug = slugify(ctx.body.slug || ctx.body.name);
  const item = db.insert('foodItems', Object.assign(
    { id: db.id('food'), slug, category: 'Snacks', description: '', size: '', veg: true, popular: false, imageUrl: '/img/food/_placeholder.svg', available: true },
    pick(ctx.body, FOOD_FIELDS)
  ));
  ctx.state.status = 201;
  return { item };
});

router.put('/admin/food/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('foodItems', ctx.params.id)) throw new HttpError(404, 'Food item not found');
  // `adminEdited` stops the boot-time catalogue resync from reverting this item.
  const patch = Object.assign(pick(ctx.body, FOOD_FIELDS), { adminEdited: true });
  return { item: db.update('foodItems', ctx.params.id, patch) };
});

router.delete('/admin/food/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('foodItems', ctx.params.id)) throw new HttpError(404, 'Food item not found');
  db.remove('foodItems', ctx.params.id);
  markSeedRemoved(ctx.params.id); // stays deleted across restarts
  return { deleted: true, id: ctx.params.id };
});

router.post('/admin/offers', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['title', 'code', 'discountType', 'discountValue']);
  const code = String(ctx.body.code).toUpperCase();
  if (db.findOne('offers', (o) => o.code === code)) throw new HttpError(409, 'That offer code already exists');
  const offer = db.insert('offers', Object.assign(
    { id: db.id('off'), slug: slugify(ctx.body.title), subtitle: '', maxDiscount: 0, minAmount: 0, appliesTo: 'all', bannerUrl: '/img/banners/best-ticket-offers.svg', active: true },
    pick(ctx.body, OFFER_FIELDS),
    { code }
  ));
  ctx.state.status = 201;
  return { offer };
});

router.put('/admin/offers/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('offers', ctx.params.id)) throw new HttpError(404, 'Offer not found');
  const patch = pick(ctx.body, OFFER_FIELDS);
  if (patch.code) patch.code = String(patch.code).toUpperCase();
  return { offer: db.update('offers', ctx.params.id, patch) };
});

router.delete('/admin/offers/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('offers', ctx.params.id)) throw new HttpError(404, 'Offer not found');
  db.remove('offers', ctx.params.id);
  return { deleted: true, id: ctx.params.id };
});

// ── Experiences (pool party, water park, wedding, etc.) ──────────────────────
router.get('/admin/experiences', auth.requireAdmin, () => {
  const list = [...db.get('experiences')].sort((a, b) => (a.order || 0) - (b.order || 0));
  return { experiences: list };
});

router.post('/admin/experiences', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['title', 'category']);
  const body = Object.assign({}, ctx.body);
  if (typeof body.features === 'string') body.features = body.features.split(',').map((s) => s.trim()).filter(Boolean);
  const slug = slugify(ctx.body.title);
  resolveExperienceImage(body, slug);
  const experience = db.insert('experiences', Object.assign(
    { id: db.id('exp'), slug, subtitle: '', icon: 'sparkle', color: '#7C3AED', priceLabel: '', priceNote: '', features: [], badge: '', order: db.get('experiences').length + 1, active: true, image: '' },
    pick(body, EXPERIENCE_FIELDS)
  ));
  ctx.state.status = 201;
  return { experience };
});

router.put('/admin/experiences/:id', auth.requireAdmin, (ctx) => {
  const existing = db.byId('experiences', ctx.params.id);
  if (!existing) throw new HttpError(404, 'Experience not found');
  const body = Object.assign({}, ctx.body);
  if (typeof body.features === 'string') body.features = body.features.split(',').map((s) => s.trim()).filter(Boolean);
  resolveExperienceImage(body, existing.slug || slugify(existing.title));
  // `adminEdited` stops the boot-time catalogue resync from reverting this entry.
  const patch = Object.assign(pick(body, EXPERIENCE_FIELDS), { adminEdited: true });
  return { experience: db.update('experiences', ctx.params.id, patch) };
});

router.delete('/admin/experiences/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('experiences', ctx.params.id)) throw new HttpError(404, 'Experience not found');
  db.remove('experiences', ctx.params.id);
  markSeedRemoved(ctx.params.id); // stays deleted across restarts
  return { deleted: true, id: ctx.params.id };
});

// ── Dine-In (discounts, notices, reservations, bills) ────────────────────────
/**
 * Everything the Dine-In admin section renders: the live settings (so the
 * discount and notice inputs show what customers are being offered right now),
 * a preview of each notice with its {tokens} already substituted, and the
 * reservation/bill ledgers.
 */
router.get('/admin/dine-in', auth.requireAdmin, () => {
  const s = dine.settings();
  const customerName = (userId) => {
    const user = db.byId('users', userId);
    return user ? user.name : 'Unknown';
  };

  const reservations = [...db.get('dineReservations')]
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
    .slice(0, 200)
    .map((r) => Object.assign(dine.decorateReservation(r, s), { customerName: customerName(r.userId) }));

  const bills = [...db.get('dineBills')]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 200)
    .map((b) => Object.assign({}, b, { customerName: customerName(b.userId) }));

  return {
    settings: s,
    defaults: dine.DEFAULTS,
    /** Token reference shown under the notice inputs in the admin form. */
    noticeTokens: Object.keys(dine.noticeTokens(s)),
    /** Live render of each notice, so the admin sees exactly what a guest reads. */
    previews: {
      reserved: dine.renderNotice(s.reservedNotice, dine.noticeTokens(s)),
      locked: dine.renderNotice(
        s.lockedNotice,
        dine.noticeTokens(s, {
          minutesLeft: dine.durationLabel(s.lockMinutes),
          unlockTime: dine.clockLabel(new Date(Date.now() + s.lockMinutes * 60000)),
        })
      ),
      walkin: dine.renderNotice(s.walkinNotice, dine.noticeTokens(s)),
      paidReserved: dine.renderNotice(
        s.paidReservedNotice,
        dine.noticeTokens(s, { saving: dine.money(Math.round((1000 * s.reservedDiscountPercent) / 100)) })
      ),
      paidWalkin: dine.renderNotice(
        s.paidWalkinNotice,
        dine.noticeTokens(s, { saving: dine.money(Math.round((1000 * s.walkinDiscountPercent) / 100)) })
      ),
    },
    stats: {
      bills: db.get('dineBills').length,
      revenue: db.get('dineBills').reduce((sum, b) => sum + (b.amounts?.total || 0), 0),
      discountGiven: db.get('dineBills').reduce((sum, b) => sum + (b.amounts?.discount || 0), 0),
      reservations: db.get('dineReservations').length,
      upcoming: db.find(
        'dineReservations',
        (r) => r.status === 'confirmed' && new Date(r.startsAt).getTime() > Date.now()
      ).length,
    },
    reservations,
    bills,
  };
});

/**
 * Updates discounts, the lock window and the notice copy. Takes effect on the
 * very next customer request - both the amount they are charged and the wording
 * of the notice they are shown come from here.
 */
router.put('/admin/dine-in/settings', auth.requireAdmin, (ctx) => {
  const settings = dine.saveSettings(ctx.body || {});
  return { settings, previews: { walkin: dine.renderNotice(settings.walkinNotice, dine.noticeTokens(settings)) } };
});

/** Restores the shipped notice wording, leaving the numbers alone. */
router.post('/admin/dine-in/notices/reset', auth.requireAdmin, () => {
  const patch = {};
  for (const key of dine.NOTICE_FIELDS) patch[key] = dine.DEFAULTS[key];
  return { settings: dine.saveSettings(patch) };
});

router.post('/admin/dine-in/reservations/:id/cancel', auth.requireAdmin, (ctx) => {
  const reservation = db.byId('dineReservations', ctx.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (reservation.status !== 'confirmed') throw new HttpError(400, 'That reservation is not active');
  const updated = db.update('dineReservations', ctx.params.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelledBy: 'admin',
  });
  // The guest loses their in-app discount, so they are told — same as when they
  // cancel it themselves.
  notify(
    reservation.userId,
    'Reservation cancelled',
    `Your table at ${dine.settings().restaurantName} on ${reservation.date} at ${reservation.time} ` +
      'was cancelled by the restaurant. Please call us to rebook.',
    'booking'
  );
  return { reservation: dine.decorateReservation(updated) };
});

router.delete('/admin/dine-in/reservations/:id', auth.requireAdmin, (ctx) => {
  const reservation = db.byId('dineReservations', ctx.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  // Deleting one that paid a bill would leave dineBills.reservationId dangling.
  if (reservation.billId) {
    throw new HttpError(400, 'That reservation settled a bill and is kept for the record');
  }
  db.remove('dineReservations', ctx.params.id);
  return { deleted: true, id: ctx.params.id };
});

// ── Water park (rate card, packages, add-ons, passes) ────────────────────────
/**
 * Everything the Water Park admin section renders in one payload.
 *
 * `packages` arrive already expanded by `decoratePackage()`, so the value
 * breakup, the total actual value and the "you save" figure in the admin table
 * are the same computed numbers the customer is shown — there is no second
 * copy of that arithmetic anywhere.
 */
router.get('/admin/waterpark', auth.requireAdmin, () => {
  const s = park.settings();
  const customerName = (userId) => {
    if (!userId) return 'Counter sale';
    const user = db.byId('users', userId);
    return user ? user.name : 'Unknown';
  };

  const all = db.get('waterparkBookings');
  const confirmed = all.filter((b) => b.status === 'confirmed');
  const todayKey = park.today();

  const bookings = [...all]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 200)
    .map((b) =>
      Object.assign(park.decorateBooking(b, s), {
        customerName: customerName(b.userId),
      })
    );

  /** Which rate-card lines and add-ons are actually selling. */
  const lineSales = new Map();
  for (const booking of confirmed) {
    for (const line of booking.lines || []) {
      const row = lineSales.get(line.itemId) || { itemId: line.itemId, label: line.label, qty: 0, revenue: 0 };
      row.qty += Number(line.qty) || 0;
      row.revenue += Number(line.value) || 0;
      lineSales.set(line.itemId, row);
    }
  }
  const addOnSales = new Map();
  for (const booking of confirmed) {
    for (const addOn of booking.addOns || []) {
      const row = addOnSales.get(addOn.id) || { id: addOn.id, label: addOn.label, qty: 0, revenue: 0 };
      row.qty += Number(addOn.qty) || 0;
      row.revenue += Number(addOn.value) || 0;
      addOnSales.set(addOn.id, row);
    }
  }

  const packageCounts = new Map();
  for (const booking of confirmed) {
    if (!booking.packageId) continue;
    packageCounts.set(booking.packageId, (packageCounts.get(booking.packageId) || 0) + (booking.packageQty || 1));
  }

  return {
    settings: s,
    defaults: park.DEFAULTS,
    units: park.UNITS,
    /** Token reference shown under the notice inputs in the admin form. */
    noticeTokens: Object.keys(park.noticeTokens(s)),
    /** Live render of each notice, so the admin sees exactly what a guest reads. */
    previews: {
      package: park.renderNotice(s.packageNotice, park.noticeTokens(s)),
      individual: park.renderNotice(s.individualNotice, park.noticeTokens(s)),
      paid: park.renderNotice(
        s.paidNotice,
        park.noticeTokens(s, { date: park.dateLabel(todayKey), time: park.timeLabel(s.openTime) })
      ),
      soldOut: park.renderNotice(
        s.soldOutNotice,
        park.noticeTokens(s, { date: park.dateLabel(todayKey), time: park.timeLabel(s.openTime) })
      ),
    },
    /** Inactive ones included: the admin needs to see and re-enable them. */
    packages: park.allPackages(s).map((p) =>
      Object.assign({}, p, { sold: packageCounts.get(p.id) || 0 })
    ),
    items: s.items.map((i) =>
      Object.assign({}, i, {
        sales: lineSales.get(i.id) || { qty: 0, revenue: 0 },
        /** Packages that would break if this line were deleted. */
        usedBy: s.packages.filter((p) => (p.lines || []).some((l) => l.itemId === i.id)).map((p) => p.name),
      })
    ),
    addOns: s.addOns.map((a) => Object.assign({}, a, { sales: addOnSales.get(a.id) || { qty: 0, revenue: 0 } })),
    stats: {
      bookings: confirmed.length,
      cancelled: all.filter((b) => b.status === 'cancelled').length,
      revenue: confirmed.reduce((sum, b) => sum + (b.amounts?.total || 0), 0),
      guests: confirmed.reduce((sum, b) => sum + (b.guests?.total || 0), 0),
      /** What the bundles cost against counter rates — the price of the promotion. */
      savingGiven: confirmed.reduce((sum, b) => sum + (b.amounts?.totalSaving || 0), 0),
      addOnRevenue: confirmed.reduce((sum, b) => sum + (b.amounts?.addOnAmount || 0), 0),
      packageBookings: confirmed.filter((b) => b.mode === 'package').length,
      individualBookings: confirmed.filter((b) => b.mode === 'individual').length,
      counterSales: confirmed.filter((b) => b.source === 'counter').length,
      todayGuests: confirmed.filter((b) => b.date === todayKey).reduce((sum, b) => sum + (b.guests?.total || 0), 0),
      todayRevenue: confirmed
        .filter((b) => b.date === todayKey)
        .reduce((sum, b) => sum + (b.amounts?.total || 0), 0),
      upcoming: confirmed.filter((b) => b.date >= todayKey).length,
      checkedIn: confirmed.filter((b) => b.checkedInAt).length,
    },
    bookings,
    /** Today's gate load, slot by slot. */
    todaySlots: park.slotsFor(todayKey, s),
    today: todayKey,
  };
});

/** Park identity, hours, capacity, charges and notice copy. */
router.put('/admin/waterpark/settings', auth.requireAdmin, (ctx) => {
  const settings = park.saveSettings(ctx.body || {});
  return {
    settings,
    previews: {
      package: park.renderNotice(settings.packageNotice, park.noticeTokens(settings)),
      individual: park.renderNotice(settings.individualNotice, park.noticeTokens(settings)),
    },
  };
});

/** Restores the shipped notice wording, leaving prices alone. */
router.post('/admin/waterpark/notices/reset', auth.requireAdmin, () => {
  const patch = {};
  for (const key of park.NOTICE_FIELDS) patch[key] = park.DEFAULTS[key];
  return { settings: park.saveSettings(patch) };
});

/**
 * Restores the whole shipped configuration — rate card, packages and add-ons.
 * The escape hatch for an admin who has edited the numbers into a corner.
 */
router.post('/admin/waterpark/reset', auth.requireAdmin, () => {
  const meta = db.get('meta');
  delete meta.waterPark;
  db.markDirty('meta');
  return { settings: park.settings(), packages: park.allPackages() };
});

// ── Rate card ──
/**
 * Creates or updates one rate-card line. Editing a rate here moves every
 * package's value breakup and the per-person builder at the same time, which
 * is the whole point of there being a single rate card.
 */
router.post('/admin/waterpark/items', auth.requireAdmin, (ctx) => {
  const item = park.saveItem(ctx.body || {});
  ctx.state.status = 201;
  return { item, packages: park.allPackages() };
});

router.put('/admin/waterpark/items/:id', auth.requireAdmin, (ctx) => {
  const existing = park.itemById(ctx.params.id);
  if (!existing) throw new HttpError(404, 'Rate-card line not found');
  const item = park.saveItem(Object.assign({}, ctx.body, { id: ctx.params.id }));
  return { item, packages: park.allPackages() };
});

router.delete('/admin/waterpark/items/:id', auth.requireAdmin, (ctx) => {
  park.removeItem(ctx.params.id);
  return { deleted: true, id: ctx.params.id };
});

// ── Packages ──
router.post('/admin/waterpark/packages', auth.requireAdmin, (ctx) => {
  const pkg = park.savePackage(ctx.body || {});
  ctx.state.status = 201;
  return { package: pkg };
});

router.put('/admin/waterpark/packages/:id', auth.requireAdmin, (ctx) => {
  if (!park.packageById(ctx.params.id)) throw new HttpError(404, 'Package not found');
  const pkg = park.savePackage(Object.assign({}, ctx.body, { id: ctx.params.id }));
  return { package: pkg };
});

router.delete('/admin/waterpark/packages/:id', auth.requireAdmin, (ctx) => {
  const sold = db.find(
    'waterparkBookings',
    (b) => b.packageId === ctx.params.id && b.status === 'confirmed'
  ).length;
  // Issued passes name the package, so it is switched off rather than removed
  // once it has sold — otherwise the ledger would reference a package that no
  // longer exists.
  if (sold) {
    const pkg = park.savePackage(Object.assign({}, park.packageById(ctx.params.id), { active: false }));
    return { deleted: false, deactivated: true, package: pkg, sold };
  }
  park.removePackage(ctx.params.id);
  return { deleted: true, id: ctx.params.id };
});

// ── Add-ons ──
router.post('/admin/waterpark/addons', auth.requireAdmin, (ctx) => {
  const addOn = park.saveAddOn(ctx.body || {});
  ctx.state.status = 201;
  return { addOn };
});

router.put('/admin/waterpark/addons/:id', auth.requireAdmin, (ctx) => {
  if (!park.addOnById(ctx.params.id)) throw new HttpError(404, 'Add-on not found');
  const addOn = park.saveAddOn(Object.assign({}, ctx.body, { id: ctx.params.id }));
  return { addOn };
});

router.delete('/admin/waterpark/addons/:id', auth.requireAdmin, (ctx) => {
  park.removeAddOn(ctx.params.id);
  return { deleted: true, id: ctx.params.id };
});

// ── Passes ──
/**
 * Prices an order without saving it. The admin counter-booking form calls this
 * on every keystroke so the clerk sees the live total, and it is the same
 * resolver the customer app quotes through.
 */
router.post('/admin/waterpark/quote', auth.requireAdmin, (ctx) => {
  const s = park.settings();
  const order = park.resolveOrder(ctx.body || {}, s);
  const offer = ctx.body && ctx.body.offerCode
    ? resolveWaterparkOffer(db.get('offers'), ctx.body.offerCode, {
        baseAmount: order.baseAmount,
        addOnAmount: order.addOnAmount,
        actualValue: order.actualValue,
      })
    : null;
  const amounts = computeWaterparkTotals({
    baseAmount: order.baseAmount,
    actualValue: order.actualValue,
    addOnAmount: order.addOnAmount,
    convenienceFeePercent: s.convenienceFeePercent,
    gstPercent: s.gstPercent,
    offer,
  });
  return {
    order,
    amounts,
    offer: offer ? { code: offer.code, title: offer.title } : null,
    offerRejected: Boolean(ctx.body && ctx.body.offerCode) && !offer,
    notice: park.orderNotice(order, s),
    slot: ctx.body && ctx.body.date && ctx.body.time ? park.slotFor(ctx.body.date, ctx.body.time, s) : null,
  };
});

/**
 * Sells a pass at the gate. This is what makes the tab usable for walk-ups:
 * no customer account is needed, the clerk records a name and phone, and the
 * booking is marked `source: 'counter'` so counter sales can be told apart
 * from app sales in the ledger.
 */
router.post('/admin/waterpark/bookings', auth.requireAdmin, (ctx) => {
  const body = ctx.body || {};
  const s = park.settings();

  const date = park.assertBookableDate(body.date || park.today(), s);
  if (!body.time) throw new HttpError(400, 'Pick an entry time');

  const order = park.resolveOrder(body, s);
  const offer = body.offerCode
    ? resolveWaterparkOffer(db.get('offers'), body.offerCode, {
        baseAmount: order.baseAmount,
        addOnAmount: order.addOnAmount,
        actualValue: order.actualValue,
      })
    : null;
  const amounts = computeWaterparkTotals({
    baseAmount: order.baseAmount,
    actualValue: order.actualValue,
    addOnAmount: order.addOnAmount,
    convenienceFeePercent: s.convenienceFeePercent,
    gstPercent: s.gstPercent,
    offer,
  });

  const slot = park.assertCapacity(date, body.time, order.guests.total, s);

  const guestName = String(body.guestName || '').trim();
  if (!guestName) throw new HttpError(400, "Enter the guest's name for the pass");

  // A counter sale may be attached to an existing customer account by email, so
  // the pass shows up in their app too.
  let userId = null;
  if (body.customerEmail) {
    const email = String(body.customerEmail).trim().toLowerCase();
    const user = db.findOne('users', (u) => String(u.email).toLowerCase() === email);
    if (!user) throw new HttpError(404, `No customer account for ${email}`);
    userId = user.id;
  }

  const method = body.paymentMethod || 'cash';
  const startsAt = park.stampFor(date, slot.time);

  const booking = db.insert('waterparkBookings', {
    id: db.id('wpb'),
    reference: db.reference('WP'),
    userId,
    type: 'waterpark',
    status: 'confirmed',

    mode: order.mode,
    packageId: order.packageId,
    packageCode: order.packageCode,
    packageName: order.packageName,
    packageQty: order.packageQty,
    lines: order.lines,
    addOns: order.addOns,
    guests: order.guests,

    date,
    time: slot.time,
    startsAt: startsAt ? startsAt.toISOString() : null,
    guest: {
      name: guestName.slice(0, 80),
      phone: String(body.guestPhone || '').trim().slice(0, 20),
    },

    amounts,
    offerCode: amounts.offerCode,
    payment: {
      method,
      methodLabel: method === 'cash' ? 'Cash at counter' : method === 'upi' ? 'UPI at counter' : 'Card at counter',
      status: 'paid',
      amount: amounts.total,
      transactionId: `TXN${db.reference('').slice(0, 10)}`,
      paidAt: new Date().toISOString(),
    },
    checkedInAt: null,
    source: 'counter',
    soldBy: ctx.user.id,
    notes: String(body.notes || '').trim().slice(0, 300),
    appliedRates: {
      parkName: s.parkName,
      validityNote: s.validityNote,
      convenienceFeePercent: s.convenienceFeePercent,
      gstPercent: s.gstPercent,
      lines: order.lines.map((l) => ({ itemId: l.itemId, label: l.label, rate: l.rate })),
    },
  });

  if (userId) {
    notify(
      userId,
      `${s.headline} pass issued`,
      `${order.guests.total} guest(s) on ${park.dateLabel(date)} at ${park.timeLabel(slot.time)}. ` +
        `Reference ${booking.reference}.`,
      'booking'
    );
  }

  ctx.state.status = 201;
  return { booking: park.decorateBooking(booking, s) };
});

/** Gate check-in. Idempotent per pass, and refuses a cancelled one. */
router.post('/admin/waterpark/bookings/:id/checkin', auth.requireAdmin, (ctx) => {
  const booking = db.byId('waterparkBookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'confirmed') throw new HttpError(400, 'That pass is cancelled');
  if (booking.checkedInAt) {
    throw new HttpError(400, `Already checked in at ${park.clockLabel(booking.checkedInAt)}`);
  }
  const updated = db.update('waterparkBookings', ctx.params.id, {
    checkedInAt: new Date().toISOString(),
    checkedInBy: ctx.user.id,
  });
  return { booking: park.decorateBooking(updated) };
});

/** Undo a mistaken check-in. */
router.post('/admin/waterpark/bookings/:id/undo-checkin', auth.requireAdmin, (ctx) => {
  const booking = db.byId('waterparkBookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (!booking.checkedInAt) throw new HttpError(400, 'That pass has not been checked in');
  const updated = db.update('waterparkBookings', ctx.params.id, { checkedInAt: null, checkedInBy: null });
  return { booking: park.decorateBooking(updated) };
});

router.post('/admin/waterpark/bookings/:id/cancel', auth.requireAdmin, (ctx) => {
  const booking = db.byId('waterparkBookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'confirmed') throw new HttpError(400, 'That pass is already cancelled');

  const updated = db.update('waterparkBookings', ctx.params.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelledBy: 'admin',
  });

  // Cancelling releases the slot, so the guest has to be told.
  if (booking.userId) {
    notify(
      booking.userId,
      'Water park pass cancelled',
      `Your ${park.settings().headline} pass for ${park.dateLabel(booking.date)} was cancelled by the park. ` +
        'Please call us to rebook.',
      'booking'
    );
  }
  return { booking: park.decorateBooking(updated) };
});

router.delete('/admin/waterpark/bookings/:id', auth.requireAdmin, (ctx) => {
  const booking = db.byId('waterparkBookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  // A pass that was paid for and used is the revenue record for that visit.
  if (booking.status === 'confirmed' && booking.checkedInAt) {
    throw new HttpError(400, 'That pass was used at the gate and is kept for the record');
  }
  db.remove('waterparkBookings', ctx.params.id);
  return { deleted: true, id: ctx.params.id };
});

// ── Promo sliders (the auto-scrolling banner on each tab) ────────────────────
/** Filename stem for an uploaded slide image. */
function slideSlug(body) {
  const base = `${body.section || 'slide'}-${body.title || 'slide'}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'slide';
}

/** Mutates body.imageUrl in place: a data: URL becomes a saved file path. */
function resolveSlideImage(body) {
  if (isDataUrl(body.imageUrl)) body.imageUrl = saveUploadedImage('promos', slideSlug(body), body.imageUrl);
}

/** Every section, its slider settings and its slides (inactive ones included). */
router.get('/admin/promos', auth.requireAdmin, () => promos.adminPayload());

/** Whether a tab's slider shows, and how fast it advances. */
router.put('/admin/promos/:section/settings', auth.requireAdmin, (ctx) => {
  const settings = promos.saveSliderSettings(ctx.params.section, ctx.body || {});
  return { section: ctx.params.section, settings, slider: promos.publicSlider(ctx.params.section) };
});

router.post('/admin/promos', auth.requireAdmin, (ctx) => {
  const body = Object.assign({}, ctx.body);
  resolveSlideImage(body);
  const slide = promos.saveSlide(body);
  ctx.state.status = 201;
  return { slide, slides: promos.slidesFor(slide.section, { includeInactive: true }) };
});

router.put('/admin/promos/slides/:id', auth.requireAdmin, (ctx) => {
  const body = Object.assign({}, ctx.body, { id: ctx.params.id });
  resolveSlideImage(body);
  const slide = promos.saveSlide(body);
  return { slide, slides: promos.slidesFor(slide.section, { includeInactive: true }) };
});

router.delete('/admin/promos/slides/:id', auth.requireAdmin, (ctx) => {
  const slide = promos.removeSlide(ctx.params.id);
  // A starter slide must stay deleted across restarts.
  markSeedRemoved(slide.id);
  return { deleted: true, id: slide.id, slides: promos.slidesFor(slide.section, { includeInactive: true }) };
});

/** Reorders by swapping with the neighbour, so order numbers stay implicit. */
router.post('/admin/promos/slides/:id/move', auth.requireAdmin, (ctx) => {
  const direction = (ctx.body && ctx.body.direction) || '';
  return promos.moveSlide(ctx.params.id, direction);
});

// ── Hotel & rooms ────────────────────────────────────────────────────────────
/** Rooms and their live occupancy for the next `days` nights. */
router.get('/admin/hotel', auth.requireAdmin, (ctx) => {
  const hotel = db.findOne('hotels', (h) => h.active !== false) || db.get('hotels')[0] || null;
  const rooms = [...db.get('hotelRooms')].sort((a, b) => (a.order || 0) - (b.order || 0));
  const days = Math.min(60, Math.max(1, Number(ctx.query.days) || 14));

  const from = hotels.today();
  const to = hotels.addDays(from, days);

  const stays = db.find('bookings', (b) => b.type === 'hotel' && b.status !== 'cancelled');
  const upcoming = stays.filter((b) => (b.stay?.checkOut || '') >= from);

  return {
    hotel,
    window: { from, to, days },
    totals: {
      roomTypes: rooms.length,
      physicalRooms: rooms.reduce((sum, r) => sum + (Number(r.totalRooms) || 0), 0),
      upcomingStays: upcoming.length,
      revenue: stays.reduce((sum, b) => sum + (b.amounts?.total || 0), 0),
      roomNightsSold: stays.reduce(
        (sum, b) => sum + (Number(b.stay?.nights) || 0) * (Number(b.stay?.rooms) || 1),
        0
      ),
    },
    rooms: rooms.map((room) => {
      const state = hotels.availability(room, from, to);
      return Object.assign({}, room, {
        // Busiest night in the window, so the admin can see pressure at a glance.
        peakBooked: state.booked,
        availableNow: state.available,
        occupancyPercent: state.totalRooms
          ? Math.round((state.booked / state.totalRooms) * 1000) / 10
          : 0,
      });
    }),
  };
});

/** Night-by-night occupancy for one room type — powers the availability table. */
router.get('/admin/hotel/rooms/:id/calendar', auth.requireAdmin, (ctx) => {
  const room = db.byId('hotelRooms', ctx.params.id);
  if (!room) throw new HttpError(404, 'Room type not found');

  const days = Math.min(60, Math.max(1, Number(ctx.query.days) || 14));
  const from = ctx.query.from && hotels.parseKey(ctx.query.from) ? ctx.query.from : hotels.today();
  const to = hotels.addDays(from, days);
  const { perNight } = hotels.bookedRooms(room.id, from, to);
  const totalRooms = Number(room.totalRooms) || 0;

  return {
    room: { id: room.id, name: room.name, totalRooms },
    nights: hotels.nightKeys(from, to).map((date) => ({
      date,
      booked: perNight[date] || 0,
      available: Math.max(0, totalRooms - (perNight[date] || 0)),
    })),
  };
});

router.put('/admin/hotel', auth.requireAdmin, (ctx) => {
  const existing = db.findOne('hotels', (h) => h.active !== false) || db.get('hotels')[0];
  const body = Object.assign({}, ctx.body);
  if (typeof body.amenities === 'string') body.amenities = csv(body.amenities);
  if (typeof body.policies === 'string') body.policies = lines(body.policies);

  const slug = existing ? existing.slug : slugify(body.name || 'hotel');
  if (isDataUrl(body.coverPhoto)) body.coverPhoto = saveUploadedImage('hotels', slug, body.coverPhoto);
  const photos = resolvePhotoList(body.photos, 'hotels', slug);
  if (photos !== undefined) body.photos = photos;
  // The property details form leaves this out, so the categorised galleries
  // survive an edit untouched; a full map may still be sent (e.g. an import).
  const propertyPhotos = resolvePropertyPhotos(body.propertyPhotos, slug);
  if (propertyPhotos !== undefined) body.propertyPhotos = propertyPhotos;
  else delete body.propertyPhotos;

  if (!existing) {
    requireFields(body, ['name']);
    const hotel = db.insert(
      'hotels',
      Object.assign(
        {
          id: db.id('htl'),
          slug,
          tagline: '',
          area: '',
          city: 'Mandla',
          address: '',
          phone: '',
          rating: 0,
          reviewCount: 0,
          checkInTime: '12:00',
          checkOutTime: '11:00',
          photos: [],
          propertyPhotos: {},
          amenities: [],
          policies: [],
          active: true,
        },
        pick(body, HOTEL_FIELDS)
      )
    );
    ctx.state.status = 201;
    return { hotel };
  }

  return { hotel: db.update('hotels', existing.id, pick(body, HOTEL_FIELDS)) };
});

/**
 * Saves one category of the property gallery.
 *
 * Photos arrive as base64 data: URLs, so a category full of full-quality shots
 * would blow past the request body limit if sent in one go. The admin panel
 * therefore sends the first batch as `replace` and any remainder as `append`,
 * which lets it upload a category of any size a few megabytes at a time.
 */
router.put('/admin/hotel/photos', auth.requireAdmin, (ctx) => {
  const hotel = db.findOne('hotels', (h) => h.active !== false) || db.get('hotels')[0];
  if (!hotel) throw new HttpError(400, 'Add the property details before uploading photos');

  const category = String(ctx.body.category || '');
  if (!isPropertyPhotoCategory(category)) {
    throw new HttpError(400, `Unknown photo category: ${category || '(none)'}`);
  }

  const incoming = resolvePhotoList(ctx.body.photos || [], 'hotels', hotel.slug, PHOTOS_PER_CATEGORY) || [];
  const current = (hotel.propertyPhotos && hotel.propertyPhotos[category]) || [];
  const merged = (ctx.body.mode === 'append' ? current.concat(incoming) : incoming).slice(0, PHOTOS_PER_CATEGORY);

  const propertyPhotos = Object.assign({}, hotel.propertyPhotos);
  if (merged.length) propertyPhotos[category] = merged;
  else delete propertyPhotos[category];

  const updated = db.update('hotels', hotel.id, { propertyPhotos });
  return { category, photos: merged, propertyPhotos: updated.propertyPhotos };
});

router.get('/admin/hotel/rooms', auth.requireAdmin, () => ({
  rooms: [...db.get('hotelRooms')].sort((a, b) => (a.order || 0) - (b.order || 0)),
}));

router.post('/admin/hotel/rooms', auth.requireAdmin, (ctx) => {
  requireFields(ctx.body, ['name', 'pricePerNight']);
  // Re-creating a previously deleted seeded slug should un-tombstone it.
  unmarkSeedRemoved(`room_${slugify(ctx.body.slug || ctx.body.name)}`);

  const hotel = db.findOne('hotels', (h) => h.active !== false) || db.get('hotels')[0];
  if (!hotel) throw new HttpError(400, 'Set up the hotel details before adding rooms');

  const body = normaliseRoom(Object.assign({}, ctx.body), slugify(ctx.body.slug || ctx.body.name));

  const room = db.insert(
    'hotelRooms',
    Object.assign(
      {
        id: db.id('room'),
        hotelId: hotel.id,
        slug: slugify(ctx.body.slug || ctx.body.name),
        subtitle: '',
        sizeSqft: 0,
        sizeSqmt: 0,
        view: '',
        bedType: 'Double Bed',
        bedCount: 1,
        bathrooms: 1,
        maxGuests: 2,
        maxChildren: 1,
        totalRooms: 1,
        mrpPerNight: 0,
        taxesPerNight: 0,
        badge: '',
        photos: [],
        popularAmenities: [],
        amenityGroups: [],
        inclusions: [],
        order: db.get('hotelRooms').length + 1,
        active: true,
      },
      pick(body, ROOM_FIELDS)
    )
  );

  ctx.state.status = 201;
  return { room };
});

router.put('/admin/hotel/rooms/:id', auth.requireAdmin, (ctx) => {
  const existing = db.byId('hotelRooms', ctx.params.id);
  if (!existing) throw new HttpError(404, 'Room type not found');

  const body = normaliseRoom(Object.assign({}, ctx.body), existing.slug || slugify(existing.name));
  return { room: db.update('hotelRooms', ctx.params.id, pick(body, ROOM_FIELDS)) };
});

router.delete('/admin/hotel/rooms/:id', auth.requireAdmin, (ctx) => {
  const room = db.byId('hotelRooms', ctx.params.id);
  if (!room) throw new HttpError(404, 'Room type not found');

  // A room type with live stays is hidden rather than deleted, so existing
  // guests keep a valid booking record to check in against.
  const liveStays = db.find(
    'bookings',
    (b) => b.type === 'hotel' && b.roomId === room.id && b.status === 'confirmed' && (b.stay?.checkOut || '') >= hotels.today()
  );

  if (liveStays.length) {
    return {
      archived: true,
      reason: `${liveStays.length} upcoming stay(s) use this room type, so it was hidden from the app instead of deleted.`,
      room: db.update('hotelRooms', room.id, { active: false }),
    };
  }

  db.remove('hotelRooms', room.id);
  markSeedRemoved(room.id); // a seeded room type stays deleted across restarts
  return { deleted: true, id: room.id };
});

// ── Bookings & users ─────────────────────────────────────────────────────────
router.get('/admin/bookings', auth.requireAdmin, (ctx) => {
  const { status, type, movieId, cinemaId, q, limit } = ctx.query;
  let list = [...db.get('bookings')];

  if (status) list = list.filter((b) => b.status === status);
  if (type) list = list.filter((b) => b.type === type);
  if (movieId) list = list.filter((b) => b.movieId === movieId);
  if (cinemaId) list = list.filter((b) => b.cinemaId === cinemaId);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((b) => {
      const user = db.byId('users', b.userId);
      return (
        b.reference.toLowerCase().includes(needle) ||
        (user && (user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)))
      );
    });
  }

  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    count: list.length,
    bookings: list.slice(0, Number(limit) || 200).map((b) => {
      const user = db.byId('users', b.userId);
      const movie = b.movieId ? db.byId('movies', b.movieId) : null;
      const cinema = b.cinemaId ? db.byId('cinemas', b.cinemaId) : null;
      const hotel = b.hotelId ? db.byId('hotels', b.hotelId) : null;

      const stayLabel = b.stay
        ? `${b.stay.rooms} room${b.stay.rooms === 1 ? '' : 's'} · ${b.stay.nights} night${b.stay.nights === 1 ? '' : 's'}`
        : '';

      return {
        id: b.id,
        reference: b.reference,
        type: b.type,
        status: b.status,
        createdAt: b.createdAt,
        startsAt: b.startsAt,
        showDate: b.showDate,
        showTime: b.showTime,
        seatLabel: (b.seats || []).map((s) => s.id).join(', '),
        seatCount: (b.seats || []).length,
        total: b.amounts?.total || 0,
        refundAmount: b.refundAmount || 0,
        paymentLabel: b.payment?.methodLabel || '',
        customer: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone } : null,
        movieTitle: movie ? movie.title : b.type === 'food' ? 'Food order' : b.type === 'hotel' ? b.stay?.roomName || 'Stay' : '',
        cinemaName: cinema ? cinema.name : hotel ? hotel.name : '',
        // Stay-specific columns (null for every other booking type).
        stay: b.stay
          ? {
              checkIn: b.stay.checkIn,
              checkOut: b.stay.checkOut,
              nights: b.stay.nights,
              rooms: b.stay.rooms,
              guests: b.stay.guests,
              label: stayLabel,
            }
          : null,
        guestName: b.guest?.name || '',
      };
    }),
  };
});

router.get('/admin/users', auth.requireAdmin, (ctx) => {
  const { q, role } = ctx.query;
  let list = db.get('users');
  if (role) list = list.filter((u) => u.role === role);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle) || String(u.phone).includes(needle));
  }
  return {
    count: list.length,
    users: list.map((u) => {
      const bookings = db.find('bookings', (b) => b.userId === u.id);
      return Object.assign(auth.publicUser(u), {
        bookingCount: bookings.length,
        totalSpent: bookings.filter((b) => b.status !== 'cancelled').reduce((s, b) => s + (b.amounts?.total || 0), 0),
      });
    }),
  };
});

router.post('/admin/users/:id/toggle', auth.requireAdmin, (ctx) => {
  const user = db.byId('users', ctx.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  if (user.id === ctx.user.id) throw new HttpError(400, 'You cannot disable your own account');
  return { user: auth.publicUser(db.update('users', user.id, { active: user.active === false })) };
});

/** Front-desk / gate scanner: look a ticket up by its reference. */
router.get('/admin/verify/:reference', auth.requireAdmin, (ctx) => {
  const booking = db.findOne('bookings', (b) => b.reference.toUpperCase() === ctx.params.reference.toUpperCase());
  if (!booking) throw new HttpError(404, 'No ticket with that reference');
  const user = db.byId('users', booking.userId);
  const movie = booking.movieId ? db.byId('movies', booking.movieId) : null;
  const cinema = booking.cinemaId ? db.byId('cinemas', booking.cinemaId) : null;
  const hotel = booking.hotelId ? db.byId('hotels', booking.hotelId) : null;

  // A stay stays scannable for the whole trip (a guest may arrive late on
  // check-in day), whereas a ticket expires 3h after the show starts.
  const isStay = booking.type === 'hotel';
  const withinWindow = isStay
    ? (booking.stay?.checkOut || '') >= hotels.today()
    : !booking.startsAt || new Date(booking.startsAt).getTime() > Date.now() - 3 * 60 * 60 * 1000;

  const valid = booking.status === 'confirmed' && withinWindow;

  return {
    valid,
    reason: valid
      ? isStay
        ? 'Stay is valid — guest can check in'
        : 'Ticket is valid'
      : booking.status === 'cancelled'
        ? `${isStay ? 'Stay' : 'Ticket'} was cancelled`
        : booking.status === 'completed'
          ? 'Already checked in'
          : isStay
            ? 'Stay has already ended'
            : 'Show has already ended',
    booking: {
      reference: booking.reference,
      type: booking.type,
      status: booking.status,
      seatLabel: (booking.seats || []).map((s) => s.id).join(', '),
      showDate: booking.showDate,
      showTime: booking.showTime,
      movieTitle: movie ? movie.title : isStay ? booking.stay?.roomName || 'Stay' : 'Food order',
      cinemaName: cinema ? cinema.name : hotel ? hotel.name : '',
      customerName: user ? user.name : '',
      total: booking.amounts?.total || 0,
      food: booking.food || [],
      stay: booking.stay || null,
      guestName: booking.guest?.name || '',
    },
  };
});

router.post('/admin/bookings/:id/checkin', auth.requireAdmin, (ctx) => {
  const booking = db.byId('bookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'confirmed') throw new HttpError(400, `Cannot check in a ${booking.status} booking`);
  return { booking: db.update('bookings', booking.id, { checkedInAt: new Date().toISOString(), status: 'completed' }) };
});

module.exports = router;
