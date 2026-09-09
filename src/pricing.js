'use strict';
/**
 * Single source of truth for money. The checkout API and the seeder both use
 * this, so demo data and live bookings are always priced the same way.
 * All amounts are integers in the smallest sensible unit (whole rupees).
 */
const CONVENIENCE_FEE_PER_SEAT = 30;
const GST_RATE = 0.18; // GST applies to the convenience fee only
const CURRENCY = { code: 'INR', symbol: '\u20B9', locale: 'en-IN' };

// Money is kept in whole rupees end to end - no fractional paise anywhere,
// so the figure on the ticket always matches the sum of its parts exactly.
function round(n) {
  return Math.round(n);
}

/**
 * @param {object} input
 * @param {Array<{price:number}>} input.seats
 * @param {Array<{price:number, qty:number}>} input.food
 * @param {object|null} input.offer
 * @returns {{tickets:number, food:number, convenienceFee:number, gst:number, discount:number, total:number, offerCode:string|null}}
 */
function computeTotals({ seats = [], food = [], offer = null } = {}) {
  const tickets = seats.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  const foodTotal = food.reduce((sum, f) => sum + (Number(f.price) || 0) * (Number(f.qty) || 0), 0);
  const convenienceFee = seats.length * CONVENIENCE_FEE_PER_SEAT;
  const gst = round(convenienceFee * GST_RATE);

  let discount = 0;
  if (offer) {
    const base =
      offer.appliesTo === 'food' ? foodTotal : offer.appliesTo === 'tickets' ? tickets : tickets + foodTotal;
    if (base >= (offer.minAmount || 0)) {
      discount =
        offer.discountType === 'percent'
          ? Math.min(Math.round((base * offer.discountValue) / 100), offer.maxDiscount || Infinity)
          : Math.min(offer.discountValue, offer.maxDiscount || Infinity);
      discount = Math.min(discount, base);
    }
  }

  const total = Math.max(0, round(tickets + foodTotal + convenienceFee + gst - discount));

  return {
    tickets,
    food: foodTotal,
    convenienceFee,
    gst,
    discount,
    total,
    offerCode: offer && discount > 0 ? offer.code : null,
  };
}

/** Validates an offer code against the current cart. Returns null when unusable. */
function resolveOffer(offers, code, { seats = [], food = [] } = {}) {
  if (!code) return null;
  const offer = offers.find((o) => o.code.toUpperCase() === String(code).toUpperCase() && o.active !== false);
  if (!offer) return null;
  const preview = computeTotals({ seats, food, offer });
  return preview.discount > 0 ? offer : null;
}

/**
 * Hotel stays price per room-night, so they get their own calculation rather
 * than being forced through computeTotals() (which charges a per-seat
 * convenience fee and would bill a room as if it were zero seats).
 *
 * Taxes & fees are a flat per-room-night amount held on the room record, which
 * is how the rate is quoted on the listing ("+₹131 taxes & fees Per Night").
 *
 * The returned object intentionally keeps the same keys the movie/food bill
 * uses (discount, total, offerCode, gst) so `expand()`, the admin bookings
 * table and the ticket bill all keep working unchanged.
 *
 * @param {object} input
 * @param {number} input.ratePerNight   discounted nightly rate actually charged
 * @param {number} input.mrpPerNight    pre-discount rack rate, for "you saved"
 * @param {number} input.taxesPerNight  flat taxes & fees per room-night
 * @param {number} input.nights         number of nights (>= 1)
 * @param {number} input.rooms          number of rooms (>= 1)
 * @param {object|null} input.offer     coupon, applied to the room charge only
 */
function computeHotelTotals({
  ratePerNight = 0,
  mrpPerNight = 0,
  taxesPerNight = 0,
  nights = 1,
  rooms = 1,
  offer = null,
} = {}) {
  const nightCount = Math.max(1, Math.round(Number(nights) || 1));
  const roomCount = Math.max(1, Math.round(Number(rooms) || 1));
  const roomNights = nightCount * roomCount;

  const rate = Math.max(0, round(Number(ratePerNight) || 0));
  const mrp = Math.max(0, round(Number(mrpPerNight) || 0));
  const roomCharge = rate * roomNights;
  const rackCharge = mrp * roomNights;
  const taxes = Math.max(0, round(Number(taxesPerNight) || 0)) * roomNights;

  let discount = 0;
  if (offer) {
    // Coupons discount the room charge; taxes & fees are never discounted.
    if (roomCharge >= (offer.minAmount || 0)) {
      discount =
        offer.discountType === 'percent'
          ? Math.min(Math.round((roomCharge * offer.discountValue) / 100), offer.maxDiscount || Infinity)
          : Math.min(offer.discountValue, offer.maxDiscount || Infinity);
      discount = Math.min(discount, roomCharge);
    }
  }

  const total = Math.max(0, round(roomCharge + taxes - discount));

  return {
    nights: nightCount,
    rooms: roomCount,
    roomNights,
    ratePerNight: rate,
    mrpPerNight: mrp,
    taxesPerNight: Math.max(0, round(Number(taxesPerNight) || 0)),
    roomCharge,
    rackCharge,
    // Savings against the rack rate, shown as "You saved ₹x" on the listing.
    rackSavings: Math.max(0, rackCharge - roomCharge),
    taxes,
    discount,
    total,
    offerCode: offer && discount > 0 ? offer.code : null,

    // Shared bill shape: a stay has no tickets, no food and no per-seat fee,
    // and its "gst" line is the taxes & fees block.
    tickets: 0,
    food: 0,
    convenienceFee: 0,
    gst: taxes,
  };
}

/** Offer codes usable on a stay: appliesTo 'hotel' (or 'all'). */
function resolveHotelOffer(offers, code, { ratePerNight, mrpPerNight, taxesPerNight, nights, rooms } = {}) {
  if (!code) return null;
  const offer = offers.find(
    (o) =>
      o.code.toUpperCase() === String(code).toUpperCase() &&
      o.active !== false &&
      (o.appliesTo === 'hotel' || o.appliesTo === 'all')
  );
  if (!offer) return null;
  const preview = computeHotelTotals({ ratePerNight, mrpPerNight, taxesPerNight, nights, rooms, offer });
  return preview.discount > 0 ? offer : null;
}

/**
 * A dine-in bill is the restaurant's own total, so there is nothing to price up
 * from parts - the job here is applying the instant discount tier the guest
 * qualified for (30% with a held reservation, 10% as a walk-in) and, optionally,
 * a coupon on top of it.
 *
 * Like computeHotelTotals() this keeps the shared bill keys so anything that
 * renders a generic bill breakdown keeps working.
 *
 * @param {object} input
 * @param {number} input.billAmount       the bill printed by the restaurant
 * @param {number} input.discountPercent  the tier's percentage off
 * @param {number} input.maxDiscount      rupee cap on the instant discount (0 = uncapped)
 * @param {object|null} input.offer       coupon, applied after the tier discount
 */
function computeDineTotals({ billAmount = 0, discountPercent = 0, maxDiscount = 0, offer = null } = {}) {
  const bill = Math.max(0, round(Number(billAmount) || 0));
  const percent = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const cap = Math.max(0, round(Number(maxDiscount) || 0));

  let instantDiscount = round((bill * percent) / 100);
  if (cap > 0) instantDiscount = Math.min(instantDiscount, cap);
  instantDiscount = Math.min(instantDiscount, bill);

  // A coupon stacks on top, but only on what is still payable, so the two
  // discounts can never combine to more than the bill itself.
  let offerDiscount = 0;
  if (offer) {
    const remaining = bill - instantDiscount;
    // The coupon's own minimum is judged on the same base it is applied to.
    if (remaining >= (offer.minAmount || 0)) {
      offerDiscount =
        offer.discountType === 'percent'
          ? Math.min(round((remaining * offer.discountValue) / 100), offer.maxDiscount || Infinity)
          : Math.min(offer.discountValue, offer.maxDiscount || Infinity);
      offerDiscount = Math.min(offerDiscount, remaining);
    }
  }

  // The cap is what the admin form calls "maximum discount per bill", so it has
  // to bound the tier and the coupon together rather than just the tier.
  if (cap > 0 && instantDiscount + offerDiscount > cap) {
    offerDiscount = Math.max(0, cap - instantDiscount);
  }

  const discount = instantDiscount + offerDiscount;
  const total = Math.max(0, round(bill - discount));

  return {
    billAmount: bill,
    discountPercent: percent,
    instantDiscount,
    offerDiscount,
    discount,
    total,
    offerCode: offer && offerDiscount > 0 ? offer.code : null,
    /** Effective percentage actually taken off, for the "you saved" line. */
    effectivePercent: bill > 0 ? Math.round((discount / bill) * 100) : 0,

    // Shared bill shape: the whole amount is food, with no fees or taxes added
    // on top because the restaurant's bill already includes them.
    tickets: 0,
    food: bill,
    convenienceFee: 0,
    gst: 0,
  };
}

/** Offer codes usable on a dine-in bill: appliesTo 'dinein' (or 'all'). */
function resolveDineOffer(offers, code, { billAmount, discountPercent, maxDiscount } = {}) {
  if (!code) return null;
  const offer = offers.find(
    (o) =>
      o.code.toUpperCase() === String(code).toUpperCase() &&
      o.active !== false &&
      (o.appliesTo === 'dinein' || o.appliesTo === 'all')
  );
  if (!offer) return null;
  const preview = computeDineTotals({ billAmount, discountPercent, maxDiscount, offer });
  return preview.offerDiscount > 0 ? offer : null;
}

module.exports = {
  computeTotals,
  resolveOffer,
  computeHotelTotals,
  resolveHotelOffer,
  computeDineTotals,
  resolveDineOffer,
  CONVENIENCE_FEE_PER_SEAT,
  GST_RATE,
  CURRENCY,
};
