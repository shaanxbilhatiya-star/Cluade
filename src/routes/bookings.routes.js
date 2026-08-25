'use strict';
const db = require('../db');
const auth = require('../auth');
const seats = require('../seats');
const barcode = require('../barcode');
const { computeTotals, resolveOffer, CONVENIENCE_FEE_PER_SEAT, GST_RATE } = require('../pricing');
const { Router, HttpError } = require('../router');

const router = new Router();

const CANCELLATION_CUTOFF_MS = 2 * 60 * 60 * 1000; // no cancels inside 2h of showtime
const REFUND_RATE = 0.75;

const PAYMENT_LABELS = {
  card: 'Credit / Debit Card',
  upi: 'UPI',
  wallet: 'Wallet',
  netbanking: 'Net Banking',
  cash: 'Pay at Counter',
};

// ── helpers ──────────────────────────────────────────────────────────────────
function bucketOf(booking) {
  if (booking.status === 'cancelled') return 'cancelled';
  const start = booking.startsAt ? new Date(booking.startsAt).getTime() : 0;
  return start && start < Date.now() ? 'passed' : 'upcoming';
}

function expand(booking) {
  const movie = booking.movieId ? db.byId('movies', booking.movieId) : null;
  const cinema = booking.cinemaId ? db.byId('cinemas', booking.cinemaId) : null;
  const screen = booking.screenId ? db.byId('screens', booking.screenId) : null;

  return Object.assign({}, booking, {
    bucket: bucketOf(booking),
    seatLabel: (booking.seats || []).map((s) => s.id).join(', '),
    title: movie ? movie.title : booking.type === 'food' ? 'Food & Beverages' : 'CineFlex booking',
    posterUrl: movie ? movie.posterUrl : '/img/food/_placeholder.svg',
    movie: movie && {
      id: movie.id,
      title: movie.title,
      posterUrl: movie.posterUrl,
      backdropUrl: movie.backdropUrl,
      certificate: movie.certificate,
      runtime: movie.runtime,
      genres: movie.genres,
      languages: movie.languages,
    },
    cinema: cinema && { id: cinema.id, name: cinema.name, area: cinema.area, city: cinema.city, address: cinema.address },
    screenName: screen ? screen.name : null,
    barcodeUrl: `/api/bookings/${booking.id}/barcode.svg`,
    canCancel:
      booking.status === 'confirmed' &&
      booking.type === 'movie' &&
      new Date(booking.startsAt).getTime() - Date.now() > CANCELLATION_CUTOFF_MS,
  });
}

function resolveFoodLines(rawItems) {
  const lines = [];
  for (const raw of rawItems || []) {
    const item = db.byId('foodItems', raw.itemId || raw.id);
    if (!item) throw new HttpError(400, `Unknown food item: ${raw.itemId || raw.id}`);
    if (item.available === false) throw new HttpError(400, `${item.name} is currently unavailable`);
    const qty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
    lines.push({ itemId: item.id, name: item.name, qty, price: item.price, imageUrl: item.imageUrl });
  }
  return lines;
}

function paymentRecord(payment, user, amount) {
  const method = (payment && payment.method) || 'card';
  if (!PAYMENT_LABELS[method]) throw new HttpError(400, `Unsupported payment method: ${method}`);

  let label = PAYMENT_LABELS[method];
  if (payment && payment.methodId) {
    const saved = (user.paymentMethods || []).find((m) => m.id === payment.methodId);
    if (saved) label = saved.label + (saved.last4 ? ` ••${saved.last4}` : '');
  } else if (payment && payment.label) {
    label = String(payment.label).slice(0, 60);
  }

  return {
    method,
    methodLabel: label,
    status: method === 'cash' ? 'pending' : 'paid',
    amount,
    transactionId: `TXN${db.reference('').slice(0, 10)}`,
    paidAt: method === 'cash' ? null : new Date().toISOString(),
  };
}

function notify(userId, title, body, kind) {
  db.insert('notifications', { id: db.id('ntf'), userId, title, body, kind, read: false });
}

// ── Offer preview ────────────────────────────────────────────────────────────
router.post('/offers/validate', auth.requireAuth, (ctx) => {
  const { code, showtimeId, seats: seatIds = [], food = [] } = ctx.body;
  let seatLines = [];
  if (showtimeId && seatIds.length) {
    const { index } = seats.seatIndex(showtimeId);
    seatLines = seatIds.filter((s) => index.has(s)).map((s) => index.get(s));
  }
  const foodLines = resolveFoodLines(food);
  const offer = resolveOffer(db.get('offers'), code, { seats: seatLines, food: foodLines });
  if (!offer) throw new HttpError(400, 'That code is not valid for this order');

  const totals = computeTotals({ seats: seatLines, food: foodLines, offer });
  return { offer: { code: offer.code, title: offer.title, subtitle: offer.subtitle }, totals };
});

/** Price preview before paying - keeps the UI and server in agreement. */
router.post('/bookings/quote', auth.requireAuth, (ctx) => {
  const { showtimeId, seats: seatIds = [], food = [], offerCode } = ctx.body;
  let seatLines = [];
  if (showtimeId && seatIds.length) {
    const { index } = seats.seatIndex(showtimeId);
    seatLines = seatIds.filter((s) => index.has(s)).map((s) => index.get(s));
  }
  const foodLines = resolveFoodLines(food);
  const offer = resolveOffer(db.get('offers'), offerCode, { seats: seatLines, food: foodLines });
  return {
    totals: computeTotals({ seats: seatLines, food: foodLines, offer }),
    breakdown: { convenienceFeePerSeat: CONVENIENCE_FEE_PER_SEAT, gstRate: GST_RATE },
    offerApplied: offer ? offer.code : null,
  };
});

// ── Create a movie booking from a seat hold ──────────────────────────────────
router.post('/bookings', auth.requireAuth, (ctx) => {
  const { holdId, food = [], offerCode, payment, reminder } = ctx.body;
  if (!holdId) throw new HttpError(400, 'Select your seats before paying');

  const hold = seats.getHold(holdId);
  if (!hold) throw new HttpError(410, 'Your seat hold expired - please pick your seats again');
  if (hold.userId !== ctx.user.id) throw new HttpError(403, 'That seat hold belongs to another user');

  const showtime = db.byId('showtimes', hold.showtimeId);
  if (!showtime) throw new HttpError(404, 'Showtime no longer exists');
  if (new Date(showtime.startsAt).getTime() < Date.now()) throw new HttpError(400, 'This show has already started');

  // Final safety check: nobody else grabbed these seats in the meantime.
  const alreadyBooked = seats.bookedSeatIds(showtime.id);
  const clash = hold.seats.filter((s) => alreadyBooked.has(s));
  if (clash.length) {
    seats.releaseHold(hold.id);
    throw new HttpError(409, `Seats just got booked by someone else: ${clash.join(', ')}`, { seats: clash });
  }

  const foodLines = resolveFoodLines(food);
  const offer = resolveOffer(db.get('offers'), offerCode, { seats: hold.seatDetails, food: foodLines });
  const amounts = computeTotals({ seats: hold.seatDetails, food: foodLines, offer });
  const movie = db.byId('movies', showtime.movieId);
  const cinema = db.byId('cinemas', showtime.cinemaId);

  const booking = db.insert('bookings', {
    id: db.id('bkg'),
    reference: db.reference('CF'),
    type: 'movie',
    userId: ctx.user.id,
    status: 'confirmed',
    movieId: showtime.movieId,
    cinemaId: showtime.cinemaId,
    screenId: showtime.screenId,
    showtimeId: showtime.id,
    showDate: showtime.date,
    showTime: showtime.time,
    startsAt: showtime.startsAt,
    endsAt: showtime.endsAt,
    format: showtime.format,
    language: showtime.language,
    seats: hold.seatDetails,
    food: foodLines,
    amounts,
    offerCode: amounts.offerCode,
    payment: paymentRecord(payment, ctx.user, amounts.total),
    reminder: { enabled: reminder !== false, minutesBefore: 30 },
    cancelledAt: null,
    refundAmount: 0,
  });

  seats.releaseHold(hold.id);

  const earned = Math.round(amounts.total / 10);
  db.update('users', ctx.user.id, { loyaltyPoints: (ctx.user.loyaltyPoints || 0) + earned });

  notify(
    ctx.user.id,
    'Booking confirmed 🎟️',
    `${hold.seats.length} seat(s) for ${movie ? movie.title : 'your show'} at ${cinema ? cinema.name : 'the cinema'} - ${showtime.date} ${showtime.time}.`,
    'booking'
  );

  ctx.state.status = 201;
  return { booking: expand(booking), pointsEarned: earned };
});

// ── Standalone food order ────────────────────────────────────────────────────
router.post('/bookings/food', auth.requireAuth, (ctx) => {
  const { cinemaId, items = [], slot, date, offerCode, payment } = ctx.body;
  const foodLines = resolveFoodLines(items);
  if (!foodLines.length) throw new HttpError(400, 'Your cart is empty');

  const cinema = cinemaId ? db.byId('cinemas', cinemaId) : db.get('cinemas')[0];
  if (!cinema) throw new HttpError(400, 'Choose a cinema for pickup');

  const offer = resolveOffer(db.get('offers'), offerCode, { seats: [], food: foodLines });
  const amounts = computeTotals({ seats: [], food: foodLines, offer });

  const pickupDate = date || new Date().toISOString().slice(0, 10);
  const pickupSlot = slot || '19:00';
  const [hh, mm] = pickupSlot.split(':').map(Number);
  const [y, m, d] = pickupDate.split('-').map(Number);
  const startsAt = new Date(y, m - 1, d, hh || 19, mm || 0).toISOString();

  const booking = db.insert('bookings', {
    id: db.id('bkg'),
    reference: db.reference('FD'),
    type: 'food',
    userId: ctx.user.id,
    status: 'confirmed',
    cinemaId: cinema.id,
    seats: [],
    food: foodLines,
    amounts,
    offerCode: amounts.offerCode,
    pickup: { cinemaName: cinema.name, slot: pickupSlot, date: pickupDate, counter: `Counter ${1 + (foodLines.length % 4)}` },
    startsAt,
    payment: paymentRecord(payment, ctx.user, amounts.total),
    reminder: { enabled: false, minutesBefore: 30 },
  });

  notify(ctx.user.id, 'Food order placed 🍿', `Pick up at ${cinema.name}, ${pickupSlot} on ${pickupDate}.`, 'booking');

  ctx.state.status = 201;
  return { booking: expand(booking) };
});

// ── Read ─────────────────────────────────────────────────────────────────────
router.get('/bookings', auth.requireAuth, (ctx) => {
  const { type, bucket, status } = ctx.query;
  let list = db.find('bookings', (b) => b.userId === ctx.user.id);

  if (type && type !== 'all') list = list.filter((b) => b.type === type);
  if (status) list = list.filter((b) => b.status === status);

  let expanded = list.map(expand);
  if (bucket && bucket !== 'all') expanded = expanded.filter((b) => b.bucket === bucket);

  expanded.sort((a, b) => {
    const dir = bucket === 'passed' ? -1 : 1;
    return dir * String(a.startsAt || '').localeCompare(String(b.startsAt || ''));
  });

  const all = list.map(expand);
  return {
    count: expanded.length,
    counts: {
      upcoming: all.filter((b) => b.bucket === 'upcoming').length,
      passed: all.filter((b) => b.bucket === 'passed').length,
      cancelled: all.filter((b) => b.bucket === 'cancelled').length,
    },
    bookings: expanded,
  };
});

router.get('/bookings/:id', auth.requireAuth, (ctx) => {
  const booking =
    db.byId('bookings', ctx.params.id) ||
    db.findOne('bookings', (b) => b.reference === ctx.params.id.toUpperCase());
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.userId !== ctx.user.id && ctx.user.role !== 'admin') throw new HttpError(403, 'Not your booking');
  return { booking: expand(booking) };
});

/** Scannable ticket barcode. Public by reference so gate scanners work. */
router.get('/bookings/:id/barcode.svg', (ctx) => {
  const booking =
    db.byId('bookings', ctx.params.id) ||
    db.findOne('bookings', (b) => b.reference === ctx.params.id.toUpperCase());
  if (!booking) throw new HttpError(404, 'Booking not found');

  const { svg } = barcode.render(booking.reference, {
    narrow: Number(ctx.query.narrow) || 2,
    height: Number(ctx.query.height) || 96,
    showText: ctx.query.text !== '0',
  });

  ctx.res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': Buffer.byteLength(svg),
  });
  ctx.res.end(svg);
});

// ── Mutate ───────────────────────────────────────────────────────────────────
router.post('/bookings/:id/cancel', auth.requireAuth, (ctx) => {
  const booking = db.byId('bookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.userId !== ctx.user.id && ctx.user.role !== 'admin') throw new HttpError(403, 'Not your booking');
  if (booking.status === 'cancelled') throw new HttpError(400, 'This booking is already cancelled');
  if (booking.status === 'completed') throw new HttpError(400, 'This show has already been watched');

  if (ctx.user.role !== 'admin' && booking.type === 'movie') {
    const msLeft = new Date(booking.startsAt).getTime() - Date.now();
    if (msLeft < CANCELLATION_CUTOFF_MS) {
      throw new HttpError(400, 'Tickets can only be cancelled up to 2 hours before showtime');
    }
  }

  const refund = Math.round((booking.amounts.total || 0) * REFUND_RATE);
  const updated = db.update('bookings', booking.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    refundAmount: refund,
    payment: Object.assign({}, booking.payment, { status: 'refunded' }),
  });

  notify(
    booking.userId,
    'Booking cancelled',
    `${booking.reference} cancelled. ₹${refund} will be refunded to ${booking.payment.methodLabel} in 5-7 working days.`,
    'booking'
  );

  return { booking: expand(updated), refundAmount: refund, refundRate: REFUND_RATE };
});

router.patch('/bookings/:id/reminder', auth.requireAuth, (ctx) => {
  const booking = db.byId('bookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.userId !== ctx.user.id) throw new HttpError(403, 'Not your booking');

  const enabled = Boolean(ctx.body.enabled);
  const minutesBefore = Number(ctx.body.minutesBefore) || booking.reminder?.minutesBefore || 30;
  const updated = db.update('bookings', booking.id, { reminder: { enabled, minutesBefore } });
  return { reminder: updated.reminder };
});

module.exports = router;
