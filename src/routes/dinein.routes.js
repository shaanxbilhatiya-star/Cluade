'use strict';
/**
 * Public Dine-In API.
 *
 *   GET    /api/dine-in                          tab payload: the venue, both restaurants, my tables
 *   GET    /api/dine-in/slots?outletId=&date=    bookable time slots at one restaurant
 *   GET    /api/dine-in/reservations             my reservations (with live lock state)
 *   POST   /api/dine-in/reservations             reserve a table  (outletId REQUIRED)
 *   POST   /api/dine-in/reservations/:id/cancel  cancel a reservation
 *   POST   /api/dine-in/quote                    price a bill (server decides the tier)
 *   POST   /api/dine-in/offers/validate          check a coupon against a bill
 *   POST   /api/dine-in/bills                    pay the bill      (outletId REQUIRED)
 *   GET    /api/dine-in/bills                    my paid bills
 *   GET    /api/dine-in/bills/:id                one receipt
 *
 * ── Which restaurant? ───────────────────────────────────────────────────────
 * The resort has two: Rangoli (pure veg) and Dolphin (non-veg). Anything that
 * commits a guest to one of them — holding a table, settling a bill — refuses to
 * proceed without an `outletId`. There is deliberately NO default: silently
 * picking one would book a vegetarian family a table in the non-veg dining room,
 * or post a Dolphin bill against Rangoli's takings. Reads (slots, quotes) are
 * more forgiving, but every write names its restaurant.
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

/** "Rangoli (pure veg) or Dolphin (serves non-vegetarian)" — for error copy. */
function outletChoiceList(s) {
  return dine
    .bookableOutlets(s)
    .map((o) => `${o.name} (${dine.diet(o.diet).long.toLowerCase()})`)
    .join(' or ');
}

/**
 * Resolves the restaurant a write is for, refusing rather than guessing.
 *
 * The two failure messages are different on purpose: "you did not say which" and
 * "that one is closed" need different reactions from the guest.
 */
function requireOutlet(id, s, verb = 'booking') {
  if (!id) {
    throw new HttpError(400, `Choose which restaurant you are ${verb} — ${outletChoiceList(s)}`);
  }
  const outlet = dine.outletById(id, s);
  if (!outlet) throw new HttpError(404, `We have no restaurant called "${String(id).slice(0, 40)}"`);
  if (outlet.active === false) {
    throw new HttpError(400, `${outlet.name} is not taking bookings right now — try ${outletChoiceList(s)}`);
  }
  return outlet;
}

/** Optional outlet on a read path: resolved if named, null if not. */
function optionalOutlet(id, s) {
  return id ? dine.outletById(id, s) : null;
}

/**
 * The guest's usable table, optionally narrowed to one restaurant.
 *
 * Narrowing matters: a guest can hold a table at Rangoli AND at Dolphin, and the
 * bill screen must only ever see the one belonging to the restaurant it is
 * settling.
 */
function myReservation(ctx, s, outletId = null) {
  if (!ctx.user) return null;
  return dine.activeReservationFor(ctx.user.id, s, Date.now(), outletId);
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
function reservationForBill(ctx, body, s, outlet = null) {
  if (!ctx.user) return null;
  if (body.reservationId) {
    const found = db.byId('dineReservations', body.reservationId);
    if (!found || found.userId !== ctx.user.id) {
      throw new HttpError(404, 'Reservation not found');
    }
    /* An explicitly named reservation is returned even when it belongs to the
       other restaurant — `resolveTier` then downgrades it and says why, which is
       far more use to the guest than pretending they have no booking at all. */
    return dine.decorateReservation(found, s);
  }
  /* Auto-pick prefers the restaurant being billed, so a Dolphin bill never
     quietly consumes the table held at Rangoli. */
  const here = myReservation(ctx, s, outlet ? outlet.id : null);
  if (here || !outlet) return here;

  /* No table at THIS restaurant. Before settling for a plain walk-in, look for
     one at the other: if the guest is holding a Rangoli table and paying at
     Dolphin, `resolveTier` can then explain where their 30% went instead of
     leaving them to wonder why the app forgot their booking. */
  return myReservation(ctx, s, null);
}

/**
 * Everything a quote or a payment needs, priced and tier-resolved together so
 * the preview the guest sees is produced by the same code path that charges them.
 */
function resolveBillRequest(ctx, body, s, { outletRequired = false } = {}) {
  /* The bill total is declared by the guest, so it is bounded on both sides:
     a junk or astronomical figure would otherwise be persisted and summed into
     the admin revenue figures. */
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

  /* Paying requires naming the restaurant; a price preview does not, so the bill
     screen can still show a figure the moment an amount is typed. */
  const outlet = outletRequired
    ? requireOutlet(body.outletId, s, 'paying')
    : optionalOutlet(body.outletId, s);

  const reservation = reservationForBill(ctx, body, s, outlet);
  const walkinRequested = body.mode === 'walkin';
  const tier = dine.resolveTier({ reservation, walkinRequested, outlet, s });

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

  return { billAmount, outlet, reservation, tier, offer, amounts };
}

/** Quote/notice payload shared by the quote endpoint and the pay endpoint. */
function quotePayload({ tier, amounts, reservation, outlet }, s) {
  return {
    mode: tier.mode,
    discountPercent: tier.discountPercent,
    locked: tier.locked,
    canPayNow: tier.canPayNow,
    lock: tier.lock,
    walkinFallback: tier.walkinFallback === undefined ? null : tier.walkinFallback,
    /** 'other-outlet' when the guest's table is at the *other* restaurant. */
    downgradedFrom: tier.downgradedFrom || null,
    /** The restaurant being billed, so the screen can keep saying it out loud. */
    outlet: outlet ? dine.publicOutlet(outlet, s) : null,
    /** Where the guest's table actually is, when that is somewhere else. */
    reservedOutlet: tier.reservedOutlet || null,
    notice: dine.tierNotice(tier, s, amounts),
    noticeKind: tier.noticeKind,
    amounts,
    reservation: reservation || null,
    offerApplied: amounts.offerCode,
  };
}

// ── Tab payload ──────────────────────────────────────────────────────────────
/**
 * One call renders the whole tab.
 *
 * The shape leads with `outlets` because that is the first decision a guest has
 * to make and the one they most often do not realise exists. Each entry carries
 * its own hours, its own veg/non-veg mark, and its own answer to "do I have a
 * table here, and what will this bill cost me?" — so the two restaurants can
 * never be rendered as one.
 *
 * Both discount tiers are also described up front (so the "30% with a
 * reservation / 10% walk-in" figures always match live settings). They are
 * venue-wide: the same deal at both restaurants, stated once.
 */
router.get('/dine-in', (ctx) => {
  const s = dine.settings();
  const reservation = ctx.user ? myReservation(ctx, s) : null;

  // Previewed with no bill so the copy is right even before an amount is typed.
  const reservedTier = dine.resolveTier({ reservation, s });

  /** Per-restaurant state: my table there, and the tier a bill there would get. */
  const outletPayload = dine.outlets(s).map((outlet) => {
    const mine = ctx.user ? myReservation(ctx, s, outlet.id) : null;
    const tier = dine.resolveTier({ reservation: mine, outlet, s });
    return Object.assign(dine.publicOutlet(outlet, s), {
      reservation: mine,
      current: {
        mode: tier.mode,
        discountPercent: tier.discountPercent,
        locked: tier.locked,
        canPayNow: tier.canPayNow,
        lock: tier.lock,
        notice: dine.tierNotice(tier, s),
        noticeKind: tier.noticeKind,
      },
    });
  });

  const recentBills = ctx.user
    ? db
        .find('dineBills', (b) => b.userId === ctx.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        // Every past bill is re-labelled with the restaurant it was rung up at.
        .map((b) => Object.assign({}, b, { outlet: dine.outletOf(b, s) }))
    : [];

  return {
    settings: dine.publicSettings(s),
    /** The resort. Never a restaurant name — that is what `outlets` is for. */
    venue: {
      name: s.venueName,
      tagline: s.tagline,
      address: s.address,
      phone: s.phone,
      rating: s.rating || 0,
      reviewCount: s.reviewCount || 0,
      coverPhoto: s.coverPhoto || '',
      photos: s.photos || [],
      amenities: s.amenities || [],
      policies: s.policies || [],
    },
    outlets: outletPayload,
    /**
     * The two tiers, exactly as the admin has configured them. Venue-wide, and
     * flagged as such so the tab can say "same deal at both restaurants" — the
     * guest's choice of restaurant is about what they want to eat, never about
     * chasing a better discount.
     */
    tiers: {
      sharedAcrossOutlets: true,
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
    /**
     * The soonest usable table across both restaurants. Kept for callers that
     * only want "do I have a booking at all" — anything that acts on a table
     * should read it off `outlets[].reservation`, which cannot be ambiguous.
     */
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
/**
 * Availability at ONE restaurant. The two keep separate seat pools and separate
 * hours, so the answer is meaningless without an outlet — and the outlet is
 * echoed back, so a screen can never draw Rangoli's breakfast slots under a
 * Dolphin heading.
 */
router.get('/dine-in/slots', (ctx) => {
  const s = activeSettings();
  const outlet = requireOutlet(ctx.query.outletId, s, 'booking');
  const date = ctx.query.date || dine.today();
  return {
    outlet: dine.publicOutlet(outlet, s),
    date,
    slotMinutes: s.slotMinutes,
    slots: dine.slotsFor(date, outlet, s),
  };
});

// ── Reservations ─────────────────────────────────────────────────────────────
router.get('/dine-in/reservations', auth.requireAuth, (ctx) => {
  const s = dine.settings();
  const list = db
    .find('dineReservations', (r) => r.userId === ctx.user.id)
    .map((r) => dine.decorateReservation(r, s))
    .sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  return {
    count: list.length,
    reservations: list,
    /** So a list screen can group by restaurant without a second call. */
    outlets: dine.outlets(s).map((o) => dine.publicOutlet(o, s)),
  };
});

router.post('/dine-in/reservations', auth.requireAuth, (ctx) => {
  const s = activeSettings();
  const body = ctx.body || {};

  /* Which restaurant, first and without a default. A table is a physical seat in
     one of two dining rooms, and one of them serves no meat at all — there is no
     safe guess to make here. */
  const outlet = requireOutlet(body.outletId, s, 'booking');

  const date = String(body.date || '');
  if (!dine.parseKey(date)) throw new HttpError(400, 'Pick a valid date for your reservation');
  if (date < dine.today()) throw new HttpError(400, 'That date has already passed');

  const maxDate = dine.dateKey(
    new Date(Date.now() + Math.max(0, Number(s.advanceDays) || 0) * 24 * 60 * 60 * 1000)
  );
  if (date > maxDate) throw new HttpError(400, `Tables can only be reserved up to ${s.advanceDays} days ahead`);

  const time = String(body.time || '');
  const slot = dine.slotsFor(date, outlet, s).find((x) => x.time === time);
  if (!slot) {
    throw new HttpError(
      400,
      `${outlet.name} has no table at that time — it serves ${outlet.openTime}–${outlet.closeTime}`
    );
  }

  const partySize = Math.round(Number(body.partySize) || 0);
  if (!partySize || partySize < 1) throw new HttpError(400, 'How many guests are coming?');
  if (partySize > s.maxPartySize) {
    throw new HttpError(400, `For parties over ${s.maxPartySize}, please call ${outlet.phone || s.phone} instead`);
  }
  if (partySize > slot.seatsLeft) {
    throw new HttpError(
      400,
      `Only ${slot.seatsLeft} seat(s) left at ${outlet.name} for ${slot.label} — try another slot`
    );
  }

  const guestName = String(body.guestName || ctx.user.name || '').trim().slice(0, 80);
  if (!guestName) throw new HttpError(400, 'Enter the name we should hold the table under');
  const guestPhone = String(body.guestPhone || ctx.user.phone || '').trim().slice(0, 20);

  // Seating areas belong to the outlet — Dolphin has a rooftop, Rangoli does not.
  const area = outlet.areas.includes(body.area) ? body.area : outlet.areas[0] || '';
  const reservedAt = new Date().toISOString();
  const startsAt = dine.stampFor(date, time);

  const reservation = db.insert('dineReservations', {
    id: db.id('dres'),
    reference: db.reference('DR'),
    userId: ctx.user.id,
    status: 'confirmed',
    /** Which of the two restaurants this table is in. */
    outletId: outlet.id,
    /**
     * Frozen name + diet mark. The live outlet is the source of truth for
     * display, but a guest's own record of "I booked the pure-veg one" must
     * survive a later rename.
     */
    outlet: dine.outletStamp(outlet),
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

  /* The notification names the restaurant and its diet mark, because this is
     often the only place a guest re-reads which one they picked. */
  notify(
    ctx.user.id,
    `Table reserved at ${outlet.name} 🍽️`,
    `${partySize} guest(s) at ${outlet.name} (${dine.diet(outlet.diet).label}) — ${s.venueName}, ` +
      `${date} at ${slot.label}. In-app billing with ${s.reservedDiscountPercent}% off unlocks at ` +
      `${decorated.lock.unlockLabel}. This discount applies to your ${outlet.name} bill only.`,
    'booking'
  );

  ctx.state.status = 201;
  return {
    reservation: decorated,
    outlet: dine.publicOutlet(outlet, s),
    settings: dine.publicSettings(s),
  };
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
  const where = dine.outletOf(reservation);
  notify(
    ctx.user.id,
    'Reservation cancelled',
    `Your table${where ? ` at ${where.name}` : ''} on ${reservation.date} at ${reservation.time} was cancelled.`,
    'booking'
  );
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
  /* `outletRequired` is the whole point: money must be attributed to the kitchen
     that cooked the food, and only the guest knows which one that was. */
  const { billAmount, outlet, reservation, tier, amounts } = resolveBillRequest(ctx, body, s, {
    outletRequired: true,
  });

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

  const payment = paymentRecord(body.payment, amounts.total);

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
    /** Which of the two restaurants this money belongs to. */
    outletId: outlet.id,
    outlet: dine.outletStamp(outlet),
    /**
     * The restaurant's own name, frozen. This field used to hold an invented
     * venue-wide "Kingfisher Restaurant", which told a guest reading their
     * receipt nothing about where they had eaten.
     */
    restaurantName: outlet.name,
    venueName: s.venueName,
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

  notify(
    ctx.user.id,
    payment.status === 'paid' ? `Bill paid at ${outlet.name} 🍽️` : `Bill ready at ${outlet.name}'s counter 🍽️`,
    `${dine.money(amounts.total)} ${payment.status === 'paid' ? 'paid' : 'due'} at ${outlet.name} ` +
      `(${dine.diet(outlet.diet).label}), ${s.venueName} — you saved ${dine.money(amounts.discount)} ` +
      `(${amounts.effectivePercent}% off ${dine.money(billAmount)}).`,
    'payment'
  );

  ctx.state.status = 201;
  return {
    bill: Object.assign({}, bill, {
      notice: dine.paidNotice(bill, s),
      outlet: dine.outletOf(bill, s),
    }),
  };
});

router.get('/dine-in/bills', auth.requireAuth, (ctx) => {
  const s = dine.settings();
  const list = db
    .find('dineBills', (b) => b.userId === ctx.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((b) => Object.assign({}, b, { outlet: dine.outletOf(b, s) }));
  return {
    count: list.length,
    totalSaved: list.reduce((sum, b) => sum + (b.amounts.discount || 0), 0),
    bills: list,
    /** Per-restaurant totals, so "where does my money go?" is answerable. */
    byOutlet: dine.outlets(s).map((o) => {
      const mine = list.filter((b) => b.outletId === o.id);
      return {
        id: o.id,
        name: o.name,
        diet: o.diet,
        dietLabel: dine.diet(o.diet).label,
        bills: mine.length,
        paid: mine.reduce((sum, b) => sum + (b.amounts.total || 0), 0),
        saved: mine.reduce((sum, b) => sum + (b.amounts.discount || 0), 0),
      };
    }),
  };
});

router.get('/dine-in/bills/:id', auth.requireAuth, (ctx) => {
  const bill = db.byId('dineBills', ctx.params.id);
  if (!bill) throw new HttpError(404, 'Bill not found');
  if (bill.userId !== ctx.user.id && ctx.user.role !== 'admin') {
    throw new HttpError(403, 'That bill belongs to someone else');
  }
  const s = dine.settings();
  return {
    bill: Object.assign({}, bill, {
      notice: dine.paidNotice(bill, s),
      outlet: dine.outletOf(bill, s),
      venueName: bill.venueName || s.venueName,
    }),
  };
});

module.exports = router;
