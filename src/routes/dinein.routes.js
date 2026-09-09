'use strict';
/**
 * Public Dine-In API.
 *
 *   GET    /api/dine-in                          tab payload: settings, discount tiers, my reservation
 *   GET    /api/dine-in/slots                    bookable time slots for a date
 *   GET    /api/dine-in/reservations             my reservations (with live lock state)
 *   POST   /api/dine-in/reservations             reserve a table
 *   POST   /api/dine-in/reservations/:id/cancel  cancel a reservation
 *   POST   /api/dine-in/quote                    price a bill (server decides the tier)
 *   POST   /api/dine-in/offers/validate          check a coupon against a bill
 *   POST   /api/dine-in/bills                    pay the bill
 *   GET    /api/dine-in/bills                    my paid bills
 *   GET    /api/dine-in/bills/:id                one receipt
 *
 * The 30%/10% split, the 30-minute billing lock and every notice string are
 * resolved in src/dinein.js from admin-editable settings. Nothing here hardcodes
 * a discount, and the lock is enforced on this side so editing the request in
 * the browser cannot buy a bigger discount.
 */
const db = require('../db');
const auth = require('../auth');
const dine = require('../dinein');
const { computeDineTotals, resolveDineOffer } = require('../pricing');
const { paymentRecord, notify } = require('../bookings');
const { Router, HttpError } = require('../router');

const router = new Router();

// ── helpers ──────────────────────────────────────────────────────────────────
/** Refuses every dine-in request while the admin has the tab switched off. */
function activeSettings() {
  const s = dine.settings();
  if (s.active === false) throw new HttpError(503, 'Dine-In is not available right now');
  return s;
}

function myReservation(ctx, s) {
  if (!ctx.user) return null;
  return dine.activeReservationFor(ctx.user.id, s);
}

/**
 * Resolves the reservation a bill should be settled against.
 * An explicit reservationId is honoured (and must belong to the caller);
 * otherwise the guest's soonest usable reservation is picked up automatically.
 *
 * Quoting is open to anonymous callers so the bill screen can price a walk-in
 * before sign-in, so a reservationId from someone with no session is simply
 * ignored — answering "not found" vs "not yours" would leak which ids exist.
 */
function reservationForBill(ctx, body, s) {
  if (!ctx.user) return null;
  if (body.reservationId) {
    const found = db.byId('dineReservations', body.reservationId);
    if (!found || found.userId !== ctx.user.id) {
      throw new HttpError(404, 'Reservation not found');
    }
    return dine.decorateReservation(found, s);
  }
  return myReservation(ctx, s);
}

/**
 * Everything a quote or a payment needs, priced and tier-resolved together so
 * the preview the guest sees is produced by the same code path that charges them.
 */
function resolveBillRequest(ctx, body, s) {
  /* The bill total is declared by the guest, so it is bounded on both sides:
     a junk or astronomical figure would otherwise be persisted and summed into
     the admin revenue figures, and would mint loyalty points to match. */
  const raw = body.billAmount;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new HttpError(400, 'Enter the bill amount printed on your restaurant bill');
  }
  const billAmount = Math.round(Number(raw));
  if (!Number.isSafeInteger(billAmount) || billAmount <= 0) {
    throw new HttpError(400, 'Enter the bill amount printed on your restaurant bill');
  }

  const minimum = Number(s.minBillAmount) || 0;
  if (minimum > 0 && billAmount < minimum) {
    throw new HttpError(400, `Bills under ${dine.money(minimum)} cannot be paid through the app`);
  }
  const maximum = Number(s.maxBillAmount) || 0;
  if (maximum > 0 && billAmount > maximum) {
    throw new HttpError(
      400,
      `Bills over ${dine.money(maximum)} cannot be settled in the app — please pay at the counter`
    );
  }

  const reservation = reservationForBill(ctx, body, s);
  const walkinRequested = body.mode === 'walkin';
  const tier = dine.resolveTier({ reservation, walkinRequested, s });

  const offer = resolveDineOffer(db.get('offers'), body.offerCode, {
    billAmount,
    discountPercent: tier.discountPercent,
    maxDiscount: s.maxDiscountAmount,
  });

  const amounts = computeDineTotals({
    billAmount,
    discountPercent: tier.discountPercent,
    maxDiscount: s.maxDiscountAmount,
    offer,
  });

  return { billAmount, reservation, tier, offer, amounts };
}

/** Quote/notice payload shared by the quote endpoint and the pay endpoint. */
function quotePayload({ tier, amounts, reservation }, s) {
  return {
    mode: tier.mode,
    discountPercent: tier.discountPercent,
    locked: tier.locked,
    canPayNow: tier.canPayNow,
    lock: tier.lock,
    walkinFallback: tier.walkinFallback === undefined ? null : tier.walkinFallback,
    downgradedFrom: tier.downgradedFrom || null,
    notice: dine.tierNotice(tier, s, amounts),
    noticeKind: tier.noticeKind,
    amounts,
    reservation: reservation || null,
    offerApplied: amounts.offerCode,
  };
}

// ── Tab payload ──────────────────────────────────────────────────────────────
/**
 * One call renders the whole tab. Both tiers are described up front (so the
 * "30% with a reservation / 10% walk-in" cards always match the live settings)
 * along with the caller's reservation and its countdown, when signed in.
 */
router.get('/dine-in', (ctx) => {
  const s = dine.settings();
  const reservation = ctx.user ? myReservation(ctx, s) : null;

  // Previewed with no bill so the copy is right even before an amount is typed.
  const reservedTier = dine.resolveTier({ reservation, s });
  const walkinTier = dine.resolveTier({ reservation: null, s });

  const recentBills = ctx.user
    ? db
        .find('dineBills', (b) => b.userId === ctx.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
    : [];

  return {
    settings: dine.publicSettings(s),
    /** The two tiers, exactly as the admin has configured them. */
    tiers: {
      reserved: {
        discountPercent: s.reservedDiscountPercent,
        lockMinutes: s.lockMinutes,
        notice: dine.renderNotice(s.reservedNotice, dine.noticeTokens(s)),
      },
      walkin: {
        discountPercent: s.walkinDiscountPercent,
        notice: dine.renderNotice(s.walkinNotice, dine.noticeTokens(s)),
      },
    },
    /** What applies to this guest right now, notice included. */
    current: {
      mode: reservedTier.mode,
      discountPercent: reservedTier.discountPercent,
      locked: reservedTier.locked,
      canPayNow: reservedTier.canPayNow,
      lock: reservedTier.lock,
      walkinFallback: reservedTier.walkinFallback === undefined ? null : reservedTier.walkinFallback,
      notice: dine.tierNotice(reservedTier, s),
      noticeKind: reservedTier.noticeKind,
    },
    reservation,
    upcomingCount: ctx.user
      ? db.find(
          'dineReservations',
          (r) =>
            r.userId === ctx.user.id &&
            r.status === 'confirmed' &&
            new Date(r.startsAt).getTime() > Date.now()
        ).length
      : 0,
    recentBills,
    signedIn: Boolean(ctx.user),
  };
});

// ── Slots ────────────────────────────────────────────────────────────────────
router.get('/dine-in/slots', (ctx) => {
  const s = activeSettings();
  const date = ctx.query.date || dine.today();
  return { date, slotMinutes: s.slotMinutes, slots: dine.slotsFor(date, s) };
});

// ── Reservations ─────────────────────────────────────────────────────────────
router.get('/dine-in/reservations', auth.requireAuth, (ctx) => {
  const s = dine.settings();
  const list = db
    .find('dineReservations', (r) => r.userId === ctx.user.id)
    .map((r) => dine.decorateReservation(r, s))
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  return { count: list.length, reservations: list };
});

router.post('/dine-in/reservations', auth.requireAuth, (ctx) => {
  const s = activeSettings();
  const body = ctx.body || {};

  const date = String(body.date || '');
  if (!dine.parseKey(date)) throw new HttpError(400, 'Pick a valid date for your reservation');
  if (date < dine.today()) throw new HttpError(400, 'That date has already passed');

  const maxDate = dine.dateKey(
    new Date(Date.now() + Math.max(0, Number(s.advanceDays) || 0) * 24 * 60 * 60 * 1000)
  );
  if (date > maxDate) throw new HttpError(400, `Tables can only be reserved up to ${s.advanceDays} days ahead`);

  const time = String(body.time || '');
  const slot = dine.slotsFor(date, s).find((x) => x.time === time);
  if (!slot) throw new HttpError(400, 'That time is not available — pick another slot');

  const partySize = Math.round(Number(body.partySize) || 0);
  if (!partySize || partySize < 1) throw new HttpError(400, 'How many guests are coming?');
  if (partySize > s.maxPartySize) {
    throw new HttpError(400, `For parties over ${s.maxPartySize}, please call ${s.phone} instead`);
  }
  if (partySize > slot.seatsLeft) {
    throw new HttpError(400, `Only ${slot.seatsLeft} seat(s) left at ${slot.label} — try another slot`);
  }

  const guestName = String(body.guestName || ctx.user.name || '').trim().slice(0, 80);
  if (!guestName) throw new HttpError(400, 'Enter the name we should hold the table under');
  const guestPhone = String(body.guestPhone || ctx.user.phone || '').trim().slice(0, 20);

  const area = s.areas.includes(body.area) ? body.area : s.areas[0] || '';
  const reservedAt = new Date().toISOString();
  const startsAt = dine.stampFor(date, time);

  const reservation = db.insert('dineReservations', {
    id: db.id('dres'),
    reference: db.reference('DR'),
    userId: ctx.user.id,
    status: 'confirmed',
    date,
    time,
    startsAt,
    /**
     * When the table was actually booked. The billing lock is measured from
     * here (not from the slot), which is what makes "book at least
     * lockMinutes before you arrive" the rule that earns the bigger discount.
     */
    reservedAt,
    partySize,
    area,
    guest: {
      name: guestName,
      phone: guestPhone,
      notes: String(body.notes || '').trim().slice(0, 300),
    },
    /** Set once this reservation has been used to settle a bill. */
    billId: null,
    /** Snapshot of the deal promised at booking time, for the audit trail. */
    promisedDiscountPercent: s.reservedDiscountPercent,
    lockMinutes: s.lockMinutes,
    cancelledAt: null,
  });

  const decorated = dine.decorateReservation(reservation, s);

  notify(
    ctx.user.id,
    'Table reserved 🍽️',
    `${partySize} guest(s) at ${s.restaurantName} on ${date} at ${slot.label}. ` +
      `In-app billing with ${s.reservedDiscountPercent}% off unlocks at ${decorated.lock.unlockLabel}.`,
    'booking'
  );

  ctx.state.status = 201;
  return { reservation: decorated, settings: dine.publicSettings(s) };
});

router.post('/dine-in/reservations/:id/cancel', auth.requireAuth, (ctx) => {
  const reservation = db.byId('dineReservations', ctx.params.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (reservation.userId !== ctx.user.id) throw new HttpError(403, 'That reservation belongs to someone else');
  if (reservation.status !== 'confirmed') throw new HttpError(400, 'That reservation is already cancelled');
  if (reservation.billId) throw new HttpError(400, 'That reservation has already been billed');

  const updated = db.update('dineReservations', reservation.id, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  });
  notify(ctx.user.id, 'Reservation cancelled', `Your table on ${reservation.date} at ${reservation.time} was cancelled.`, 'booking');
  return { reservation: dine.decorateReservation(updated) };
});

// ── Pricing ──────────────────────────────────────────────────────────────────
/**
 * Price preview. Returns the tier, the lock countdown and the rendered notice,
 * so the bill screen never has to work out a discount for itself.
 */
router.post('/dine-in/quote', (ctx) => {
  const s = activeSettings();
  const resolved = resolveBillRequest(ctx, ctx.body || {}, s);
  return quotePayload(resolved, s);
});

router.post('/dine-in/offers/validate', (ctx) => {
  const s = activeSettings();
  const body = Object.assign({}, ctx.body, { offerCode: ctx.body.code });
  const resolved = resolveBillRequest(ctx, body, s);
  if (!resolved.offer) throw new HttpError(400, 'That code is not valid for this bill');
  return {
    offer: {
      code: resolved.offer.code,
      title: resolved.offer.title,
      subtitle: resolved.offer.subtitle,
    },
    amounts: resolved.amounts,
  };
});

// ── Paying the bill ──────────────────────────────────────────────────────────
router.post('/dine-in/bills', auth.requireAuth, (ctx) => {
  const s = activeSettings();
  const body = ctx.body || {};
  const { billAmount, reservation, tier, amounts } = resolveBillRequest(ctx, body, s);

  /* The lock, enforced server-side. A guest who has just reserved cannot bill
     against that reservation until it has been held for lockMinutes; they are
     told exactly when it opens, and offered the walk-in rate in the meantime. */
  if (tier.locked) {
    const suffix =
      s.allowWalkinWhileLocked !== false
        ? ` You can pay now at ${s.walkinDiscountPercent}% off instead.`
        : '';
    throw new HttpError(
      423,
      `Billing for this reservation unlocks at ${tier.lock.unlockLabel}, ` +
        `${dine.durationLabel(tier.lock.minutesLeft)} from now.${suffix}`
    );
  }

  if (tier.mode === 'walkin' && reservation && !s.allowWalkinWhileLocked && reservation.blockedReason === 'locked') {
    throw new HttpError(423, 'Please wait for your reservation billing window to open');
  }

  const payment = paymentRecord(body.payment, ctx.user, amounts.total);

  const bill = db.insert('dineBills', {
    id: db.id('dbil'),
    reference: db.reference('DB'),
    userId: ctx.user.id,
    /* 'Pay at the counter' is not money in hand, so the bill only claims to be
       paid when the payment record does. */
    status: payment.status === 'paid' ? 'paid' : 'pending',
    /** 'reserved' (earned the bigger discount) or 'walkin'. */
    mode: tier.mode,
    reservationId: tier.mode === 'reserved' && reservation ? reservation.id : null,
    restaurantName: s.restaurantName,
    tableNumber: String(body.tableNumber || '').trim().slice(0, 20),
    billNumber: String(body.billNumber || '').trim().slice(0, 40),
    guestName: String(body.guestName || ctx.user.name || '').trim().slice(0, 80),
    billAmount,
    amounts,
    offerCode: amounts.offerCode,
    /** Frozen copy of the terms applied, so a later settings change cannot rewrite history. */
    appliedSettings: {
      discountPercent: tier.discountPercent,
      maxDiscountAmount: s.maxDiscountAmount,
      lockMinutes: s.lockMinutes,
      lockBasis: s.lockBasis,
    },
    payment,
    paidAt: payment.paidAt,
  });

  // A reservation can only buy the bigger discount once.
  if (bill.reservationId) {
    db.update('dineReservations', bill.reservationId, { billId: bill.id, status: 'completed' });
  }

  // Points follow the settled amount, and only once the money is actually in.
  const earned = payment.status === 'paid' ? Math.round(amounts.total / 10) : 0;
  if (earned) {
    db.update('users', ctx.user.id, { loyaltyPoints: (ctx.user.loyaltyPoints || 0) + earned });
  }

  notify(
    ctx.user.id,
    payment.status === 'paid' ? 'Bill paid 🍽️' : 'Bill ready at the counter 🍽️',
    `${dine.money(amounts.total)} ${payment.status === 'paid' ? 'paid' : 'due'} at ${s.restaurantName} — ` +
      `you saved ${dine.money(amounts.discount)} (${amounts.effectivePercent}% off ${dine.money(billAmount)}).`,
    'payment'
  );

  ctx.state.status = 201;
  return {
    bill: Object.assign({}, bill, { notice: dine.paidNotice(bill, s) }),
    pointsEarned: earned,
  };
});

router.get('/dine-in/bills', auth.requireAuth, (ctx) => {
  const list = db
    .find('dineBills', (b) => b.userId === ctx.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    count: list.length,
    totalSaved: list.reduce((sum, b) => sum + (b.amounts.discount || 0), 0),
    bills: list,
  };
});

router.get('/dine-in/bills/:id', auth.requireAuth, (ctx) => {
  const bill = db.byId('dineBills', ctx.params.id);
  if (!bill) throw new HttpError(404, 'Bill not found');
  if (bill.userId !== ctx.user.id && ctx.user.role !== 'admin') {
    throw new HttpError(403, 'That bill belongs to someone else');
  }
  const s = dine.settings();
  return { bill: Object.assign({}, bill, { notice: dine.paidNotice(bill, s) }) };
});

module.exports = router;
