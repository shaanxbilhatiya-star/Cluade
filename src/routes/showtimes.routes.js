'use strict';
const db = require('../db');
const auth = require('../auth');
const seats = require('../seats');
const { Router, HttpError } = require('../router');

const router = new Router();

function expand(show) {
  const movie = db.byId('movies', show.movieId);
  const cinema = db.byId('cinemas', show.cinemaId);
  const screen = db.byId('screens', show.screenId);
  const booked = seats.bookedSeatIds(show.id).size;
  const capacity = screen ? (screen.layout || []).reduce((sum, r) => sum + r.seats, 0) : 0;

  return Object.assign({}, show, {
    movie: movie && {
      id: movie.id,
      title: movie.title,
      posterUrl: movie.posterUrl,
      backdropUrl: movie.backdropUrl,
      certificate: movie.certificate,
      runtime: movie.runtime,
      genres: movie.genres,
      rating: movie.rating,
    },
    cinema: cinema && { id: cinema.id, name: cinema.name, area: cinema.area, city: cinema.city, address: cinema.address },
    screen: screen && { id: screen.id, name: screen.name, format: screen.format, soundSystem: screen.soundSystem },
    capacity,
    seatsBooked: booked,
    seatsAvailable: Math.max(0, capacity - booked),
    isPast: new Date(show.startsAt).getTime() < Date.now(),
  });
}

router.get('/showtimes', (ctx) => {
  const { movieId, cinemaId, date, city, from } = ctx.query;
  let list = db.get('showtimes').filter((s) => s.status === 'active');

  if (movieId) list = list.filter((s) => s.movieId === movieId);
  if (cinemaId) list = list.filter((s) => s.cinemaId === cinemaId);
  if (date) list = list.filter((s) => s.date === date);
  if (from) list = list.filter((s) => s.date >= from);
  if (city) {
    const ids = new Set(db.find('cinemas', (c) => c.city.toLowerCase() === city.toLowerCase()).map((c) => c.id));
    list = list.filter((s) => ids.has(s.cinemaId));
  }

  list = [...list].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const limit = ctx.query.limit ? Number(ctx.query.limit) : 200;
  return { count: list.length, showtimes: list.slice(0, limit).map(expand) };
});

router.get('/showtimes/:id', (ctx) => {
  const show = db.byId('showtimes', ctx.params.id);
  if (!show) throw new HttpError(404, 'Showtime not found');
  return expand(show);
});

/** Full seat map. Pass ?holdId=... so your own held seats show as selected. */
router.get('/showtimes/:id/seats', (ctx) => {
  const show = db.byId('showtimes', ctx.params.id);
  if (!show) throw new HttpError(404, 'Showtime not found');
  const map = seats.buildSeatMap(show.id, { holdId: ctx.query.holdId });
  return Object.assign(map, { showtime: expand(show) });
});

/** Temporarily reserve seats while the user completes checkout. */
router.post('/showtimes/:id/hold', auth.requireAuth, (ctx) => {
  const show = db.byId('showtimes', ctx.params.id);
  if (!show) throw new HttpError(404, 'Showtime not found');
  if (new Date(show.startsAt).getTime() < Date.now()) throw new HttpError(400, 'This show has already started');

  const hold = seats.createHold(show.id, ctx.body.seats, ctx.user.id);
  ctx.state.status = 201;
  return {
    hold: {
      id: hold.id,
      showtimeId: hold.showtimeId,
      seats: hold.seatDetails,
      expiresAt: hold.expiresAt,
      expiresInSeconds: Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)),
    },
  };
});

router.get('/holds/:id', auth.requireAuth, (ctx) => {
  const hold = seats.getHold(ctx.params.id);
  if (!hold || hold.userId !== ctx.user.id) throw new HttpError(404, 'Your seat hold has expired');
  return {
    hold: {
      id: hold.id,
      showtimeId: hold.showtimeId,
      seats: hold.seatDetails,
      expiresAt: hold.expiresAt,
      expiresInSeconds: Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)),
    },
  };
});

router.delete('/holds/:id', auth.requireAuth, (ctx) => {
  const hold = seats.getHold(ctx.params.id);
  if (!hold) return { ok: true };
  if (hold.userId !== ctx.user.id) throw new HttpError(403, 'That hold belongs to someone else');
  seats.releaseHold(hold.id);
  return { ok: true };
});

module.exports = router;
