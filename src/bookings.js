'use strict';
/**
 * Shared booking logic.
 *
 * `bookings` is one polymorphic collection discriminated by `type`
 * ('movie' | 'food' | 'hotel'). These helpers are the single place that knows
 * how to present a booking of any type and how to record its payment, so the
 * movie/food routes and the hotel routes cannot drift apart.
 */
const db = require('./db');
const { HttpError } = require('./router');

/** Movie tickets: no cancellation inside 2h of showtime. */
const CANCELLATION_CUTOFF_MS = 2 * 60 * 60 * 1000;
/** Stays: free cancellation until 24h before check-in. */
const HOTEL_CANCELLATION_CUTOFF_MS = 24 * 60 * 60 * 1000;
const REFUND_RATE = 0.75;

const PAYMENT_LABELS = {
  card: 'Credit / Debit Card',
  upi: 'UPI',
  wallet: 'Wallet',
  netbanking: 'Net Banking',
  cash: 'Pay at Counter',
};

/** Which tab of My Tickets a booking belongs in. */
function bucketOf(booking) {
  if (booking.status === 'cancelled') return 'cancelled';
  // A stay stays "upcoming" until check-out, not check-in.
  const reference = booking.type === 'hotel' ? booking.endsAt || booking.startsAt : booking.startsAt;
  const stamp = reference ? new Date(reference).getTime() : 0;
  return stamp && stamp < Date.now() ? 'passed' : 'upcoming';
}

/** How long before the event a booking can still be cancelled. */
function cutoffFor(type) {
  return type === 'hotel' ? HOTEL_CANCELLATION_CUTOFF_MS : CANCELLATION_CUTOFF_MS;
}

function canCancel(booking) {
  if (booking.status !== 'confirmed') return false;
  if (booking.type === 'food') return false;
  const start = new Date(booking.startsAt).getTime();
  if (!start) return false;
  return start - Date.now() > cutoffFor(booking.type);
}

/** Display title for any booking type. */
function titleOf(booking, { movie, room, hotel }) {
  if (movie) return movie.title;
  if (booking.type === 'hotel') {
    const roomName = (room && room.name) || booking.stay?.roomName || 'Room';
    return `${roomName} · ${(hotel && hotel.name) || booking.stay?.hotelName || 'Hotel'}`;
  }
  if (booking.type === 'food') return 'Food & Beverages';
  return 'CineFlex booking';
}

function imageOf(booking, { movie, room }) {
  if (movie) return movie.posterUrl;
  if (booking.type === 'hotel') {
    const photos = (room && room.photos) || [];
    return photos[0] || '/img/hotels/_placeholder.svg';
  }
  return '/img/food/_placeholder.svg';
}

/** Adds everything the client needs to render a booking. */
function expand(booking) {
  const movie = booking.movieId ? db.byId('movies', booking.movieId) : null;
  const cinema = booking.cinemaId ? db.byId('cinemas', booking.cinemaId) : null;
  const screen = booking.screenId ? db.byId('screens', booking.screenId) : null;
  const hotel = booking.hotelId ? db.byId('hotels', booking.hotelId) : null;
  const room = booking.roomId ? db.byId('hotelRooms', booking.roomId) : null;

  return Object.assign({}, booking, {
    bucket: bucketOf(booking),
    seatLabel: (booking.seats || []).map((s) => s.id).join(', '),
    title: titleOf(booking, { movie, room, hotel }),
    posterUrl: imageOf(booking, { movie, room }),
    movie: movie && {
      id: movie.id,
      title: movie.title,
      posterUrl: movie.posterUrl,
      backdropUrl: movie.backdropUrl,
      certificate: movie.certificate,
      runtime: movie.runtime,
      genres: movie.genres,
      languages: movie.languages,
    },
    cinema: cinema && { id: cinema.id, name: cinema.name, area: cinema.area, city: cinema.city, address: cinema.address },
    screenName: screen ? screen.name : null,
    hotel: hotel && {
      id: hotel.id,
      name: hotel.name,
      area: hotel.area,
      city: hotel.city,
      address: hotel.address,
      phone: hotel.phone,
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
      policies: hotel.policies,
    },
    room: room && {
      id: room.id,
      name: room.name,
      photos: room.photos,
      bedType: room.bedType,
      sizeSqft: room.sizeSqft,
      maxGuests: room.maxGuests,
    },
    barcodeUrl: `/api/bookings/${booking.id}/barcode.svg`,
    canCancel: canCancel(booking),
    cancellationCutoffHours: Math.round(cutoffFor(booking.type) / (60 * 60 * 1000)),
  });
}

/** Builds the payment sub-record, resolving a saved card to its label. */
function paymentRecord(payment, user, amount) {
  const method = (payment && payment.method) || 'card';
  if (!PAYMENT_LABELS[method]) throw new HttpError(400, `Unsupported payment method: ${method}`);

  let label = PAYMENT_LABELS[method];
  if (payment && payment.methodId) {
    const saved = (user.paymentMethods || []).find((m) => m.id === payment.methodId);
    if (saved) label = saved.label + (saved.last4 ? ` ••${saved.last4}` : '');
  } else if (payment && payment.label) {
    label = String(payment.label).slice(0, 60);
  }

  return {
    method,
    methodLabel: label,
    status: method === 'cash' ? 'pending' : 'paid',
    amount,
    transactionId: `TXN${db.reference('').slice(0, 10)}`,
    paidAt: method === 'cash' ? null : new Date().toISOString(),
  };
}

function notify(userId, title, body, kind) {
  db.insert('notifications', { id: db.id('ntf'), userId, title, body, kind, read: false });
}

module.exports = {
  CANCELLATION_CUTOFF_MS,
  HOTEL_CANCELLATION_CUTOFF_MS,
  REFUND_RATE,
  PAYMENT_LABELS,
  bucketOf,
  canCancel,
  cutoffFor,
  expand,
  paymentRecord,
  notify,
};
