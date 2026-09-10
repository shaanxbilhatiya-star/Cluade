'use strict';
/**
 * Water park end-to-end test.
 *
 * Spawns the server against a throwaway data directory and proves the things
 * the tab exists to get right:
 *
 *   1. The poster's arithmetic. Package A is worth 2,450, sells for 1,499 and
 *      saves 951; Package B is worth 3,200, sells for 1,799 and saves 1,401 —
 *      and every one of those numbers is computed from the rate card, so
 *      editing a rate moves the value, the total AND the saving together.
 *   2. Individual booking. A guest can build the same day out person by person
 *      with every quantity editable, priced at counter rates, saving nothing —
 *      which is what makes the package a visible deal rather than a claim.
 *   3. Nobody gets through the gate without an entry ticket, no package can be
 *      sold with fewer entry tickets than guests, and a full slot is refused.
 *
 * It then edits prices through the admin API and checks the customer side
 * follows immediately, which is the whole point of these being settings rather
 * than constants.
 *
 *   npm run test:waterpark
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3944;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cineflex-park-'));

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

/** Finds a package in a catalogue payload by its printed code (A / B). */
function byCode(list, code) {
  return (list || []).find((p) => p.code === code) || null;
}

/** The value of one line of a package's breakup. */
function line(pkg, itemId) {
  return (pkg.lines || []).find((l) => l.itemId === itemId) || null;
}

/** A date key N days from today, used to test slots away from "now". */
function futureKeyFor(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

    /* Past slots are dropped for today, so a suite that books "today" would
       stop working after closing time — which is real behaviour, not a bug, but
       it makes the run depend on the wall clock. Widening the opening hours
       first means there is always a slot left today whatever time this runs. */
    const wideHours = await api('PUT', '/api/admin/waterpark/settings', {
      token: adminToken,
      body: { openTime: '00:00', closeTime: '23:59', slotMinutes: 60 },
    });
    if (wideHours.status !== 200) throw new Error(`could not widen the park hours: ${wideHours.body?.error}`);

    // ── The poster ────────────────────────────────────────────────────────────
    section('The poster \u2014 both packages price exactly as printed');
    const tab = await api('GET', '/api/waterpark');
    check('GET /api/waterpark succeeds', tab.status === 200, `status ${tab.status}`);
    check('health reports the new collection', (await api('GET', '/api/health')).body.counts.waterparkBookings === 0);

    const packA = byCode(tab.body.catalogue.packages, 'A');
    const packB = byCode(tab.body.catalogue.packages, 'B');
    check('Package A is on sale', Boolean(packA));
    check('Package B is on sale', Boolean(packB));

    check('A: 2 adults + 1 child = 3 guests', packA.guests === 3 && packA.adults === 2 && packA.children === 1);
    check('A: adult entry is 2 x 550 = 1,100',
      line(packA, 'entry-adult').qty === 2 && line(packA, 'entry-adult').rate === 550 && line(packA, 'entry-adult').value === 1100,
      JSON.stringify(line(packA, 'entry-adult')));
    check('A: child entry is 1 x 350 = 350', line(packA, 'entry-child').value === 350);
    check('A: costume is 3 x 100 = 300', line(packA, 'costume').value === 300);
    check('A: movie ticket is 3 x 150 = 450', line(packA, 'movie-ticket').value === 450);
    check('A: kids jumping is 1 x 100 = 100', line(packA, 'kids-jumping').value === 100);
    check('A: welcome drink is 3 x 50 = 150', line(packA, 'welcome-drink').value === 150);
    check('A: TOTAL ACTUAL VALUE is 2,450', packA.actualValue === 2450, `got ${packA.actualValue}`);
    check('A: PACKAGE PRICE is 1,499', packA.price === 1499, `got ${packA.price}`);
    check('A: YOU SAVE is 951', packA.saving === 951, `got ${packA.saving}`);

    check('B: 2 adults + 2 children = 4 guests', packB.guests === 4 && packB.adults === 2 && packB.children === 2);
    check('B: adult entry is 2 x 550 = 1,100', line(packB, 'entry-adult').value === 1100);
    check('B: child entry is 2 x 350 = 700', line(packB, 'entry-child').value === 700);
    check('B: costume is 4 x 100 = 400', line(packB, 'costume').value === 400);
    check('B: movie ticket is 4 x 150 = 600', line(packB, 'movie-ticket').value === 600);
    check('B: kids jumping is 2 x 100 = 200', line(packB, 'kids-jumping').value === 200);
    check('B: welcome drink is 4 x 50 = 200', line(packB, 'welcome-drink').value === 200);
    check('B: TOTAL ACTUAL VALUE is 3,200', packB.actualValue === 3200, `got ${packB.actualValue}`);
    check('B: PACKAGE PRICE is 1,799', packB.price === 1799, `got ${packB.price}`);
    check('B: YOU SAVE is 1,401', packB.saving === 1401, `got ${packB.saving}`);

    check('the value breakup sums to the printed total, by construction',
      packA.lines.reduce((s, l) => s + l.value, 0) === packA.actualValue &&
      packB.lines.reduce((s, l) => s + l.value, 0) === packB.actualValue);

    section('Add-ons and inclusions match the poster');
    const addOns = tab.body.catalogue.addOns;
    const priceOf = (id) => (addOns.find((a) => a.id === id) || {}).price;
    check('Fish Spa is 99', priceOf('fish-spa') === 99);
    check('Bull Ride is 99', priceOf('bull-ride') === 99);
    check('Massage Chair (15 min) is 99', priceOf('massage-chair-15') === 99);
    check('Massage Chair (30 min) is 129', priceOf('massage-chair-30') === 129);
    check('Photography is 199', priceOf('photography') === 199);
    check('five inclusions are listed', tab.body.catalogue.inclusions.length === 5, JSON.stringify(tab.body.catalogue.inclusions));
    check('the one-day validity note is published', /one day only/i.test(tab.body.settings.validityNote || ''));

    // ── Quoting ───────────────────────────────────────────────────────────────
    section('Quoting a package');
    const date = tab.body.date;
    check('entry slots are offered for today', tab.body.slots.length > 0, `got ${tab.body.slots.length}`);
    const slot = tab.body.slots[0];

    const qa = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id, date, time: slot.time } });
    check('a package quote charges the package price', qa.body.amounts.total === 1499, JSON.stringify(qa.body.amounts));
    check('and reports the 951 saving', qa.body.amounts.totalSaving === 951 && qa.body.amounts.packageSaving === 951);
    check('and counts 3 guests', qa.body.guests.total === 3);
    check('the notice quotes the live value, price and saving',
      /2,450/.test(qa.body.notice) && /1,499/.test(qa.body.notice) && /951/.test(qa.body.notice), qa.body.notice);

    section('Quoting two packages plus an extra guest and add-ons');
    const qb = await api('POST', '/api/waterpark/quote', {
      body: {
        mode: 'package', packageId: packB.id, packageQty: 2,
        extras: [{ itemId: 'entry-adult', qty: 1 }],
        addOns: [{ id: 'fish-spa', qty: 2 }, { id: 'photography', qty: 1 }],
        date, time: slot.time,
      },
    });
    // 2 x 1,799 = 3,598 + one adult at 550 = 4,148; add-ons 2x99 + 199 = 397
    check('two packages plus one extra adult is 4,148', qb.body.amounts.baseAmount === 4148, JSON.stringify(qb.body.amounts));
    check('add-ons total 397', qb.body.amounts.addOnAmount === 397);
    check('the order totals 4,545', qb.body.amounts.total === 4545);
    check('9 guests are counted (4+4 plus the extra adult)', qb.body.guests.total === 9, JSON.stringify(qb.body.guests));
    check('the extra adult is bought at the counter rate, so it adds no saving',
      qb.body.amounts.packageSaving === 2802, `got ${qb.body.amounts.packageSaving}`);

    // ── Individual booking ────────────────────────────────────────────────────
    section('Individual booking \u2014 per person, everything editable');
    const solo = await api('POST', '/api/waterpark/quote', {
      body: {
        mode: 'individual',
        lines: [
          { itemId: 'entry-adult', qty: 1 },
          { itemId: 'costume', qty: 1 },
          { itemId: 'movie-ticket', qty: 1 },
          { itemId: 'welcome-drink', qty: 1 },
        ],
        date, time: slot.time,
      },
    });
    check('one adult taking everything costs 850', solo.body.amounts.total === 850, JSON.stringify(solo.body.amounts));
    check('an individual booking saves nothing \u2014 it is the counter price',
      solo.body.amounts.packageSaving === 0 && solo.body.amounts.actualValue === solo.body.amounts.baseAmount);
    check('it counts one adult and no children',
      solo.body.guests.adults === 1 && solo.body.guests.children === 0 && solo.body.guests.total === 1);
    check('the per-person notice nudges towards a package', /package/i.test(solo.body.notice), solo.body.notice);
    check('the notice quotes the best saving on offer', /1,401/.test(solo.body.notice), solo.body.notice);

    section('Every quantity is independently editable');
    const mixed = await api('POST', '/api/waterpark/quote', {
      body: {
        mode: 'individual',
        lines: [
          { itemId: 'entry-adult', qty: 3 },   // 1,650
          { itemId: 'entry-child', qty: 5 },   // 1,750
          { itemId: 'costume', qty: 2 },       //   200  (only two want one)
          { itemId: 'kids-jumping', qty: 4 },  //   400  (only four of the five)
        ],
        date, time: slot.time,
      },
    });
    check('a mix nobody bundled prices line by line', mixed.body.amounts.baseAmount === 4000, JSON.stringify(mixed.body.amounts));
    check('8 guests are counted from the entry tickets only', mixed.body.guests.total === 8, JSON.stringify(mixed.body.guests));
    check('taking fewer costumes than guests is allowed', line({ lines: mixed.body.lines }, 'costume').qty === 2);

    section('Gate rules');
    const noEntry = await api('POST', '/api/waterpark/quote', {
      body: { mode: 'individual', lines: [{ itemId: 'costume', qty: 2 }, { itemId: 'welcome-drink', qty: 2 }] },
    });
    check('an order with no entry ticket is refused', noEntry.status === 400, `status ${noEntry.status}`);
    check('and says why', /entry ticket/i.test(noEntry.body.error || ''), noEntry.body?.error);
    const emptyOrder = await api('POST', '/api/waterpark/quote', { body: { mode: 'individual', lines: [] } });
    check('an empty order is refused', emptyOrder.status === 400);
    const unknown = await api('POST', '/api/waterpark/quote', { body: { mode: 'individual', lines: [{ itemId: 'unicorn-ride', qty: 1 }] } });
    check('an unknown rate-card line is refused', unknown.status === 400, unknown.body?.error);
    const noPack = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: 'nope' } });
    check('an unknown package is refused', noPack.status === 400);

    // ── Booking ───────────────────────────────────────────────────────────────
    section('Booking a pass');
    const anon = await api('POST', '/api/waterpark/bookings', { body: { mode: 'package', packageId: packA.id, date, time: slot.time } });
    check('booking requires a signed-in guest', anon.status === 401, `status ${anon.status}`);

    const booked = await api('POST', '/api/waterpark/bookings', {
      token,
      body: { mode: 'package', packageId: packA.id, date, time: slot.time, payment: { method: 'upi' } },
    });
    check('a pass is issued', booked.status === 201, `status ${booked.status}: ${booked.body?.error}`);
    const pass = booked.body.booking;
    check('it charges 1,499', pass.amounts.total === 1499);
    check('it carries a WP reference', /^WP/.test(pass.reference || ''), pass.reference);
    check('it stores the full value breakup', (pass.lines || []).length === 6);
    check('it records the guest count', pass.guests.total === 3);
    check('the receipt notice states the saving and the date',
      /951/.test(pass.notice || '') && /one day only/i.test(pass.notice || ''), pass.notice);
    check('the rates are frozen onto the pass', (pass.appliedRates.lines || []).length === 6);
    check('a gate barcode is served',
      (await fetch(`${BASE}/api/waterpark/bookings/${pass.id}/barcode.svg`)).headers.get('content-type') === 'image/svg+xml');

    const mine = await api('GET', '/api/waterpark/bookings', { token });
    check('the guest can list their passes', mine.status === 200 && mine.body.bookings.length === 1);
    const other = await api('GET', `/api/waterpark/bookings/${pass.id}`, { token: adminToken });
    check('an admin may read any pass', other.status === 200);

    section('Booking validation');
    const noTime = await api('POST', '/api/waterpark/bookings', { token, body: { mode: 'package', packageId: packA.id, date } });
    check('an entry time is required', noTime.status === 400, noTime.body?.error);
    const past = await api('POST', '/api/waterpark/bookings', { token, body: { mode: 'package', packageId: packA.id, date: '2020-01-01', time: slot.time } });
    check('a past date is refused', past.status === 400, past.body?.error);
    const farOff = await api('POST', '/api/waterpark/bookings', { token, body: { mode: 'package', packageId: packA.id, date: '2099-01-01', time: slot.time } });
    check('a date beyond the booking window is refused', farOff.status === 400, farOff.body?.error);
    const badSlot = await api('POST', '/api/waterpark/bookings', { token, body: { mode: 'package', packageId: packA.id, date, time: '03:17' } });
    check('a time that is not an entry slot is refused', badSlot.status === 400, badSlot.body?.error);

    // ── Capacity ──────────────────────────────────────────────────────────────
    section('Slot capacity');
    const slotsNow = await api('GET', `/api/waterpark/slots?date=${date}`);
    const thisSlot = slotsNow.body.slots.find((s) => s.time === slot.time);
    check('the booked slot now shows 3 guests', thisSlot.guests === 3, JSON.stringify(thisSlot));
    check('and 117 of 120 spaces left', thisSlot.seatsLeft === 117, `got ${thisSlot.seatsLeft}`);

    await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { capacityPerSlot: 4 } });
    const overflow = await api('POST', '/api/waterpark/bookings', {
      token,
      body: { mode: 'package', packageId: packB.id, date, time: slot.time, payment: { method: 'upi' } },
    });
    check('a party that will not fit the slot is refused with 409', overflow.status === 409, `status ${overflow.status}`);
    check('and is told how many spaces remain', /1 space/.test(overflow.body.error || ''), overflow.body?.error);
    await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { capacityPerSlot: 120 } });

    // ── Admin: editing prices moves everything at once ────────────────────────
    section('Admin \u2014 editing the rate card moves every package');
    const raise = await api('PUT', '/api/admin/waterpark/items/entry-adult', {
      token: adminToken,
      body: { label: 'Water Park Entry \u2013 Adult', rate: 600, unit: 'adult', entry: true, active: true },
    });
    check('the adult rate can be raised to 600', raise.status === 200, `status ${raise.status}: ${raise.body?.error}`);
    const rA = byCode(raise.body.packages, 'A');
    const rB = byCode(raise.body.packages, 'B');
    check("A's value follows to 2,550", rA.actualValue === 2550, `got ${rA.actualValue}`);
    check("A's saving follows to 1,051", rA.saving === 1051, `got ${rA.saving}`);
    check("B's value follows to 3,300", rB.actualValue === 3300, `got ${rB.actualValue}`);
    check("B's saving follows to 1,501", rB.saving === 1501, `got ${rB.saving}`);

    const custView = await api('GET', '/api/waterpark');
    check('the customer app sees the new value immediately',
      byCode(custView.body.catalogue.packages, 'A').actualValue === 2550);
    const individualAfter = await api('POST', '/api/waterpark/quote', {
      body: { mode: 'individual', lines: [{ itemId: 'entry-adult', qty: 1 }] },
    });
    check('and a per-person booking is charged the new rate too', individualAfter.body.amounts.total === 600);

    // put it back
    await api('PUT', '/api/admin/waterpark/items/entry-adult', {
      token: adminToken,
      body: { label: 'Water Park Entry \u2013 Adult', rate: 550, unit: 'adult', entry: true, active: true },
    });

    section('Admin \u2014 package editing');
    const repriced = await api('PUT', `/api/admin/waterpark/packages/${packA.id}`, {
      token: adminToken,
      body: {
        code: 'A', name: 'Family of 3', composition: '2 Adults + 1 Child', adults: 2, children: 1, price: 1299,
        lines: packA.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      },
    });
    check('a package price can be changed', repriced.status === 200 && repriced.body.package.price === 1299);
    check('and the saving is recomputed to 1,151', repriced.body.package.saving === 1151, `got ${repriced.body.package.saving}`);
    await api('PUT', `/api/admin/waterpark/packages/${packA.id}`, {
      token: adminToken,
      body: {
        code: 'A', name: 'Family of 3', composition: '2 Adults + 1 Child', adults: 2, children: 1, price: 1499,
        lines: packA.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      },
    });

    const mismatch = await api('POST', '/api/admin/waterpark/packages', {
      token: adminToken,
      body: { name: 'Family of 6', adults: 4, children: 2, price: 2999, lines: [{ itemId: 'entry-adult', qty: 2 }, { itemId: 'entry-child', qty: 2 }] },
    });
    check('a package whose entry tickets do not match its head count is refused', mismatch.status === 400, `status ${mismatch.status}`);
    check('and the message explains the gate problem', /turn someone away/i.test(mismatch.body.error || ''), mismatch.body?.error);

    const newPack = await api('POST', '/api/admin/waterpark/packages', {
      token: adminToken,
      body: {
        code: 'C', name: 'Couple Special', composition: '2 Adults', adults: 2, children: 0, price: 1199,
        lines: [{ itemId: 'entry-adult', qty: 2 }, { itemId: 'costume', qty: 2 }, { itemId: 'movie-ticket', qty: 2 }, { itemId: 'welcome-drink', qty: 2 }],
      },
    });
    check('a brand-new package can be added', newPack.status === 201, `status ${newPack.status}: ${newPack.body?.error}`);
    check('its value is computed from the same rate card', newPack.body.package.actualValue === 1700, `got ${newPack.body.package?.actualValue}`);
    check('and its saving is 501', newPack.body.package.saving === 501);
    const bookable = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: newPack.body.package.id } });
    check('the new package is immediately bookable', bookable.status === 200 && bookable.body.amounts.total === 1199);
    check('the new package can be deleted while unsold',
      (await api('DELETE', `/api/admin/waterpark/packages/${newPack.body.package.id}`, { token: adminToken })).body.deleted === true);

    section('Admin \u2014 rate card and add-on guards');
    const usedItem = await api('DELETE', '/api/admin/waterpark/items/costume', { token: adminToken });
    check('a rate line still used by a package cannot be deleted', usedItem.status === 400, `status ${usedItem.status}`);
    check('and it names the packages using it', /Family of 3/.test(usedItem.body.error || ''), usedItem.body?.error);

    const newItem = await api('POST', '/api/admin/waterpark/items', {
      token: adminToken,
      body: { label: 'Locker Rental', rate: 75, unit: 'guest', active: true },
    });
    check('a new rate line can be added', newItem.status === 201 && newItem.body.item.id === 'locker-rental', JSON.stringify(newItem.body?.item));
    check('an unused rate line can be deleted',
      (await api('DELETE', '/api/admin/waterpark/items/locker-rental', { token: adminToken })).body.deleted === true);

    const newAddOn = await api('POST', '/api/admin/waterpark/addons', {
      token: adminToken, body: { label: 'Zorbing Ball', price: 149, active: true },
    });
    check('a new add-on can be added', newAddOn.status === 201, JSON.stringify(newAddOn.body?.addOn));
    const withNew = await api('POST', '/api/waterpark/quote', {
      body: { mode: 'package', packageId: packA.id, addOns: [{ id: 'zorbing-ball', qty: 2 }] },
    });
    check('and is instantly sellable at its price', withNew.body.amounts.addOnAmount === 298, JSON.stringify(withNew.body?.amounts));
    await api('DELETE', '/api/admin/waterpark/addons/zorbing-ball', { token: adminToken });

    const priceyAddOn = await api('PUT', '/api/admin/waterpark/addons/fish-spa', {
      token: adminToken, body: { label: 'Fish Spa', price: 149, active: true },
    });
    check('an add-on price can be edited', priceyAddOn.status === 200 && priceyAddOn.body.addOn.price === 149);
    await api('PUT', '/api/admin/waterpark/addons/fish-spa', { token: adminToken, body: { label: 'Fish Spa', price: 99, active: true } });

    const off = await api('PUT', '/api/admin/waterpark/addons/bull-ride', {
      token: adminToken, body: { label: 'Bull Ride', price: 99, active: false },
    });
    check('an add-on can be switched off', off.status === 200);
    const offQuote = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id, addOns: [{ id: 'bull-ride', qty: 1 }] } });
    check('and can no longer be sold', offQuote.status === 400, offQuote.body?.error);
    await api('PUT', '/api/admin/waterpark/addons/bull-ride', { token: adminToken, body: { label: 'Bull Ride', price: 99, active: true } });

    // ── Admin: counter sales ──────────────────────────────────────────────────
    section('Admin \u2014 selling at the counter');
    const counterSlot = (await api('GET', `/api/waterpark/slots?date=${date}`)).body.slots.slice(-1)[0];
    const counter = await api('POST', '/api/admin/waterpark/bookings', {
      token: adminToken,
      body: {
        mode: 'individual',
        lines: [{ itemId: 'entry-child', qty: 2 }, { itemId: 'kids-jumping', qty: 2 }],
        date, time: counterSlot.time, guestName: 'Walk-up family', guestPhone: '9999900000', paymentMethod: 'cash',
      },
    });
    check('a walk-up pass can be sold with no customer account', counter.status === 201, `status ${counter.status}: ${counter.body?.error}`);
    check('it charges 900 (2 x 350 + 2 x 100)', counter.body.booking.amounts.total === 900, JSON.stringify(counter.body.booking?.amounts));
    check('it is marked as a counter sale', counter.body.booking.source === 'counter');
    check('it records who it was sold to', counter.body.booking.guest.name === 'Walk-up family');
    check('it is marked paid at the counter', counter.body.booking.payment.status === 'paid');
    const noName = await api('POST', '/api/admin/waterpark/bookings', {
      token: adminToken, body: { mode: 'package', packageId: packA.id, date, time: counterSlot.time },
    });
    check("a counter sale without a guest name is refused", noName.status === 400, noName.body?.error);
    const notAdmin = await api('POST', '/api/admin/waterpark/bookings', {
      token, body: { mode: 'package', packageId: packA.id, date, time: counterSlot.time, guestName: 'X' },
    });
    check('a customer cannot sell themselves a counter pass', notAdmin.status === 403, `status ${notAdmin.status}`);

    section('Admin \u2014 the gate');
    const ci = await api('POST', `/api/admin/waterpark/bookings/${counter.body.booking.id}/checkin`, { token: adminToken });
    check('a pass can be checked in at the gate', ci.status === 200 && Boolean(ci.body.booking.checkedInAt));
    const ci2 = await api('POST', `/api/admin/waterpark/bookings/${counter.body.booking.id}/checkin`, { token: adminToken });
    check('checking the same pass in twice is refused', ci2.status === 400, ci2.body?.error);
    const delUsed = await api('DELETE', `/api/admin/waterpark/bookings/${counter.body.booking.id}`, { token: adminToken });
    check('a used pass cannot be deleted', delUsed.status === 400, delUsed.body?.error);
    check('a mistaken check-in can be undone',
      (await api('POST', `/api/admin/waterpark/bookings/${counter.body.booking.id}/undo-checkin`, { token: adminToken })).status === 200);

    // ── Admin: the section payload ────────────────────────────────────────────
    section('Admin \u2014 the section payload');
    const adminView = await api('GET', '/api/admin/waterpark', { token: adminToken });
    check('GET /api/admin/waterpark succeeds', adminView.status === 200, `status ${adminView.status}`);
    check('it requires an admin', (await api('GET', '/api/admin/waterpark', { token })).status === 403);
    check('it reports revenue', adminView.body.stats.revenue === 1499 + 900, `got ${adminView.body.stats?.revenue}`);
    check('it counts guests through the gate', adminView.body.stats.guests === 5, `got ${adminView.body.stats?.guests}`);
    check('it separates package from individual bookings',
      adminView.body.stats.packageBookings === 1 && adminView.body.stats.individualBookings === 1);
    check('it counts counter sales separately', adminView.body.stats.counterSales === 1);
    check('it reports what the bundling cost', adminView.body.stats.savingGiven === 951, `got ${adminView.body.stats?.savingGiven}`);
    check('it shows which rate lines are selling',
      (adminView.body.items.find((i) => i.id === 'entry-child') || {}).sales.qty === 3,
      JSON.stringify(adminView.body.items.map((i) => [i.id, i.sales.qty])));
    check('it warns which packages depend on a rate line',
      (adminView.body.items.find((i) => i.id === 'costume') || {}).usedBy.length === 2);
    check('it lists inactive packages too so they can be re-enabled', adminView.body.packages.length >= 2);
    check("it includes today's gate load slot by slot", Array.isArray(adminView.body.todaySlots) && adminView.body.todaySlots.length > 0);
    check('it exposes the notice tokens for the editor', adminView.body.noticeTokens.includes('saving'));
    check('it previews each notice with tokens filled in', /\u20B9/.test(adminView.body.previews.package));
    check('the customer name is resolved for app sales',
      adminView.body.bookings.some((b) => b.customerName === 'Andrew Ainsely'),
      JSON.stringify(adminView.body.bookings.map((b) => b.customerName)));
    check('and a counter sale is labelled as such',
      adminView.body.bookings.some((b) => b.customerName === 'Counter sale'));

    const dash = await api('GET', '/api/admin/stats', { token: adminToken });
    check('the dashboard carries a water park block', Boolean(dash.body.park), JSON.stringify(dash.body?.park));
    check('and its revenue agrees with the section', dash.body.park.revenue === adminView.body.stats.revenue);
    // Two passes exist at this point: the app booking and the counter sale.
    check('and the totals count the collection', dash.body.totals.waterparkBookings === 2, `got ${dash.body.totals?.waterparkBookings}`);

    // ── Admin: settings and notices ───────────────────────────────────────────
    section('Admin \u2014 settings, notices and the kill switch');
    const badHours = await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { openTime: '18:00', closeTime: '10:00' } });
    check('closing before opening is refused', badHours.status === 400, badHours.body?.error);
    // A 3-hour slot cannot fit inside a 2-hour opening window, which would
    // leave a live tab with no bookable slot at all.
    const bigSlot = await api('PUT', '/api/admin/waterpark/settings', {
      token: adminToken, body: { slotMinutes: 180, openTime: '10:00', closeTime: '12:00' },
    });
    check('a slot that cannot fit the opening hours is refused', bigSlot.status === 400, bigSlot.body?.error);
    const exactSlot = await api('PUT', '/api/admin/waterpark/settings', {
      token: adminToken, body: { slotMinutes: 480, openTime: '10:00', closeTime: '18:00' },
    });
    check('but a single slot filling the whole day is allowed', exactSlot.status === 200, exactSlot.body?.error);
    check('and that day really does yield one bookable slot',
      (await api('GET', `/api/waterpark/slots?date=${futureKeyFor(3)}`)).body.slots.length === 1);
    await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { slotMinutes: 60 } });

    const reworded = await api('PUT', '/api/admin/waterpark/settings', {
      token: adminToken,
      body: { packageNotice: 'Only {price} for {guests} guests \u2014 saving {saving}!' },
    });
    check('notice copy can be rewritten', reworded.status === 200);
    const newNotice = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id } });
    check('and the customer sees the new wording with live tokens',
      /^Only \u20B91,499 for 3 guests \u2014 saving \u20B9951!$/.test(newNotice.body.notice), newNotice.body?.notice);
    check('resetting notices restores the shipped wording',
      (await api('POST', '/api/admin/waterpark/notices/reset', { token: adminToken })).status === 200);
    const restored = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id } });
    check('and the default wording is back', /worth/.test(restored.body.notice), restored.body?.notice);

    const fees = await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { convenienceFeePercent: 2, gstPercent: 18 } });
    check('a booking fee and tax can be switched on', fees.status === 200);
    const withFees = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id } });
    // 1,499 + 2% = 1,529 (fee 30), + 18% = 1,804
    check('they are applied on top of the package price',
      withFees.body.amounts.convenienceFee === 30 && withFees.body.amounts.gst === 275 && withFees.body.amounts.total === 1804,
      JSON.stringify(withFees.body.amounts));
    await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { convenienceFeePercent: 0, gstPercent: 0 } });

    const noIndividual = await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { allowIndividual: false } });
    check('per-person booking can be switched off', noIndividual.status === 200);
    const blocked = await api('POST', '/api/waterpark/quote', { body: { mode: 'individual', lines: [{ itemId: 'entry-adult', qty: 1 }] } });
    check('and is then refused with a reason', blocked.status === 400 && /switched off/i.test(blocked.body.error || ''), blocked.body?.error);
    const stillPackages = await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id } });
    check('while packages keep selling', stillPackages.status === 200);
    await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { allowIndividual: true } });

    const hidden = await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { active: false } });
    check('the whole tab can be switched off', hidden.status === 200);
    check('and booking then returns 503',
      (await api('POST', '/api/waterpark/quote', { body: { mode: 'package', packageId: packA.id } })).status === 503);
    const hiddenTab = await api('GET', '/api/waterpark');
    check('the tab payload still loads, reporting itself inactive',
      hiddenTab.status === 200 && hiddenTab.body.settings.active === false && hiddenTab.body.slots.length === 0);
    await api('PUT', '/api/admin/waterpark/settings', { token: adminToken, body: { active: true } });

    // ── Cancellation ──────────────────────────────────────────────────────────
    section('Cancellation');
    const sameDay = await api('POST', `/api/waterpark/bookings/${pass.id}/cancel`, { token });
    check('a pass cannot be cancelled on the day of the visit', sameDay.status === 400, sameDay.body?.error);

    const future = new Date();
    future.setDate(future.getDate() + 5);
    const futureKey = future.toISOString().slice(0, 10);
    const futureSlot = (await api('GET', `/api/waterpark/slots?date=${futureKey}`)).body.slots[0];
    const laterPass = await api('POST', '/api/waterpark/bookings', {
      token, body: { mode: 'package', packageId: packB.id, date: futureKey, time: futureSlot.time, payment: { method: 'card' } },
    });
    check('a future visit can be booked', laterPass.status === 201, laterPass.body?.error);
    const cancelled = await api('POST', `/api/waterpark/bookings/${laterPass.body.booking.id}/cancel`, { token });
    check('and cancelled by the guest', cancelled.status === 200 && cancelled.body.booking.status === 'cancelled');
    const freed = (await api('GET', `/api/waterpark/slots?date=${futureKey}`)).body.slots.find((s) => s.time === futureSlot.time);
    check('cancelling releases the slot', freed.guests === 0, JSON.stringify(freed));
    check('cancelling twice is refused',
      (await api('POST', `/api/waterpark/bookings/${laterPass.body.booking.id}/cancel`, { token })).status === 400);

    // ── Reset ─────────────────────────────────────────────────────────────────
    section('Restoring the shipped configuration');
    await api('PUT', '/api/admin/waterpark/items/entry-adult', {
      token: adminToken, body: { label: 'Adult', rate: 999, unit: 'adult', entry: true, active: true },
    });
    const reset = await api('POST', '/api/admin/waterpark/reset', { token: adminToken });
    check('the whole configuration can be restored', reset.status === 200);
    check('and Package A is worth 2,450 again', byCode(reset.body.packages, 'A').actualValue === 2450,
      `got ${byCode(reset.body.packages, 'A')?.actualValue}`);
    check('and saves 951 again', byCode(reset.body.packages, 'A').saving === 951);
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
