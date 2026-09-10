'use strict';
/**
 * Water park booking API — "Family Fun Day".
 *
 *   GET  /api/waterpark                       tab payload: packages, rate card, add-ons
 *   GET  /api/waterpark/slots?date=           entry slots with live capacity
 *   POST /api/waterpark/quote                 price an order (package or per-person)
 *   POST /api/waterpark/offers/validate       check a coupon against that order
 *   POST /api/waterpark/bookings              pay and issue the pass          (auth)
 *   GET  /api/waterpark/bookings              my passes                       (auth)
 *   GET  /api/waterpark/bookings/:id          one pass                        (auth)
 *   POST /api/waterpark/bookings/:id/cancel   release the slot                (auth)
 *   GET  /api/waterpark/bookings/:id/barcode.svg   gate barcode (public by reference)
 *
 * Both booking modes and every endpoint above price through
 * `park.resolveOrder()` + `computeWaterparkTotals()`, so a quote and the
 * amount actually charged cannot drift apart.
 */
const db = require('../db');
const auth = require('../auth');
const park = require('../waterpark');
const barcode = require('../barcode');
const { computeWaterparkTotals, resolveWaterparkOffer } = require('../pricing');
const { paymentRecord, notify } = require('../bookings');
const { Router, HttpError } = require('../router');

const router = new Router();

/** Settings, refusing service when the admin has switched the tab off. */
function activeSettings() {
  const s = park.settings();
  if (s.active === false) throw new HttpError(503, 'Water park booking is not available right now');
  return s;
}

/**
 * Resolves + prices a request in one place. Both /quote and /bookings call
 * this, which is what makes the quoted total and the charged total the same
 * number by construction rather than by review.
 */
function resolveOrderRequest(body = {}, s = activeSettings()) {
  const order = park.resolveOrder(body, s);

  const offer = body.offerCode
    ? resolveWaterparkOffer(db.get('offers'), body.offerCode, {
        baseAmount: order.baseAmount,
        addOnAmount: order.addOnAmount,
        actualValue: order.actualValue,
      })
    : null;

  const amounts = computeWaterparkTotals({
    baseAmount: order.baseAmount,
    actualValue: order.actualValue,
    addOnAmount: order.addOnAmount,
    convenienceFeePercent: s.convenienceFeePercent,
    gstPercent: s.gstPercent,
    offer,
  });

  return { order, offer, amounts, settings: s };
}

/** The quote shape, shared by /quote and the response to a rejected coupon. */
function quotePayload({ order, amounts, offer, settings: s }, { slot = null } = {}) {
  return {
    mode: order.mode,
    package: order.packageId
      ? { id: order.packageId, code: order.packageCode, name: order.packageName, qty: order.packageQty }
      : null,
    lines: order.lines,
    addOns: order.addOns,
    guests: order.guests,
    amounts,
    offer: offer ? { code: offer.code, title: offer.title } : null,
    notice: park.orderNotice(order, s),
    slot,
    /** Only ever a hint on a quote — capacity is enforced again at payment. */
    slotWarning:
      slot && slot.seatsLeft < order.guests.total
        ? slot.seatsLeft === 0
          ? `The ${slot.label} slot is full.`
          : `Only ${slot.seatsLeft} space(s) left in the ${slot.label} slot.`
        : null,
  };
}

// ── Tab payload ─────────────────────────────────────────────────────────────
router.get('/waterpark', (ctx) => {
  const s = park.settings();
  const date = ctx.query.date && park.DATE_RE.test(ctx.query.date) ? ctx.query.date : park.today();

  return {
    settings: park.publicSettings(s),
    catalogue: park.catalogue(s),
    today: park.today(),
    date,
    slots: s.active === false ? [] : park.slotsFor(date, s),
    notices: {
      package: park.renderNotice(s.packageNotice, park.noticeTokens(s)),
      individual: park.renderNotice(s.individualNotice, park.noticeTokens(s)),
    },
    /** Lets the per-person builder pre-fill sensible quantities. */
    bestSaving: park.bestSaving(s),
    myBookings: ctx.user
      ? db
          .find('waterparkBookings', (b) => b.userId === ctx.user.id && b.status === 'confirmed')
          .filter((b) => b.date >= park.today())
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 3)
          .map((b) => park.decorateBooking(b, s))
      : [],
  };
});

router.get('/waterpark/slots', (ctx) => {
  const s = activeSettings();
  const date = ctx.query.date || park.today();
  park.assertBookableDate(date, s);
  return { date, dateLabel: park.dateLabel(date), slots: park.slotsFor(date, s) };
});

// ── Quoting ─────────────────────────────────────────────────────────────────
router.post('/waterpark/quote', (ctx) => {
  const resolved = resolveOrderRequest(ctx.body || {});
  const body = ctx.body || {};

  // A quote reports on the slot but never blocks on it, so a guest can price
  // their day out before committing to a time.
  let slot = null;
  if (body.date && body.time && park.DATE_RE.test(body.date)) {
    slot = park.slotFor(body.date, body.time, resolved.settings);
  }

  return Object.assign(quotePayload(resolved, { slot }), {
    /** Set when a coupon was sent but could not be applied. */
    offerRejected: Boolean(body.offerCode) && !resolved.offer,
  });
});

router.post('/waterpark/offers/validate', (ctx) => {
  const resolved = resolveOrderRequest(ctx.body || {});
  if (!resolved.offer) throw new HttpError(400, 'This code cannot be used on this booking');
  return {
    offer: {
      code: resolved.offer.code,
      title: resolved.offer.title,
      subtitle: resolved.offer.subtitle,
      discount: resolved.amounts.offerDiscount,
    },
    amounts: resolved.amounts,
  };
});

// ── Booking ─────────────────────────────────────────────────────────────────
router.post('/waterpark/bookings', auth.requireAuth, (ctx) => {
  const body = ctx.body || {};
  const s = activeSettings();

  const date = park.assertBookableDate(body.date, s);
  if (!body.time) throw new HttpError(400, 'Pick an entry time');

  const resolved = resolveOrderRequest(body, s);
  const { order, amounts, offer } = resolved;

  // Re-checked here rather than trusting the quote: the slot can fill between
  // the guest seeing a price and pressing pay.
  const slot = park.assertCapacity(date, body.time, order.guests.total, s);

  const payment = paymentRecord(body.payment, ctx.user, amounts.total);
  const startsAt = park.stampFor(date, slot.time);

  const booking = db.insert('waterparkBookings', {
    id: db.id('wpb'),
    reference: db.reference('WP'),
    userId: ctx.user.id,
    type: 'waterpark',
    status: 'confirmed',

    mode: order.mode,
    packageId: order.packageId,
    packageCode: order.packageCode,
    packageName: order.packageName,
    packageQty: order.packageQty,
    lines: order.lines,
    addOns: order.addOns,
    guests: order.guests,

    date,
    time: slot.time,
    startsAt: startsAt ? startsAt.toISOString() : null,
    guest: {
      name: String(body.guestName || ctx.user.name || '').slice(0, 80),
      phone: String(body.guestPhone || ctx.user.phone || '').slice(0, 20),
    },

    amounts,
    offerCode: amounts.offerCode,
    payment,
    checkedInAt: null,
    source: 'app',
    /* Frozen so a later price change never rewrites history on an issued pass. */
    appliedRates: {
      parkName: s.parkName,
      validityNote: s.validityNote,
      convenienceFeePercent: s.convenienceFeePercent,
      gstPercent: s.gstPercent,
      lines: order.lines.map((l) => ({ itemId: l.itemId, label: l.label, rate: l.rate })),
    },
  });

  if (offer && amounts.offerDiscount > 0) {
    notify(
      ctx.user.id,
      `Offer ${offer.code} applied`,
      `You saved ${park.money(amounts.offerDiscount)} on your ${s.parkName} day pass.`,
      'offer'
    );
  }

  notify(
    ctx.user.id,
    `${s.headline} pass confirmed`,
    `${order.guests.total} guest(s) on ${park.dateLabel(date)} at ${park.timeLabel(slot.time)}. ` +
      `Reference ${booking.reference}.`,
    'booking'
  );

  ctx.state.status = 201;
  return { booking: park.decorateBooking(booking, s) };
});

router.get('/waterpark/bookings', auth.requireAuth, (ctx) => {
  const s = park.settings();
  const mine = db
    .find('waterparkBookings', (b) => b.userId === ctx.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((b) => park.decorateBooking(b, s));
  return { bookings: mine };
});

router.get('/waterpark/bookings/:id', auth.requireAuth, (ctx) => {
  const booking = db.byId('waterparkBookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.userId !== ctx.user.id && ctx.user.role !== 'admin') {
    throw new HttpError(403, 'Not your booking');
  }
  return { booking: park.decorateBooking(booking, park.settings()) };
});

router.post('/waterpark/bookings/:id/cancel', auth.requireAuth, (ctx) => {
  const booking = db.byId('waterparkBookings', ctx.params.id);
  if (!booking) throw new HttpError(404, 'Booking not found');
  if (booking.userId !== ctx.user.id && ctx.user.role !== 'admin') {
    throw new HttpError(403, 'Not your booking');
  }
  if (booking.status !== 'confirmed') throw new HttpError(400, 'This booking is already cancelled');
  if (booking.checkedInAt) throw new HttpError(400, 'This pass has already been used at the gate');

  // The visit day itself is non-refundable: the slot can no longer be resold.
  if (booking.date <= park.today()) {
    throw new HttpError(400, 'A pass cannot be cancelled on the day of the visit');
  }

  const updated = db.update('waterparkBookings', booking.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelledBy: 'customer',
  });

  return { booking: park.decorateBooking(updated, park.settings()) };
});

/** Scannable gate pass. Public by reference so gate scanners need no login. */
router.get('/waterpark/bookings/:id/barcode.svg', (ctx) => {
  const booking =
    db.byId('waterparkBookings', ctx.params.id) ||
    db.findOne('waterparkBookings', (b) => b.reference === ctx.params.id.toUpperCase());
  if (!booking) throw new HttpError(404, 'Booking not found');

  const { svg } = barcode.render(booking.reference, {
    narrow: Number(ctx.query.narrow) || 2,
    height: Number(ctx.query.height) || 96,
    showText: ctx.query.text !== '0',
  });

  ctx.res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': Buffer.byteLength(svg),
  });
  ctx.res.end(svg);
});

module.exports = router;
