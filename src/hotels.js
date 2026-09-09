'use strict';
/**
 * Hotel stay helpers: date-range validation and room availability.
 *
 * Availability is derived from the bookings collection rather than stored, the
 * same way seat availability is derived in src/seats.js. A room type has
 * `totalRooms` physical rooms; for a given stay we count how many are already
 * committed on the busiest night of the range and compare.
 *
 * Nights are half-open [checkIn, checkOut): a 12 Jan → 14 Jan stay occupies
 * the nights of the 12th and the 13th, so a guest checking in on the 14th
 * never collides with one checking out that morning.
 */
const db = require('./db');
const { HttpError } = require('./router');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_NIGHTS = 30;
const MAX_ROOMS_PER_BOOKING = 5;

/** 'YYYY-MM-DD' for a Date, in local time (matches the rest of the app). */
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's date key. */
function today() {
  return dateKey(new Date());
}

/** Parses 'YYYY-MM-DD' into a local midnight Date. Returns null when invalid. */
function parseKey(key) {
  if (!DATE_RE.test(String(key || ''))) return null;
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects impossible dates that Date would silently roll over (e.g. 02-31).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Whole nights between two date keys. */
function nightsBetween(checkIn, checkOut) {
  const a = parseKey(checkIn);
  const b = parseKey(checkOut);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Every night occupied by a stay, as date keys (check-out morning excluded). */
function nightKeys(checkIn, checkOut) {
  const keys = [];
  const start = parseKey(checkIn);
  const nights = nightsBetween(checkIn, checkOut);
  for (let i = 0; i < nights; i += 1) {
    keys.push(dateKey(new Date(start.getTime() + i * MS_PER_DAY)));
  }
  return keys;
}

/** Adds days to a date key. */
function addDays(key, days) {
  const date = parseKey(key);
  if (!date) return key;
  return dateKey(new Date(date.getTime() + days * MS_PER_DAY));
}

/**
 * Validates a requested stay and returns the normalised range.
 * @returns {{checkIn: string, checkOut: string, nights: number}}
 */
function parseStay({ checkIn, checkOut, nights } = {}) {
  const start = parseKey(checkIn);
  if (!start) throw new HttpError(400, 'Check-in date must be a valid date (YYYY-MM-DD)');

  // `nights` is accepted as a convenience so callers can skip the maths.
  let end = parseKey(checkOut);
  if (!end && nights !== undefined) end = parseKey(addDays(checkIn, Math.max(1, Number(nights) || 1)));
  if (!end) throw new HttpError(400, 'Check-out date must be a valid date (YYYY-MM-DD)');

  if (checkIn < today()) throw new HttpError(400, 'Check-in date cannot be in the past');

  const nightCount = nightsBetween(checkIn, dateKey(end));
  if (nightCount < 1) throw new HttpError(400, 'Check-out must be at least one night after check-in');
  if (nightCount > MAX_NIGHTS) {
    throw new HttpError(400, `Stays are limited to ${MAX_NIGHTS} nights — please call us for longer bookings`);
  }

  return { checkIn, checkOut: dateKey(end), nights: nightCount };
}

/** Confirmed (not cancelled) hotel bookings that hold inventory. */
function activeStays(excludeBookingId) {
  return db.find(
    'bookings',
    (b) => b.type === 'hotel' && b.status !== 'cancelled' && b.id !== excludeBookingId
  );
}

/**
 * How many rooms of a type are committed on the busiest night of a range.
 * @returns {{booked: number, perNight: Record<string, number>}}
 */
function bookedRooms(roomId, checkIn, checkOut, excludeBookingId) {
  const wanted = new Set(nightKeys(checkIn, checkOut));
  const perNight = {};
  for (const key of wanted) perNight[key] = 0;

  for (const stay of activeStays(excludeBookingId)) {
    if (stay.roomId !== roomId) continue;
    const count = Math.max(1, Number(stay.stay?.rooms) || 1);
    for (const key of nightKeys(stay.stay?.checkIn, stay.stay?.checkOut)) {
      if (wanted.has(key)) perNight[key] += count;
    }
  }

  const booked = Object.values(perNight).reduce((max, n) => Math.max(max, n), 0);
  return { booked, perNight };
}

/**
 * Availability for one room type over a range.
 * @returns {{totalRooms: number, booked: number, available: number, soldOut: boolean}}
 */
function availability(room, checkIn, checkOut, excludeBookingId) {
  const totalRooms = Math.max(0, Number(room.totalRooms) || 0);
  const { booked, perNight } = bookedRooms(room.id, checkIn, checkOut, excludeBookingId);
  const available = Math.max(0, totalRooms - booked);
  return { totalRooms, booked, available, soldOut: available === 0, perNight };
}

/** Throws when the requested number of rooms cannot be honoured. */
function assertAvailable(room, checkIn, checkOut, rooms) {
  const wanted = Math.max(1, Math.round(Number(rooms) || 1));
  if (wanted > MAX_ROOMS_PER_BOOKING) {
    throw new HttpError(
      400,
      `Up to ${MAX_ROOMS_PER_BOOKING} rooms can be booked online — please call us for group bookings`
    );
  }

  const state = availability(room, checkIn, checkOut);
  if (state.available < wanted) {
    throw new HttpError(
      409,
      state.available === 0
        ? `${room.name} is sold out for those dates`
        : `Only ${state.available} ${room.name}${state.available === 1 ? '' : 's'} left for those dates`,
      { available: state.available, requested: wanted }
    );
  }
  return state;
}

/** Combines a date key with the hotel's check-in/out clock into an ISO stamp. */
function stampFor(dateKeyValue, time, fallbackHour) {
  const date = parseKey(dateKeyValue);
  if (!date) return null;
  const [hh, mm] = String(time || '').split(':').map(Number);
  date.setHours(Number.isFinite(hh) ? hh : fallbackHour, Number.isFinite(mm) ? mm : 0, 0, 0);
  return date.toISOString();
}

module.exports = {
  DATE_RE,
  MAX_NIGHTS,
  MAX_ROOMS_PER_BOOKING,
  dateKey,
  today,
  parseKey,
  addDays,
  nightsBetween,
  nightKeys,
  parseStay,
  bookedRooms,
  availability,
  assertAvailable,
  stampFor,
};
