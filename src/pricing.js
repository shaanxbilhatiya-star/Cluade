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

module.exports = { computeTotals, resolveOffer, CONVENIENCE_FEE_PER_SEAT, GST_RATE, CURRENCY };
