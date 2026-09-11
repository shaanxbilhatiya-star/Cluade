'use strict';
/**
 * Dine-In end-to-end test.
 *
 * Spawns the server against a throwaway data directory and proves the two rules
 * the tab exists to enforce:
 *
 *   1. A guest holding a reservation bills at the reserved rate (30% by
 *      default) — but billing against that reservation is REFUSED until the
 *      reservation has been held for `lockMinutes` (30 by default).
 *   2. A guest with no reservation bills instantly at the walk-in rate (10% by
 *      default) and is shown the "book a table ahead next time" notice.
 *
 * It then changes the discounts and the notice wording through the admin API and
 * checks the customer side follows immediately, which is the whole point of
 * making them settings rather than constants.
 *
 *   npm run test:dine-in
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3942;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cineflex-dine-'));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m\u2713\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` \u2014 ${detail}` : ''));
    console.log(`  \x1b[31m\u2717\x1b[0m ${name}${detail ? ` \x1b[31m(${detail})\x1b[0m` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function api(method, endpoint, { token, body } = {}) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: Object.assign(
      body ? { 'Content-Type': 'application/json' } : {},
      token ? { Authorization: `Bearer ${token}` } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { json = null; }
  return { status: res.status, body: json };
}

async function waitForServer(child) {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch (_e) { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not become healthy in time');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** First reservation in the admin ledger that was used to settle a bill. */
function db_findBilledReservation(adminResponse) {
  return (adminResponse.body.reservations || []).find((r) => r.billId) || null;
}

async function run() {
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' });
  delete env.NODE_OPTIONS;

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  child.stdout.on('data', (d) => serverLog.push(d.toString()));
  child.stderr.on('data', (d) => serverLog.push(d.toString()));

  try {
    await waitForServer(child);
    console.log(`\nTesting ${BASE}  (scratch data dir: ${DATA_DIR})`);

    const login = await api('POST', '/api/auth/login', { body: { email: 'andrew@example.com', password: '1234' } });
    const token = login.body.token;
    const adminLogin = await api('POST', '/api/auth/login', { body: { email: 'admin@cineflex.com', password: 'admin123' } });
    const adminToken = adminLogin.body.token;
    if (!token || !adminToken) throw new Error('Could not sign in with the demo accounts');

    // ── Defaults ──────────────────────────────────────────────────────────────
    section('Tab payload & defaults');
    const home = await api('GET', '/api/dine-in', { token });
    check('GET /api/dine-in succeeds', home.status === 200);
    check('reserved tier defaults to 30%', home.body.tiers.reserved.discountPercent === 30, JSON.stringify(home.body?.tiers?.reserved));
    check('walk-in tier defaults to 10%', home.body.tiers.walkin.discountPercent === 10, JSON.stringify(home.body?.tiers?.walkin));
    check('billing lock defaults to 30 minutes', home.body.settings.lockMinutes === 30, `got ${home.body?.settings?.lockMinutes}`);
    check('a guest with no reservation is on the walk-in tier', home.body.current.mode === 'walkin');
    check('health reports the new collections', (await api('GET', '/api/health')).body.counts.dineBills === 0);

    // ── Rule 2: walk-in, instant, 10% ────────────────────────────────────────
    section('Rule 2 \u2014 walk-in pays instantly at 10%');
    const walkQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000 } });
    check('walk-in quote applies 10%',
      walkQuote.body.mode === 'walkin' && walkQuote.body.amounts.discount === 200 && walkQuote.body.amounts.total === 1800,
      JSON.stringify(walkQuote.body?.amounts));
    check('walk-in is payable immediately', walkQuote.body.canPayNow === true && walkQuote.body.locked === false);
    check('walk-in notice says to book at least 30 minutes ahead next time',
      /book a reservation at least 30 minutes ahead/i.test(walkQuote.body.notice || ''), walkQuote.body?.notice);
    check('walk-in notice quotes both live percentages',
      /10% off/.test(walkQuote.body.notice || '') && /30% off instead/.test(walkQuote.body.notice || ''));

    let expectedBills = 0;
    let expectedSaved = 0;
    const walkBill = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 2000, payment: { method: 'upi' }, tableNumber: '7' } });
    check('walk-in bill is accepted right away', walkBill.status === 201, `status ${walkBill.status}: ${walkBill.body?.error}`);
    check('walk-in bill charges 1800 of 2000', walkBill.body.bill.amounts.total === 1800 && walkBill.body.bill.mode === 'walkin');
    check('walk-in receipt repeats the book-ahead advice',
      /Book a table at least 30 minutes/i.test(walkBill.body.bill.notice || ''), walkBill.body?.bill?.notice);
    expectedBills += 1;
    expectedSaved += 200;

    // ── Rule 1: reservation locks billing for 30 minutes ─────────────────────
    section('Rule 1 \u2014 a fresh reservation is locked for 30 minutes');
    const slots = await api('GET', '/api/dine-in/slots', { token });
    check('slots are offered for today', slots.status === 200 && slots.body.slots.length > 0, `got ${slots.body?.slots?.length}`);
    const slot = slots.body.slots[0]; // soonest slot

    /* Billing opens at the LATER of "held long enough" and "the sitting is about
       to start". Widen the sitting window so this section measures the hold rule
       on its own; the section after this one tests the sitting rule on its own. */
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { arriveEarlyMinutes: 1440 } });

    const made = await api('POST', '/api/dine-in/reservations', {
      token,
      body: { date: slots.body.date, time: slot.time, partySize: 4, guestName: 'Andrew Smith', area: 'Garden' },
    });
    check('a table can be reserved', made.status === 201, `status ${made.status}: ${made.body?.error}`);
    const reservation = made.body.reservation;
    check('the new reservation is locked', reservation.lock.locked === true && reservation.billable === false);
    check('lock countdown is ~30 minutes', reservation.lock.minutesLeft > 27 && reservation.lock.minutesLeft <= 30, `got ${reservation.lock?.minutesLeft}`);
    check('blockedReason explains why', reservation.blockedReason === 'locked');

    const lockedQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000 } });
    check('the locked reservation still quotes the 30% tier',
      lockedQuote.body.mode === 'reserved' && lockedQuote.body.discountPercent === 30, JSON.stringify(lockedQuote.body?.mode));
    check('but it reports canPayNow = false', lockedQuote.body.canPayNow === false && lockedQuote.body.locked === true);
    check('locked notice states the 30-minute rule and the unlock time',
      /unlocks 30 minutes after booking/i.test(lockedQuote.body.notice || '') && /Billing opens at/i.test(lockedQuote.body.notice || ''),
      lockedQuote.body?.notice);
    check('locked notice offers the 10% fallback', /pay now at 10% off/i.test(lockedQuote.body.notice || ''));

    const lockedPay = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 2000, payment: { method: 'upi' } } });
    check('paying against a locked reservation is refused (423)', lockedPay.status === 423, `status ${lockedPay.status}: ${lockedPay.body?.error}`);
    check('the refusal names the unlock time', /unlocks at/i.test(lockedPay.body?.error || ''), lockedPay.body?.error);

    const fallbackQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000, mode: 'walkin' } });
    check('a locked guest may still choose the 10% walk-in rate',
      fallbackQuote.body.mode === 'walkin' && fallbackQuote.body.canPayNow === true && fallbackQuote.body.amounts.total === 1800);

    // ── Rule 1 continued: once the window elapses, 30% applies ───────────────
    /* The lock is measured against the clock, so to reach the unlocked state we
       shorten the window rather than wait 30 real minutes. Set DINE_SLOW_TEST=1
       to additionally watch a 1-minute window actually expire in real time. */
    section('Rule 1 \u2014 once the window elapses the reservation bills at 30%');
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 0, arriveEarlyMinutes: 1440 } });
    const unlocked = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000 } });
    check('the reservation is now unlocked',
      unlocked.body.mode === 'reserved' && unlocked.body.locked === false && unlocked.body.canPayNow === true,
      JSON.stringify({ mode: unlocked.body?.mode, locked: unlocked.body?.locked }));
    check('30% is applied: 2000 -> 1400',
      unlocked.body.amounts.discount === 600 && unlocked.body.amounts.total === 1400, JSON.stringify(unlocked.body?.amounts));
    check('the reserved notice is shown instead of the locked one',
      /pay this bill in the app/i.test(unlocked.body.notice || ''), unlocked.body?.notice);

    const reservedPay = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 2000, payment: { method: 'card' } } });
    check('the reserved bill is accepted', reservedPay.status === 201, `status ${reservedPay.status}: ${reservedPay.body?.error}`);
    check('it charges 1400 and records the reserved mode',
      reservedPay.body.bill.amounts.total === 1400 && reservedPay.body.bill.mode === 'reserved');
    check('it is linked to the reservation', reservedPay.body.bill.reservationId === reservation.id);
    check('the receipt notice thanks them for reserving',
      /reserved-table discount/i.test(reservedPay.body.bill.notice || ''), reservedPay.body?.bill?.notice);
    check('the applied terms are frozen on the bill', reservedPay.body.bill.appliedSettings.discountPercent === 30);
    expectedBills += 1;
    expectedSaved += 600;

    const reused = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000 } });
    check('a spent reservation cannot be billed twice (falls back to walk-in)',
      reused.body.mode === 'walkin', JSON.stringify(reused.body?.mode));
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 30, arriveEarlyMinutes: 30 } });

    // The same gate, watched against the real clock on a 1-minute window.
    if (process.env.DINE_SLOW_TEST === '1') {
      section('Rule 1 \u2014 real-clock check (1-minute window)');
      await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 1, arriveEarlyMinutes: 1440 } });
      const slow = await api('POST', '/api/dine-in/reservations', {
        token,
        body: { date: slots.body.date, time: slot.time, partySize: 2, guestName: 'Andrew Smith' },
      });
      check('reservation starts locked', slow.body.reservation.lock.locked === true);
      const beforePay = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 1000, payment: { method: 'upi' } } });
      check('billing is refused inside the window', beforePay.status === 423, `status ${beforePay.status}`);
      console.log('    waiting 65s for the window to expire...');
      await sleep(65000);
      const afterWait = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1000 } });
      check('the lock releases on its own once the window passes',
        afterWait.body.locked === false && afterWait.body.mode === 'reserved' && afterWait.body.amounts.total === 700,
        JSON.stringify({ locked: afterWait.body?.locked, mode: afterWait.body?.mode, total: afterWait.body?.amounts?.total }));
      const afterPay = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 1000, payment: { method: 'upi' } } });
      check('and the bill then goes through at 30%', afterPay.status === 201 && afterPay.body.bill.amounts.total === 700);
      expectedBills += 1;
      expectedSaved += 300;
      await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 30, arriveEarlyMinutes: 30 } });
    }

    // ── The loophole the lock alone does not close ────────────────────────────
    /* Waiting out the lock must not be enough on its own: a guest already at the
       table could otherwise book any far-future slot, wait, and claim the
       reserved rate. Billing only opens near the reserved sitting. */
    section('Reserved rate requires the actual sitting, not just a wait');
    var far = new Date();
    far.setDate(far.getDate() + 6);
    var farDate = far.getFullYear() + '-' + String(far.getMonth() + 1).padStart(2, '0') + '-' +
      String(far.getDate()).padStart(2, '0');
    var farSlots = await api('GET', '/api/dine-in/slots?date=' + farDate, { token });
    var farSlot = farSlots.body.slots[0];
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 0, arriveEarlyMinutes: 30 } });
    var farRes = await api('POST', '/api/dine-in/reservations', {
      token,
      body: { date: farDate, time: farSlot.time, partySize: 2, guestName: 'Andrew Ainsely' },
    });
    check('a far-future table can be reserved', farRes.status === 201, `status ${farRes.status}`);
    check('but it is not billable today even with the lock elapsed',
      farRes.body.reservation.billable === false && farRes.body.reservation.blockedReason === 'locked',
      JSON.stringify({ billable: farRes.body.reservation?.billable, reason: farRes.body.reservation?.blockedReason }));
    var farQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1000, reservationId: farRes.body.reservation.id } });
    check('quoting against it cannot be paid at the reserved rate', farQuote.body.canPayNow === false);
    var farPay = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 1000, reservationId: farRes.body.reservation.id, payment: { method: 'upi' } } });
    check('paying against a far-future reservation is refused', farPay.status === 423, `status ${farPay.status}`);
    await api('POST', '/api/dine-in/reservations/' + farRes.body.reservation.id + '/cancel', { token });
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 30 } });

    // ── Cross-user access ────────────────────────────────────────────────────
    section('Cross-user access');
    var other = await api('POST', '/api/auth/register', {
      body: { name: 'Other Guest', email: 'other-dine-' + Date.now() + '@example.com', password: '1234', phone: '+91 90000 00000' },
    });
    var otherToken = other.body.token;
    var mineAgain = await api('GET', '/api/dine-in/reservations', { token });
    var someReservation = (mineAgain.body.reservations || [])[0];
    if (someReservation) {
      var poke = await api('POST', '/api/dine-in/quote', { token: otherToken, body: { billAmount: 1000, reservationId: someReservation.id } });
      check("another guest cannot quote against someone else's reservation", poke.status === 404, `status ${poke.status}`);
      var cancelTheirs = await api('POST', '/api/dine-in/reservations/' + someReservation.id + '/cancel', { token: otherToken });
      check("another guest cannot cancel someone else's reservation", cancelTheirs.status === 403, `status ${cancelTheirs.status}`);
    }
    var theirBill = await api('GET', '/api/dine-in/bills/' + reservedPay.body.bill.id, { token: otherToken });
    check("another guest cannot read someone else's receipt", theirBill.status === 403, `status ${theirBill.status}`);
    var anonQuote = await api('POST', '/api/dine-in/quote', { body: { billAmount: 1000, reservationId: reservation.id } });
    check('an anonymous quote ignores a reservation id instead of crashing',
      anonQuote.status === 200 && anonQuote.body.mode === 'walkin', `status ${anonQuote.status}`);

    // ── Amount bounds ────────────────────────────────────────────────────────
    section('Bill amount is bounded on both sides');
    var huge = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1e21 } });
    check('an astronomical bill is rejected', huge.status === 400, `status ${huge.status}`);
    var overMax = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 500000 } });
    check('a bill over the configured maximum is rejected', overMax.status === 400 && /counter/i.test(overMax.body?.error || ''));
    var arrayAmount = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: [500] } });
    check('a non-scalar amount is rejected', arrayAmount.status === 400, `status ${arrayAmount.status}`);
    var boolAmount = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: true } });
    check('a boolean amount is rejected', boolAmount.status === 400, `status ${boolAmount.status}`);

    // ── Client cannot dictate the money ──────────────────────────────────────
    section('The client cannot dictate the discount');
    var spoof = await api('POST', '/api/dine-in/quote', {
      token,
      body: { billAmount: 1000, discountPercent: 90, amounts: { total: 1 }, mode: 'walkin' },
    });
    check('a client-supplied percentage is ignored',
      spoof.body.discountPercent === 10 && spoof.body.amounts.total === 900, JSON.stringify(spoof.body?.amounts));

    // ── Admin control ────────────────────────────────────────────────────────
    section('Admin controls the discounts and the notices');
    const adminView = await api('GET', '/api/admin/dine-in', { token: adminToken });
    check('admin can read settings, ledgers and previews',
      adminView.status === 200 && adminView.body.settings.reservedDiscountPercent === 30 &&
      adminView.body.bills.length === expectedBills && adminView.body.reservations.length >= 1,
      `bills ${adminView.body?.bills?.length}, reservations ${adminView.body?.reservations?.length}`);
    check('bills are attributed to a customer', adminView.body.bills[0].customerName === 'Andrew Ainsely',
      adminView.body.bills[0]?.customerName);
    check('admin sees the token list for notices', adminView.body.noticeTokens.includes('reservedDiscount'));
    check('admin sees a rendered preview of each notice',
      /30%/.test(adminView.body.previews.reserved) && /10%/.test(adminView.body.previews.walkin));
    check('dashboard stats include dine-in',
      (await api('GET', '/api/admin/stats', { token: adminToken })).body.dine.bills === expectedBills);

    const changed = await api('PUT', '/api/admin/dine-in/settings', {
      token: adminToken,
      body: { reservedDiscountPercent: 40, walkinDiscountPercent: 15, lockMinutes: 45 },
    });
    check('admin can change both discounts and the lock window',
      changed.status === 200 && changed.body.settings.reservedDiscountPercent === 40 &&
      changed.body.settings.walkinDiscountPercent === 15 && changed.body.settings.lockMinutes === 45);

    const afterChange = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000 } });
    check('the customer is charged the new 15% walk-in rate at once',
      afterChange.body.discountPercent === 15 && afterChange.body.amounts.total === 1700, JSON.stringify(afterChange.body?.amounts));
    check('the notice re-renders with the new numbers',
      /15% off/.test(afterChange.body.notice) && /40% off instead/.test(afterChange.body.notice) &&
      /45 minutes ahead/.test(afterChange.body.notice), afterChange.body?.notice);

    const rewritten = await api('PUT', '/api/admin/dine-in/settings', {
      token: adminToken,
      body: { walkinNotice: 'Today: {walkinDiscount}% off. Reserve {lockMinutes} min ahead for {reservedDiscount}%.' },
    });
    check('admin can rewrite the notice text', rewritten.status === 200);
    const customQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1000 } });
    check('the customer sees the admin-authored notice with tokens filled in',
      customQuote.body.notice === 'Today: 15% off. Reserve 45 min ahead for 40%.', customQuote.body?.notice);

    const reset = await api('POST', '/api/admin/dine-in/notices/reset', { token: adminToken });
    check('notices can be reset to the shipped wording',
      /book a reservation at least/i.test(reset.body.settings.walkinNotice));
    check('resetting notices leaves the numbers alone', reset.body.settings.walkinDiscountPercent === 15);

    const capped = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { reservedDiscountPercent: 30, walkinDiscountPercent: 10, lockMinutes: 30, maxDiscountAmount: 300 } });
    check('a rupee cap can be set on the instant discount', capped.body.settings.maxDiscountAmount === 300);
    const cappedQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 2000 } });
    check('the cap is honoured: 10% of 2000 is 200, under the 300 cap', cappedQuote.body.amounts.discount === 200);
    const bigQuote = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 6000 } });
    check('the cap bites on a larger bill: 10% of 6000 capped to 300', bigQuote.body.amounts.discount === 300, JSON.stringify(bigQuote.body?.amounts));

    // A coupon must not be able to walk past the cap the admin set.
    await api('POST', '/api/admin/offers', {
      token: adminToken,
      body: { title: 'Dine Test', code: 'DINETEST', discountType: 'percent', discountValue: 100, appliesTo: 'dinein' },
    });
    const stacked = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 6000, offerCode: 'DINETEST' } });
    check('a stacked coupon cannot exceed the total discount cap',
      stacked.body.amounts.discount === 300 && stacked.body.amounts.total === 5700, JSON.stringify(stacked.body?.amounts));
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { maxDiscountAmount: 0 } });
    const uncapped = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1000, offerCode: 'DINETEST' } });
    check('with no cap the coupon applies to what is left after the tier discount',
      uncapped.body.amounts.instantDiscount === 100 && uncapped.body.amounts.offerDiscount === 900 &&
      uncapped.body.amounts.total === 0, JSON.stringify(uncapped.body?.amounts));

    // ── Guards ───────────────────────────────────────────────────────────────
    section('Validation & access control');
    const clamped = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { reservedDiscountPercent: 250 } });
    check('an out-of-range discount is clamped to 100', clamped.body.settings.reservedDiscountPercent === 100);
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { reservedDiscountPercent: 30 } });

    const badBasis = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockBasis: 'whenever' } });
    check('an unknown lockBasis is rejected', badBasis.status === 400);

    // Cross-field guards: combinations that would produce an unclaimable deal.
    const inverted2 = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { walkinDiscountPercent: 80 } });
    check('a walk-in discount above the reserved one is rejected',
      inverted2.status === 400 && /reason to book ahead/i.test(inverted2.body?.error || ''), `status ${inverted2.status}`);
    const deadEnd = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { lockMinutes: 1200, graceHours: 0, arriveEarlyMinutes: 0 } });
    check('a lock that cannot fit inside the billing window is rejected',
      deadEnd.status === 400 && /billing window/i.test(deadEnd.body?.error || ''), `status ${deadEnd.status}`);
    const badTime = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { openTime: '25:99' } });
    check('an invalid opening time is rejected', badTime.status === 400);
    const inverted = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { openTime: '22:00', closeTime: '10:00' } });
    check('closing before opening is rejected', inverted.status === 400);

    const asCustomer = await api('PUT', '/api/admin/dine-in/settings', { token, body: { reservedDiscountPercent: 99 } });
    check('a customer cannot change the discounts', asCustomer.status === 403, `status ${asCustomer.status}`);
    const anon = await api('POST', '/api/dine-in/bills', { body: { billAmount: 500 } });
    check('paying a bill requires sign-in', anon.status === 401, `status ${anon.status}`);
    const zero = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 0 } });
    check('a zero bill is rejected', zero.status === 400);
    const negative = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: -500 } });
    check('a negative bill is rejected', negative.status === 400);

    const minimum = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { minBillAmount: 500 } });
    check('a minimum bill can be configured', minimum.body.settings.minBillAmount === 500);
    const tooSmall = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 200 } });
    check('a bill under the minimum is rejected', tooSmall.status === 400 && /cannot be paid/i.test(tooSmall.body?.error || ''));
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { minBillAmount: 0 } });

    const otherReservation = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1000, reservationId: 'dres_nope' } });
    check('an unknown reservation id is a 404', otherReservation.status === 404);

    const bigParty = await api('POST', '/api/dine-in/reservations', {
      token,
      body: { date: slots.body.date, time: slot.time, partySize: 999, guestName: 'Andrew' },
    });
    check('an oversized party is rejected with the phone number', bigParty.status === 400 && /please call/i.test(bigParty.body?.error || ''));
    const pastDate = await api('POST', '/api/dine-in/reservations', {
      token,
      body: { date: '2020-01-01', time: slot.time, partySize: 2, guestName: 'Andrew' },
    });
    check('a past date is rejected', pastDate.status === 400);

    const disabled = await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { active: false } });
    check('the whole tab can be switched off', disabled.body.settings.active === false);
    const whileOff = await api('POST', '/api/dine-in/quote', { token, body: { billAmount: 1000 } });
    check('quotes are refused while the tab is off (503)', whileOff.status === 503, `status ${whileOff.status}`);
    await api('PUT', '/api/admin/dine-in/settings', { token: adminToken, body: { active: true } });

    // ── Pay at the counter ───────────────────────────────────────────────────
    /* 'cash' is money not yet collected, so the bill must not claim to be paid. */
    section('Pay at the counter is not settled money');
    const cashBill = await api('POST', '/api/dine-in/bills', { token, body: { billAmount: 1000, payment: { method: 'cash' } } });
    check('a counter bill is accepted', cashBill.status === 201, `status ${cashBill.status}`);
    check('but its status is pending, not paid',
      cashBill.body.bill.status === 'pending' && cashBill.body.bill.payment.status === 'pending',
      JSON.stringify({ bill: cashBill.body.bill?.status, payment: cashBill.body.bill?.payment?.status }));
    check('and no loyalty points are minted', cashBill.body.pointsEarned === undefined);
    expectedBills += 1;
    expectedSaved += cashBill.body.bill.amounts.discount;

    // ── Admin ledger guards ──────────────────────────────────────────────────
    section('Admin ledger guards');
    const billedRes = db_findBilledReservation(await api('GET', '/api/admin/dine-in', { token: adminToken }));
    if (billedRes) {
      const delBilled = await api('DELETE', '/api/admin/dine-in/reservations/' + billedRes.id, { token: adminToken });
      check('a reservation that settled a bill cannot be deleted', delBilled.status === 400, `status ${delBilled.status}`);
      check('and it reports itself as billed, not cancelled', billedRes.blockedReason === 'already-billed',
        billedRes.blockedReason);
    } else {
      check('a reservation that settled a bill cannot be deleted', false, 'no billed reservation found');
    }

    // ── Receipts ─────────────────────────────────────────────────────────────
    section('Receipts');
    const bills = await api('GET', '/api/dine-in/bills', { token });
    check('a guest can list their bills', bills.status === 200 && bills.body.bills.length === expectedBills);
    check('total saved is reported', bills.body.totalSaved === expectedSaved, `got ${bills.body?.totalSaved}, expected ${expectedSaved}`);
    const one = await api('GET', `/api/dine-in/bills/${reservedPay.body.bill.id}`, { token });
    check('a single receipt is retrievable with its notice', one.status === 200 && Boolean(one.body.bill.notice));
  } catch (err) {
    failed += 1;
    failures.push(`Harness error: ${err.message}`);
    console.error('\n\x1b[31mHarness error:\x1b[0m', err);
    if (serverLog.length) console.error('\nServer output:\n' + serverLog.join(''));
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_e) {}
  }

  console.log(`\n${'\u2500'.repeat(56)}`);
  console.log(`  \x1b[32m${passed} passed\x1b[0m` + (failed ? `,  \x1b[31m${failed} failed\x1b[0m` : ',  0 failed'));
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  \u2022 ${f}`));
  }
  console.log('');
  process.exit(failed ? 1 : 0);
}

run();
