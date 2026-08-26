'use strict';
const db = require('../db');
const { Router, HttpError } = require('../router');
const { GENRES, LANGUAGES, CITIES } = require('../catalog');

const router = new Router();

// Reviews are sourced live from TMDB (the same source used for the admin's
// autofill) rather than collected from customers. Cached briefly per movie
// so we don't hit TMDB on every single page view.
const TMDB_BASE = 'https://api.themoviedb.org/3';
const reviewCache = new Map(); // tmdbId -> { at, reviews }
const REVIEW_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchExternalReviews(tmdbId) {
  if (!tmdbId) return [];
  const cached = reviewCache.get(tmdbId);
  if (cached && Date.now() - cached.at < REVIEW_CACHE_MS) return cached.reviews;

  const token = process.env.TMDB_API_TOKEN;
  if (!token) return [];

  try {
    const res = await fetch(`${TMDB_BASE}/movie/${encodeURIComponent(tmdbId)}/reviews?language=en-US&page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return cached ? cached.reviews : [];
    const data = await res.json();
    const reviews = (data.results || []).slice(0, 6).map((r) => ({
      id: r.id,
      author: { name: r.author || 'Anonymous', avatarUrl: '/img/avatars/guest.svg' },
      rating: r.author_details?.rating ? Math.round(r.author_details.rating) : null,
      text: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      createdAt: r.created_at,
    }));
    reviewCache.set(tmdbId, { at: Date.now(), reviews });
    return reviews;
  } catch (_e) {
    return cached ? cached.reviews : [];
  }
}

function decorate(movie) {
  const showtimeCount = db.get('showtimes').filter((s) => s.movieId === movie.id && s.status !== 'cancelled').length;
  return Object.assign({}, movie, { reviews: { count: movie.votes || 0, average: movie.rating || 0 }, showtimeCount });
}

router.get('/movies', (ctx) => {
  const { status, genre, language, q, city, limit, sort } = ctx.query;
  let list = db.get('movies').filter((m) => m.active !== false);

  if (status) {
    const wanted = status.split(',').map((s) => s.trim());
    list = list.filter((m) => wanted.includes(m.status));
  }
  if (genre) list = list.filter((m) => m.genres.some((g) => g.toLowerCase() === genre.toLowerCase()));
  if (language) list = list.filter((m) => m.languages.some((l) => l.toLowerCase() === language.toLowerCase()));
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (m) =>
        m.title.toLowerCase().includes(needle) ||
        m.genres.join(' ').toLowerCase().includes(needle) ||
        m.languages.join(' ').toLowerCase().includes(needle) ||
        (m.cast || []).join(' ').toLowerCase().includes(needle) ||
        String(m.director || '').toLowerCase().includes(needle)
    );
  }
  if (city) {
    const cinemaIds = new Set(db.find('cinemas', (c) => c.city.toLowerCase() === city.toLowerCase()).map((c) => c.id));
    const playing = new Set(
      db.get('showtimes').filter((s) => cinemaIds.has(s.cinemaId)).map((s) => s.movieId)
    );
    list = list.filter((m) => m.status === 'coming_soon' || playing.has(m.id));
  }

  if (sort === 'rating') list = [...list].sort((a, b) => b.rating - a.rating);
  else if (sort === 'release') list = [...list].sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)));
  else list = [...list].sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)) * -1);

  const capped = limit ? list.slice(0, Number(limit)) : list;
  return { count: capped.length, movies: capped.map(decorate) };
});

router.get('/movies/:id', async (ctx) => {
  const movie =
    db.byId('movies', ctx.params.id) || db.findOne('movies', (m) => m.slug === ctx.params.id);
  if (!movie) throw new HttpError(404, 'Movie not found');

  const reviews = await fetchExternalReviews(movie.tmdbId);
  const cinemaIds = [...new Set(db.get('showtimes').filter((s) => s.movieId === movie.id).map((s) => s.cinemaId))];

  return Object.assign(decorate(movie), {
    reviewList: reviews,
    playingAt: cinemaIds.map((id) => db.byId('cinemas', id)).filter(Boolean).map((c) => ({ id: c.id, name: c.name, city: c.city, area: c.area })),
  });
});

router.get('/movies/:id/showtimes', (ctx) => {
  const movie = db.byId('movies', ctx.params.id) || db.findOne('movies', (m) => m.slug === ctx.params.id);
  if (!movie) throw new HttpError(404, 'Movie not found');
  const { date, city, format, language } = ctx.query;

  let shows = db.get('showtimes').filter((s) => s.movieId === movie.id && s.status === 'active');
  if (date) shows = shows.filter((s) => s.date === date);
  if (format) shows = shows.filter((s) => s.format === format);
  if (language) shows = shows.filter((s) => s.language === language);

  const grouped = new Map();
  for (const show of shows) {
    const cinema = db.byId('cinemas', show.cinemaId);
    if (!cinema) continue;
    if (city && cinema.city.toLowerCase() !== city.toLowerCase()) continue;

    if (!grouped.has(cinema.id)) {
      grouped.set(cinema.id, {
        cinema: {
          id: cinema.id,
          name: cinema.name,
          area: cinema.area,
          city: cinema.city,
          distanceKm: cinema.distanceKm,
          facilities: cinema.facilities,
          rating: cinema.rating,
        },
        shows: [],
      });
    }
    const screen = db.byId('screens', show.screenId);
    grouped.get(cinema.id).shows.push({
      id: show.id,
      date: show.date,
      time: show.time,
      startsAt: show.startsAt,
      endsAt: show.endsAt,
      format: show.format,
      language: show.language,
      prices: show.prices,
      screenName: screen ? screen.name : '',
      soldOut: false,
      isPast: new Date(show.startsAt).getTime() < Date.now(),
    });
  }

  const cinemas = [...grouped.values()].map((entry) => {
    entry.shows.sort((a, b) => a.time.localeCompare(b.time));
    return entry;
  });
  cinemas.sort((a, b) => (a.cinema.distanceKm || 0) - (b.cinema.distanceKm || 0));

  const dates = [...new Set(db.get('showtimes').filter((s) => s.movieId === movie.id).map((s) => s.date))].sort();

  return { movie: { id: movie.id, title: movie.title, certificate: movie.certificate, runtime: movie.runtime, posterUrl: movie.posterUrl }, dates, cinemas };
});

router.get('/genres', () => ({ genres: GENRES }));
router.get('/languages', () => ({ languages: LANGUAGES }));
router.get('/cities', () => {
  const fromData = [...new Set(db.get('cinemas').map((c) => c.city))];
  return { cities: [...new Set([...fromData, ...CITIES])] };
});

module.exports = router;
