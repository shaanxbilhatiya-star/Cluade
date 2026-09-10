'use strict';
const db = require('../db');
const auth = require('../auth');
const { Router, HttpError } = require('../router');

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
