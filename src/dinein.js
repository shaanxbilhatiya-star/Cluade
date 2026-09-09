'use strict';
/**
 * Dine-In domain logic.
 *
 * The tab lets a guest settle their restaurant bill from the table and take an
 * instant discount. There are exactly two tiers, and which one applies is
 * decided here so the tab header, the quote endpoint and the pay endpoint can
 * never disagree:
 *
 *   reserved  - the guest holds a table reservation that has been live for at
 *               least `lockMinutes`. Earns `reservedDiscountPercent` (30% by
 *               default). Billing against the reservation is LOCKED until that
 *               window elapses, which is the whole point: it stops a guest
 *               already sitting at the table from booking a reservation on the
 *               spot and claiming the bigger discount.
 *   walkin    - no reservation (or one that is still locked). Bills instantly
 *               at `walkinDiscountPercent` (10% by default) and the guest is
 *               shown the "book ahead next time" notice.
 *
 * Every number and every line of notice copy below is admin-editable and stored
 * as a singleton on the `meta` collection, so changing the discount in the
 * admin panel changes what the next customer is quoted AND the wording of the
 * notice they read, without a deploy.
 */
const db = require('./db');
const { HttpError } = require('./router');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MS_PER_MIN = 60 * 1000;

/**
 * Shipped defaults. `settings()` merges the admin's saved values over these, so
 * a field the admin has never touched keeps working after an upgrade.
 *
 * Notice copy uses {tokens} that are substituted at read time - that is what
 * makes a notice "reflect the discount at that moment" even after the admin
 * edits the percentages and leaves the wording alone.
 */
const DEFAULTS = {
  active: true,

  // ── Restaurant identity ──
  restaurantName: 'Kingfisher Restaurant',
  tagline: 'Pay your bill from the table and save instantly',
  address: 'Kingfisher Resort, Mandla',
  phone: '7648913272',

  // ── Discounts (percent off the food bill) ──
  reservedDiscountPercent: 30,
  walkinDiscountPercent: 10,
  /** Rupee cap on the instant discount. 0 = uncapped. */
  maxDiscountAmount: 0,
  /** Bills below this cannot be paid through the app. 0 = no minimum. */
  minBillAmount: 0,

  // ── The reservation billing lock ──
  /** How long a reservation must be held before it can be billed. */
  lockMinutes: 30,
  /** 'booked' = counted from when the reservation was made, 'slot' = from the reserved time. */
  lockBasis: 'booked',
  /**
   * How far before the reserved time billing may open. This is what ties the
   * discount to the visit: without it, "wait 30 minutes" could be satisfied by
   * booking any far-future slot, so a walk-in could earn the reserved rate by
   * reserving a table for next week and ordering starters.
   */
  arriveEarlyMinutes: 30,
  /** Hours after the reserved slot that a reservation can still be billed. */
  graceHours: 4,
  /** Let a guest whose reservation is still locked pay right away at the walk-in rate. */
  allowWalkinWhileLocked: true,

  /** Largest bill that may be settled in-app, as a guard on a self-declared amount. */
  maxBillAmount: 200000,

  // ── Reservation window ──
  openTime: '11:00',
  closeTime: '23:00',
  slotMinutes: 30,
  maxPartySize: 20,
  /** Guests that can be seated in any one slot. */
  capacityPerSlot: 40,
  /** How many days ahead a table can be reserved. */
  advanceDays: 14,
  areas: ['Indoor AC', 'Garden', 'Rooftop', 'Poolside'],

  // ── Notices (customer-facing, admin-editable, {token} aware) ──
  reservedNotice:
    'Table reserved \u2014 pay this bill in the app and {reservedDiscount}% comes off instantly.',
  lockedNotice:
    'Your {reservedDiscount}% reserved-table discount unlocks {lockMinutes} minutes after booking. ' +
    'Billing opens at {unlockTime}, {minutesLeft} from now. You can still pay now at {walkinDiscount}% off.',
  walkinNotice:
    'Paying as a walk-in guest, so this bill gets {walkinDiscount}% off. Before you arrive next time, ' +
    'book a reservation at least {lockMinutes} minutes ahead and get {reservedDiscount}% off instead.',
  paidReservedNotice:
    'You saved {saving} with your {reservedDiscount}% reserved-table discount. See you again soon!',
  paidWalkinNotice:
    'You saved {saving} at the {walkinDiscount}% walk-in rate. Book a table at least {lockMinutes} minutes ' +
    'before you reach {restaurant} next time and save {reservedDiscount}% instead.',
};

/** Numeric fields, with the bounds the admin form is validated against. */
const NUMERIC_FIELDS = {
  reservedDiscountPercent: { min: 0, max: 100 },
  walkinDiscountPercent: { min: 0, max: 100 },
  maxDiscountAmount: { min: 0, max: 1000000 },
  minBillAmount: { min: 0, max: 1000000 },
  lockMinutes: { min: 0, max: 1440 },
  arriveEarlyMinutes: { min: 0, max: 1440 },
  graceHours: { min: 0, max: 72 },
  maxBillAmount: { min: 100, max: 10000000 },
  slotMinutes: { min: 5, max: 180 },
  maxPartySize: { min: 1, max: 500 },
  capacityPerSlot: { min: 1, max: 5000 },
  advanceDays: { min: 0, max: 365 },
};

const TEXT_FIELDS = ['restaurantName', 'tagline', 'address', 'phone'];
const TIME_FIELDS = ['openTime', 'closeTime'];
const NOTICE_FIELDS = [
  'reservedNotice',
  'lockedNotice',
  'walkinNotice',
  'paidReservedNotice',
  'paidWalkinNotice',
];

// ── Settings ────────────────────────────────────────────────────────────────
/** Current settings: shipped defaults with the admin's saved values merged over. */
function settings() {
  const saved = db.get('meta').dineIn || {};
  return Object.assign({}, DEFAULTS, saved);
}

function clampNumber(value, bounds, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

/**
 * Validates and persists a settings patch. Only known keys are written, so a
 * stray field in the request body can never end up in the stored record.
 */
function saveSettings(patch = {}) {
  const current = settings();
  const next = Object.assign({}, current);

  for (const [key, bounds] of Object.entries(NUMERIC_FIELDS)) {
    if (patch[key] === undefined || patch[key] === '') continue;
    if (!Number.isFinite(Number(patch[key]))) throw new HttpError(400, `${key} must be a number`);
    next[key] = clampNumber(patch[key], bounds, current[key]);
  }

  for (const key of TEXT_FIELDS) {
    if (patch[key] === undefined) continue;
    next[key] = String(patch[key]).trim().slice(0, 160);
  }

  for (const key of TIME_FIELDS) {
    if (patch[key] === undefined || patch[key] === '') continue;
    if (!TIME_RE.test(String(patch[key]))) throw new HttpError(400, `${key} must be a 24-hour time like 11:00`);
    next[key] = String(patch[key]);
  }

  for (const key of NOTICE_FIELDS) {
    if (patch[key] === undefined) continue;
    // An empty notice is allowed - it simply hides that banner.
    next[key] = String(patch[key]).trim().slice(0, 600);
  }

  if (patch.lockBasis !== undefined) {
    const basis = String(patch.lockBasis);
    if (basis !== 'booked' && basis !== 'slot') {
      throw new HttpError(400, "lockBasis must be either 'booked' or 'slot'");
    }
    next.lockBasis = basis;
  }

  if (patch.active !== undefined) next.active = patch.active === true || patch.active === 'true';
  if (patch.allowWalkinWhileLocked !== undefined) {
    next.allowWalkinWhileLocked =
      patch.allowWalkinWhileLocked === true || patch.allowWalkinWhileLocked === 'true';
  }

  if (patch.areas !== undefined) {
    const list = Array.isArray(patch.areas)
      ? patch.areas
      : String(patch.areas || '').split(',');
    next.areas = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  }

  if (!TIME_RE.test(next.openTime) || !TIME_RE.test(next.closeTime)) {
    throw new HttpError(400, 'Opening and closing times must be 24-hour times like 11:00');
  }
  if (minutesOfDay(next.closeTime) <= minutesOfDay(next.openTime)) {
    throw new HttpError(400, 'Closing time must be later than opening time');
  }

  /* Cross-field checks. Each field is individually valid above; these catch
     combinations that would quietly produce a deal no guest can ever claim. */
  if (next.walkinDiscountPercent > next.reservedDiscountPercent) {
    throw new HttpError(
      400,
      'The walk-in discount cannot be larger than the reserved-table discount — that would remove any reason to book ahead'
    );
  }
  // The billing window must still be open after the lock elapses, or a
  // reservation would expire before it ever became billable.
  if (next.lockMinutes > next.arriveEarlyMinutes + next.graceHours * 60) {
    throw new HttpError(
      400,
      `A ${next.lockMinutes}-minute lock cannot fit inside the billing window — raise "reservation still valid for" ` +
        `(currently ${next.graceHours}h) or lower the lock`
    );
  }
  if (next.minBillAmount && next.maxBillAmount && next.minBillAmount > next.maxBillAmount) {
    throw new HttpError(400, 'The minimum bill cannot be larger than the maximum bill');
  }

  const meta = db.get('meta');
  meta.dineIn = next;
  // Debounced write, like every other request-path mutation in the app.
  db.markDirty('meta');
  return next;
}

/** The slice of settings the customer app is allowed to see. */
function publicSettings(s = settings()) {
  return {
    active: s.active !== false,
    restaurantName: s.restaurantName,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    reservedDiscountPercent: s.reservedDiscountPercent,
    walkinDiscountPercent: s.walkinDiscountPercent,
    maxDiscountAmount: s.maxDiscountAmount,
    minBillAmount: s.minBillAmount,
    maxBillAmount: s.maxBillAmount,
    lockMinutes: s.lockMinutes,
    lockBasis: s.lockBasis,
    arriveEarlyMinutes: s.arriveEarlyMinutes,
    graceHours: s.graceHours,
    allowWalkinWhileLocked: s.allowWalkinWhileLocked !== false,
    openTime: s.openTime,
    closeTime: s.closeTime,
    slotMinutes: s.slotMinutes,
    maxPartySize: s.maxPartySize,
    advanceDays: s.advanceDays,
    areas: s.areas,
  };
}

// ── Dates & slots ───────────────────────────────────────────────────────────
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function today() {
  return dateKey(new Date());
}

function parseKey(key) {
  if (!DATE_RE.test(String(key || ''))) return null;
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function minutesOfDay(time) {
  const match = TIME_RE.exec(String(time || ''));
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function timeLabel(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' + 'HH:MM' -> ISO stamp in local time. */
function stampFor(key, time) {
  const date = parseKey(key);
  if (!date) return null;
  const match = TIME_RE.exec(String(time || ''));
  date.setHours(match ? Number(match[1]) : 12, match ? Number(match[2]) : 0, 0, 0);
  return date.toISOString();
}

/** "6:30 PM" for display inside notices. */
function clockLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${period}`;
}

/** "25 minutes" / "1 hr 5 min" for the countdown inside notices. */
function durationLabel(minutes) {
  const mins = Math.max(0, Math.ceil(minutes));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

/**
 * Reservations that still hold a seat for a given date. A party that has paid
 * its bill is 'completed' but is very much still at the table, so those count
 * too — only a cancellation frees the seats.
 */
function reservationsOn(key) {
  return db.find(
    'dineReservations',
    (r) => r.date === key && (r.status === 'confirmed' || r.status === 'completed')
  );
}

/**
 * Bookable slots for a date, with the seats left in each. Past slots on today's
 * date are dropped, and a slot too close to now to clear the lock is flagged so
 * the UI can be honest about it up front.
 */
function slotsFor(key, s = settings()) {
  const date = parseKey(key);
  if (!date) throw new HttpError(400, 'Pick a valid date (YYYY-MM-DD)');

  const step = Math.max(5, Number(s.slotMinutes) || 30);
  const open = minutesOfDay(s.openTime);
  const close = minutesOfDay(s.closeTime);
  const isToday = key === today();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const taken = reservationsOn(key).reduce((map, r) => {
    map[r.time] = (map[r.time] || 0) + (Number(r.partySize) || 0);
    return map;
  }, {});

  const out = [];
  for (let minutes = open; minutes <= close - step; minutes += step) {
    if (isToday && minutes < nowMinutes) continue;
    const time = timeLabel(minutes);
    const seated = taken[time] || 0;
    const capacity = Math.max(1, Number(s.capacityPerSlot) || 40);
    out.push({
      time,
      label: clockLabel(stampFor(key, time)),
      seatsLeft: Math.max(0, capacity - seated),
      full: seated >= capacity,
    });
  }
  return out;
}

// ── Notices ─────────────────────────────────────────────────────────────────
/**
 * Substitutes {tokens} into an admin-authored notice. Unknown tokens are left
 * untouched so a typo in the admin panel is visible rather than silently blank.
 */
function renderNotice(template, tokens = {}) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    tokens[key] === undefined || tokens[key] === null ? whole : String(tokens[key])
  );
}

function money(amount) {
  return `\u20B9${(Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Every token a notice may reference. */
function noticeTokens(s, extra = {}) {
  return Object.assign(
    {
      reservedDiscount: s.reservedDiscountPercent,
      walkinDiscount: s.walkinDiscountPercent,
      lockMinutes: s.lockMinutes,
      graceHours: s.graceHours,
      restaurant: s.restaurantName,
      minutesLeft: '0 minutes',
      unlockTime: '',
      bill: money(0),
      saving: money(0),
      payable: money(0),
    },
    extra
  );
}

// ── The lock ────────────────────────────────────────────────────────────────
/**
 * When a reservation's billing window opens.
 *
 * Two conditions have to be met, and the later of the two wins:
 *   1. the table has been held for `lockMinutes` - the anti-gaming rule, so a
 *      guest cannot book from their seat and immediately claim the bigger
 *      discount;
 *   2. the reserved sitting is actually about to happen (`arriveEarlyMinutes`
 *      before the slot) - which stops the first rule being satisfied by booking
 *      a table for next week and simply waiting half an hour.
 *
 * Together they enforce the real rule: book ahead, then pay when you dine.
 */
function unlockTimeOf(reservation, s = settings()) {
  const lockMs = Math.max(0, Number(s.lockMinutes) || 0) * MS_PER_MIN;
  const slotMs = new Date(reservation.startsAt || reservation.createdAt).getTime();
  const bookedMs = new Date(reservation.reservedAt || reservation.createdAt).getTime();

  const basis = s.lockBasis === 'slot' ? slotMs : bookedMs;
  const heldLongEnough = (Number.isFinite(basis) ? basis : Date.now()) + lockMs;

  const earlyMs = Math.max(0, Number(s.arriveEarlyMinutes) || 0) * MS_PER_MIN;
  const sittingOpens = (Number.isFinite(slotMs) ? slotMs : Date.now()) - earlyMs;

  return new Date(Math.max(heldLongEnough, sittingOpens));
}

/** Lock state of a single reservation right now. */
function lockState(reservation, s = settings(), now = Date.now()) {
  const unlocksAt = unlockTimeOf(reservation, s);
  const msLeft = unlocksAt.getTime() - now;
  return {
    locked: msLeft > 0,
    unlocksAt: unlocksAt.toISOString(),
    unlockLabel: clockLabel(unlocksAt),
    minutesLeft: Math.max(0, Math.ceil(msLeft / MS_PER_MIN)),
    secondsLeft: Math.max(0, Math.ceil(msLeft / 1000)),
  };
}

/** When a reservation stops being billable (grace period after the slot). */
function expiryOf(reservation, s = settings()) {
  const slot = new Date(reservation.startsAt || reservation.createdAt).getTime();
  const graceMs = Math.max(0, Number(s.graceHours) || 0) * 60 * MS_PER_MIN;
  return new Date((Number.isFinite(slot) ? slot : Date.now()) + graceMs);
}

/** Adds lock/eligibility state to a stored reservation for the client. */
function decorateReservation(reservation, s = settings(), now = Date.now()) {
  const lock = lockState(reservation, s, now);
  const expiresAt = expiryOf(reservation, s);
  const expired = expiresAt.getTime() < now;

  return Object.assign({}, reservation, {
    lock,
    expiresAt: expiresAt.toISOString(),
    expired,
    billable: reservation.status === 'confirmed' && !reservation.billId && !lock.locked && !expired,
    /**
     * Why it is not billable, for the UI to explain. `billId` is checked before
     * status because a reservation that has been used becomes 'completed', and
     * reporting that as 'cancelled' would be a lie.
     */
    blockedReason: reservation.billId
      ? 'already-billed'
      : reservation.status !== 'confirmed'
        ? 'cancelled'
        : lock.locked
          ? 'locked'
          : expired
            ? 'expired'
            : null,
  });
}

/** The reservation a guest should be billed against: soonest usable one. */
function activeReservationFor(userId, s = settings(), now = Date.now()) {
  const mine = db
    .find('dineReservations', (r) => r.userId === userId && r.status === 'confirmed' && !r.billId)
    .map((r) => decorateReservation(r, s, now))
    .filter((r) => !r.expired)
    // Billable ones first, then the one that unlocks soonest.
    .sort((a, b) => {
      if (a.billable !== b.billable) return a.billable ? -1 : 1;
      return new Date(a.lock.unlocksAt) - new Date(b.lock.unlocksAt);
    });
  return mine[0] || null;
}

/**
 * The single decision point for "what discount does this bill get right now".
 *
 * @param {object} input
 * @param {object|null} input.reservation  decorated reservation, or null for a walk-in
 * @param {boolean} input.walkinRequested  guest explicitly chose to pay at the walk-in rate
 * @returns tier descriptor including the rendered, admin-authored notice
 */
function resolveTier({ reservation = null, walkinRequested = false, s = settings(), now = Date.now() } = {}) {
  const reserved = Number(s.reservedDiscountPercent) || 0;
  const walkin = Number(s.walkinDiscountPercent) || 0;

  // No usable reservation, or the guest asked for the instant walk-in rate.
  if (!reservation || walkinRequested) {
    return {
      mode: 'walkin',
      discountPercent: walkin,
      locked: false,
      canPayNow: true,
      reservationId: null,
      lock: null,
      noticeKey: 'walkinNotice',
      noticeKind: 'warn',
    };
  }

  if (reservation.blockedReason === 'locked') {
    return {
      mode: 'reserved',
      discountPercent: reserved,
      locked: true,
      canPayNow: false,
      reservationId: reservation.id,
      lock: reservation.lock,
      // Falling back to the walk-in rate keeps the guest from being stuck.
      walkinFallback: s.allowWalkinWhileLocked !== false ? walkin : null,
      noticeKey: 'lockedNotice',
      noticeKind: 'warn',
    };
  }

  if (!reservation.billable) {
    // Cancelled, expired or already billed - treat as a walk-in.
    return {
      mode: 'walkin',
      discountPercent: walkin,
      locked: false,
      canPayNow: true,
      reservationId: null,
      lock: null,
      noticeKey: 'walkinNotice',
      noticeKind: 'warn',
      downgradedFrom: reservation.blockedReason,
    };
  }

  return {
    mode: 'reserved',
    discountPercent: reserved,
    locked: false,
    canPayNow: true,
    reservationId: reservation.id,
    lock: reservation.lock,
    noticeKey: 'reservedNotice',
    noticeKind: 'info',
  };
}

/** Renders the notice for a tier, filling in live amounts and countdown. */
function tierNotice(tier, s = settings(), amounts = null) {
  const tokens = noticeTokens(s, {
    minutesLeft: tier.lock ? durationLabel(tier.lock.minutesLeft) : '0 minutes',
    unlockTime: tier.lock ? tier.lock.unlockLabel : '',
    bill: money(amounts ? amounts.billAmount : 0),
    saving: money(amounts ? amounts.discount : 0),
    payable: money(amounts ? amounts.total : 0),
  });
  return renderNotice(s[tier.noticeKey], tokens);
}

/** Notice shown on the receipt after a bill is paid. */
function paidNotice(bill, s = settings()) {
  const key = bill.mode === 'reserved' ? 'paidReservedNotice' : 'paidWalkinNotice';
  return renderNotice(
    s[key],
    noticeTokens(s, {
      bill: money(bill.amounts.billAmount),
      saving: money(bill.amounts.discount),
      payable: money(bill.amounts.total),
    })
  );
}

module.exports = {
  DEFAULTS,
  NOTICE_FIELDS,
  DATE_RE,
  TIME_RE,
  settings,
  saveSettings,
  publicSettings,
  dateKey,
  today,
  parseKey,
  minutesOfDay,
  stampFor,
  clockLabel,
  durationLabel,
  slotsFor,
  renderNotice,
  noticeTokens,
  money,
  lockState,
  unlockTimeOf,
  expiryOf,
  decorateReservation,
  activeReservationFor,
  resolveTier,
  tierNotice,
  paidNotice,
};
