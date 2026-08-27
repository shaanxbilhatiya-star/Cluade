'use strict';
const db = require('../db');
const auth = require('../auth');
const { LAYOUTS } = require('../catalog');
const { ensureRollingShowtimes } = require('../seed');
const { Router, HttpError } = require('../router');

const router = new Router();

const MOVIE_FIELDS = [
  'title', 'tagline', 'status', 'genres', 'languages', 'formats', 'certificate',
  'runtime', 'rating', 'votes', 'releaseDate', 'director', 'cast', 'synopsis',
  'trailerUrl', 'posterUrl', 'backdropUrl', 'accentColor', 'active',
  'castPhotos', 'tmdbId',
];
const CINEMA_FIELDS = ['name', 'brand', 'city', 'area', 'address', 'lat', 'lng', 'distanceKm', 'rating', 'facilities', 'active'];
const FOOD_FIELDS = ['name', 'category', 'price', 'description', 'size', 'veg', 'popular', 'imageUrl', 'available'];
const OFFER_FIELDS = ['title', 'subtitle', 'code', 'discountType', 'discountValue', 'maxDiscount', 'minAmount', 'appliesTo', 'bannerUrl', 'active'];

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
      users: db.find('users', (u) => u.role === 'customer').length,
      bookings: bookings.length,
      cancelled: bookings.filter((b) => b.status === 'cancelled').length,
      seatsSold,
      revenue,
      occupancyPercent: pastCapacity ? Math.round((seatsSoldOnPastShows / pastCapacity) * 1000) / 10 : 0,
      showsCompleted: pastShowIds.size,
    },
    today: { bookings: todays.length, revenue: todays.reduce((s, b) => s + (b.amounts?.total || 0), 0) },
    topMovies,
    trend,
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
      synopsis: '',
      posterUrl: '/img/posters/_placeholder.svg',
      backdropUrl: '/img/posters/_placeholder.svg',
      accentColor: '#6D28D9',
      active: true,
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
  const preset = ctx.body.layoutPreset || 'standard';
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
  const base = Number(ctx.body.basePrice) || 220;

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
    prices: ctx.body.prices || { regular: base, premium: Math.round(base * 1.5), vip: Math.round(base * 2.2) },
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
  return { item: db.update('foodItems', ctx.params.id, pick(ctx.body, FOOD_FIELDS)) };
});

router.delete('/admin/food/:id', auth.requireAdmin, (ctx) => {
  if (!db.byId('foodItems', ctx.params.id)) throw new HttpError(404, 'Food item not found');
  db.remove('foodItems', ctx.params.id);
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
        movieTitle: movie ? movie.title : b.type === 'food' ? 'Food order' : '',
        cinemaName: cinema ? cinema.name : '',
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

  const valid =
    booking.status === 'confirmed' &&
    (!booking.startsAt || new Date(booking.startsAt).getTime() > Date.now() - 3 * 60 * 60 * 1000);

  return {
    valid,
    reason: valid ? 'Ticket is valid' : booking.status === 'cancelled' ? 'Ticket was cancelled' : 'Show has already ended',
    booking: {
      reference: booking.reference,
      type: booking.type,
      status: booking.status,
      seatLabel: (booking.seats || []).map((s) => s.id).join(', '),
      showDate: booking.showDate,
      showTime: booking.showTime,
      movieTitle: movie ? movie.title : 'Food order',
      cinemaName: cinema ? cinema.name : '',
      customerName: user ? user.name : '',
      total: booking.amounts?.total || 0,
      food: booking.food || [],
    },
  };
});

router.post('/admin/bookings/:id/checkin', auth.requireAdmin, (ctx) => {
  const booking = db.byId('bookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.status !== 'confirmed') throw new HttpError(400, `Cannot check in a ${booking.status} booking`);
  return { booking: db.update('bookings', booking.id, { checkedInAt: new Date().toISOString(), status: 'completed' }) };
});


// ── TMDB Integration ─────────────────────────────────────────────────────────
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p';

async function tmdbGet(path) {
  const token = process.env.TMDB_API_TOKEN;
  if (!token) throw new HttpError(503, 'TMDB_API_TOKEN env var is not set. Add it to your environment and restart.');
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new HttpError(502, `TMDB error ${res.status}`);
  return res.json();
}

function tmdbMovieShape(d, credits, reviews) {
  const cast = (credits.cast || []).slice(0, 12);
  const castPhotos = {};
  for (const c of cast) {
    if (c.profile_path) castPhotos[c.name] = `${TMDB_IMG}/w185${c.profile_path}`;
  }
  const director = ((credits.crew || []).find((c) => c.job === 'Director') || {}).name || '';
  const genres   = (d.genres || []).map((g) => g.name);
  const langs    = (d.spoken_languages || []).map((l) => l.english_name || l.name);

  const reviewList = ((reviews && reviews.results) || []).slice(0, 6).map((r) => ({
    id: r.id,
    author: { name: r.author || 'Anonymous', avatarUrl: '/img/avatars/guest.svg' },
    rating: r.author_details && r.author_details.rating ? Math.round(r.author_details.rating) : null,
    text: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    createdAt: r.created_at,
  }));

  return {
    tmdbId: d.id,
    title: d.title || d.original_title,
    tagline: d.tagline || '',
    synopsis: d.overview || '',
    runtime: d.runtime || 0,
    releaseDate: (d.release_date || '').slice(0, 10),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : 0,
    votes: d.vote_count || 0,
    certificate: 'UA',
    genres,
    languages: langs,
    director,
    cast: cast.map((c) => c.name),
    castPhotos,
    posterUrl: d.poster_path ? `${TMDB_IMG}/w500${d.poster_path}` : '/img/posters/_placeholder.svg',
    backdropUrl: d.backdrop_path ? `${TMDB_IMG}/w1280${d.backdrop_path}` : '/img/posters/_placeholder.svg',
    trailerUrl: '',
    reviewList,
  };
}

router.get('/admin/tmdb/search', auth.requireAdmin, async (ctx) => {
  const q = (ctx.query.q || '').trim();
  if (!q) return { results: [] };
  const data = await tmdbGet(`/search/movie?query=${encodeURIComponent(q)}&language=en-US&page=1`);
  const results = (data.results || []).slice(0, 8).map((r) => ({
    id: r.id,
    title: r.title,
    year: r.release_date ? r.release_date.slice(0, 4) : '',
    posterUrl: r.poster_path ? `${TMDB_IMG}/w185${r.poster_path}` : null,
  }));
  return { results };
});

router.get('/admin/tmdb/movie/:id', auth.requireAdmin, async (ctx) => {
  const [detail, creditsData, reviewsData] = await Promise.all([
    tmdbGet(`/movie/${ctx.params.id}?language=en-US`),
    tmdbGet(`/movie/${ctx.params.id}/credits?language=en-US`),
    tmdbGet(`/movie/${ctx.params.id}/reviews?language=en-US&page=1`),
  ]);
  return { movie: tmdbMovieShape(detail, creditsData, reviewsData) };
});

module.exports = router;
