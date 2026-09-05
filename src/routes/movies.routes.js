'use strict';
const db = require('../db');
const auth = require('../auth');
const { Router, HttpError } = require('../router');
const { GENRES, LANGUAGES, CITIES } = require('../catalog');

const router = new Router();

function reviewSummary(movieId) {
  const reviews = db.find('reviews', (r) => r.movieId === movieId);
  if (!reviews.length) return { count: 0, average: 0 };
  const total = reviews.reduce((s, r) => s + r.rating, 0);
  return { count: reviews.length, average: Math.round((total / reviews.length) * 10) / 10 };
}

function decorate(movie) {
  const showtimeCount = db.get('showtimes').filter((s) => s.movieId === movie.id && s.status !== 'cancelled').length;
  return Object.assign({}, movie, { reviews: reviewSummary(movie.id), showtimeCount });
}

// ── External reviews (TMDB) ─────────────────────────────────────────────────
// Read-only: we never write reviews back to TMDB, only fetch + cache them.
// Works automatically for existing movies (auto-resolves a tmdbId by title
// search if one isn't saved yet) and for any future movie added via admin.
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
const tmdbIdCache = new Map(); // movie.id -> tmdbId (or null = "looked up, not found")
const tmdbReviewCache = new Map(); // tmdbId -> { at, reviews }

function tmdbHeaders() {
  const token = process.env.TMDB_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : null;
}

async function resolveTmdbId(movie) {
  if (movie.tmdbId) return movie.tmdbId;
  if (tmdbIdCache.has(movie.id)) return tmdbIdCache.get(movie.id);

  const headers = tmdbHeaders();
  if (!headers) return null;

  try {
    const year = movie.releaseDate ? String(movie.releaseDate).slice(0, 4) : '';
    const url = `${TMDB_BASE}/search/movie?query=${encodeURIComponent(movie.title)}${year ? `&year=${year}` : ''}&include_adult=false&language=en-US&page=1`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`TMDB search failed (${res.status})`);
    const data = await res.json();
    const match = (data.results || [])[0];
    const tmdbId = match ? match.id : null;

    tmdbIdCache.set(movie.id, tmdbId);
    if (tmdbId) db.update('movies', movie.id, { tmdbId }); // persist so future requests skip the search
    return tmdbId;
  } catch (_e) {
    tmdbIdCache.set(movie.id, null);
    return null;
  }
}

async function fetchTmdbReviews(tmdbId) {
  if (!tmdbId) return [];
  const cached = tmdbReviewCache.get(tmdbId);
  if (cached && Date.now() - cached.at < TMDB_CACHE_MS) return cached.reviews;

  const headers = tmdbHeaders();
  if (!headers) return cached ? cached.reviews : [];

  try {
    const res = await fetch(`${TMDB_BASE}/movie/${encodeURIComponent(tmdbId)}/reviews?language=en-US&page=1`, { headers });
    if (!res.ok) throw new Error(`TMDB reviews failed (${res.status})`);
    const data = await res.json();
    const reviews = (data.results || []).slice(0, 25).map((r) => ({
      id: `tmdb_${r.id}`,
      rating: r.author_details && r.author_details.rating ? Math.round(r.author_details.rating) : null,
      text: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      createdAt: r.created_at,
      author: {
        name: r.author || (r.author_details && r.author_details.username) || 'TMDB user',
        avatarUrl:
          r.author_details && r.author_details.avatar_path
            ? (String(r.author_details.avatar_path).startsWith('/https')
                ? String(r.author_details.avatar_path).slice(1)
                : `https://image.tmdb.org/t/p/w185${r.author_details.avatar_path}`)
            : '/img/avatars/guest.svg',
      },
      source: 'tmdb',
    }));
    tmdbReviewCache.set(tmdbId, { at: Date.now(), reviews });
    return reviews;
  } catch (_e) {
    return cached ? cached.reviews : [];
  }
}

async function getReviewsFor(movie) {
  const localReviews = db
    .find('reviews', (r) => r.movieId === movie.id)
    .map((r) => {
      const u = db.byId('users', r.userId);
      return {
        id: r.id,
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt,
        author: u ? { name: u.name, avatarUrl: u.avatarUrl } : { name: 'CineFlex user', avatarUrl: '/img/avatars/guest.svg' },
        source: 'local',
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const tmdbId = await resolveTmdbId(movie);
  const tmdbReviews = await fetchTmdbReviews(tmdbId);

  const reviewList = [...localReviews, ...tmdbReviews];

  const rated = reviewList.filter((r) => Number.isFinite(r.rating));
  const summary = rated.length
    ? { count: reviewList.length, average: Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10 }
    : { count: reviewList.length, average: 0 };

  return { reviewList, summary };
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

  const { reviewList, summary } = await getReviewsFor(movie);
  const cinemaIds = [...new Set(db.get('showtimes').filter((s) => s.movieId === movie.id).map((s) => s.cinemaId))];

  return Object.assign(decorate(movie), {
    reviews: summary,
    reviewList,
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

router.post('/movies/:id/reviews', auth.requireAuth, (ctx) => {
  const movie = db.byId('movies', ctx.params.id);
  if (!movie) throw new HttpError(404, 'Movie not found');
  const rating = Number(ctx.body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) throw new HttpError(400, 'Rating must be between 1 and 10');

  const existing = db.findOne('reviews', (r) => r.movieId === movie.id && r.userId === ctx.user.id);
  const payload = { rating: Math.round(rating), text: String(ctx.body.text || '').slice(0, 600) };

  const review = existing
    ? db.update('reviews', existing.id, payload)
    : db.insert('reviews', Object.assign({ id: db.id('rev'), movieId: movie.id, userId: ctx.user.id }, payload));

  ctx.state.status = existing ? 200 : 201;
  return { review, summary: reviewSummary(movie.id) };
});

router.get('/genres', () => ({ genres: GENRES }));
router.get('/languages', () => ({ languages: LANGUAGES }));
router.get('/cities', () => {
  const fromData = [...new Set(db.get('cinemas').map((c) => c.city))];
  return { cities: [...new Set([...fromData, ...CITIES])] };
});

module.exports = router;
