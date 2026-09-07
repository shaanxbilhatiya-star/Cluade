'use strict';
const db = require('../db');
const barcode = require('../barcode');
const { Router, HttpError } = require('../router');
const { CURRENCY } = require('../pricing');

const router = new Router();

function slim(movie) {
  return {
    id: movie.id,
    slug: movie.slug,
    title: movie.title,
    tagline: movie.tagline,
    status: movie.status,
    genres: movie.genres,
    languages: movie.languages,
    certificate: movie.certificate,
    runtime: movie.runtime,
    rating: movie.rating,
    votes: movie.votes,
    releaseDate: movie.releaseDate,
    posterUrl: movie.posterUrl,
    backdropUrl: movie.backdropUrl,
    accentColor: movie.accentColor,
  };
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One call that fills the entire Home screen. */
router.get('/home', (ctx) => {
  const city = ctx.query.city || (ctx.user && ctx.user.city) || 'Ahmedabad';
  const movies = db.get('movies').filter((m) => m.active !== false);
  const today = todayKey();

  const cityCinemaIds = new Set(
    db.find('cinemas', (c) => c.active !== false && c.city.toLowerCase() === city.toLowerCase()).map((c) => c.id)
  );
  const playingInCity = new Set(
    db.get('showtimes').filter((s) => s.date >= today && cityCinemaIds.has(s.cinemaId)).map((s) => s.movieId)
  );

  const nowPlaying = movies
    .filter((m) => m.status === 'now_playing' && (playingInCity.size === 0 || playingInCity.has(m.id)))
    .sort((a, b) => b.rating - a.rating);

  const comingSoon = movies
    .filter((m) => m.status === 'coming_soon')
    .sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)));

  // Hero carousel: highest rated now-playing titles, then the next big release.
  const hero = [...nowPlaying.slice(0, 4), ...comingSoon.slice(0, 1)].map((m) =>
    Object.assign(slim(m), { isComingSoon: m.status === 'coming_soon' })
  );

  let recommended = [];
  if (ctx.user && (ctx.user.interests || []).length) {
    const interests = new Set(ctx.user.interests.map((i) => i.toLowerCase()));
    recommended = movies
      .filter((m) => m.genres.some((g) => interests.has(g.toLowerCase())))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 10)
      .map(slim);
  }

  const cinemas = db
    .find('cinemas', (c) => c.active !== false && c.city.toLowerCase() === city.toLowerCase())
    .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0))
    .slice(0, 5)
    .map((c) => ({ id: c.id, name: c.name, area: c.area, city: c.city, distanceKm: c.distanceKm, rating: c.rating, facilities: c.facilities }));

  const unreadNotifications = ctx.user
    ? db.find('notifications', (n) => n.userId === ctx.user.id && !n.read).length
    : 0;

  const nextBooking = ctx.user
    ? db
        .find('bookings', (b) => b.userId === ctx.user.id && b.status === 'confirmed' && new Date(b.startsAt) > new Date())
        .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0] || null
    : null;

  return {
    city,
    cities: [...new Set(db.get('cinemas').map((c) => c.city))],
    currency: CURRENCY,
    hero,
    nowPlaying: nowPlaying.map(slim),
    comingSoon: comingSoon.map(slim),
    recommended,
    cinemas,
    offers: db
      .get('offers')
      .filter((o) => o.active !== false)
      .map((o) => ({ id: o.id, title: o.title, subtitle: o.subtitle, code: o.code, bannerUrl: o.bannerUrl, appliesTo: o.appliesTo })),
    unreadNotifications,
    nextBooking: nextBooking && {
      id: nextBooking.id,
      reference: nextBooking.reference,
      title: (db.byId('movies', nextBooking.movieId) || {}).title || 'Food order',
      startsAt: nextBooking.startsAt,
      posterUrl: (db.byId('movies', nextBooking.movieId) || {}).posterUrl || '/img/food/_placeholder.svg',
      seatLabel: (nextBooking.seats || []).map((s) => s.id).join(', '),
    },
    user: ctx.user
      ? { id: ctx.user.id, name: ctx.user.name, avatarUrl: ctx.user.avatarUrl, city: ctx.user.city }
      : null,
  };
});

/** Generic Code 39 barcode, used for the membership card in Account. */
router.get('/barcode.svg', (ctx) => {
  const value = String(ctx.query.value || '').slice(0, 40);
  if (!value) throw new HttpError(400, 'A value query parameter is required');
  let svg;
  try {
    svg = barcode.render(value, {
      narrow: Number(ctx.query.narrow) || 2,
      height: Number(ctx.query.height) || 80,
      showText: ctx.query.text !== '0',
    }).svg;
  } catch (_e) {
    throw new HttpError(400, 'That value cannot be encoded as a barcode');
  }
  ctx.res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': Buffer.byteLength(svg),
  });
  ctx.res.end(svg);
});

/** Global search across movies, cinemas and food. */
router.get('/search', (ctx) => {
  const q = String(ctx.query.q || '').trim().toLowerCase();
  if (q.length < 1) return { query: q, movies: [], cinemas: [], food: [] };

  const movies = db
    .get('movies')
    .filter(
      (m) =>
        m.active !== false &&
        (m.title.toLowerCase().includes(q) ||
          m.genres.join(' ').toLowerCase().includes(q) ||
          (m.cast || []).join(' ').toLowerCase().includes(q) ||
          String(m.director || '').toLowerCase().includes(q) ||
          m.languages.join(' ').toLowerCase().includes(q))
    )
    .slice(0, 12)
    .map(slim);

  const cinemas = db
    .get('cinemas')
    .filter((c) => c.active !== false && (c.name.toLowerCase().includes(q) || c.area.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)))
    .slice(0, 8)
    .map((c) => ({ id: c.id, name: c.name, area: c.area, city: c.city, distanceKm: c.distanceKm }));

  const food = db
    .get('foodItems')
    .filter((f) => f.available !== false && (f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)))
    .slice(0, 8);

  return { query: q, movies, cinemas, food };
});

module.exports = router;
