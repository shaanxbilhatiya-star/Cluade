'use strict';
/**
 * Seat map generation, availability and temporary seat holds.
 *
 * A seat is unavailable when it is either
 *   (a) part of a confirmed/pending booking, or
 *   (b) inside an unexpired hold created by another checkout session.
 */
const db = require('./db');
const { HttpError } = require('./router');

const HOLD_MINUTES = 10;

const TIER_LABELS = {
  regular: 'Regular',
  premium: 'Premium',
  vip: 'VIP Recliner',
  sofa: 'Sofa',
  recliner: 'Recliner',
  platinum: 'Platinum',
  gold: 'Gold',
  silver: 'Silver',
};

function nowMs() {
  return Date.now();
}

/** Remove holds whose expiry has passed. Returns how many were dropped. */
function releaseExpiredHolds() {
  const holds = db.get('seatHolds');
  const before = holds.length;
  const alive = holds.filter((h) => new Date(h.expiresAt).getTime() > nowMs());
  if (alive.length !== before) db.replace('seatHolds', alive);
  return before - alive.length;
}

function activeHolds(showtimeId) {
  releaseExpiredHolds();
  return db.get('seatHolds').filter((h) => h.showtimeId === showtimeId);
}

/** Seat ids already committed to a booking for this showtime. */
function bookedSeatIds(showtimeId) {
  const taken = new Set();
  for (const b of db.get('bookings')) {
    if (b.showtimeId !== showtimeId) continue;
    if (b.status === 'cancelled') continue;
    for (const s of b.seats || []) taken.add(typeof s === 'string' ? s : s.id);
  }
  return taken;
}

/** Seat ids held by somebody else (excluding the caller's own hold). */
function heldSeatIds(showtimeId, exceptHoldId) {
  const held = new Set();
  for (const h of activeHolds(showtimeId)) {
    if (exceptHoldId && h.id === exceptHoldId) continue;
    for (const s of h.seats) held.add(s);
  }
  return held;
}

function priceFor(showtime, tier) {
  const prices = showtime.prices || {};
  if (typeof prices[tier] === 'number') return prices[tier];
  const base = typeof prices.regular === 'number' ? prices.regular : 200;
  if (tier === 'premium') return Math.round(base * 1.5);
  if (tier === 'vip') return Math.round(base * 2.2);
  return base;
}

/**
 * Build the full seat map for a showtime.
 * @returns {{ rows: Array, tiers: Array, stats: object }}
 */
function buildSeatMap(showtimeId, opts = {}) {
  const showtime = db.byId('showtimes', showtimeId);
  if (!showtime) throw new HttpError(404, 'Showtime not found');
  const screen = db.byId('screens', showtime.screenId);
  if (!screen) throw new HttpError(500, 'Screen configuration missing for this showtime');

  const booked = bookedSeatIds(showtimeId);
  const held = heldSeatIds(showtimeId, opts.holdId);
  const blocked = new Set(screen.blockedSeats || []);

  const tiersUsed = new Map();
  let available = 0;
  let total = 0;

  const rows = (screen.layout || []).map((rowDef) => {
    const seats = [];
    for (let n = 1; n <= rowDef.seats; n += 1) {
      const seatId = `${rowDef.row}${n}`;
      const tier = rowDef.tier || 'regular';
      let status = 'available';
      if (blocked.has(seatId)) status = 'blocked';
      else if (booked.has(seatId)) status = 'booked';
      else if (held.has(seatId)) status = 'held';

      if (status === 'available') available += 1;
      if (status !== 'blocked') total += 1;

      const price = priceFor(showtime, tier);
      if (!tiersUsed.has(tier)) tiersUsed.set(tier, price);

      seats.push({
        id: seatId,
        row: rowDef.row,
        number: n,
        tier,
        price,
        status,
        gapAfter: Array.isArray(rowDef.gapAfter) ? rowDef.gapAfter.includes(n) : false,
      });
    }
    return { row: rowDef.row, tier: rowDef.tier || 'regular', seats };
  });

  return {
    showtimeId,
    screen: { id: screen.id, name: screen.name, format: screen.format, soundSystem: screen.soundSystem },
    rows,
    tiers: [...tiersUsed.entries()].map(([tier, price]) => ({
      tier,
      label: TIER_LABELS[tier] || tier,
      price,
    })),
    stats: { total, available, booked: booked.size, held: held.size },
    holdMinutes: HOLD_MINUTES,
  };
}

/** Flat lookup of seat -> {tier, price} for a showtime. */
function seatIndex(showtimeId) {
  const map = buildSeatMap(showtimeId);
  const index = new Map();
  for (const row of map.rows) {
    for (const seat of row.seats) index.set(seat.id, seat);
  }
  return { index, map };
}

/**
 * Reserve seats for HOLD_MINUTES so a user can pay without losing them.
 * Throws 409 listing the conflicting seats if any are gone.
 */
function createHold(showtimeId, seatIds, userId) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    throw new HttpError(400, 'Select at least one seat');
  }
  if (seatIds.length > 10) {
    throw new HttpError(400, 'You can book a maximum of 10 seats at once');
  }
  const unique = [...new Set(seatIds.map(String))];
  const { index } = seatIndex(showtimeId);

  const unknown = unique.filter((s) => !index.has(s));
  if (unknown.length) throw new HttpError(400, `Unknown seat(s): ${unknown.join(', ')}`);

  const conflicts = unique.filter((s) => index.get(s).status !== 'available');
  if (conflicts.length) {
    throw new HttpError(409, `These seats were just taken: ${conflicts.join(', ')}`, { seats: conflicts });
  }

  // One active hold per user per showtime - replace any previous one.
  const holds = db.get('seatHolds').filter((h) => !(h.userId === userId && h.showtimeId === showtimeId));
  db.replace('seatHolds', holds);

  const seats = unique.map((s) => {
    const seat = index.get(s);
    return { id: seat.id, row: seat.row, number: seat.number, tier: seat.tier, price: seat.price };
  });

  const hold = db.insert('seatHolds', {
    id: db.id('hold'),
    showtimeId,
    userId,
    seats: unique,
    seatDetails: seats,
    expiresAt: new Date(nowMs() + HOLD_MINUTES * 60_000).toISOString(),
  });

  return hold;
}

function getHold(holdId) {
  releaseExpiredHolds();
  return db.byId('seatHolds', holdId);
}

function releaseHold(holdId) {
  return db.remove('seatHolds', holdId);
}

module.exports = {
  HOLD_MINUTES,
  TIER_LABELS,
  buildSeatMap,
  seatIndex,
  bookedSeatIds,
  heldSeatIds,
  createHold,
  getHold,
  releaseHold,
  releaseExpiredHolds,
  priceFor,
};
