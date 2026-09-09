'use strict';
/**
 * Dine-In: restaurant billing with two discount tiers.
 *
 *   reserved — the guest booked a table with us. Their bill gets the higher
 *              discount, but only once the table has been reserved for
 *              `unlockMinutes`; until then billing is locked. Booking a table
 *              and immediately asking for the big discount is exactly what the
 *              lock exists to prevent.
 *
 *   walkin   — the guest just turned up. They can pay immediately but only get
 *              the smaller discount, and they are told (via `walkInNotice`)
 *              to reserve ahead next time to earn the bigger one.
 *
 * Everything an operator might want to tune - both percentages, the lock
 * window and the wording of every notice - lives in `meta.dineIn` and is
 * editable from the admin panel. Notices are templates: the placeholders are
 * substituted here, server side, so the text a customer reads can never
 * disagree with the discount they are actually being given.
 */
const db = require('./db');
const { HttpError } = require('./router');

/** Shipped defaults. Anything the admin saves is layered on top of these. */
const DEFAULTS = {
  active: true,
  restaurantName: 'Kingfisher Dine-In',
  phone: '7648913272',

  /** Discount for a guest who reserved a table (and waited out the lock). */
  reservedDiscountPercent: 30,
  /** Discount for a walk-in guest paying at the table. */
  walkInDiscountPercent: 10,
  /** How long after booking a reservation before its bill can be paid. */
  unlockMinutes: 30,

  /** 0 = no cap on the rupee value of the discount. */
  maxDiscountAmount: 0,
  /** Smallest bill we will accept. 0 = no minimum. */
  minBillAmount: 0,
  maxBillAmount: 200000,
  maxPartySize: 30,

  slots: ['12:00', '13:00', '14:00', '19:00', '20:00', '21:00', '22:00'],

  // ── Notice templates ──────────────────────────────────────────────────────
  // Placeholders: {reservedDiscount} {walkInDiscount} {extraDiscount}
  //               {unlockMinutes} {minutesLeft} {unlockTime} {discount}
  //               {restaurantName} {phone} {reference} {tableLabel}
  //               {partySize} {bill} {saved} {payable}
  reserveNotice:
    'Reserve at least {unlockMinutes} minutes before you arrive. Billing unlocks {unlockMinutes} minutes after you book, and then your bill gets {reservedDiscount}% off.',
  lockedNotice:
    'Table reserved — your {reservedDiscount}% discount unlocks at {unlockTime}. Billing opens {unlockMinutes} minutes after you book, so please wait another {minutesLeft} min.',
  reservedNotice:
    'Reservation {reference} is unlocked. Pay your bill here and get {reservedDiscount}% off.',
  walkInNotice:
    'You are billing as a walk-in, so this bill gets {walkInDiscount}% off. Before you arrive next time, book a reservation at least {unlockMinutes} minutes ahead and get {reservedDiscount}% off instead — {extraDiscount}% extra.',
};

/** Notice keys, exposed so the admin UI and the API agree on what is editable. */
const NOTICE_KEYS = ['reserveNotice', 'lockedNotice', 'reservedNotice', 'walkInNotice'];

const NUMBER_FIELDS = [
  'reservedDiscountPercent',
  'walkInDiscountPercent',
  'unlockMinutes',
  'maxDiscountAmount',
  'minBillAmount',
  'maxBillAmount',
  'maxPartySize',
];

const SETTING_FIELDS = ['active', 'restaurantName', 'phone', 'slots', ...NUMBER_FIELDS, ...NOTICE_KEYS];

const MINUTE_MS = 60 * 1000;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Current configuration: defaults with any admin overrides layered on top. */
function settings() {
  const stored = db.get('meta').dineIn;
  return Object.assign({}, DEFAULTS, stored && typeof stored === 'object' ? stored : {});
}

/**
 * Validates and persists a settings patch. Only known fields are accepted and
 * every number is clamped, so a bad admin payload can never produce a
 * nonsensical discount (e.g. 400% off, or a negative lock window).
 */
function saveSettings(patch) {
  const next = Object.assign({}, settings());

  for (const key of SETTING_FIELDS) {
    if (patch[key] === undefined) continue;
    next[key] = patch[key];
  }

  next.active = next.active !== false && next.active !== 'false';
  next.restaurantName = String(next.restaurantName || DEFAULTS.restaurantName).slice(0, 80);
  next.phone = String(next.phone || '').replace(/[^\d+\s-]/g, '').slice(0, 20);

  next.reservedDiscountPercent = clamp(next.reservedDiscountPercent, 0, 100, DEFAULTS.reservedDiscountPercent);
  next.walkInDiscountPercent = clamp(next.walkInDiscountPercent, 0, 100, DEFAULTS.walkInDiscountPercent);
  next.unlockMinutes = clamp(next.unlockMinutes, 0, 1440, DEFAULTS.unlockMinutes);
  next.maxDiscountAmount = clamp(next.maxDiscountAmount, 0, 1000000, DEFAULTS.maxDiscountAmount);
  next.minBillAmount = clamp(next.minBillAmount, 0, 1000000, DEFAULTS.minBillAmount);
  next.maxBillAmount = clamp(next.maxBillAmount, 1, 10000000, DEFAULTS.maxBillAmount);
  next.maxPartySize = clamp(next.maxPartySize, 1, 200, DEFAULTS.maxPartySize);

  if (next.maxBillAmount < next.minBillAmount) {
    throw new HttpError(400, 'Maximum bill cannot be lower than the minimum bill');
  }

  next.slots = normaliseSlots(next.slots);
  if (!next.slots.length) next.slots = DEFAULTS.slots.slice();

  for (const key of NOTICE_KEYS) {
    // An empty notice falls back to the shipped wording rather than showing
    // the customer a blank box.
    const text = String(next[key] === undefined || next[key] === null ? '' : next[key]).trim();
    next[key] = (text || DEFAULTS[key]).slice(0, 600);
  }

  const meta = db.get('meta');
  meta.dineIn = next;
  db.markDirty('meta');
  db.flushNow();
  return next;
}

/** Accepts an array or comma/newline separated text; keeps valid HH:MM only. */
function normaliseSlots(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]/);

  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim());
    if (!match) continue;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (hh > 23 || mm > 59) continue;
    const slot = `${String(hh).padStart(2, '0')}:${match[2]}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    out.push(slot);
  }
  return out.sort();
}

/** "19:05" in the venue's local time, for {unlockTime}. */
function clockOf(timestamp) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Substitutes {placeholders} in a notice template. Unknown placeholders are
 * left untouched so a typo in the admin panel is visible rather than silently
 * deleting text.
 */
function renderNotice(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] === undefined || vars[key] === null ? match : String(vars[key])
  );
}

/** The placeholder values that are always available, whatever the context. */
function baseVars(cfg) {
  return {
    reservedDiscount: cfg.reservedDiscountPercent,
    walkInDiscount: cfg.walkInDiscountPercent,
    extraDiscount: Math.max(0, cfg.reservedDiscountPercent - cfg.walkInDiscountPercent),
    unlockMinutes: cfg.unlockMinutes,
    restaurantName: cfg.restaurantName,
    phone: cfg.phone,
  };
}

/**
 * Lock state of a reservation, computed live from when it was booked against
 * the *current* unlock window - so an admin shortening the window immediately
 * releases reservations that have already waited long enough.
 */
function lockStateOf(reservation, cfg, now = Date.now()) {
  const bookedAt = new Date(reservation.bookedAt || reservation.createdAt).getTime();
  const unlocksAt = (Number.isFinite(bookedAt) ? bookedAt : now) + cfg.unlockMinutes * MINUTE_MS;
  const msLeft = unlocksAt - now;

  return {
    bookedAt: new Date(Number.isFinite(bookedAt) ? bookedAt : now).toISOString(),
    unlocksAt: new Date(unlocksAt).toISOString(),
    unlockTime: clockOf(unlocksAt),
    locked: msLeft > 0,
    minutesLeft: Math.max(0, Math.ceil(msLeft / MINUTE_MS)),
    secondsLeft: Math.max(0, Math.ceil(msLeft / 1000)),
  };
}

/** A reservation is billable while it is still open. */
function isOpen(reservation) {
  return reservation.status === 'booked';
}

/** The reservation a guest's next bill should attach to (most recent open one). */
function openReservationFor(userId) {
  return db
    .find('dineReservations', (r) => r.userId === userId && isOpen(r))
    .sort((a, b) => String(b.bookedAt || b.createdAt).localeCompare(String(a.bookedAt || a.createdAt)))[0] || null;
}

/** Adds lock state + a rendered notice to a reservation for the client. */
function expandReservation(reservation, cfg = settings(), now = Date.now()) {
  const lock = lockStateOf(reservation, cfg, now);
  const vars = Object.assign(baseVars(cfg), {
    minutesLeft: lock.minutesLeft,
    unlockTime: lock.unlockTime,
    reference: reservation.reference,
    tableLabel: reservation.tableLabel,
    partySize: reservation.partySize,
    discount: cfg.reservedDiscountPercent,
  });

  const billable = isOpen(reservation) && !lock.locked;

  return Object.assign({}, reservation, lock, {
    billable,
    canCancel: isOpen(reservation),
    discountPercent: cfg.reservedDiscountPercent,
    notice: renderNotice(lock.locked ? cfg.lockedNotice : cfg.reservedNotice, vars),
    noticeKind: lock.locked ? 'locked' : 'reserved',
  });
}

/**
 * Resolves what a bill would cost, which notice to show and whether payment is
 * allowed. Used by both the quote endpoint and the pay endpoint, so a preview
 * can never disagree with what actually gets charged.
 *
 * @param {object} input
 * @param {'reserved'|'walkin'} input.mode
 * @param {number} input.billAmount     bill total from the restaurant
 * @param {object|null} input.reservation
 * @param {object} [input.cfg]
 * @param {boolean} [input.validate]    throw instead of returning blocked:true
 */
function resolveBill({ mode, billAmount, reservation = null, cfg = settings(), now = Date.now(), validate = false }) {
  const { computeDineInTotals } = require('./pricing');

  if (mode !== 'reserved' && mode !== 'walkin') {
    throw new HttpError(400, 'mode must be "reserved" or "walkin"');
  }
  if (!cfg.active) throw new HttpError(400, 'Dine-In billing is currently unavailable');

  const bill = Number(billAmount);
  if (!Number.isFinite(bill) || bill <= 0) throw new HttpError(400, 'Enter the bill amount printed on your restaurant bill');
  if (bill < cfg.minBillAmount) {
    throw new HttpError(400, `Dine-In billing starts at \u20B9${cfg.minBillAmount}`);
  }
  if (bill > cfg.maxBillAmount) {
    throw new HttpError(400, `Bills above \u20B9${cfg.maxBillAmount} have to be settled at the counter`);
  }

  let lock = null;
  if (mode === 'reserved') {
    if (!reservation) {
      throw new HttpError(400, 'We could not find an open reservation for you. Pay as a walk-in, or reserve a table first.');
    }
    if (!isOpen(reservation)) {
      throw new HttpError(400, reservation.status === 'billed' ? 'That reservation has already been billed' : 'That reservation is no longer active');
    }
    lock = lockStateOf(reservation, cfg, now);
  }

  const locked = Boolean(lock && lock.locked);
  const discountPercent = mode === 'reserved' ? cfg.reservedDiscountPercent : cfg.walkInDiscountPercent;

  // While locked we still price the bill so the guest can see what they are
  // waiting for, but paying is refused.
  if (locked && validate) {
    throw new HttpError(
      423,
      `Billing unlocks ${cfg.unlockMinutes} minutes after you reserve. Please try again in ${lock.minutesLeft} minute(s).`,
      { minutesLeft: lock.minutesLeft, unlocksAt: lock.unlocksAt }
    );
  }

  const amounts = computeDineInTotals({
    billAmount: bill,
    discountPercent,
    maxDiscountAmount: cfg.maxDiscountAmount,
  });

  const vars = Object.assign(baseVars(cfg), {
    discount: discountPercent,
    minutesLeft: lock ? lock.minutesLeft : 0,
    unlockTime: lock ? lock.unlockTime : clockOf(now),
    reference: reservation ? reservation.reference : '',
    tableLabel: reservation ? reservation.tableLabel : '',
    partySize: reservation ? reservation.partySize : '',
    bill: amounts.billAmount,
    saved: amounts.discount,
    payable: amounts.total,
  });

  const noticeKind = locked ? 'locked' : mode === 'reserved' ? 'reserved' : 'walkin';
  const template = locked ? cfg.lockedNotice : mode === 'reserved' ? cfg.reservedNotice : cfg.walkInNotice;

  return {
    mode,
    amounts,
    discountPercent,
    locked,
    payable: !locked,
    lock,
    notice: renderNotice(template, vars),
    noticeKind,
    reservation: reservation ? expandReservation(reservation, cfg, now) : null,
  };
}

/** Public (non-secret) configuration the customer app needs to render the tab. */
function publicSettings(cfg = settings()) {
  const vars = baseVars(cfg);
  return {
    active: cfg.active,
    restaurantName: cfg.restaurantName,
    phone: cfg.phone,
    reservedDiscountPercent: cfg.reservedDiscountPercent,
    walkInDiscountPercent: cfg.walkInDiscountPercent,
    unlockMinutes: cfg.unlockMinutes,
    minBillAmount: cfg.minBillAmount,
    maxBillAmount: cfg.maxBillAmount,
    maxPartySize: cfg.maxPartySize,
    slots: cfg.slots,
    notices: {
      reserve: renderNotice(cfg.reserveNotice, vars),
      // Previews with no live reservation: {minutesLeft}/{unlockTime} are not
      // known yet, so they resolve to the full window.
      locked: renderNotice(cfg.lockedNotice, Object.assign({}, vars, { minutesLeft: cfg.unlockMinutes, unlockTime: '—', reference: '', discount: cfg.reservedDiscountPercent })),
      reserved: renderNotice(cfg.reservedNotice, Object.assign({}, vars, { reference: '', discount: cfg.reservedDiscountPercent })),
      walkin: renderNotice(cfg.walkInNotice, Object.assign({}, vars, { discount: cfg.walkInDiscountPercent })),
    },
  };
}

/** Next free table label, e.g. "Table 7". Purely cosmetic. */
function nextTableLabel() {
  const open = db.find('dineReservations', isOpen).length;
  return `Table ${1 + (open % 18)}`;
}

module.exports = {
  DEFAULTS,
  NOTICE_KEYS,
  SETTING_FIELDS,
  settings,
  saveSettings,
  publicSettings,
  normaliseSlots,
  renderNotice,
  baseVars,
  lockStateOf,
  isOpen,
  openReservationFor,
  expandReservation,
  resolveBill,
  nextTableLabel,
};
