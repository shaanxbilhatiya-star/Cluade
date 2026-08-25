'use strict';
const db = require('../db');
const auth = require('../auth');
const { Router, HttpError } = require('../router');
const { LANGUAGES, GENRES } = require('../catalog');

const router = new Router();

const EDITABLE_PROFILE_FIELDS = ['name', 'phone', 'city', 'dateOfBirth', 'gender', 'avatarUrl'];

function me(ctx) {
  return db.byId('users', ctx.user.id);
}

// ── Profile ──────────────────────────────────────────────────────────────────
router.get('/me', auth.requireAuth, (ctx) => {
  const user = me(ctx);
  const bookings = db.find('bookings', (b) => b.userId === user.id);
  const spent = bookings
    .filter((b) => b.status !== 'cancelled')
    .reduce((sum, b) => sum + (b.amounts?.total || 0), 0);

  return {
    user: auth.publicUser(user),
    stats: {
      totalBookings: bookings.length,
      moviesWatched: bookings.filter((b) => b.type === 'movie' && b.status === 'completed').length,
      upcoming: bookings.filter((b) => b.status === 'confirmed' && new Date(b.startsAt) > new Date()).length,
      totalSpent: spent,
      loyaltyPoints: user.loyaltyPoints || 0,
      watchlistCount: (user.watchlist || []).length,
    },
  };
});

router.patch('/me', auth.requireAuth, (ctx) => {
  const patch = {};
  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (ctx.body[field] !== undefined) patch[field] = ctx.body[field];
  }
  if (patch.name !== undefined && String(patch.name).trim().length < 2) {
    throw new HttpError(400, 'Name must be at least 2 characters');
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
  return { user: auth.publicUser(db.update('users', ctx.user.id, patch)) };
});

router.patch('/me/settings', auth.requireAuth, (ctx) => {
  const user = me(ctx);
  const current = user.settings || {};
  const next = {
    darkMode: ctx.body.darkMode !== undefined ? Boolean(ctx.body.darkMode) : current.darkMode,
    language: ctx.body.language !== undefined ? String(ctx.body.language) : current.language,
    notifications: Object.assign({}, current.notifications, ctx.body.notifications || {}),
  };
  return { settings: db.update('users', user.id, { settings: next }).settings };
});

// ── Watchlist ────────────────────────────────────────────────────────────────
router.get('/me/watchlist', auth.requireAuth, (ctx) => {
  const ids = me(ctx).watchlist || [];
  return { movies: ids.map((id) => db.byId('movies', id)).filter(Boolean) };
});

router.post('/me/watchlist', auth.requireAuth, (ctx) => {
  const movie = db.byId('movies', ctx.body.movieId);
  if (!movie) throw new HttpError(404, 'Movie not found');
  const user = me(ctx);
  const list = new Set(user.watchlist || []);
  const wasAdded = !list.has(movie.id);
  if (wasAdded) list.add(movie.id);
  else list.delete(movie.id);
  db.update('users', user.id, { watchlist: [...list] });
  return { inWatchlist: wasAdded, watchlist: [...list] };
});

router.delete('/me/watchlist/:movieId', auth.requireAuth, (ctx) => {
  const user = me(ctx);
  const list = (user.watchlist || []).filter((id) => id !== ctx.params.movieId);
  db.update('users', user.id, { watchlist: list });
  return { watchlist: list };
});

// ── Movie interests ──────────────────────────────────────────────────────────
router.get('/me/interests', auth.requireAuth, (ctx) => {
  const user = me(ctx);
  return {
    interests: user.interests || [],
    preferredLanguages: user.preferredLanguages || [],
    allGenres: GENRES,
    allLanguages: LANGUAGES,
  };
});

router.put('/me/interests', auth.requireAuth, (ctx) => {
  const interests = Array.isArray(ctx.body.interests)
    ? ctx.body.interests.filter((g) => GENRES.includes(g))
    : me(ctx).interests || [];
  const preferredLanguages = Array.isArray(ctx.body.preferredLanguages)
    ? ctx.body.preferredLanguages.filter((l) => LANGUAGES.includes(l))
    : me(ctx).preferredLanguages || [];
  const user = db.update('users', ctx.user.id, { interests, preferredLanguages });
  return { interests: user.interests, preferredLanguages: user.preferredLanguages };
});

// ── Payment methods ──────────────────────────────────────────────────────────
const PAYMENT_TYPES = ['card', 'upi', 'wallet', 'netbanking'];

router.get('/me/payment-methods', auth.requireAuth, (ctx) => ({
  paymentMethods: me(ctx).paymentMethods || [],
}));

router.post('/me/payment-methods', auth.requireAuth, (ctx) => {
  const { type, label, last4, brand, expiry, handle, bank } = ctx.body;
  if (!PAYMENT_TYPES.includes(type)) throw new HttpError(400, `Payment type must be one of: ${PAYMENT_TYPES.join(', ')}`);
  if (!label || String(label).trim().length < 2) throw new HttpError(400, 'Give this payment method a label');
  if (type === 'card' && !/^\d{4}$/.test(String(last4 || ''))) {
    throw new HttpError(400, 'Enter the last 4 digits of the card');
  }
  if (type === 'upi' && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(String(handle || ''))) {
    throw new HttpError(400, 'Enter a valid UPI ID, e.g. name@bank');
  }

  const user = me(ctx);
  const list = [...(user.paymentMethods || [])];
  const method = {
    id: db.id('pm'),
    type,
    label: String(label).trim(),
    last4: type === 'card' ? String(last4) : undefined,
    brand: brand || undefined,
    expiry: expiry || undefined,
    handle: handle || undefined,
    bank: bank || undefined,
    isDefault: list.length === 0,
  };
  list.push(method);
  db.update('users', user.id, { paymentMethods: list });
  ctx.state.status = 201;
  return { paymentMethod: method, paymentMethods: list };
});

router.post('/me/payment-methods/:id/default', auth.requireAuth, (ctx) => {
  const user = me(ctx);
  const list = (user.paymentMethods || []).map((m) => Object.assign({}, m, { isDefault: m.id === ctx.params.id }));
  if (!list.some((m) => m.isDefault)) throw new HttpError(404, 'Payment method not found');
  db.update('users', user.id, { paymentMethods: list });
  return { paymentMethods: list };
});

router.delete('/me/payment-methods/:id', auth.requireAuth, (ctx) => {
  const user = me(ctx);
  const list = (user.paymentMethods || []).filter((m) => m.id !== ctx.params.id);
  if (list.length && !list.some((m) => m.isDefault)) list[0].isDefault = true;
  db.update('users', user.id, { paymentMethods: list });
  return { paymentMethods: list };
});

// ── Notifications ────────────────────────────────────────────────────────────
router.get('/me/notifications', auth.requireAuth, (ctx) => {
  const list = db
    .find('notifications', (n) => n.userId === ctx.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { unread: list.filter((n) => !n.read).length, notifications: list };
});

router.post('/me/notifications/read', auth.requireAuth, (ctx) => {
  const ids = Array.isArray(ctx.body.ids) ? new Set(ctx.body.ids) : null;
  let changed = 0;
  for (const n of db.get('notifications')) {
    if (n.userId !== ctx.user.id || n.read) continue;
    if (ids && !ids.has(n.id)) continue;
    n.read = true;
    changed += 1;
  }
  if (changed) db.markDirty('notifications');
  return { markedRead: changed };
});

router.delete('/me/notifications/:id', auth.requireAuth, (ctx) => {
  const n = db.byId('notifications', ctx.params.id);
  if (!n || n.userId !== ctx.user.id) throw new HttpError(404, 'Notification not found');
  db.remove('notifications', n.id);
  return { ok: true };
});

module.exports = router;
