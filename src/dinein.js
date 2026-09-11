'use strict';
/**
 * Dine-In domain logic.
 *
 * ── One venue, two restaurants ──────────────────────────────────────────────
 * Kingfisher Resort does not have "a restaurant". It has TWO, side by side,
 * under one roof:
 *
 *   rangoli  - Rangoli, PURE VEGETARIAN. No meat, no egg, separate kitchen.
 *   dolphin  - Dolphin, NON-VEGETARIAN.
 *
 * Guests routinely do not know that, which produces two very real failures: a
 * vegetarian family walking into the wrong dining room, and a guest settling
 * their bill against the outlet they did not eat at. Both are this module's
 * problem, not the UI's, so the outlet is part of the domain:
 *
 *   · every reservation and every bill carries an `outletId`;
 *   · each outlet keeps its own hours, seating areas and seat pool, so a full
 *     Saturday at Dolphin never blocks a table at Rangoli;
 *   · a reservation earns its discount AT ITS OWN OUTLET ONLY - holding a
 *     Rangoli table does not discount a Dolphin bill (see `resolveTier`).
 *
 * Commercial policy - the discount percentages, the billing lock, the bill
 * bounds - is deliberately VENUE-WIDE rather than per outlet. It is one brand
 * running one offer, and letting the two outlets drift to different discounts
 * would manufacture exactly the confusion this model exists to remove.
 *
 * ── The two discount tiers ──────────────────────────────────────────────────
 * Which one applies is decided here so the tab header, the quote endpoint and
 * the pay endpoint can never disagree:
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
 * The two restaurants, as shipped.
 *
 * `diet` is the load-bearing field. It drives the green-dot / brown-triangle
 * mark that Indian diners read before they read any name, and it is what makes
 * "which one am I booking?" answerable at a glance rather than from memory.
 * Only these two values are accepted, because a third would have no mark.
 */
const DIETS = {
  veg: { label: 'Pure Veg', long: 'Pure vegetarian' },
  nonveg: { label: 'Non-Veg', long: 'Serves non-vegetarian' },
};

const OUTLET_DEFAULTS = [
  {
    id: 'rangoli',
    name: 'Rangoli',
    diet: 'veg',
    active: true,
    cuisine: 'North Indian · South Indian · Chinese',
    tagline: 'Pure vegetarian, cooked in its own kitchen — Jain on request.',
    /** One line the guest reads before choosing. Kept blunt on purpose. */
    dietNote: 'No meat, no egg, no fish. Separate kitchen from Dolphin.',
    phone: '7648913272',
    openTime: '07:00',
    closeTime: '23:00',
    capacityPerSlot: 40,
    areas: ['Indoor AC', 'Garden', 'Poolside'],
    coverPhoto: '',
    photos: [],
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    diet: 'nonveg',
    active: true,
    cuisine: 'Mughlai · Tandoor · Coastal · Chinese',
    tagline: 'The non-veg grill house — kebabs, curries and catch of the day.',
    dietNote: 'Serves chicken, mutton, fish and egg. Veg dishes are limited.',
    phone: '7648913272',
    openTime: '11:00',
    closeTime: '23:00',
    capacityPerSlot: 40,
    areas: ['Indoor AC', 'Rooftop', 'Poolside'],
    coverPhoto: '',
    photos: [],
  },
];

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

  // ── Venue identity (the resort, NOT a restaurant) ──
  /**
   * The venue name. There is deliberately no single "restaurant name" any more:
   * inventing one ("Kingfisher Restaurant") was what hid the fact that there are
   * two outlets. The tab is titled with the venue; food is always attributed to
   * an outlet.
   */
  venueName: 'Kingfisher Resort',
  tagline: 'Two restaurants inside the resort — reserve a table, then pay your bill from your seat.',
  address: 'Kingfisher Resort, Mandla',
  phone: '7648913272',

  /** The outlets. Order is the order guests see them in. */
  outlets: OUTLET_DEFAULTS,

  // ── Property details (same shape as the hotel's, for the tab's own hero) ──
  rating: 0,
  reviewCount: 0,
  coverPhoto: '',
  photos: [],
  amenities: [],
  policies: [],

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
  /* Slot length, party ceiling and how far ahead tables open are venue-wide.
     Opening hours, seat capacity and seating areas are NOT: they belong to the
     outlet, and the values below are only the fallback an outlet inherits when
     the admin has not set its own. */
  openTime: '07:00',
  closeTime: '23:00',
  slotMinutes: 30,
  maxPartySize: 20,
  /** Fallback seats per slot for an outlet that has none of its own. */
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
  /**
   * The two-restaurant notice. Shown when a guest holds a table at one outlet
   * and is settling a bill at the other, which is the single most confusing
   * thing that can happen on this tab — so it is spelled out rather than
   * silently downgraded.
   */
  otherOutletNotice:
    'Your {reservedDiscount}% table is booked at {reservedOutlet}, but this bill is for {outlet}. ' +
    'The two restaurants are billed separately, so this one gets the {walkinDiscount}% walk-in rate. ' +
    'Your {reservedOutlet} table is untouched.',
  paidReservedNotice:
    'You saved {saving} with your {reservedDiscount}% reserved-table discount at {outlet}. See you again soon!',
  paidWalkinNotice:
    'You saved {saving} at the {walkinDiscount}% walk-in rate. Book a table at least {lockMinutes} minutes ' +
    'before you reach {outlet} next time and save {reservedDiscount}% instead.',
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

const TEXT_FIELDS = ['venueName', 'tagline', 'address', 'phone'];
const TIME_FIELDS = ['openTime', 'closeTime'];
const NOTICE_FIELDS = [
  'reservedNotice',
  'lockedNotice',
  'walkinNotice',
  'otherOutletNotice',
  'paidReservedNotice',
  'paidWalkinNotice',
];

// ── Outlets ─────────────────────────────────────────────────────────────────
/** Per-outlet numeric bounds. Everything else about an outlet is text. */
const OUTLET_NUMERIC_FIELDS = { capacityPerSlot: { min: 1, max: 5000 } };
const OUTLET_TEXT_FIELDS = ['name', 'cuisine', 'tagline', 'dietNote', 'phone'];

/** A diet descriptor, always resolvable so a label never renders as blank. */
function diet(key) {
  return DIETS[key] || DIETS.veg;
}

/**
 * Merges one saved outlet over its shipped default, inheriting venue-level
 * values for anything the admin has not set on the outlet itself.
 */
function mergeOutlet(base, saved = {}, venue = {}) {
  const merged = Object.assign({}, base, saved);
  merged.id = base.id;
  merged.diet = DIETS[merged.diet] ? merged.diet : base.diet;
  merged.active = merged.active !== false;
  merged.openTime = TIME_RE.test(String(merged.openTime || '')) ? merged.openTime : venue.openTime || base.openTime;
  merged.closeTime = TIME_RE.test(String(merged.closeTime || '')) ? merged.closeTime : venue.closeTime || base.closeTime;
  merged.capacityPerSlot = Number(merged.capacityPerSlot) > 0
    ? Math.round(Number(merged.capacityPerSlot))
    : Number(venue.capacityPerSlot) || base.capacityPerSlot;
  const areas = (Array.isArray(merged.areas) ? merged.areas : []).map((a) => String(a).trim()).filter(Boolean);
  merged.areas = areas.length ? areas : (base.areas || []).slice();
  merged.photos = (Array.isArray(merged.photos) ? merged.photos : []).filter(Boolean);
  merged.coverPhoto = String(merged.coverPhoto || '');
  return merged;
}

/**
 * Every outlet, in display order, with defaults merged in.
 *
 * The shipped outlets are always present: an admin can rename Rangoli or hide
 * it for the evening, but cannot delete one and leave bills pointing at an
 * outlet the app can no longer name.
 */
function outlets(s = settings()) {
  const saved = Array.isArray(s.outlets) ? s.outlets : [];
  return OUTLET_DEFAULTS.map((base) =>
    mergeOutlet(base, saved.find((o) => o && o.id === base.id) || {}, s)
  );
}

/** Outlets a guest may currently book or bill against. */
function bookableOutlets(s = settings()) {
  return outlets(s).filter((o) => o.active !== false);
}

/** One outlet by id, or null. Never throws — callers decide the error wording. */
function outletById(id, s = settings()) {
  const wanted = String(id || '').trim().toLowerCase();
  return outlets(s).find((o) => o.id === wanted) || null;
}

/** Is this outlet serving right now? Drives the "Closed now" tag on its card. */
function outletOpenNow(outlet, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= minutesOfDay(outlet.openTime) && minutes < minutesOfDay(outlet.closeTime);
}

/** The slice of an outlet the customer app needs. */
function publicOutlet(outlet, s = settings()) {
  const d = diet(outlet.diet);
  return {
    id: outlet.id,
    name: outlet.name,
    diet: outlet.diet,
    dietLabel: d.label,
    dietLong: d.long,
    dietNote: outlet.dietNote || '',
    cuisine: outlet.cuisine || '',
    tagline: outlet.tagline || '',
    phone: outlet.phone || s.phone,
    openTime: outlet.openTime,
    closeTime: outlet.closeTime,
    openNow: outletOpenNow(outlet),
    active: outlet.active !== false,
    areas: (outlet.areas || []).slice(),
    coverPhoto: outlet.coverPhoto || '',
    photos: (outlet.photos || []).slice(),
  };
}

/**
 * The outlet stamp written onto a reservation or a bill, and read back for
 * display. Rows created before the split have no outletId; rather than guessing
 * an outlet for them (which would put words in a guest's mouth about whether
 * they ate veg or non-veg), they resolve to null and the UI says so.
 */
function outletStamp(outlet) {
  if (!outlet) return null;
  const d = diet(outlet.diet);
  return { id: outlet.id, name: outlet.name, diet: outlet.diet, dietLabel: d.label };
}

/** Reads the outlet off a stored row, tolerating pre-split rows. */
function outletOf(row, s = settings()) {
  if (!row || !row.outletId) return null;
  const found = outletById(row.outletId, s);
  return found ? outletStamp(found) : (row.outlet || null);
}

// ── Settings ────────────────────────────────────────────────────────────────
/** Current settings: shipped defaults with the admin's saved values merged over. */
function settings() {
  const saved = db.get('meta').dineIn || {};
  const merged = Object.assign({}, DEFAULTS, saved);
  merged.areas = (saved.areas || DEFAULTS.areas).slice();
  merged.photos = (saved.photos || DEFAULTS.photos).slice();
  merged.amenities = (saved.amenities || DEFAULTS.amenities).slice();
  merged.policies = (saved.policies || DEFAULTS.policies).slice();
  /* A venue saved before the split stored its name under `restaurantName`. Carry
     it over rather than silently reverting the admin's own wording. */
  if (!saved.venueName && saved.restaurantName) merged.venueName = saved.restaurantName;
  merged.outlets = OUTLET_DEFAULTS.map((base) =>
    mergeOutlet(base, (Array.isArray(saved.outlets) ? saved.outlets : []).find((o) => o && o.id === base.id) || {}, merged)
  );
  return merged;
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
/**
 * Validates one outlet patch against the outlet as it stands. Returns the whole
 * outlet, so a patch touching only the name cannot blank its hours.
 */
function validateOutletPatch(currentOutlet, patch = {}, venue = {}) {
  const next = Object.assign({}, currentOutlet);

  for (const key of OUTLET_TEXT_FIELDS) {
    if (patch[key] === undefined) continue;
    next[key] = String(patch[key]).trim().slice(0, 200);
  }
  if (patch.name !== undefined && !next.name) {
    throw new HttpError(400, 'Every restaurant needs a name — guests choose between them by name');
  }

  if (patch.diet !== undefined) {
    const key = String(patch.diet);
    if (!DIETS[key]) {
      throw new HttpError(400, "A restaurant must be marked either 'veg' or 'nonveg' — that mark is how guests tell them apart");
    }
    next.diet = key;
  }

  if (patch.active !== undefined) next.active = patch.active === true || patch.active === 'true';

  for (const key of TIME_FIELDS) {
    if (patch[key] === undefined || patch[key] === '') continue;
    if (!TIME_RE.test(String(patch[key]))) {
      throw new HttpError(400, `${next.name}: ${key} must be a 24-hour time like 11:00`);
    }
    next[key] = String(patch[key]);
  }
  if (minutesOfDay(next.closeTime) <= minutesOfDay(next.openTime)) {
    throw new HttpError(400, `${next.name} closes before it opens — check its timings`);
  }

  for (const [key, bounds] of Object.entries(OUTLET_NUMERIC_FIELDS)) {
    if (patch[key] === undefined || patch[key] === '') continue;
    if (!Number.isFinite(Number(patch[key]))) throw new HttpError(400, `${next.name}: ${key} must be a number`);
    next[key] = clampNumber(patch[key], bounds, currentOutlet[key]);
  }

  if (patch.areas !== undefined) {
    const list = Array.isArray(patch.areas) ? patch.areas : String(patch.areas || '').split(',');
    const areas = list.map((a) => String(a).trim()).filter(Boolean).slice(0, 12);
    if (!areas.length) throw new HttpError(400, `${next.name} needs at least one seating area`);
    next.areas = areas;
  }

  if (patch.coverPhoto !== undefined) next.coverPhoto = String(patch.coverPhoto || '').trim();
  if (patch.photos !== undefined) {
    const list = Array.isArray(patch.photos) ? patch.photos : String(patch.photos || '').split('\n');
    next.photos = list.map((p) => String(p).trim()).filter(Boolean);
  }

  return mergeOutlet(OUTLET_DEFAULTS.find((o) => o.id === currentOutlet.id) || currentOutlet, next, venue);
}

/**
 * Saves one outlet. Separate from `saveSettings` because an outlet is edited on
 * its own screen and its own photos are uploaded with it.
 */
function saveOutlet(id, patch = {}) {
  const current = settings();
  const existing = outletById(id, current);
  if (!existing) throw new HttpError(404, 'No such restaurant');

  const updated = validateOutletPatch(existing, patch, current);
  const nextOutlets = outlets(current).map((o) => (o.id === updated.id ? updated : o));

  if (!nextOutlets.some((o) => o.active !== false)) {
    throw new HttpError(
      400,
      'At least one restaurant has to stay open — switch the whole Dine-In tab off instead if the kitchens are closed'
    );
  }

  const meta = db.get('meta');
  meta.dineIn = Object.assign({}, current, { outlets: nextOutlets });
  db.markDirty('meta');
  return updated;
}

function saveSettings(patch = {}) {
  const current = settings();
  const next = Object.assign({}, current);

  /* Pre-split admin payloads (and the old form) send `restaurantName`. Treat it
     as the venue name so an old client cannot wipe it. */
  if (patch.venueName === undefined && patch.restaurantName !== undefined) {
    patch = Object.assign({}, patch, { venueName: patch.restaurantName });
  }

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

  /* Outlets may also arrive as a batch, each entry keyed by id. Unknown ids are
     ignored rather than appended: the two restaurants are fixed. */
  if (Array.isArray(patch.outlets)) {
    next.outlets = outlets(current).map((outlet) => {
      const incoming = patch.outlets.find((o) => o && o.id === outlet.id);
      return incoming ? validateOutletPatch(outlet, incoming, next) : outlet;
    });
    if (!next.outlets.some((o) => o.active !== false)) {
      throw new HttpError(400, 'At least one restaurant has to stay open');
    }
  }

  // ── Property details ──
  if (patch.rating !== undefined && patch.rating !== '') {
    const r = Number(patch.rating);
    if (!Number.isFinite(r) || r < 0 || r > 5) throw new HttpError(400, 'Rating must be between 0 and 5');
    next.rating = r;
  }
  if (patch.reviewCount !== undefined && patch.reviewCount !== '') {
    next.reviewCount = Math.max(0, Math.round(Number(patch.reviewCount)) || 0);
  }
  if (patch.coverPhoto !== undefined) {
    next.coverPhoto = String(patch.coverPhoto || '').trim();
  }
  if (patch.photos !== undefined) {
    const list = Array.isArray(patch.photos) ? patch.photos : String(patch.photos || '').split('\n');
    next.photos = list.map((s) => String(s).trim()).filter(Boolean);
  }
  if (patch.amenities !== undefined) {
    const list = Array.isArray(patch.amenities) ? patch.amenities : String(patch.amenities || '').split(',');
    next.amenities = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 24);
  }
  if (patch.policies !== undefined) {
    const list = Array.isArray(patch.policies) ? patch.policies : String(patch.policies || '').split('\n');
    next.policies = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 24);
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
    venueName: s.venueName,
    /**
     * Legacy alias. Old clients read `restaurantName` for the tab heading, and
     * the venue name is the honest answer for a heading — but nothing that
     * attributes food to a kitchen may use it. Bills carry an outlet instead.
     */
    restaurantName: s.venueName,
    /** The two restaurants. This is what the tab is actually built around. */
    outlets: outlets(s).map((o) => publicOutlet(o, s)),
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
    rating: s.rating || 0,
    reviewCount: s.reviewCount || 0,
    coverPhoto: s.coverPhoto || '',
    photos: s.photos || [],
    amenities: s.amenities || [],
    policies: s.policies || [],
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
function reservationsOn(key, outletId = null) {
  return db.find(
    'dineReservations',
    (r) =>
      r.date === key &&
      (r.status === 'confirmed' || r.status === 'completed') &&
      /* Seats are counted per restaurant: the two have separate dining rooms, so
         a packed Saturday at Dolphin must not hide a free table at Rangoli.
         Pre-split rows have no outletId and are counted against neither. */
      (outletId === null || r.outletId === outletId)
  );
}

/**
 * Bookable slots for a date at one outlet, with the seats left in each. Past
 * slots on today's date are dropped.
 *
 * The hours and the seat count come from the OUTLET, not the venue — Rangoli
 * opens for breakfast, Dolphin does not, and quoting one's hours for the other
 * is the sort of small lie that ends with a guest standing at a locked door.
 */
function slotsFor(key, outlet, s = settings()) {
  const date = parseKey(key);
  if (!date) throw new HttpError(400, 'Pick a valid date (YYYY-MM-DD)');
  if (!outlet) throw new HttpError(400, 'Pick which restaurant you want a table at');

  const step = Math.max(5, Number(s.slotMinutes) || 30);
  const open = minutesOfDay(outlet.openTime);
  const close = minutesOfDay(outlet.closeTime);
  const isToday = key === today();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const taken = reservationsOn(key, outlet.id).reduce((map, r) => {
    map[r.time] = (map[r.time] || 0) + (Number(r.partySize) || 0);
    return map;
  }, {});

  const out = [];
  for (let minutes = open; minutes <= close - step; minutes += step) {
    if (isToday && minutes < nowMinutes) continue;
    const time = timeLabel(minutes);
    const seated = taken[time] || 0;
    const capacity = Math.max(1, Number(outlet.capacityPerSlot) || Number(s.capacityPerSlot) || 40);
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

/**
 * Every token a notice may reference.
 *
 * `{outlet}` is the restaurant the notice is about and `{reservedOutlet}` the one
 * a guest's table is at — the same value most of the time, and different exactly
 * when the guest needs telling. Both fall back to a readable phrase rather than
 * an empty string, so a notice never reads "...before you reach  next time".
 */
function noticeTokens(s, extra = {}) {
  return Object.assign(
    {
      reservedDiscount: s.reservedDiscountPercent,
      walkinDiscount: s.walkinDiscountPercent,
      lockMinutes: s.lockMinutes,
      graceHours: s.graceHours,
      venue: s.venueName,
      /* Falls back to the venue, never to one of the two outlets: naming Rangoli
         on a bill we cannot attribute would be a guess about what someone ate. */
      outlet: s.venueName,
      reservedOutlet: s.venueName,
      diet: '',
      /** Legacy token, kept working: it now means the outlet. */
      restaurant: s.venueName,
      minutesLeft: '0 minutes',
      unlockTime: '',
      bill: money(0),
      saving: money(0),
      payable: money(0),
    },
    extra
  );
}

/**
 * Notice tokens naming a specific outlet (and, if different, the one the guest's
 * table is at). Only keys we can actually fill are returned, so an unknown
 * outlet falls through to the defaults in `noticeTokens` instead of blanking
 * them.
 */
function outletTokens(s, outlet, reservedOutlet = null) {
  const tokens = {};
  if (outlet) {
    tokens.outlet = outlet.name;
    tokens.restaurant = outlet.name;
    tokens.diet = diet(outlet.diet).label;
    tokens.reservedOutlet = outlet.name;
  }
  if (reservedOutlet) tokens.reservedOutlet = reservedOutlet.name;
  return tokens;
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
    /**
     * Which restaurant this table is at, resolved live so a renamed outlet shows
     * its new name. null for a pre-split reservation, which the UI labels
     * honestly rather than guessing.
     */
    outlet: outletOf(reservation, s),
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

/**
 * The reservation a guest should be billed against: soonest usable one.
 *
 * `outletId` narrows it to one restaurant, which is what the bill screen wants —
 * a guest can hold a table at both, and pulling the Rangoli booking into a
 * Dolphin bill is precisely the mix-up this parameter exists to prevent.
 */
function activeReservationFor(userId, s = settings(), now = Date.now(), outletId = null) {
  const mine = db
    .find(
      'dineReservations',
      (r) =>
        r.userId === userId &&
        r.status === 'confirmed' &&
        !r.billId &&
        (outletId === null || r.outletId === outletId)
    )
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
 * @param {object|null} input.outlet       the restaurant this bill is for
 * @returns tier descriptor including the rendered, admin-authored notice
 */
function resolveTier({
  reservation = null,
  walkinRequested = false,
  outlet = null,
  s = settings(),
  now = Date.now(),
} = {}) {
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
      outlet: outletStamp(outlet),
      noticeKey: 'walkinNotice',
      noticeKind: 'warn',
    };
  }

  /**
   * Wrong restaurant. The table is real and the guest keeps it, but it buys
   * nothing here: Rangoli and Dolphin ring up separately, so a Rangoli booking
   * cannot take 30% off a Dolphin bill. Downgraded to the walk-in rate with its
   * own notice, because a guest who silently got 10% where they expected 30%
   * would reasonably think the app had cheated them.
   */
  if (outlet && reservation.outletId && reservation.outletId !== outlet.id) {
    return {
      mode: 'walkin',
      discountPercent: walkin,
      locked: false,
      canPayNow: true,
      reservationId: null,
      lock: null,
      outlet: outletStamp(outlet),
      reservedOutlet: outletOf(reservation, s),
      downgradedFrom: 'other-outlet',
      noticeKey: 'otherOutletNotice',
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
      outlet: outletStamp(outlet) || outletOf(reservation, s),
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
      outlet: outletStamp(outlet),
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
    outlet: outletStamp(outlet) || outletOf(reservation, s),
    noticeKey: 'reservedNotice',
    noticeKind: 'info',
  };
}

/** Renders the notice for a tier, filling in live amounts and countdown. */
function tierNotice(tier, s = settings(), amounts = null) {
  const tokens = noticeTokens(
    s,
    Object.assign(
      {
        minutesLeft: tier.lock ? durationLabel(tier.lock.minutesLeft) : '0 minutes',
        unlockTime: tier.lock ? tier.lock.unlockLabel : '',
        bill: money(amounts ? amounts.billAmount : 0),
        saving: money(amounts ? amounts.discount : 0),
        payable: money(amounts ? amounts.total : 0),
      },
      // Names the restaurant the notice is about, and the one holding the table.
      outletTokens(s, tier.outlet, tier.reservedOutlet)
    )
  );
  return renderNotice(s[tier.noticeKey], tokens);
}

/** Notice shown on the receipt after a bill is paid. */
function paidNotice(bill, s = settings()) {
  const key = bill.mode === 'reserved' ? 'paidReservedNotice' : 'paidWalkinNotice';
  return renderNotice(
    s[key],
    noticeTokens(
      s,
      Object.assign(
        {
          bill: money(bill.amounts.billAmount),
          saving: money(bill.amounts.discount),
          payable: money(bill.amounts.total),
        },
        /* Read off the bill, not off live settings: the receipt must keep naming
           the restaurant the guest actually ate at. */
        outletTokens(s, outletOf(bill, s) || bill.outlet || null)
      )
    )
  );
}

module.exports = {
  DEFAULTS,
  DIETS,
  OUTLET_DEFAULTS,
  NOTICE_FIELDS,
  DATE_RE,
  TIME_RE,
  settings,
  saveSettings,
  saveOutlet,
  publicSettings,
  diet,
  outlets,
  bookableOutlets,
  outletById,
  outletOpenNow,
  publicOutlet,
  outletStamp,
  outletOf,
  outletTokens,
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
