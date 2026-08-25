'use strict';
const db = require('../db');
const auth = require('../auth');
const { Router, HttpError } = require('../router');

const router = new Router();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findByLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return (
    db.findOne('users', (u) => u.email.toLowerCase() === value) ||
    (digits.length >= 6
      ? db.findOne('users', (u) => String(u.phone || '').replace(/\D/g, '').endsWith(digits.slice(-10)))
      : null)
  );
}

router.post('/auth/register', (ctx) => {
  const { name, email, phone, password, city } = ctx.body;
  if (!name || String(name).trim().length < 2) throw new HttpError(400, 'Please enter your full name');
  const mail = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new HttpError(400, 'Please enter a valid email address');
  if (db.findOne('users', (u) => u.email.toLowerCase() === mail)) {
    throw new HttpError(409, 'An account with this email already exists');
  }

  const seq = db.get('users').length + 1;
  const user = db.insert('users', {
    id: db.id('usr'),
    name: String(name).trim(),
    email: mail,
    phone: phone ? String(phone).trim() : '',
    password: auth.hashPassword(password),
    role: 'customer',
    avatarUrl: '/img/avatars/guest.svg',
    city: city || 'Ahmedabad',
    memberId: `CF-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`,
    loyaltyPoints: 0,
    watchlist: [],
    interests: [],
    preferredLanguages: [],
    paymentMethods: [],
    settings: {
      darkMode: false,
      language: 'English (US)',
      notifications: { bookingUpdates: true, offers: true, newReleases: true, reminders: true },
    },
    active: true,
  });

  db.insert('notifications', {
    id: db.id('ntf'),
    userId: user.id,
    title: 'Welcome to CineFlex 🎬',
    body: 'Your account is ready. Browse now playing movies and book your first show.',
    kind: 'system',
    read: false,
  });

  ctx.state.status = 201;
  return { token: auth.sign({ sub: user.id, role: user.role }), user: auth.publicUser(user) };
});

router.post('/auth/login', (ctx) => {
  const { email, login, password } = ctx.body;
  const user = findByLogin(login || email);
  if (!user || !auth.verifyPassword(password, user.password)) {
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (user.active === false) throw new HttpError(403, 'This account has been disabled');

  db.update('users', user.id, { lastLoginAt: new Date().toISOString() });
  return { token: auth.sign({ sub: user.id, role: user.role }), user: auth.publicUser(db.byId('users', user.id)) };
});

router.get('/auth/me', auth.requireAuth, (ctx) => ({ user: auth.publicUser(ctx.user) }));

router.post('/auth/logout', () => ({ ok: true }));

router.post('/auth/change-password', auth.requireAuth, (ctx) => {
  const { currentPassword, newPassword } = ctx.body;
  if (!auth.verifyPassword(currentPassword, ctx.user.password)) {
    throw new HttpError(400, 'Your current password is incorrect');
  }
  db.update('users', ctx.user.id, { password: auth.hashPassword(newPassword) });
  return { ok: true, message: 'Password updated' };
});

module.exports = router;
