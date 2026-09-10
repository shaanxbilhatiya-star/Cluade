'use strict';
/**
 * Water park domain logic — "Family Fun Day" at Kingfisher Mandla.
 *
 * The tab sells the same day out two ways, and both are priced from ONE rate
 * card so they can never contradict each other:
 *
 *   package     - a fixed bundle (Family of 3, Family of 4) sold at a flat
 *                 price that is lower than the sum of its parts. The
 *                 "actual value" and the "you save" figure are NEVER stored;
 *                 they are recomputed from qty x rate every time they are
 *                 read. That is deliberate: the printed poster had an adult
 *                 entry line of "2 x 350 = 1,100", and the only way a total
 *                 can disagree with its own line items is if someone stored
 *                 it. Here, editing the adult rate in the admin panel moves
 *                 the value breakup, the total and the savings together.
 *   individual  - the guest (or the counter clerk) builds the day out person
 *                 by person from that same rate card, with every quantity
 *                 editable. Nothing is bundled and nothing is discounted, so
 *                 the package always visibly beats it.
 *
 * Add-ons (fish spa, bull ride, massage chair, photography) sit on top of
 * either mode.
 *
 * Every rate, every package line, every add-on price and every line of
 * customer-facing copy is admin-editable and stored as a singleton on the
 * `meta` collection, so a price change is live for the next customer without a
 * deploy.
 */
const db = require('./db');
const { HttpError } = require('./router');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Who a rate-card line applies to. Drives the suggested quantity per guest. */
const UNITS = ['adult', 'child', 'guest', 'booking'];

/**
 * Shipped defaults. `settings()` merges the admin's saved values over these, so
 * a field the admin has never touched keeps working after an upgrade.
 *
 * Notice copy uses {tokens} substituted at read time, which is what lets the
 * wording keep telling the truth after the admin edits a price.
 */
const DEFAULTS = {
  active: true,

  // ── Park identity ──
  parkName: 'Kingfisher Mandla',
  headline: 'Family Fun Day',
  tagline: 'Water Park \u2022 Movie \u2022 Fun \u2022 Memories \u2014 all in one package!',
  subline: 'Make every moment a family memory',
  address: 'Near Bichhiya Road, Mandla, Madhya Pradesh',
  phone: '93030 17878 / 79',
  /** The one-line terms printed under the packages. */
  validityNote: 'Package valid for one day only.',

  // ── Operating window ──
  openTime: '10:00',
  closeTime: '18:00',
  /** Entry slots are generated every this-many minutes between open and close. */
  slotMinutes: 60,
  /** Guests admitted per entry slot. */
  capacityPerSlot: 120,
  /** How many days ahead a visit can be booked. 0 = same day only. */
  advanceDays: 30,
  /** Guard on a single booking, so one order cannot swallow a whole slot. */
  maxGuestsPerBooking: 30,
  /** How many copies of one package a single booking may contain. */
  maxPackagesPerBooking: 10,

  /** Let guests build a per-person booking instead of taking a package. */
  allowIndividual: true,

  // ── Charges on top ──
  /** Booking fee as a percent of the order. 0 = none. */
  convenienceFeePercent: 0,
  /** Tax percent applied after the fee. 0 = prices are tax inclusive. */
  gstPercent: 0,

  /**
   * ── The rate card ──
   * The single source of truth for both modes. `unit` is who the line applies
   * to, which is what lets the individual builder pre-fill a sensible quantity
   * from the guest count. `entry` marks the two park-entry tickets: those are
   * the lines that put a person through the gate, so they are what capacity and
   * the guest count are measured on. Everything else is an extra a guest may
   * or may not take.
   *
   * Adult entry is 550. The poster prints "2 x 350 = 1,100" on Package A,
   * which cannot both be true — 550 is the rate that reconciles Package A's
   * 2,450 total and matches Package B's own adult line.
   */
  items: [
    { id: 'entry-adult', label: 'Water Park Entry \u2013 Adult', rate: 550, unit: 'adult', entry: true, active: true },
    { id: 'entry-child', label: 'Water Park Entry \u2013 Child', rate: 350, unit: 'child', entry: true, active: true },
    { id: 'costume', label: 'Costume', rate: 100, unit: 'guest', entry: false, active: true },
    { id: 'movie-ticket', label: 'Movie Ticket', rate: 150, unit: 'guest', entry: false, active: true },
    { id: 'kids-jumping', label: 'Kids Jumping Section', rate: 100, unit: 'child', entry: false, active: true },
    { id: 'welcome-drink', label: 'Welcome Drink', rate: 50, unit: 'guest', entry: false, active: true },
  ],

  /**
   * ── Packages ──
   * `lines` reference the rate card by id and carry only a quantity. The value
   * of a line, the package's actual value and its savings are all computed.
   */
  packages: [
    {
      id: 'family-of-3',
      code: 'A',
      name: 'Family of 3',
      composition: '2 Adults + 1 Child',
      adults: 2,
      children: 1,
      lines: [
        { itemId: 'entry-adult', qty: 2 },
        { itemId: 'entry-child', qty: 1 },
        { itemId: 'costume', qty: 3 },
        { itemId: 'movie-ticket', qty: 3 },
        { itemId: 'kids-jumping', qty: 1 },
        { itemId: 'welcome-drink', qty: 3 },
      ],
      price: 1499,
      badge: 'Save big',
      active: true,
    },
    {
      id: 'family-of-4',
      code: 'B',
      name: 'Family of 4',
      composition: '2 Adults + 2 Children',
      adults: 2,
      children: 2,
      lines: [
        { itemId: 'entry-adult', qty: 2 },
        { itemId: 'entry-child', qty: 2 },
        { itemId: 'costume', qty: 4 },
        { itemId: 'movie-ticket', qty: 4 },
        { itemId: 'kids-jumping', qty: 2 },
        { itemId: 'welcome-drink', qty: 4 },
      ],
      price: 1799,
      badge: 'Most popular',
      active: true,
    },
  ],

  /** ── Add-ons ── Chargeable per unit, on top of a package or an individual day. */
  addOns: [
    { id: 'fish-spa', label: 'Fish Spa', price: 99, note: '', active: true },
    { id: 'bull-ride', label: 'Bull Ride', price: 99, note: '', active: true },
    { id: 'massage-chair-15', label: 'Massage Chair', price: 99, note: '15 min', active: true },
    { id: 'massage-chair-30', label: 'Massage Chair', price: 129, note: '30 min', active: true },
    { id: 'photography', label: 'Photography', price: 199, note: '', active: true },
  ],

  /** The "what's included" strip. Presentation only — pricing comes from `lines`. */
  inclusions: [
    'Water Park Entry',
    'Movie Tickets',
    'Costume',
    'Kids Jumping Section',
    'Welcome Drink',
  ],

  // ── Notices (customer-facing, admin-editable, {token} aware) ──
  packageNotice:
    '{package} covers {guests} guests \u2014 worth {actualValue}, yours for {price}. You save {saving}. {validity}',
  individualNotice:
    'Building your own day out, charged per person at counter rates. A family package works out {bestSaving} cheaper ' +
    'for the same inclusions \u2014 worth comparing before you pay.',
  paidNotice:
    'All set! Show this pass at the {park} gate on {date}. You saved {saving} against the counter price. {validity}',
  soldOutNotice:
    'That entry slot is full. Pick another time on {date} \u2014 every slot holds {capacity} guests.',
};

/** Numeric settings, with the bounds the admin form is validated against. */
const NUMERIC_FIELDS = {
  slotMinutes: { min: 15, max: 480 },
  capacityPerSlot: { min: 1, max: 100000 },
  advanceDays: { min: 0, max: 365 },
  maxGuestsPerBooking: { min: 1, max: 500 },
  maxPackagesPerBooking: { min: 1, max: 100 },
  convenienceFeePercent: { min: 0, max: 30 },
  gstPercent: { min: 0, max: 40 },
};

const TEXT_FIELDS = ['parkName', 'headline', 'tagline', 'subline', 'address', 'phone', 'validityNote'];
const TIME_FIELDS = ['openTime', 'closeTime'];
const BOOLEAN_FIELDS = ['active', 'allowIndividual'];
const NOTICE_FIELDS = ['packageNotice', 'individualNotice', 'paidNotice', 'soldOutNotice'];

// ── Settings ────────────────────────────────────────────────────────────────
/** Current settings: shipped defaults with the admin's saved values merged over. */
function settings() {
  const saved = db.get('meta').waterPark || {};
  const merged = Object.assign({}, DEFAULTS, saved);
  // Arrays must be cloned, or a caller mutating a package line would silently
  // rewrite the stored record without ever going through saveSettings().
  merged.items = (saved.items || DEFAULTS.items).map((i) => Object.assign({}, i));
  merged.packages = (saved.packages || DEFAULTS.packages).map((p) =>
    Object.assign({}, p, { lines: (p.lines || []).map((l) => Object.assign({}, l)) })
  );
  merged.addOns = (saved.addOns || DEFAULTS.addOns).map((a) => Object.assign({}, a));
  merged.inclusions = (saved.inclusions || DEFAULTS.inclusions).slice();
  return merged;
}

/** Writes the whole settings object back. The only place that touches storage. */
function persist(next) {
  const meta = db.get('meta');
  meta.waterPark = next;
  // Debounced write, like every other request-path mutation in the app.
  db.markDirty('meta');
  return next;
}

function clampNumber(value, bounds, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function money(amount) {
  return `\u20B9${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`;
}

function minutesOfDay(time) {
  const m = TIME_RE.exec(String(time || ''));
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Turns a label into a stable id, e.g. "Fish Spa" -> "fish-spa". */
function slug(value, fallback = 'item') {
  const out = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return ID_RE.test(out) ? out : `${fallback}-${db.id('x').slice(-6)}`;
}

/**
 * Validates and persists a settings patch. Only known keys are written, so a
 * stray field in the request body can never end up in the stored record — and
 * because the rate card, packages and add-ons have their own CRUD below, a
 * settings save can never accidentally wipe them.
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
    next[key] = String(patch[key]).trim().slice(0, 200);
  }

  for (const key of TIME_FIELDS) {
    if (patch[key] === undefined || patch[key] === '') continue;
    if (!TIME_RE.test(String(patch[key]))) {
      throw new HttpError(400, `${key} must be a 24-hour time like 10:00`);
    }
    next[key] = String(patch[key]);
  }

  for (const key of NOTICE_FIELDS) {
    if (patch[key] === undefined) continue;
    // An empty notice is allowed - it simply hides that banner.
    next[key] = String(patch[key]).trim().slice(0, 600);
  }

  for (const key of BOOLEAN_FIELDS) {
    if (patch[key] === undefined) continue;
    next[key] = patch[key] === true || patch[key] === 'true';
  }

  if (patch.inclusions !== undefined) {
    const list = Array.isArray(patch.inclusions) ? patch.inclusions : String(patch.inclusions || '').split(',');
    next.inclusions = list.map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  }

  if (!TIME_RE.test(next.openTime) || !TIME_RE.test(next.closeTime)) {
    throw new HttpError(400, 'Opening and closing times must be 24-hour times like 10:00');
  }
  if (minutesOfDay(next.closeTime) <= minutesOfDay(next.openTime)) {
    throw new HttpError(400, 'Closing time must be later than opening time');
  }
  // A slot longer than the whole day would generate no slots at all, leaving a
  // live tab that cannot be booked.
  if (next.slotMinutes > minutesOfDay(next.closeTime) - minutesOfDay(next.openTime)) {
    throw new HttpError(
      400,
      `A ${next.slotMinutes}-minute slot does not fit between ${next.openTime} and ${next.closeTime} — ` +
        'shorten the slot or widen the opening hours'
    );
  }

  return persist(next);
}

/** The slice of settings the customer app is allowed to see. */
function publicSettings(s = settings()) {
  return {
    active: s.active !== false,
    parkName: s.parkName,
    headline: s.headline,
    tagline: s.tagline,
    subline: s.subline,
    address: s.address,
    phone: s.phone,
    validityNote: s.validityNote,
    openTime: s.openTime,
    closeTime: s.closeTime,
    slotMinutes: s.slotMinutes,
    capacityPerSlot: s.capacityPerSlot,
    advanceDays: s.advanceDays,
    maxGuestsPerBooking: s.maxGuestsPerBooking,
    maxPackagesPerBooking: s.maxPackagesPerBooking,
    allowIndividual: s.allowIndividual !== false,
    convenienceFeePercent: s.convenienceFeePercent,
    gstPercent: s.gstPercent,
    inclusions: s.inclusions,
  };
}

// ── Rate card ───────────────────────────────────────────────────────────────
function itemById(id, s = settings()) {
  return s.items.find((i) => i.id === id) || null;
}

/** Rate card as the customer sees it: active lines only. */
function activeItems(s = settings()) {
  return s.items.filter((i) => i.active !== false);
}

/** Default quantity for one rate-card line given a guest mix. */
function suggestedQty(item, adults, children) {
  if (item.unit === 'adult') return adults;
  if (item.unit === 'child') return children;
  if (item.unit === 'booking') return adults + children > 0 ? 1 : 0;
  return adults + children;
}

/**
 * Creates or updates one rate-card line. Called by the admin panel; this is
 * how "everything editable" is actually delivered — the rates behind both the
 * packages and the per-person builder are these records.
 */
function saveItem(patch = {}, s = settings()) {
  const label = String(patch.label || '').trim();
  if (!label) throw new HttpError(400, 'The rate-card line needs a name');

  const id = patch.id ? String(patch.id) : slug(label, 'item');
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid rate-card line id');

  const rate = Number(patch.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000000) {
    throw new HttpError(400, 'Rate must be between 0 and 10,00,000');
  }

  const unit = UNITS.includes(patch.unit) ? patch.unit : 'guest';
  const record = {
    id,
    label: label.slice(0, 80),
    rate: Math.round(rate),
    unit,
    // Only per-person lines can be gate entries; a per-booking line admitting a
    // guest would make the head count meaningless.
    entry: (patch.entry === true || patch.entry === 'true') && (unit === 'adult' || unit === 'child'),
    active: patch.active === undefined ? true : patch.active === true || patch.active === 'true',
  };

  const idx = s.items.findIndex((i) => i.id === id);
  if (idx === -1) s.items.push(record);
  else s.items[idx] = Object.assign({}, s.items[idx], record);

  persist(s);
  return record;
}

/**
 * Deletes a rate-card line. Refused while a package still references it,
 * because a package line pointing at a missing rate would price as zero and
 * silently understate that package's value.
 */
function removeItem(id, s = settings()) {
  const item = itemById(id, s);
  if (!item) throw new HttpError(404, 'Rate-card line not found');

  const used = s.packages.filter((p) => (p.lines || []).some((l) => l.itemId === id));
  if (used.length) {
    throw new HttpError(
      400,
      `"${item.label}" is still part of ${used.map((p) => p.name).join(', ')}. ` +
        'Remove it from those packages first, or switch it off instead of deleting it.'
    );
  }
  if (s.items.length <= 1) throw new HttpError(400, 'The rate card cannot be left empty');

  s.items = s.items.filter((i) => i.id !== id);
  persist(s);
  return item;
}

// ── Packages ────────────────────────────────────────────────────────────────
function packageById(id, s = settings()) {
  return s.packages.find((p) => p.id === id) || null;
}

/**
 * Expands a package into its value breakup. This is the function that makes
 * the poster's "TOTAL ACTUAL VALUE" and "YOU SAVE" impossible to get wrong:
 * both are returned from qty x rate, never read from storage.
 */
function decoratePackage(pkg, s = settings()) {
  const lines = [];
  let actualValue = 0;
  let missing = 0;

  for (const line of pkg.lines || []) {
    const item = itemById(line.itemId, s);
    const qty = Math.max(0, Math.round(Number(line.qty) || 0));
    if (!qty) continue;
    if (!item) {
      // Surfaced rather than swallowed, so the admin can see a broken line.
      missing += 1;
      lines.push({ itemId: line.itemId, label: 'Unknown item', rate: 0, qty, value: 0, missing: true });
      continue;
    }
    const value = item.rate * qty;
    actualValue += value;
    lines.push({
      itemId: item.id,
      label: item.label,
      rate: item.rate,
      qty,
      value,
      unit: item.unit,
      entry: item.entry === true,
    });
  }

  const price = Math.max(0, Math.round(Number(pkg.price) || 0));
  const adults = Math.max(0, Math.round(Number(pkg.adults) || 0));
  const children = Math.max(0, Math.round(Number(pkg.children) || 0));
  const saving = Math.max(0, actualValue - price);

  return Object.assign({}, pkg, {
    price,
    adults,
    children,
    guests: adults + children,
    lines,
    actualValue,
    saving,
    savingPercent: actualValue > 0 ? Math.round((saving / actualValue) * 100) : 0,
    /** True when the flat price is not actually a deal — the admin should know. */
    overpriced: price > actualValue,
    brokenLines: missing,
  });
}

function activePackages(s = settings()) {
  return s.packages.filter((p) => p.active !== false).map((p) => decoratePackage(p, s));
}

function allPackages(s = settings()) {
  return s.packages.map((p) => decoratePackage(p, s));
}

/** The best saving on offer, used by the "a package is cheaper" nudge. */
function bestSaving(s = settings()) {
  return activePackages(s).reduce((best, p) => Math.max(best, p.saving), 0);
}

/** Creates or updates a package, including its whole value breakup. */
function savePackage(patch = {}, s = settings()) {
  const name = String(patch.name || '').trim();
  if (!name) throw new HttpError(400, 'The package needs a name');

  const id = patch.id ? String(patch.id) : slug(name, 'package');
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid package id');

  const price = Number(patch.price);
  if (!Number.isFinite(price) || price < 0 || price > 1000000) {
    throw new HttpError(400, 'Package price must be between 0 and 10,00,000');
  }

  const rawLines = Array.isArray(patch.lines) ? patch.lines : [];
  const lines = [];
  for (const line of rawLines) {
    const qty = Math.round(Number(line.qty) || 0);
    if (qty <= 0) continue; // a zero quantity is how the admin removes a line
    if (qty > 999) throw new HttpError(400, 'A package line cannot exceed 999 units');
    if (!itemById(line.itemId, s)) {
      throw new HttpError(400, `Unknown rate-card line "${line.itemId}"`);
    }
    lines.push({ itemId: String(line.itemId), qty });
  }
  if (!lines.length) throw new HttpError(400, 'A package needs at least one line in its value breakup');

  const record = {
    id,
    code: String(patch.code || '').trim().slice(0, 4).toUpperCase(),
    name: name.slice(0, 80),
    composition: String(patch.composition || '').trim().slice(0, 80),
    adults: Math.max(0, Math.round(Number(patch.adults) || 0)),
    children: Math.max(0, Math.round(Number(patch.children) || 0)),
    lines,
    price: Math.round(price),
    badge: String(patch.badge || '').trim().slice(0, 30),
    active: patch.active === undefined ? true : patch.active === true || patch.active === 'true',
  };

  if (record.adults + record.children === 0) {
    throw new HttpError(400, 'A package must be for at least one guest');
  }

  /* The head count and the entry tickets have to agree. Without this a
     "Family of 4" could be sold with three entry tickets, and the gate would
     turn a guest away holding a valid pass. */
  const entryQty = lines.reduce((sum, l) => {
    const item = itemById(l.itemId, s);
    return item && item.entry ? sum + l.qty : sum;
  }, 0);
  if (entryQty && entryQty !== record.adults + record.children) {
    throw new HttpError(
      400,
      `This package admits ${record.adults + record.children} guest(s) but carries ${entryQty} entry ticket(s) — ` +
        'the two must match or the gate will turn someone away'
    );
  }

  const idx = s.packages.findIndex((p) => p.id === id);
  if (idx === -1) s.packages.push(record);
  else s.packages[idx] = Object.assign({}, s.packages[idx], record);

  persist(s);
  return decoratePackage(record, s);
}

function removePackage(id, s = settings()) {
  const pkg = packageById(id, s);
  if (!pkg) throw new HttpError(404, 'Package not found');
  s.packages = s.packages.filter((p) => p.id !== id);
  persist(s);
  return pkg;
}

// ── Add-ons ─────────────────────────────────────────────────────────────────
function addOnById(id, s = settings()) {
  return s.addOns.find((a) => a.id === id) || null;
}

function activeAddOns(s = settings()) {
  return s.addOns.filter((a) => a.active !== false);
}

function saveAddOn(patch = {}, s = settings()) {
  const label = String(patch.label || '').trim();
  if (!label) throw new HttpError(400, 'The add-on needs a name');

  const note = String(patch.note || '').trim().slice(0, 40);
  const id = patch.id ? String(patch.id) : slug(note ? `${label} ${note}` : label, 'addon');
  if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid add-on id');

  const price = Number(patch.price);
  if (!Number.isFinite(price) || price < 0 || price > 1000000) {
    throw new HttpError(400, 'Add-on price must be between 0 and 10,00,000');
  }

  const record = {
    id,
    label: label.slice(0, 60),
    price: Math.round(price),
    note,
    active: patch.active === undefined ? true : patch.active === true || patch.active === 'true',
  };

  const idx = s.addOns.findIndex((a) => a.id === id);
  if (idx === -1) s.addOns.push(record);
  else s.addOns[idx] = Object.assign({}, s.addOns[idx], record);

  persist(s);
  return record;
}

function removeAddOn(id, s = settings()) {
  const addOn = addOnById(id, s);
  if (!addOn) throw new HttpError(404, 'Add-on not found');
  s.addOns = s.addOns.filter((a) => a.id !== id);
  persist(s);
  return addOn;
}

/** Everything the customer app needs to render the tab. */
function catalogue(s = settings()) {
  return {
    packages: activePackages(s),
    items: activeItems(s).map((i) => Object.assign({}, i)),
    addOns: activeAddOns(s).map((a) => Object.assign({}, a)),
    inclusions: s.inclusions,
  };
}

// ── Dates & entry slots ─────────────────────────────────────────────────────
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
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A real Date for a date+time pair, in the server's timezone. */
function stampFor(key, time) {
  const date = parseKey(key);
  if (!date) return null;
  const m = TIME_RE.exec(String(time || ''));
  if (!m) return null;
  date.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return date;
}

function clockLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function timeLabel(time) {
  const m = TIME_RE.exec(String(time || ''));
  if (!m) return String(time || '');
  const h24 = Number(m[1]);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${period}`;
}

function dateLabel(key) {
  const date = parseKey(key);
  if (!date) return String(key || '');
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

/** Confirmed bookings on a date. */
function bookingsOn(key) {
  return db.find('waterparkBookings', (b) => b.date === key && b.status === 'confirmed');
}

/**
 * Entry slots for a date, with live capacity.
 * Past slots are dropped for today, so a guest is never offered a time that
 * has already gone.
 */
function slotsFor(key, s = settings()) {
  const date = parseKey(key);
  if (!date) return [];

  const open = minutesOfDay(s.openTime);
  const close = minutesOfDay(s.closeTime);
  const step = Math.max(15, Number(s.slotMinutes) || 60);
  const isToday = key === today();
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  const booked = new Map();
  for (const b of bookingsOn(key)) {
    booked.set(b.time, (booked.get(b.time) || 0) + (Number(b.guests && b.guests.total) || 0));
  }

  const out = [];
  for (let m = open; m + step <= close || m === open; m += step) {
    if (m >= close) break;
    if (isToday && m < nowMinutes) continue;
    const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const guests = booked.get(time) || 0;
    const seatsLeft = Math.max(0, s.capacityPerSlot - guests);
    out.push({ time, label: timeLabel(time), guests, seatsLeft, full: seatsLeft <= 0 });
  }
  return out;
}

/** Rejects a date outside the bookable window, with the reason the guest needs. */
function assertBookableDate(key, s = settings()) {
  const date = parseKey(key);
  if (!date) throw new HttpError(400, 'Pick a visit date in YYYY-MM-DD format');

  const todayDate = parseKey(today());
  const days = Math.round((date - todayDate) / (24 * 60 * 60 * 1000));
  if (days < 0) throw new HttpError(400, 'That date has already passed');
  if (days > s.advanceDays) {
    throw new HttpError(400, `Visits can be booked up to ${s.advanceDays} day(s) ahead`);
  }
  return key;
}

// ── Notices ─────────────────────────────────────────────────────────────────
/** Substitutes {tokens}. An unknown token is left intact rather than blanked. */
function renderNotice(template, tokens = {}) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    tokens[key] === undefined || tokens[key] === null ? whole : String(tokens[key])
  );
}

/** Every token a notice may use, with live values. */
function noticeTokens(s = settings(), extra = {}) {
  const adult = itemById('entry-adult', s);
  const child = itemById('entry-child', s);
  const packages = activePackages(s);
  return Object.assign(
    {
      park: s.parkName,
      headline: s.headline,
      phone: s.phone,
      address: s.address,
      validity: s.validityNote,
      capacity: s.capacityPerSlot,
      open: timeLabel(s.openTime),
      close: timeLabel(s.closeTime),
      adultRate: money(adult ? adult.rate : 0),
      childRate: money(child ? child.rate : 0),
      bestSaving: money(bestSaving(s)),
      packageCount: packages.length,
      // Order-specific tokens; a notice rendered without an order keeps the
      // placeholder visible so the admin can see it is contextual.
      package: extra.package !== undefined ? extra.package : packages[0] ? packages[0].name : 'the package',
      guests: extra.guests !== undefined ? extra.guests : (packages[0] ? packages[0].guests : 0),
      actualValue: extra.actualValue !== undefined ? extra.actualValue : money(packages[0] ? packages[0].actualValue : 0),
      price: extra.price !== undefined ? extra.price : money(packages[0] ? packages[0].price : 0),
      saving: extra.saving !== undefined ? extra.saving : money(packages[0] ? packages[0].saving : 0),
      date: extra.date !== undefined ? extra.date : dateLabel(today()),
      time: extra.time !== undefined ? extra.time : '',
      total: extra.total !== undefined ? extra.total : money(packages[0] ? packages[0].price : 0),
    },
    extra
  );
}

/** The notice for a resolved order, before it is paid. */
function orderNotice(order, s = settings()) {
  const key = order.mode === 'package' ? 'packageNotice' : 'individualNotice';
  return renderNotice(s[key], noticeTokens(s, orderTokens(order, s)));
}

/** The notice printed on a paid pass. */
function paidNotice(booking, s = settings()) {
  return renderNotice(
    s.paidNotice,
    noticeTokens(s, {
      package: booking.packageName || 'Your day out',
      guests: booking.guests ? booking.guests.total : 0,
      date: dateLabel(booking.date),
      time: timeLabel(booking.time),
      saving: money(booking.amounts ? booking.amounts.totalSaving : 0),
      total: money(booking.amounts ? booking.amounts.total : 0),
      actualValue: money(booking.amounts ? booking.amounts.actualValue : 0),
      price: money(booking.amounts ? booking.amounts.total : 0),
    })
  );
}

function orderTokens(order, s = settings()) {
  return {
    package: order.packageName || 'Individual booking',
    guests: order.guests.total,
    actualValue: money(order.actualValue),
    price: money(order.baseAmount),
    saving: money(order.packageSaving),
    date: order.date ? dateLabel(order.date) : dateLabel(today()),
    time: order.time ? timeLabel(order.time) : '',
    bestSaving: money(bestSaving(s)),
  };
}

// ── Order resolution ────────────────────────────────────────────────────────
/**
 * Normalises a requested add-on selection against the live price list.
 * Prices always come from settings, never from the request — otherwise a
 * crafted body could name its own price.
 */
function resolveAddOns(requested, s = settings()) {
  const out = [];
  let amount = 0;
  for (const raw of Array.isArray(requested) ? requested : []) {
    const id = String(raw.id || raw.addOnId || '');
    const qty = Math.round(Number(raw.qty) || 0);
    if (qty <= 0) continue;
    if (qty > 99) throw new HttpError(400, 'An add-on cannot exceed 99 units');
    const addOn = addOnById(id, s);
    if (!addOn) throw new HttpError(400, `Unknown add-on "${id}"`);
    if (addOn.active === false) throw new HttpError(400, `${addOn.label} is not available right now`);
    const value = addOn.price * qty;
    amount += value;
    out.push({ id: addOn.id, label: addOn.label, note: addOn.note, price: addOn.price, qty, value });
  }
  return { addOns: out, amount };
}

/** Normalises a list of rate-card selections (individual mode, or package extras). */
function resolveLines(requested, s = settings(), { source = 'individual' } = {}) {
  const out = [];
  let amount = 0;
  let adults = 0;
  let children = 0;

  for (const raw of Array.isArray(requested) ? requested : []) {
    const id = String(raw.itemId || raw.id || '');
    const qty = Math.round(Number(raw.qty) || 0);
    if (qty <= 0) continue;
    if (qty > 99) throw new HttpError(400, 'A single line cannot exceed 99 units');
    const item = itemById(id, s);
    if (!item) throw new HttpError(400, `Unknown rate-card line "${id}"`);
    if (item.active === false) throw new HttpError(400, `${item.label} is not available right now`);

    const value = item.rate * qty;
    amount += value;
    if (item.entry) {
      if (item.unit === 'adult') adults += qty;
      if (item.unit === 'child') children += qty;
    }
    out.push({
      itemId: item.id,
      label: item.label,
      rate: item.rate,
      qty,
      value,
      unit: item.unit,
      entry: item.entry === true,
      source,
    });
  }
  return { lines: out, amount, adults, children };
}

/**
 * THE single decision point for what an order contains and what it is worth.
 * The quote endpoint, the customer pay endpoint and the admin counter-booking
 * endpoint all go through here, so none of them can price a day out
 * differently from the others.
 *
 * @param {object} input
 * @param {'package'|'individual'} input.mode
 * @param {string}  [input.packageId]
 * @param {number}  [input.packageQty]  how many copies of the package
 * @param {Array}   [input.extras]      extra rate-card lines alongside a package
 * @param {Array}   [input.lines]       the whole order, in individual mode
 * @param {Array}   [input.addOns]
 * @param {string}  [input.date]
 * @param {string}  [input.time]
 */
function resolveOrder(input = {}, s = settings()) {
  const mode = input.mode === 'individual' ? 'individual' : 'package';
  if (mode === 'individual' && s.allowIndividual === false) {
    throw new HttpError(400, 'Per-person booking is switched off — please pick one of the packages');
  }

  const { addOns, amount: addOnAmount } = resolveAddOns(input.addOns, s);

  let lines = [];
  let baseAmount = 0;
  let actualValue = 0;
  let adults = 0;
  let children = 0;
  let pkg = null;
  let packageQty = 0;

  if (mode === 'package') {
    pkg = packageById(String(input.packageId || ''), s);
    if (!pkg) throw new HttpError(400, 'Pick one of the packages');
    if (pkg.active === false) throw new HttpError(400, 'That package is no longer on sale');

    const decorated = decoratePackage(pkg, s);
    if (decorated.brokenLines) {
      throw new HttpError(503, 'That package is being updated right now — please try again in a moment');
    }

    packageQty = Math.round(Number(input.packageQty) || 1);
    if (packageQty < 1) packageQty = 1;
    if (packageQty > s.maxPackagesPerBooking) {
      throw new HttpError(400, `Up to ${s.maxPackagesPerBooking} package(s) per booking`);
    }

    lines = decorated.lines.map((l) =>
      Object.assign({}, l, { qty: l.qty * packageQty, value: l.value * packageQty, source: 'package' })
    );
    baseAmount = decorated.price * packageQty;
    actualValue = decorated.actualValue * packageQty;
    adults = decorated.adults * packageQty;
    children = decorated.children * packageQty;

    // Extras let a family of five take the family-of-four package and add one
    // more person at counter rates, rather than being pushed to price the
    // whole group individually.
    const extras = resolveLines(input.extras, s, { source: 'extra' });
    lines = lines.concat(extras.lines);
    baseAmount += extras.amount;
    // An extra is bought at the counter rate, so its value IS its price — it
    // adds nothing to the saving.
    actualValue += extras.amount;
    adults += extras.adults;
    children += extras.children;
  } else {
    const built = resolveLines(input.lines, s, { source: 'individual' });
    if (!built.lines.length) throw new HttpError(400, 'Add at least one item to your day out');
    if (built.adults + built.children === 0) {
      throw new HttpError(400, 'Add at least one water park entry ticket — that is what gets you through the gate');
    }
    lines = built.lines;
    baseAmount = built.amount;
    // Nothing is bundled, so the counter value and the price are the same and
    // the saving is zero. That is the honest comparison against a package.
    actualValue = built.amount;
    adults = built.adults;
    children = built.children;
  }

  const guests = { adults, children, total: adults + children };
  if (guests.total > s.maxGuestsPerBooking) {
    throw new HttpError(400, `Up to ${s.maxGuestsPerBooking} guests per booking — please split larger groups`);
  }

  return {
    mode,
    packageId: pkg ? pkg.id : null,
    packageCode: pkg ? pkg.code : null,
    packageName: pkg ? pkg.name : null,
    packageQty,
    lines,
    addOns,
    guests,
    baseAmount,
    addOnAmount,
    actualValue,
    /** What the bundle saves against the same items bought individually. */
    packageSaving: Math.max(0, actualValue - baseAmount),
    date: input.date ? String(input.date) : null,
    time: input.time ? String(input.time) : null,
  };
}

/**
 * Checks a slot can still take the party. Called on quote (as a warning) and
 * again at payment (as a hard stop), because the slot can fill in between.
 */
function slotFor(key, time, s = settings()) {
  const slots = slotsFor(key, s);
  return slots.find((slot) => slot.time === time) || null;
}

function assertCapacity(key, time, partySize, s = settings()) {
  const slot = slotFor(key, time, s);
  if (!slot) {
    throw new HttpError(400, `${timeLabel(time)} is not an entry slot on ${dateLabel(key)}`);
  }
  if (slot.seatsLeft < partySize) {
    throw new HttpError(
      409,
      slot.seatsLeft === 0
        ? renderNotice(s.soldOutNotice, noticeTokens(s, { date: dateLabel(key), time: timeLabel(time) }))
        : `Only ${slot.seatsLeft} space(s) left in the ${timeLabel(time)} slot`
    );
  }
  return slot;
}

/** Adds everything a client needs to render a booking. */
function decorateBooking(booking, s = settings()) {
  const start = stampFor(booking.date, booking.time);
  return Object.assign({}, booking, {
    dateLabel: dateLabel(booking.date),
    timeLabel: timeLabel(booking.time),
    upcoming: booking.status === 'confirmed' && (!start || start.getTime() + 12 * 60 * 60 * 1000 > Date.now()),
    passUrl: `/api/waterpark/bookings/${booking.id}/barcode.svg`,
    notice: booking.status === 'confirmed' ? paidNotice(booking, s) : '',
  });
}

module.exports = {
  DEFAULTS,
  NOTICE_FIELDS,
  NUMERIC_FIELDS,
  UNITS,
  DATE_RE,
  TIME_RE,
  settings,
  saveSettings,
  publicSettings,
  itemById,
  activeItems,
  suggestedQty,
  saveItem,
  removeItem,
  packageById,
  decoratePackage,
  activePackages,
  allPackages,
  bestSaving,
  savePackage,
  removePackage,
  addOnById,
  activeAddOns,
  saveAddOn,
  removeAddOn,
  catalogue,
  dateKey,
  today,
  parseKey,
  stampFor,
  clockLabel,
  timeLabel,
  dateLabel,
  minutesOfDay,
  slotsFor,
  slotFor,
  assertCapacity,
  assertBookableDate,
  renderNotice,
  noticeTokens,
  orderNotice,
  paidNotice,
  money,
  resolveOrder,
  resolveAddOns,
  resolveLines,
  decorateBooking,
};
