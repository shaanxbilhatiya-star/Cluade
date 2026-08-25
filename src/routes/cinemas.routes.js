'use strict';
const db = require('../db');
const { Router, HttpError } = require('../router');

const router = new Router();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

router.get('/cinemas', (ctx) => {
  const { city, q, movieId } = ctx.query;
  let list = db.get('cinemas').filter((c) => c.active !== false);

  if (city) list = list.filter((c) => c.city.toLowerCase() === city.toLowerCase());
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.area.toLowerCase().includes(needle) ||
        c.city.toLowerCase().includes(needle) ||
        c.brand.toLowerCase().includes(needle)
    );
  }
  if (movieId) {
    const ids = new Set(db.get('showtimes').filter((s) => s.movieId === movieId).map((s) => s.cinemaId));
    list = list.filter((c) => ids.has(c.id));
  }

  const today = todayKey();
  const decorated = list
    .map((c) => {
      const screens = db.find('screens', (s) => s.cinemaId === c.id && s.active !== false);
      const shows = db.get('showtimes').filter((s) => s.cinemaId === c.id && s.date >= today && s.status === 'active');
      const movieIds = [...new Set(shows.map((s) => s.movieId))];
      return Object.assign({}, c, {
        screenCount: screens.length,
        formats: [...new Set(screens.map((s) => s.format))],
        showtimeCount: shows.length,
        nowShowing: movieIds
          .map((id) => db.byId('movies', id))
          .filter(Boolean)
          .map((m) => ({ id: m.id, title: m.title, posterUrl: m.posterUrl, certificate: m.certificate })),
      });
    })
    .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));

  return { count: decorated.length, cinemas: decorated };
});

router.get('/cinemas/:id', (ctx) => {
  const cinema = db.byId('cinemas', ctx.params.id) || db.findOne('cinemas', (c) => c.slug === ctx.params.id);
  if (!cinema) throw new HttpError(404, 'Cinema not found');

  const screens = db.find('screens', (s) => s.cinemaId === cinema.id).map((s) => ({
    id: s.id,
    name: s.name,
    format: s.format,
    soundSystem: s.soundSystem,
    capacity: (s.layout || []).reduce((sum, r) => sum + r.seats, 0),
  }));

  return Object.assign({}, cinema, { screens });
});

router.get('/cinemas/:id/showtimes', (ctx) => {
  const cinema = db.byId('cinemas', ctx.params.id) || db.findOne('cinemas', (c) => c.slug === ctx.params.id);
  if (!cinema) throw new HttpError(404, 'Cinema not found');

  const date = ctx.query.date || todayKey();
  const shows = db
    .get('showtimes')
    .filter((s) => s.cinemaId === cinema.id && s.date === date && s.status === 'active');

  const grouped = new Map();
  for (const show of shows) {
    const movie = db.byId('movies', show.movieId);
    if (!movie) continue;
    if (!grouped.has(movie.id)) {
      grouped.set(movie.id, {
        movie: {
          id: movie.id,
          title: movie.title,
          posterUrl: movie.posterUrl,
          certificate: movie.certificate,
          runtime: movie.runtime,
          genres: movie.genres,
          rating: movie.rating,
        },
        shows: [],
      });
    }
    const screen = db.byId('screens', show.screenId);
    grouped.get(movie.id).shows.push({
      id: show.id,
      time: show.time,
      date: show.date,
      startsAt: show.startsAt,
      format: show.format,
      language: show.language,
      prices: show.prices,
      screenName: screen ? screen.name : '',
      isPast: new Date(show.startsAt).getTime() < Date.now(),
    });
  }

  const movies = [...grouped.values()].map((g) => {
    g.shows.sort((a, b) => a.time.localeCompare(b.time));
    return g;
  });

  const dates = [...new Set(db.get('showtimes').filter((s) => s.cinemaId === cinema.id).map((s) => s.date))].sort();

  return { cinema: { id: cinema.id, name: cinema.name, area: cinema.area, city: cinema.city, address: cinema.address, facilities: cinema.facilities }, date, dates, movies };
});

module.exports = router;
