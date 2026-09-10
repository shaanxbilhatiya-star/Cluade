'use strict';
/**
 * Public hotel/stay API.
 *
 *   GET  /api/hotels                        property + room types (+ availability for a date range)
 *   GET  /api/hotels/rooms/:id              one room type in full
 *   POST /api/hotels/quote                  price a stay before paying
 *   POST /api/hotels/offers/validate        check a coupon against a stay
 *   POST /api/hotels/bookings               confirm a stay
 */
const db = require('../db');
const auth = require('../auth');
const hotels = require('../hotels');
const { computeHotelTotals, resolveHotelOffer } = require('../pricing');
const { expand, paymentRecord, notify } = require('../bookings');
const { Router, HttpError } = require('../router');

const router = new Router();

const FALLBACK_PHONE = '7648913272';

// ── helpers ──────────────────────────────────────────────────────────────────
/** The active property. Single-property deployment, so the first one wins. */
function currentHotel() {
  const hotel = db.findOne('hotels', (h) => h.active !== false) || db.get('hotels')[0];
  if (!hotel) throw new HttpError(503, 'Hotel details are not set up yet');
  return hotel;
}

function bookableRooms(hotelId) {
  return db
    .find('hotelRooms', (r) => r.active !== false && (!hotelId || r.hotelId === hotelId))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function findRoom(id) {
  const room = db.byId('hotelRooms', id) || db.findOne('hotelRooms', (r) => r.slug === id);
  if (!room) throw new HttpError(404, 'Room type not found');
  return room;
}

/** Percentage off the rack rate, for the "42% OFF" chip. */
function discountPercent(room) {
  const mrp = Number(room.mrpPerNight) || 0;
  const price = Number(room.pricePerNight) || 0;
  if (!mrp || mrp <= price) return 0;
  return Math.round((1 - price / mrp) * 100);
}

/**
 * Reads an optional stay range off the query string.
 * Returns null when no dates were supplied (so listings still render).
 */
function optionalStay(query) {
  if (!query.checkIn && !query.checkOut && !query.nights) return null;
  return hotels.parseStay({ checkIn: query.checkIn, checkOut: query.checkOut, nights: query.nights });
}

function priceOf(room) {
  return {
    mrpPerNight: Number(room.mrpPerNight) || 0,
    pricePerNight: Number(room.pricePerNight) || 0,
    taxesPerNight: Number(room.taxesPerNight) || 0,
    discountPercent: discountPercent(room),
  };
}

/** Room type plus its computed price, availability and (when dated) a quote. */
function decorateRoom(room, stay, roomCount) {
  const out = Object.assign({}, room, { pricing: priceOf(room) });

  if (stay) {
    out.availability = hotels.availability(room, stay.checkIn, stay.checkOut);
    out.quote = computeHotelTotals({
      ratePerNight: room.pricePerNight,
      mrpPerNight: room.mrpPerNight,
      taxesPerNight: room.taxesPerNight,
      nights: stay.nights,
      rooms: roomCount || 1,
    });
  } else {
    out.availability = null;
    out.quote = null;
  }

  return out;
}

/** Resolves + validates everything a quote or a booking needs. */
function resolveStayRequest(body) {
  const room = findRoom(body.roomId);
  if (room.active === false) throw new HttpError(400, `${room.name} is not available for booking right now`);

  const stay = hotels.parseStay({ checkIn: body.checkIn, checkOut: body.checkOut, nights: body.nights });
  const roomCount = Math.max(1, Math.round(Number(body.rooms) || 1));

  const offer = resolveHotelOffer(db.get('offers'), body.offerCode, {
    ratePerNight: room.pricePerNight,
    mrpPerNight: room.mrpPerNight,
    taxesPerNight: room.taxesPerNight,
    nights: stay.nights,
    rooms: roomCount,
  });

  const amounts = computeHotelTotals({
    ratePerNight: room.pricePerNight,
    mrpPerNight: room.mrpPerNight,
    taxesPerNight: room.taxesPerNight,
    nights: stay.nights,
    rooms: roomCount,
    offer,
  });

  return { room, stay, roomCount, offer, amounts };
}

/** Caps guest counts to what the room type can actually sleep. */
function resolveGuests(body, room, roomCount) {
  const maxAdults = Math.max(1, Number(room.maxGuests) || 2) * roomCount;
  const maxChildren = Math.max(0, Number(room.maxChildren) || 0) * roomCount;

  const adults = Math.max(1, Math.round(Number(body.adults) || roomCount));
  const children = Math.max(0, Math.round(Number(body.children) || 0));

  if (adults > maxAdults) {
    throw new HttpError(400, `${room.name} sleeps up to ${maxAdults} adult(s) across ${roomCount} room(s)`);
  }
  if (children > maxChildren) {
    throw new HttpError(
      400,
      maxChildren === 0
        ? `${room.name} cannot accommodate extra children — please book another room`
        : `Up to ${maxChildren} child(ren) allowed across ${roomCount} room(s)`
    );
  }

  return { adults, children };
}

// ── Listing ──────────────────────────────────────────────────────────────────
router.get('/hotels', (ctx) => {
  const hotel = currentHotel();
  const stay = optionalStay(ctx.query);
  const roomCount = Math.max(1, Math.round(Number(ctx.query.rooms) || 1));
  const rooms = bookableRooms(hotel.id).map((r) => decorateRoom(r, stay, roomCount));

  return {
    hotel,
    phone: hotel.phone || FALLBACK_PHONE,
    stay,
    count: rooms.length,
    // Cheapest nightly rate, used for the "from ₹x" line on the tab header.
    fromPrice: rooms.reduce(
      (min, r) => (r.pricing.pricePerNight && (!min || r.pricing.pricePerNight < min) ? r.pricing.pricePerNight : min),
      0
    ),
    rooms,
  };
});

router.get('/hotels/rooms/:id', (ctx) => {
  const room = findRoom(ctx.params.id);
  const hotel = db.byId('hotels', room.hotelId) || currentHotel();
  const stay = optionalStay(ctx.query);
  const roomCount = Math.max(1, Math.round(Number(ctx.query.rooms) || 1));

  return {
    hotel,
    phone: hotel.phone || FALLBACK_PHONE,
    stay,
    room: decorateRoom(room, stay, roomCount),
    otherRooms: bookableRooms(hotel.id)
      .filter((r) => r.id !== room.id)
      .map((r) => decorateRoom(r, stay, roomCount)),
  };
});

// ── Pricing ──────────────────────────────────────────────────────────────────
/** Price preview — keeps the checkout screen and the server in agreement. */
router.post('/hotels/quote', (ctx) => {
  const { room, stay, roomCount, offer, amounts } = resolveStayRequest(ctx.body);
  const state = hotels.availability(room, stay.checkIn, stay.checkOut);

  return {
    stay,
    room: { id: room.id, name: room.name, pricing: priceOf(room) },
    amounts,
    availability: state,
    offerApplied: offer ? offer.code : null,
    enoughRooms: state.available >= roomCount,
  };
});

router.post('/hotels/offers/validate', (ctx) => {
  const { room, stay, roomCount } = resolveStayRequest(ctx.body);
  const offer = resolveHotelOffer(db.get('offers'), ctx.body.code, {
    ratePerNight: room.pricePerNight,
    mrpPerNight: room.mrpPerNight,
    taxesPerNight: room.taxesPerNight,
    nights: stay.nights,
    rooms: roomCount,
  });
  if (!offer) throw new HttpError(400, 'That code is not valid for this stay');

  const amounts = computeHotelTotals({
    ratePerNight: room.pricePerNight,
    mrpPerNight: room.mrpPerNight,
    taxesPerNight: room.taxesPerNight,
    nights: stay.nights,
    rooms: roomCount,
    offer,
  });

  return { offer: { code: offer.code, title: offer.title, subtitle: offer.subtitle }, amounts };
});

// ── Booking ──────────────────────────────────────────────────────────────────
router.post('/hotels/bookings', auth.requireAuth, (ctx) => {
  const { room, stay, roomCount, amounts } = resolveStayRequest(ctx.body);
  const hotel = db.byId('hotels', room.hotelId) || currentHotel();
  const guests = resolveGuests(ctx.body, room, roomCount);

  // Final check against anyone who booked while this guest was on the form.
  hotels.assertAvailable(room, stay.checkIn, stay.checkOut, roomCount);

  const guestName = String(ctx.body.guestName || ctx.user.name || '').trim().slice(0, 80);
  const guestPhone = String(ctx.body.guestPhone || ctx.user.phone || '').trim().slice(0, 20);
  if (!guestName) throw new HttpError(400, 'Enter the name of the primary guest');

  const startsAt = hotels.stampFor(stay.checkIn, hotel.checkInTime, 12);
  const endsAt = hotels.stampFor(stay.checkOut, hotel.checkOutTime, 11);

  const booking = db.insert('bookings', {
    id: db.id('bkg'),
    reference: db.reference('HT'),
    type: 'hotel',
    userId: ctx.user.id,
    status: 'confirmed',
    hotelId: hotel.id,
    roomId: room.id,
    stay: {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: stay.nights,
      rooms: roomCount,
      guests,
      checkInTime: hotel.checkInTime || '12:00',
      checkOutTime: hotel.checkOutTime || '11:00',
      hotelName: hotel.name,
      roomName: room.name,
    },
    guest: {
      name: guestName,
      phone: guestPhone,
      specialRequests: String(ctx.body.specialRequests || '').trim().slice(0, 400),
    },
    // Kept for shape-compatibility with movie/food bookings.
    seats: [],
    food: [],
    startsAt,
    endsAt,
    amounts,
    offerCode: amounts.offerCode,
    payment: paymentRecord(ctx.body.payment, amounts.total),
    reminder: { enabled: ctx.body.reminder !== false, minutesBefore: 24 * 60 },
    cancelledAt: null,
    refundAmount: 0,
  });

  notify(
    ctx.user.id,
    'Stay confirmed 🏨',
    `${roomCount} × ${room.name} at ${hotel.name} — ${stay.checkIn} to ${stay.checkOut} (${stay.nights} night${stay.nights === 1 ? '' : 's'}).`,
    'booking'
  );

  ctx.state.status = 201;
  return { booking: expand(booking) };
});

module.exports = router;
