'use strict';
/**
 * End-to-end smoke test. Spawns the server against a throwaway data directory
 * so your real data/ folder is never touched, then walks the full customer and
 * admin journey.
 *
 *   npm test
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3941;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cineflex-test-'));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` \x1b[31m(${detail})\x1b[0m` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function api(method, endpoint, { token, body, raw } = {}) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: Object.assign(
      body ? { 'Content-Type': 'application/json' } : {},
      token ? { Authorization: `Bearer ${token}` } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let json = null;
  try { json = await res.json(); } catch (_e) { json = null; }
  return { status: res.status, body: json };
}

async function waitForServer(child) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (_e) { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not become healthy in time');
}

async function run() {
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' });
  delete env.NODE_OPTIONS;

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  child.stdout.on('data', (d) => serverLog.push(d.toString()));
  child.stderr.on('data', (d) => serverLog.push(d.toString()));

  try {
    await waitForServer(child);
    console.log(`\nTesting ${BASE}  (scratch data dir: ${DATA_DIR})`);

    // ── Health & catalogue ───────────────────────────────────────────────────
    section('Health & catalogue');
    const health = await api('GET', '/api/health');
    check('GET /api/health returns ok', health.status === 200 && health.body.ok === true);
    check('seeded movies', health.body.counts.movies >= 10, `got ${health.body?.counts?.movies}`);
    check('seeded cinemas', health.body.counts.cinemas >= 5);
    check('seeded showtimes', health.body.counts.showtimes > 100, `got ${health.body?.counts?.showtimes}`);
    check('seeded food items', health.body.counts.foodItems >= 14);

    const home = await api('GET', '/api/home');
    check('GET /api/home returns hero slides', home.status === 200 && home.body.hero.length > 0);
    check('GET /api/home returns now playing', home.body.nowPlaying.length > 0);
    check('GET /api/home returns coming soon', home.body.comingSoon.length > 0);
    check('GET /api/home returns offers', home.body.offers.length > 0);
    check('GET /api/home returns cinemas', home.body.cinemas.length > 0);

    const movies = await api('GET', '/api/movies?status=now_playing');
    check('GET /api/movies filters by status', movies.status === 200 && movies.body.movies.every((m) => m.status === 'now_playing'));
    const jawan = movies.body.movies.find((m) => m.slug === 'jawan');
    check('Jawan is now playing', Boolean(jawan));

    const byGenre = await api('GET', '/api/movies?genre=Horror');
    check('GET /api/movies filters by genre', byGenre.body.movies.every((m) => m.genres.includes('Horror')));

    const search = await api('GET', '/api/search?q=nun');
    check('GET /api/search finds The Nun II', search.body.movies.some((m) => m.slug === 'the-nun-ii'));

    const detail = await api('GET', `/api/movies/${jawan.id}`);
    check('GET /api/movies/:id returns detail', detail.status === 200 && detail.body.title === 'Jawan');
    check('movie detail includes reviews', Array.isArray(detail.body.reviewList));
    check('movie detail includes playingAt', detail.body.playingAt.length > 0);

    const showtimesForMovie = await api('GET', `/api/movies/${jawan.id}/showtimes`);
    check('GET /api/movies/:id/showtimes groups by cinema', showtimesForMovie.body.cinemas.length > 0);
    check('showtimes response lists dates', showtimesForMovie.body.dates.length > 0);

    const cinemas = await api('GET', '/api/cinemas?city=Ahmedabad');
    check('GET /api/cinemas filters by city', cinemas.body.cinemas.every((c) => c.city === 'Ahmedabad'));
    const cinemaId = cinemas.body.cinemas[0].id;
    const cinemaDetail = await api('GET', `/api/cinemas/${cinemaId}`);
    check('GET /api/cinemas/:id includes screens', cinemaDetail.body.screens.length > 0);
    const cinemaShows = await api('GET', `/api/cinemas/${cinemaId}/showtimes`);
    check('GET /api/cinemas/:id/showtimes returns movies', cinemaShows.body.movies.length > 0);

    const foodHome = await api('GET', '/api/food/home');
    check('GET /api/food/home returns banners', foodHome.body.banners.length > 0);
    check('GET /api/food/home returns rails', foodHome.body.rails.length >= 3);
    const popularRail = foodHome.body.rails.find((r) => r.key === 'popular');
    check('food rail "Most Popular" has items', Boolean(popularRail && popularRail.items.length > 0));
    const popcorn = popularRail.items.find((i) => i.slug === 'jumbo-popcorn');
    check('Jumbo Popcorn exists', Boolean(popcorn));
    const foodDetail = await api('GET', `/api/food/${popcorn.id}`);
    check('GET /api/food/:id returns related items', foodDetail.status === 200 && Array.isArray(foodDetail.body.related));

    // ── Auth ─────────────────────────────────────────────────────────────────
    section('Authentication');
    const badLogin = await api('POST', '/api/auth/login', { body: { email: 'andrew@example.com', password: 'wrong' } });
    check('login rejects wrong password', badLogin.status === 401);

    const login = await api('POST', '/api/auth/login', { body: { email: 'andrew@example.com', password: '1234' } });
    check('demo customer can log in', login.status === 200 && Boolean(login.body.token));
    check('login response hides password hash', login.body.user && login.body.user.password === undefined);
    const token = login.body.token;

    const meNoToken = await api('GET', '/api/me');
    check('GET /api/me requires auth', meNoToken.status === 401);

    const badToken = await api('GET', '/api/me', { token: token.slice(0, -3) + 'aaa' });
    check('tampered token is rejected', badToken.status === 401);

    const me = await api('GET', '/api/me', { token });
    check('GET /api/me returns profile + stats', me.status === 200 && me.body.user.email === 'andrew@example.com' && me.body.stats);

    const dupe = await api('POST', '/api/auth/register', { body: { name: 'Copy Cat', email: 'andrew@example.com', password: 'abcd' } });
    check('register blocks duplicate email', dupe.status === 409);

    const reg = await api('POST', '/api/auth/register', {
      body: { name: 'Test Rider', email: `rider${Date.now()}@example.com`, phone: '+91 90000 12345', password: 'pass1234' },
    });
    check('register creates a new customer', reg.status === 201 && Boolean(reg.body.token));
    const riderToken = reg.body.token;

    const adminLogin = await api('POST', '/api/auth/login', { body: { email: 'admin@cineflex.com', password: 'admin123' } });
    check('admin can log in', adminLogin.status === 200 && adminLogin.body.user.role === 'admin');
    const adminToken = adminLogin.body.token;

    const forbidden = await api('GET', '/api/admin/stats', { token });
    check('customer cannot reach admin API', forbidden.status === 403);

    // ── Seat map, holds & booking ────────────────────────────────────────────
    section('Seat selection & holds');
    const futureShows = await api('GET', `/api/showtimes?movieId=${jawan.id}`);
    // Pick a show comfortably outside the 2-hour cancellation cut-off so the
    // cancellation test exercises the happy path.
    const show = futureShows.body.showtimes.find((s) => new Date(s.startsAt).getTime() - Date.now() > 4 * 3600_000);
    check('found an upcoming showtime', Boolean(show));
    if (!show) throw new Error('No showtime more than 4 hours away - cannot continue');

    const seatMap = await api('GET', `/api/showtimes/${show.id}/seats`);
    check('GET seats returns rows', seatMap.status === 200 && seatMap.body.rows.length > 0);
    check('seat map exposes price tiers', seatMap.body.tiers.length >= 2);
    check('seat map reports availability', seatMap.body.stats.available > 0);

    // Deliberately take the priciest free seats so the ticket subtotal clears
    // the CINEWED offer's minimum-spend requirement further down.
    const openSeats = seatMap.body.rows
      .flatMap((r) => r.seats)
      .filter((s) => s.status === 'available')
      .sort((a, b) => b.price - a.price)
      .slice(0, 3)
      .map((s) => s.id);
    check('found 3 free seats', openSeats.length === 3, openSeats.join(','));

    const noAuthHold = await api('POST', `/api/showtimes/${show.id}/hold`, { body: { seats: openSeats } });
    check('holding seats requires auth', noAuthHold.status === 401);

    const hold = await api('POST', `/api/showtimes/${show.id}/hold`, { token, body: { seats: openSeats } });
    check('POST hold reserves seats', hold.status === 201 && hold.body.hold.seats.length === 3);
    check('hold has an expiry', Boolean(hold.body.hold.expiresAt) && hold.body.hold.expiresInSeconds > 0);
    const holdId = hold.body.hold.id;

    const rivalHold = await api('POST', `/api/showtimes/${show.id}/hold`, { token: riderToken, body: { seats: openSeats } });
    check('another user cannot hold the same seats', rivalHold.status === 409, `status ${rivalHold.status}`);

    const heldMap = await api('GET', `/api/showtimes/${show.id}/seats`);
    check('held seats show as unavailable to others', openSeats.every((id) => heldMap.body.rows.flatMap((r) => r.seats).find((s) => s.id === id).status === 'held'));

    const tooMany = await api('POST', `/api/showtimes/${show.id}/hold`, {
      token: riderToken,
      body: { seats: Array.from({ length: 11 }, (_, i) => `A${i + 1}`) },
    });
    check('hold rejects more than 10 seats', tooMany.status === 400);

    const quote = await api('POST', '/api/bookings/quote', {
      token,
      body: { showtimeId: show.id, seats: openSeats, food: [{ itemId: popcorn.id, qty: 2 }] },
    });
    check('POST /api/bookings/quote prices the cart', quote.status === 200 && quote.body.totals.total > 0);
    check('quote charges a convenience fee per seat', quote.body.totals.convenienceFee === 3 * 30, `got ${quote.body?.totals?.convenienceFee}`);
    check('quote adds food subtotal', quote.body.totals.food === popcorn.price * 2);

    const badOffer = await api('POST', '/api/offers/validate', { token, body: { code: 'NOPE123', showtimeId: show.id, seats: openSeats } });
    check('invalid offer code is rejected', badOffer.status === 400);

    const goodOffer = await api('POST', '/api/offers/validate', { token, body: { code: 'CINEWED', showtimeId: show.id, seats: openSeats } });
    check('CINEWED offer applies a discount', goodOffer.status === 200 && goodOffer.body.totals.discount > 0);

    section('Checkout');
    const booking = await api('POST', '/api/bookings', {
      token,
      body: {
        holdId,
        food: [{ itemId: popcorn.id, qty: 2 }],
        offerCode: 'CINEWED',
        payment: { method: 'card', label: 'HDFC Credit Card' },
        reminder: true,
      },
    });
    check('POST /api/bookings creates a booking', booking.status === 201, JSON.stringify(booking.body).slice(0, 160));
    const created = booking.body.booking;
    check('booking has a reference', Boolean(created && /^CF[0-9A-Z]{8}$/.test(created.reference)), created && created.reference);
    check('booking keeps the held seats', created.seats.length === 3);
    check('booking applied the offer', created.amounts.discount > 0);
    check('booking totals add up', created.amounts.total === Math.round(created.amounts.tickets + created.amounts.food + created.amounts.convenienceFee + created.amounts.gst - created.amounts.discount));
    check('booking awarded loyalty points', booking.body.pointsEarned > 0);
    check('booking payment recorded as paid', created.payment.status === 'paid');

    const reused = await api('POST', '/api/bookings', { token, body: { holdId, payment: { method: 'card' } } });
    check('a spent hold cannot be reused', reused.status === 410, `status ${reused.status}`);

    const afterMap = await api('GET', `/api/showtimes/${show.id}/seats`);
    check('booked seats now show as booked', openSeats.every((id) => afterMap.body.rows.flatMap((r) => r.seats).find((s) => s.id === id).status === 'booked'));

    const barcode = await api('GET', `/api/bookings/${created.id}/barcode.svg`, { raw: true });
    check('ticket barcode renders as SVG', barcode.status === 200 && barcode.text.startsWith('<svg'));
    check('barcode encodes the reference', barcode.text.includes(created.reference));
    check('barcode served with image/svg+xml', String(barcode.headers.get('content-type')).includes('image/svg+xml'));

    section('My Tickets');
    const upcoming = await api('GET', '/api/bookings?bucket=upcoming', { token });
    check('GET /api/bookings?bucket=upcoming lists the new booking', upcoming.body.bookings.some((b) => b.id === created.id));
    check('bookings response includes tab counts', upcoming.body.counts && upcoming.body.counts.upcoming > 0);

    const passed_ = await api('GET', '/api/bookings?bucket=passed', { token });
    check('passed bucket has the seeded history booking', passed_.body.bookings.length > 0);

    const foodOnly = await api('GET', '/api/bookings?type=food', { token });
    check('type=food filters to food orders', foodOnly.body.bookings.length > 0 && foodOnly.body.bookings.every((b) => b.type === 'food'));

    const reminder = await api('PATCH', `/api/bookings/${created.id}/reminder`, { token, body: { enabled: false } });
    check('reminder toggle persists', reminder.status === 200 && reminder.body.reminder.enabled === false);

    const otherUsersBooking = await api('GET', `/api/bookings/${created.id}`, { token: riderToken });
    check('cannot read another user\'s booking', otherUsersBooking.status === 403);

    section('Food order & cancellation');
    const foodOrder = await api('POST', '/api/bookings/food', {
      token,
      body: { cinemaId, items: [{ itemId: popcorn.id, qty: 1 }], slot: '19:30', offerCode: 'POPFREE', payment: { method: 'upi' } },
    });
    check('POST /api/bookings/food places a pickup order', foodOrder.status === 201 && foodOrder.body.booking.type === 'food');
    check('food order has pickup details', Boolean(foodOrder.body.booking.pickup.counter));

    const emptyCart = await api('POST', '/api/bookings/food', { token, body: { cinemaId, items: [] } });
    check('empty food cart is rejected', emptyCart.status === 400);

    const cancel = await api('POST', `/api/bookings/${created.id}/cancel`, { token });
    check('POST cancel refunds the booking', cancel.status === 200 && cancel.body.refundAmount > 0);
    check('cancelled booking moves to the cancelled bucket', cancel.body.booking.bucket === 'cancelled');
    const recancel = await api('POST', `/api/bookings/${created.id}/cancel`, { token });
    check('cannot cancel twice', recancel.status === 400);

    const freedMap = await api('GET', `/api/showtimes/${show.id}/seats`);
    check('cancelling releases the seats', openSeats.every((id) => freedMap.body.rows.flatMap((r) => r.seats).find((s) => s.id === id).status === 'available'));

    // ── Account features ─────────────────────────────────────────────────────
    section('Account');
    const watchAdd = await api('POST', '/api/me/watchlist', { token: riderToken, body: { movieId: jawan.id } });
    check('watchlist add works', watchAdd.status === 200 && watchAdd.body.inWatchlist === true);
    const watchList = await api('GET', '/api/me/watchlist', { token: riderToken });
    check('watchlist returns the movie', watchList.body.movies.some((m) => m.id === jawan.id));
    const watchToggle = await api('POST', '/api/me/watchlist', { token: riderToken, body: { movieId: jawan.id } });
    check('watchlist toggles off', watchToggle.body.inWatchlist === false);

    const interests = await api('PUT', '/api/me/interests', { token: riderToken, body: { interests: ['Action', 'Horror', 'NotAGenre'], preferredLanguages: ['Hindi'] } });
    check('interests save and drop unknown genres', interests.body.interests.length === 2 && !interests.body.interests.includes('NotAGenre'));

    const badCard = await api('POST', '/api/me/payment-methods', { token: riderToken, body: { type: 'card', label: 'My Card', last4: '12' } });
    check('card requires 4 digits', badCard.status === 400);
    const addCard = await api('POST', '/api/me/payment-methods', { token: riderToken, body: { type: 'card', label: 'ICICI Debit', last4: '9911', brand: 'Mastercard', expiry: '11/29' } });
    check('payment method can be added', addCard.status === 201 && addCard.body.paymentMethod.isDefault === true);
    const addUpi = await api('POST', '/api/me/payment-methods', { token: riderToken, body: { type: 'upi', label: 'GPay', handle: 'rider@okaxis' } });
    check('UPI method can be added', addUpi.status === 201);
    const makeDefault = await api('POST', `/api/me/payment-methods/${addUpi.body.paymentMethod.id}/default`, { token: riderToken });
    check('default payment method can change', makeDefault.body.paymentMethods.find((m) => m.id === addUpi.body.paymentMethod.id).isDefault === true);
    const delCard = await api('DELETE', `/api/me/payment-methods/${addCard.body.paymentMethod.id}`, { token: riderToken });
    check('payment method can be deleted', delCard.body.paymentMethods.length === 1);

    const settings = await api('PATCH', '/api/me/settings', { token, body: { darkMode: true, language: 'हिन्दी', notifications: { offers: false } } });
    check('settings persist dark mode', settings.body.settings.darkMode === true);
    check('settings persist notification prefs', settings.body.settings.notifications.offers === false);
    check('settings keep untouched notification prefs', settings.body.settings.notifications.bookingUpdates === true);

    const profile = await api('PATCH', '/api/me', { token, body: { city: 'Mumbai', phone: '+91 99999 88888' } });
    check('profile update works', profile.body.user.city === 'Mumbai');
    const badName = await api('PATCH', '/api/me', { token, body: { name: 'A' } });
    check('profile rejects a 1-character name', badName.status === 400);

    const notes = await api('GET', '/api/me/notifications', { token });
    check('notifications list returns items', notes.body.notifications.length > 0);
    check('notifications report unread count', typeof notes.body.unread === 'number');
    const readAll = await api('POST', '/api/me/notifications/read', { token });
    check('notifications can be marked read', readAll.body.markedRead >= 0);

    const review = await api('POST', `/api/movies/${jawan.id}/reviews`, { token: riderToken, body: { rating: 9, text: 'Loved it.' } });
    check('review can be posted', review.status === 201 && review.body.summary.count > 0);
    const badReview = await api('POST', `/api/movies/${jawan.id}/reviews`, { token: riderToken, body: { rating: 99 } });
    check('review rating is validated', badReview.status === 400);
    const jawanDetail = await api('GET', `/api/movies/${jawan.id}`);
    check('movie detail returns a reviewList array', Array.isArray(jawanDetail.body.reviewList) && jawanDetail.body.reviewList.length > 0);

    const pwd = await api('POST', '/api/auth/change-password', { token: riderToken, body: { currentPassword: 'pass1234', newPassword: 'newpass99' } });
    check('password can be changed', pwd.status === 200);
    const reLogin = await api('POST', '/api/auth/login', { body: { email: reg.body.user.email, password: 'newpass99' } });
    check('new password works', reLogin.status === 200);

    // ── Admin ────────────────────────────────────────────────────────────────
    section('Admin');
    const stats = await api('GET', '/api/admin/stats', { token: adminToken });
    check('admin stats returns totals', stats.status === 200 && stats.body.totals.movies >= 10);
    check('admin stats returns a 7-day trend', stats.body.trend.length === 7);
    check('admin stats computes occupancy', typeof stats.body.totals.occupancyPercent === 'number');

    const newMovie = await api('POST', '/api/admin/movies', {
      token: adminToken,
      body: { title: 'Test Feature Film', status: 'coming_soon', genres: ['Drama'], languages: ['English'], runtime: 100, releaseDate: '2026-12-01' },
    });
    check('admin can create a movie', newMovie.status === 201);
    const editMovie = await api('PUT', `/api/admin/movies/${newMovie.body.movie.id}`, { token: adminToken, body: { rating: 7.7 } });
    check('admin can edit a movie', editMovie.body.movie.rating === 7.7);

    const newCinema = await api('POST', '/api/admin/cinemas', { token: adminToken, body: { name: 'Test Multiplex', city: 'Pune', area: 'Kothrud' } });
    check('admin can create a cinema', newCinema.status === 201);
    const newScreen = await api('POST', '/api/admin/screens', { token: adminToken, body: { cinemaId: newCinema.body.cinema.id, name: 'Audi X', layoutPreset: 'compact', format: '2D' } });
    check('admin can create a screen', newScreen.status === 201 && newScreen.body.screen.layout.length > 0);
    const badLayout = await api('POST', '/api/admin/screens', { token: adminToken, body: { cinemaId: newCinema.body.cinema.id, name: 'Bad', layoutPreset: 'nope' } });
    check('screen layout preset is validated', badLayout.status === 400);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const newShow = await api('POST', '/api/admin/showtimes', {
      token: adminToken,
      body: { movieId: jawan.id, screenId: newScreen.body.screen.id, date: tomorrow, time: '14:00', basePrice: 260 },
    });
    check('admin can create a showtime', newShow.status === 201 && newShow.body.showtime.prices.regular === 260);
    const clashShow = await api('POST', '/api/admin/showtimes', {
      token: adminToken,
      body: { movieId: jawan.id, screenId: newScreen.body.screen.id, date: tomorrow, time: '14:00' },
    });
    check('double-booking a screen is rejected', clashShow.status === 409);
    const badDate = await api('POST', '/api/admin/showtimes', {
      token: adminToken,
      body: { movieId: jawan.id, screenId: newScreen.body.screen.id, date: '01-01-2026', time: '14:00' },
    });
    check('showtime date format is validated', badDate.status === 400);

    const newFood = await api('POST', '/api/admin/food', { token: adminToken, body: { name: 'Test Slush', price: 199, category: 'Beverages' } });
    check('admin can create a food item', newFood.status === 201);
    const editFood = await api('PUT', `/api/admin/food/${newFood.body.item.id}`, { token: adminToken, body: { price: 249, available: false } });
    check('admin can edit a food item', editFood.body.item.price === 249);
    const hidden = await api('GET', '/api/food');
    check('unavailable food is hidden from customers', !hidden.body.items.some((i) => i.id === newFood.body.item.id));

    const newOffer = await api('POST', '/api/admin/offers', { token: adminToken, body: { title: 'Test Offer', code: 'testcode', discountType: 'flat', discountValue: 50, appliesTo: 'all', minAmount: 100 } });
    check('admin can create an offer (code upper-cased)', newOffer.status === 201 && newOffer.body.offer.code === 'TESTCODE');
    const dupeOffer = await api('POST', '/api/admin/offers', { token: adminToken, body: { title: 'Dupe', code: 'TESTCODE', discountType: 'flat', discountValue: 10 } });
    check('duplicate offer code is rejected', dupeOffer.status === 409);

    const adminBookings = await api('GET', '/api/admin/bookings', { token: adminToken });
    check('admin can list all bookings', adminBookings.status === 200 && adminBookings.body.bookings.length > 0);
    check('admin booking rows include the customer', Boolean(adminBookings.body.bookings[0].customer));
    const searchBookings = await api('GET', `/api/admin/bookings?q=${created.reference}`, { token: adminToken });
    check('admin can search bookings by reference', searchBookings.body.bookings.length === 1);

    const verify = await api('GET', `/api/admin/verify/${foodOrder.body.booking.reference}`, { token: adminToken });
    check('gate verification finds a valid ticket', verify.status === 200 && verify.body.valid === true);
    const verifyCancelled = await api('GET', `/api/admin/verify/${created.reference}`, { token: adminToken });
    check('gate verification flags a cancelled ticket', verifyCancelled.body.valid === false);
    const verifyMissing = await api('GET', '/api/admin/verify/NOPEXXXX', { token: adminToken });
    check('gate verification 404s on unknown reference', verifyMissing.status === 404);

    const adminUsers = await api('GET', '/api/admin/users', { token: adminToken });
    check('admin can list users', adminUsers.body.users.length >= 3);
    check('admin user rows never include a password', adminUsers.body.users.every((u) => u.password === undefined));
    const selfDisable = await api('POST', `/api/admin/users/${adminLogin.body.user.id}/toggle`, { token: adminToken });
    check('admin cannot disable their own account', selfDisable.status === 400);

    // Deleting a movie with live bookings must archive instead
    const liveBooking = adminBookings.body.bookings.find((b) => b.status === 'confirmed' && b.movieTitle);
    if (liveBooking) {
      const liveMovie = (await api('GET', '/api/movies?status=now_playing')).body.movies.find((m) => m.title === liveBooking.movieTitle);
      if (liveMovie) {
        const del = await api('DELETE', `/api/admin/movies/${liveMovie.id}`, { token: adminToken });
        check('deleting a movie with live bookings archives it instead', del.body.archived === true, JSON.stringify(del.body).slice(0, 120));
      }
    }
    const delTestMovie = await api('DELETE', `/api/admin/movies/${newMovie.body.movie.id}`, { token: adminToken });
    check('admin can delete an unbooked movie', delTestMovie.body.deleted === true);

    // ── Errors & static ──────────────────────────────────────────────────────
    section('Errors & static hosting');
    const notFound = await api('GET', '/api/does-not-exist');
    check('unknown API route returns 404 JSON', notFound.status === 404 && Boolean(notFound.body.error));
    const wrongMethod = await api('DELETE', '/api/home');
    check('wrong method returns 405', wrongMethod.status === 405);
    const badJson = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    check('malformed JSON body returns 400', badJson.status === 400);
    const missingShow = await api('GET', '/api/showtimes/sht_nope/seats');
    check('unknown showtime returns 404', missingShow.status === 404);

    const indexPage = await api('GET', '/', { raw: true });
    check('customer app HTML is served at /', indexPage.status === 200 && indexPage.text.includes('<html'));
    const adminPage = await api('GET', '/admin/', { raw: true });
    check('admin panel HTML is served at /admin/', adminPage.status === 200 && adminPage.text.includes('<html'));
    const poster = await api('GET', '/img/posters/jawan.svg', { raw: true });
    check('generated poster SVG is served', poster.status === 200 && poster.text.includes('<svg'));
    const traversal = await api('GET', '/../package.json', { raw: true });
    check('path traversal is blocked', traversal.status !== 200 || !traversal.text.includes('"name"'), `status ${traversal.status}`);
    const spa = await api('GET', '/movie/mov_jawan', { raw: true });
    check('deep links fall back to the SPA shell', spa.status === 200 && spa.text.includes('<html'));
  } catch (err) {
    failed += 1;
    failures.push(`Harness error: ${err.message}`);
    console.error('\n\x1b[31mHarness error:\x1b[0m', err);
    if (serverLog.length) console.error('\nServer output:\n' + serverLog.join(''));
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_e) {}
  }

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  \x1b[32m${passed} passed\x1b[0m` + (failed ? `,  \x1b[31m${failed} failed\x1b[0m` : ',  0 failed'));
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  • ${f}`));
  }
  console.log('');
  process.exit(failed ? 1 : 0);
}

run();
