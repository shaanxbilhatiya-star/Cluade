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
 * Dine-In restaurant bills. The guest types in the total already printed on
 * their restaurant bill - taxes and service are baked into that figure - so
 * there is nothing to add here, only a percentage to take off.
 *
 * The discount percentage is decided by src/dinein.js (reserved vs walk-in);
 * this function only does the arithmetic, and clamps it so a mis-configured
 * percentage can never produce a negative bill or a discount larger than the
 * bill itself.
 *
 * Like computeHotelTotals(), the result keeps the shared bill keys
 * (discount, total, offerCode, gst, ...) so expand(), the admin bookings table
 * and the receipt view all keep working unchanged.
 *
 * @param {object} input
 * @param {number} input.billAmount        restaurant bill total
 * @param {number} input.discountPercent   0-100
 * @param {number} input.maxDiscountAmount rupee cap on the discount; 0 = uncapped
 */
function computeDineInTotals({ billAmount = 0, discountPercent = 0, maxDiscountAmount = 0 } = {}) {
  const bill = Math.max(0, round(Number(billAmount) || 0));
  const percent = Math.min(100, Math.max(0, Number(discountPercent) || 0));

  let discount = round((bill * percent) / 100);
  const cap = Math.max(0, round(Number(maxDiscountAmount) || 0));
  if (cap > 0) discount = Math.min(discount, cap);
  discount = Math.min(discount, bill);

  const total = Math.max(0, bill - discount);

  return {
    billAmount: bill,
    discountPercent: percent,
    discount,
    total,
    // Effective percentage actually granted, which differs from
    // `discountPercent` whenever maxDiscountAmount clamps the saving.
    effectivePercent: bill ? Math.round((discount / bill) * 1000) / 10 : 0,

    // Shared bill shape: a restaurant bill has no tickets, no per-seat fee and
    // no separate tax line (the bill total is already tax inclusive).
    tickets: 0,
    food: 0,
    convenienceFee: 0,
    gst: 0,
    offerCode: null,
  };
}

module.exports = {
  computeTotals,
  resolveOffer,
  computeHotelTotals,
  resolveHotelOffer,
  computeDineInTotals,
  CONVENIENCE_FEE_PER_SEAT,
  GST_RATE,
  CURRENCY,
};
