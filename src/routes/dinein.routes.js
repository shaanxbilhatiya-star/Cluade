'use strict';
/**
 * Dine-In customer API: reserve a table, preview a bill, pay a bill.
 *
 * All of the policy (discount percentages, the lock window, notice wording)
 * lives in src/dinein.js so the admin panel and these routes can never drift
 * apart. Routes here only validate input and record the outcome.
 */
const db = require('../db');
const auth = require('../auth');
const dinein = require('../dinein');
const { expand, paymentRecord, notify } = require('../bookings');
const { Router, HttpError } = require('../router');

const router = new Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Combines a 'YYYY-MM-DD' key and an 'HH:MM' slot into a local ISO stamp. */
function startsAtFrom(dateKey, slot) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = slot.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

/** The signed-in guest's dine-in bills, newest first. */
function billsFor(userId, limit = 10) {
  return db
    .find('bookings', (b) => b.type === 'dinein' && b.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map(expand);
}

// ── Overview ─────────────────────────────────────────────────────────────────
/**
 * Everything the Dine-In tab needs in one round trip. Public: a guest who is
 * not signed in still sees the offer and the notices, just no reservations.
 */
router.get('/dinein', (ctx) => {
  const cfg = dinein.settings();
  const payload = {
    settings: dinein.publicSettings(cfg),
    today: todayKey(),
    reservation: null,
    reservations: [],
    bills: [],
  };

  if (!ctx.user) return payload;

  const mine = db
    .find('dineReservations', (r) => r.userId === ctx.user.id)
    .sort((a, b) => String(b.bookedAt || b.createdAt).localeCompare(String(a.bookedAt || a.createdAt)));

  payload.reservations = mine.slice(0, 10).map((r) => dinein.expandReservation(r, cfg));
  payload.reservation = payload.reservations.find((r) => r.status === 'booked') || null;
  payload.bills = billsFor(ctx.user.id);

  return payload;
});

// ── Reservations ─────────────────────────────────────────────────────────────
router.post('/dinein/reservations', auth.requireAuth, (ctx) => {
  const cfg = dinein.settings();
  if (!cfg.active) throw new HttpError(400, 'Dine-In reservations are currently unavailable');

  // One open reservation at a time keeps billing unambiguous: a bill always
  // knows exactly which reservation earned its discount.
  const existing = dinein.openReservationFor(ctx.user.id);
  if (existing) {
    throw new HttpError(
      409,
      `You already have an open reservation (${existing.reference}). Use it to pay your bill, or cancel it first.`,
      { reservationId: existing.id }
    );
  }

  const date = String(ctx.body.date || todayKey());
  if (!DATE_RE.test(date)) throw new HttpError(400, 'date must be in YYYY-MM-DD format');
  if (date < todayKey()) throw new HttpError(400, 'Pick today or a future date');

  const slot = String(ctx.body.slot || cfg.slots[0] || '19:00');
  if (!TIME_RE.test(slot)) throw new HttpError(400, 'slot must be in HH:MM format');

  const partySize = Number(ctx.body.partySize);
  if (!Number.isFinite(partySize) || partySize < 1) throw new HttpError(400, 'How many guests are coming?');
  if (partySize > cfg.maxPartySize) {
    throw new HttpError(400, `For parties over ${cfg.maxPartySize}, please call us on ${cfg.phone}`);
  }

  const now = new Date();
  const reservation = db.insert('dineReservations', {
    id: db.id('drv'),
    reference: db.reference('DR'),
    userId: ctx.user.id,
    guestName: String(ctx.body.guestName || ctx.user.name || '').slice(0, 80),
    phone: String(ctx.body.phone || ctx.user.phone || '').slice(0, 20),
    partySize: Math.round(partySize),
    date,
    slot,
    startsAt: startsAtFrom(date, slot),
    tableLabel: dinein.nextTableLabel(),
    notes: String(ctx.body.notes || '').slice(0, 240),
    status: 'booked',
    // The lock is measured from this stamp, not from the requested slot: the
    // rule is "reserve 30 minutes before you arrive", not "before you eat".
    bookedAt: now.toISOString(),
    // Snapshot of the policy in force when the table was booked, kept for
    // auditing. Live lock state is always recomputed from current settings.
    bookedUnderUnlockMinutes: cfg.unlockMinutes,
    bookedUnderDiscountPercent: cfg.reservedDiscountPercent,
    billedAt: null,
    billingId: null,
  });

  const view = dinein.expandReservation(reservation, cfg);
  notify(
    ctx.user.id,
    'Table reserved 🍽️',
    `${reservation.reference} · ${reservation.partySize} guest(s) on ${date} at ${slot}. Billing with ${cfg.reservedDiscountPercent}% off unlocks at ${view.unlockTime}.`,
    'booking'
  );

  ctx.state.status = 201;
  return { reservation: view };
});

router.get('/dinein/reservations', auth.requireAuth, (ctx) => {
  const cfg = dinein.settings();
  const list = db
    .find('dineReservations', (r) => r.userId === ctx.user.id)
    .sort((a, b) => String(b.bookedAt || b.createdAt).localeCompare(String(a.bookedAt || a.createdAt)))
    .map((r) => dinein.expandReservation(r, cfg));
  return { count: list.length, reservations: list };
});

router.post('/dinein/reservations/:id/cancel', auth.requireAuth, (ctx) => {
  const reservation = db.byId('dineReservations', ctx.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (reservation.userId !== ctx.user.id && ctx.user.role !== 'admin') throw new HttpError(403, 'Not your reservation');
  if (reservation.status === 'billed') throw new HttpError(400, 'That reservation has already been billed');
  if (reservation.status === 'cancelled') throw new HttpError(400, 'That reservation is already cancelled');

  const updated = db.update('dineReservations', reservation.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  });
  return { reservation: dinein.expandReservation(updated) };
});

// ── Billing ──────────────────────────────────────────────────────────────────
/**
 * Resolves the reservation a bill request refers to. An explicit id wins;
 * otherwise we fall back to the guest's open reservation.
 */
function reservationForBill(ctx, mode) {
  if (mode !== 'reserved') return null;

  if (ctx.body.reservationId) {
    const found = db.byId('dineReservations', ctx.body.reservationId);
    if (!found) throw new HttpError(404, 'Reservation not found');
    if (found.userId !== ctx.user.id) throw new HttpError(403, 'Not your reservation');
    return found;
  }
  return dinein.openReservationFor(ctx.user.id);
}

/** Price preview: what this bill costs, whether it is payable, which notice to show. */
router.post('/dinein/quote', auth.requireAuth, (ctx) => {
  const mode = String(ctx.body.mode || 'walkin');
  const reservation = reservationForBill(ctx, mode);
  const quote = dinein.resolveBill({
    mode,
    billAmount: ctx.body.billAmount,
    reservation,
  });
  return quote;
});

/** Pay a dine-in bill. Recorded as a booking of type 'dinein'. */
router.post('/dinein/bills', auth.requireAuth, (ctx) => {
  const cfg = dinein.settings();
  const mode = String(ctx.body.mode || 'walkin');
  const reservation = reservationForBill(ctx, mode);

  // validate:true makes the lock a hard failure instead of a preview.
  const resolved = dinein.resolveBill({
    mode,
    billAmount: ctx.body.billAmount,
    reservation,
    cfg,
    validate: true,
  });

  const amounts = resolved.amounts;
  const nowIso = new Date().toISOString();

  const booking = db.insert('bookings', {
    id: db.id('bkg'),
    reference: db.reference('DN'),
    type: 'dinein',
    userId: ctx.user.id,
    status: 'confirmed',
    seats: [],
    food: [],
    amounts,
    offerCode: null,
    dine: {
      mode,
      restaurantName: cfg.restaurantName,
      billAmount: amounts.billAmount,
      discountPercent: resolved.discountPercent,
      discountAmount: amounts.discount,
      // The notice is stored as rendered at the moment of payment, so the
      // receipt always shows the terms the guest actually agreed to even if
      // the admin edits the wording or the percentages later.
      notice: resolved.notice,
      noticeKind: resolved.noticeKind,
      reservationId: reservation ? reservation.id : null,
      reservationRef: reservation ? reservation.reference : null,
      tableLabel: reservation ? reservation.tableLabel : null,
      partySize: reservation ? reservation.partySize : null,
      reservedAt: reservation ? reservation.bookedAt : null,
      unlockMinutes: cfg.unlockMinutes,
      paidAt: nowIso,
    },
    // A dine-in bill is a receipt for a meal already eaten, so it is "now".
    startsAt: nowIso,
    payment: paymentRecord(ctx.body.payment, ctx.user, amounts.total),
    reminder: { enabled: false, minutesBefore: 30 },
  });

  if (reservation) {
    db.update('dineReservations', reservation.id, {
      status: 'billed',
      billedAt: nowIso,
      billingId: booking.id,
    });
  }

  const earned = Math.round(amounts.total / 10);
  if (earned > 0) {
    db.update('users', ctx.user.id, { loyaltyPoints: (ctx.user.loyaltyPoints || 0) + earned });
  }

  notify(
    ctx.user.id,
    `Dine-In bill paid · saved \u20B9${amounts.discount}`,
    `${booking.reference} · \u20B9${amounts.total} paid at ${cfg.restaurantName} (${resolved.discountPercent}% off \u20B9${amounts.billAmount}).`,
    'booking'
  );

  ctx.state.status = 201;
  return {
    booking: expand(booking),
    discountPercent: resolved.discountPercent,
    saved: amounts.discount,
    notice: resolved.notice,
    noticeKind: resolved.noticeKind,
    pointsEarned: earned,
  };
});

module.exports = router;
