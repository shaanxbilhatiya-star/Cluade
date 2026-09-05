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

// ── Generated reviews (no external API) ─────────────────────────────────────
// Every movie (existing or newly added via admin) gets 30 deterministic,
// template-based Hinglish reviews so the section is never empty. "Deterministic"
// means the same movie always produces the same 30 reviews on every request —
// they're seeded from the movie's own id, not re-rolled randomly each time.
const REVIEWER_NAMES = [
  'Aarav Mehta', 'Priya Nair', 'Rohan Kulkarni', 'Sneha Reddy', 'Vikram Chauhan',
  'Ananya Iyer', 'Kartik Joshi', 'Isha Malhotra', 'Aditya Verma', 'Meera Pillai',
  'Rahul Bhatt', 'Divya Menon', 'Sanjay Rao', 'Pooja Agarwal', 'Nikhil Shetty',
  'Kavya Krishnan', 'Arjun Desai', 'Riya Kapoor', 'Manish Tiwari', 'Neha Saxena',
  'Suresh Pillai', 'Anjali Gupta', 'Varun Choudhary', 'Tanvi Rane', 'Deepak Yadav',
  'Shreya Bhattacharya', 'Amit Trivedi', 'Nandini Suri', 'Yash Oberoi', 'Ritika Sharma',
];

const POSITIVE_TEMPLATES = [
  'Kya zabardast film hai yaar! {cast} ne apna best diya hai, {genreLower} lovers ke liye must watch.',
  'Paisa vasool entertainment. Direction top-notch hai aur second half me pura theatre whistle maar raha tha.',
  'Story thodi predictable hai but presentation itni mast hai ki pata hi nahi chalta time kaise nikal gaya.',
  '{cast} ka performance is career-best. BGM aur cinematography ne poore experience ko next level bana diya.',
  'First day first show dekha, bilkul disappoint nahi hui. {genreLower} genre me itna fresh feel bahut dino baad aaya.',
  'Full paisa vasool! Family ke saath enjoy kiya, sabko pasand aayi. Highly recommended for the weekend.',
  'Direction aur screenplay dono solid hain. {director} ne kamaal ka kaam kiya hai is film me.',
  'Interval tak thoda slow tha but second half ekdum blockbuster mode me chala gaya. Worth the ticket price.',
  'Ekdum mass entertainer! Dialogue-baazi aur action sequences dono top class the, hall me talent milega.',
  'Genuinely surprised, expectations se zyada acchi nikli. {cast} carried the film beautifully.',
  'Watched it in a packed theatre and the energy was unmatched — genuinely one of the better {genreLower} films this year.',
  'Music aur background score bahut hi effective hai, mood set karne me full support karta hai poori film ka.',
];

const MIXED_TEMPLATES = [
  'Decent hai, ek baar dekh sakte ho. Story me kuch naya nahi tha but acting carry kar leti hai.',
  'First half thoda dragged laga lekin climax ne sab compensate kar diya. Overall theek-thaak experience.',
  'Visuals aur action sequences achhe hain, but writing thodi weak feel hui beech beech me.',
  '{cast} ne apna role nibhaya hai theek se, but overall film thodi lambi lagi mujhe.',
  'Ek baar dekh sakte hain, but bahut zyada hype mat rakhna. Average entertainer hai.',
  'Kuch scenes bahut acche bane hain, kuch unnecessary lage. Mixed bag overall, still watchable.',
  'Not bad for a one-time watch. {genreLower} fans ko shayad thoda zyada pasand aaye compared to others.',
];

const NEGATIVE_TEMPLATES = [
  'Expected zyada tha, but screenplay kaafi loose lagi. Editing thodi tight ho sakti thi.',
  'Story bikhri hui lagi, character development bhi kam tha. Could have been much better honestly.',
  'Thoda underwhelming raha experience, especially second half me pacing bahut slow ho gayi.',
  'Not really my type, but agar aap {genreLower} ke big fan ho tabhi try karo, warna skip kar sakte ho.',
];

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function fillTemplate(tpl, movie, rng) {
  const cast = (movie.cast && movie.cast.length) ? pick(rng, movie.cast) : 'the cast';
  const genre = (movie.genres && movie.genres.length) ? movie.genres[0] : 'is';
  return tpl
    .replace(/\{cast\}/g, cast)
    .replace(/\{director\}/g, movie.director || 'the director')
    .replace(/\{genreLower\}/g, genre.toLowerCase());
}

function generateReviews(movie, count) {
  const rng = mulberry32(seedFromString(movie.id));
  const names = [...REVIEWER_NAMES];
  // deterministic shuffle so name order differs per movie but stays stable across requests
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const reviews = [];
  for (let i = 0; i < count; i++) {
    const roll = rng();
    // ~65% positive, ~25% mixed, ~10% negative — keeps it realistic, not all 10/10
    const bucket = roll < 0.65 ? POSITIVE_TEMPLATES : roll < 0.9 ? MIXED_TEMPLATES : NEGATIVE_TEMPLATES;
    const rating = roll < 0.65 ? 8 + Math.floor(rng() * 3) : roll < 0.9 ? 6 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 3);
    const text = fillTemplate(pick(rng, bucket), movie, rng);
    const name = names[i % names.length];
    const daysAgo = Math.floor(rng() * 20) + 1;

    reviews.push({
      id: `gen_${movie.id}_${i}`,
      rating,
      text,
      createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      author: { name, avatarUrl: '/img/avatars/guest.svg' },
      source: 'generated',
    });
  }
  return reviews;
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

  const needed = Math.max(0, 30 - localReviews.length);
  const generated = needed ? generateReviews(movie, needed) : [];
  const reviewList = [...localReviews, ...generated];

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
