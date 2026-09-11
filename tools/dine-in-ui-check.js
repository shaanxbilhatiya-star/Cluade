'use strict';
/**
 * Dine-In UI check — "can a guest tell which restaurant they are dealing with?"
 *
 * The resort has two restaurants, Rangoli (pure veg) and Dolphin (non-veg), and
 * the failure this guards against is not a crash: it is a guest booking a table
 * in the wrong dining room, or paying the wrong restaurant's bill, because the
 * screen never told them which one they were on. So the assertions here are
 * about what is legible on screen, not about API shapes:
 *
 *   · the tab names the RESORT and lists both restaurants, each with the
 *     veg / non-veg mark;
 *   · the old invented "Kingfisher Restaurant" appears nowhere;
 *   · the reserve and pay screens each wear a banner naming their restaurant;
 *   · a Rangoli table shows up under Rangoli and not under Dolphin;
 *   · paying at Dolphin while holding a Rangoli table says so, in words.
 *
 * Run it with --shots to write screenshots into tools/screenshots/.
 *
 *   node tools/dine-in-ui-check.js --shots
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3973;
const CDP_PORT = Number(process.env.CDP_PORT) || 9335;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cineflex-dine-ui-'));
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chrome';
const WANT_SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(__dirname, 'screenshots');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, endpoint, body, token) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: Object.assign(
      body ? { 'Content-Type': 'application/json' } : {},
      token ? { Authorization: `Bearer ${token}` } : {}
    ),
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitForHttp(url, tries = 200) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json().catch(() => ({}));
    } catch (_e) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`${url} never became reachable`);
}

/** Minimal CDP client over a single WebSocket. */
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('CDP socket error: ' + (e.message || 'unknown'))));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        this.pageErrors.push(d.exception ? (d.exception.description || d.exception.value) : d.text);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }
      }, 30000);
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error('page eval threw: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  }

  clearErrors() { this.consoleErrors = []; this.pageErrors = []; }
  close() { try { this.ws.close(); } catch (_e) {} }
}

async function waitFor(cdp, expression, label, tries = 90) {
  for (let i = 0; i < tries; i += 1) {
    let value;
    try { value = await cdp.eval(`return ${expression};`); } catch (_e) { value = false; }
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label || expression}`);
}

async function screenshot(cdp, name) {
  if (!WANT_SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`      \x1b[2m\u2192 tools/screenshots/${name}.png\x1b[0m`);
}

async function run() {
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' });
  delete env.NODE_OPTIONS;

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(d.toString()));
  server.stderr.on('data', (d) => serverLog.push(d.toString()));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-dine-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    /* This box has no outbound network, and Chrome's component updater will sit
       there retrying until the harness times out if it is left on. */
    '--disable-component-update',
    '--no-first-run',
    '--disable-sync',
    '--disable-features=OptimizationGuideModelDownloading,SodaInstaller,MediaRouter,Translate',
    // A phone-shaped viewport: this tab is mobile-only.
    '--window-size=430,1600',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBUS_SESSION_BUS_ADDRESS: '/dev/null' }) });
  const chromeLog = [];
  chrome.stdout.on('data', (d) => chromeLog.push(d.toString()));
  chrome.stderr.on('data', (d) => chromeLog.push(d.toString()));

  let cdp = null;
  try {
    await waitForHttp(`${BASE}/api/health`);
    const version = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    console.log(`\nTesting ${BASE} with ${version.Browser}`);

    const pageTarget = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page;
        await sleep(200);
      }
      throw new Error('Chrome never exposed a page target');
    })();

    const customer = (await api('POST', '/api/auth/login', { email: 'andrew@example.com', password: '1234' })).body.token;
    const admin = (await api('POST', '/api/auth/login', { email: 'admin@cineflex.com', password: 'admin123' })).body.token;
    if (!customer || !admin) throw new Error('could not sign in with the demo accounts');

    cdp = new CDP(pageTarget.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430, height: 1600, deviceScaleFactor: 2, mobile: true,
    });

    async function open(hash, readyExpr, label) {
      await cdp.send('Page.navigate', { url: `${BASE}/blank-for-origin` });
      await sleep(250);
      await cdp.eval(`localStorage.setItem('cineflex.token', ${JSON.stringify(customer)}); return true;`);
      cdp.clearErrors();
      await cdp.send('Page.navigate', { url: `${BASE}/${hash}` });
      await sleep(500);
      await waitFor(cdp, readyExpr, label);
    }

    /**
     * The admin console is a desktop app, so it gets a desktop viewport. It reads
     * the same `cineflex.token` key as the customer app — there is no separate
     * admin token — so the admin session simply overwrites it.
     */
    async function openAdmin(hash, readyExpr, label) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1500, height: 1400, deviceScaleFactor: 1, mobile: false,
      });
      /* Seed the token from a plain page on the same origin. Going to /admin/
         first and then to /admin/#dinein would be a same-document navigation, so
         Chrome would not reload and the console would sit on its login screen —
         it reads the hash once, at boot. */
      await cdp.send('Page.navigate', { url: `${BASE}/blank-for-origin` });
      await sleep(250);
      await cdp.eval(`localStorage.setItem('cineflex.token', ${JSON.stringify(admin)}); return true;`);
      cdp.clearErrors();
      await cdp.send('Page.navigate', { url: `${BASE}/admin/${hash}` });
      await sleep(700);
      await waitFor(cdp, readyExpr, label);
    }

    const noErrors = () => cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0;
    const errorDetail = () => [...cdp.consoleErrors, ...cdp.pageErrors].join(' | ');

    // ── The tab ───────────────────────────────────────────────────────────────
    section('Dine-In tab \u2014 the resort, then both restaurants');
    await open('#/dine-in', `document.querySelectorAll('.dine-outlet').length === 2`, 'both restaurant cards');
    await screenshot(cdp, 'dine-in-tab');

    check('the app bar says Dine-In, the tab is about the venue',
      (await cdp.eval(`return document.querySelector('.appbar__title').textContent.trim();`)) === 'Dine-In');
    check('the invented "Kingfisher Restaurant" is gone from the screen',
      !(await cdp.eval(`return /Kingfisher Rest(a|u)urant/i.test(document.body.innerText);`)),
      await cdp.eval(`const m = document.body.innerText.match(/Kingfisher Rest\\w+/i); return m ? m[0] : '';`));
    check('the hero names the resort',
      await cdp.eval(`return /Kingfisher Resort/.test(document.body.innerText);`));
    check('the "two restaurants" explainer is on screen',
      await cdp.eval(`return document.querySelector('.dine-explainer__title').textContent.includes('Two restaurants');`));
    check('the explainer names both, with their diets',
      await cdp.eval(`
        const t = document.querySelector('.dine-explainer').innerText;
        return /Rangoli/.test(t) && /Pure vegetarian/i.test(t) && /Dolphin/.test(t) && /non-vegetarian/i.test(t);
      `), await cdp.eval(`return document.querySelector('.dine-explainer').innerText.replace(/\\n/g, ' / ');`));

    const cards = await cdp.eval(`
      return [...document.querySelectorAll('.dine-outlet')].map(el => ({
        id: el.getAttribute('data-outlet'),
        name: el.querySelector('.dine-outlet__name').textContent.trim(),
        tag: el.querySelector('.diet-tag').textContent.trim(),
        markVeg: !!el.querySelector('.veg-mark--veg'),
        markNonVeg: !!el.querySelector('.veg-mark--nonveg'),
        hours: el.querySelector('.dine-outlet__hours').innerText.trim(),
        buttons: [...el.querySelectorAll('button')].map(b => b.textContent.trim()),
      }));
    `);
    const veg = cards.find((c) => c.id === 'rangoli');
    const nonveg = cards.find((c) => c.id === 'dolphin');
    check('Rangoli is on screen as PURE VEG with the green mark',
      veg && veg.name === 'Rangoli' && /PURE VEG/.test(veg.tag) && veg.markVeg && !veg.markNonVeg,
      JSON.stringify(veg && { name: veg.name, tag: veg.tag, mark: veg.markVeg }));
    check('Dolphin is on screen as NON-VEG with the maroon mark',
      nonveg && nonveg.name === 'Dolphin' && /NON-VEG/.test(nonveg.tag) && nonveg.markNonVeg && !nonveg.markVeg,
      JSON.stringify(nonveg && { name: nonveg.name, tag: nonveg.tag, mark: nonveg.markNonVeg }));
    check('each restaurant shows its own opening hours',
      veg.hours !== nonveg.hours, JSON.stringify({ veg: veg.hours, nonveg: nonveg.hours }));
    check('every button on a card names its restaurant, so no button is ambiguous',
      cards.every((c) => c.buttons.every((b) => b.includes(c.name))),
      JSON.stringify(cards.map((c) => c.buttons)));
    check('the shared offer is stated once for the resort, not per restaurant',
      (await cdp.eval(`return document.querySelectorAll('.dine-deal').length;`)) === 1 &&
      (await cdp.eval(`return /Same offer at Rangoli and Dolphin/.test(document.querySelector('.dine-deal').innerText);`)));
    check('no console errors on the tab', noErrors(), errorDetail());

    // ── Reserving ─────────────────────────────────────────────────────────────
    section('Reserving \u2014 the screen never stops naming the restaurant');
    await open('#/dine-in/reserve/rangoli', `document.querySelector('.dine-ident') !== null`, 'the identity banner');
    await screenshot(cdp, 'dine-in-reserve-rangoli');

    check('the banner names Rangoli and marks it veg',
      await cdp.eval(`
        const el = document.querySelector('.dine-ident');
        return el.classList.contains('dine-ident--veg') && /Rangoli/.test(el.innerText) && /Pure Veg/i.test(el.innerText);
      `), await cdp.eval(`return document.querySelector('.dine-ident').innerText.replace(/\\n/g, ' / ');`));
    check('the banner is sticky, so it survives scrolling down a long form',
      (await cdp.eval(`return getComputedStyle(document.querySelector('.dine-ident')).position;`)) === 'sticky');
    check('it offers a way to change restaurant right there',
      await cdp.eval(`return !!document.querySelector('[data-action="switch-outlet"]');`));
    check('the confirm button names the restaurant',
      /Reserve at Rangoli/.test(await cdp.eval(`return document.querySelector('[data-action="confirm"]').textContent;`)));
    check('the time section quotes Rangoli\u2019s own hours',
      await cdp.eval(`return /Rangoli serves 07:00.23:00/.test(document.body.innerText);`),
      await cdp.eval(`const m = document.body.innerText.match(/Rangoli serves [^\\n]*/); return m ? m[0] : 'not found';`));
    check('seating options are Rangoli\u2019s (no rooftop \u2014 that is Dolphin\u2019s)',
      await cdp.eval(`
        const chips = [...document.querySelectorAll('[data-action="area"]')].map(c => c.textContent.trim());
        return chips.length > 0 && !chips.includes('Rooftop');
      `), await cdp.eval(`return [...document.querySelectorAll('[data-action="area"]')].map(c => c.textContent.trim()).join(', ');`));
    check('"Change" switches to the other restaurant',
      await (async () => {
        await cdp.eval(`document.querySelector('[data-action="switch-outlet"]').click(); return true;`);
        await sleep(700);
        return cdp.eval(`return location.hash === '#/dine-in/reserve/dolphin';`);
      })(), await cdp.eval(`return location.hash;`));
    await waitFor(cdp, `document.querySelector('.dine-ident') !== null`, 'the Dolphin banner');
    check('and the banner flips to Dolphin, marked non-veg',
      await cdp.eval(`
        const el = document.querySelector('.dine-ident');
        return el.classList.contains('dine-ident--nonveg') && /Dolphin/.test(el.innerText);
      `));
    await screenshot(cdp, 'dine-in-reserve-dolphin');
    check('no console errors while reserving', noErrors(), errorDetail());

    // Book a real Rangoli table through the API, then look at the tab again.
    const slots = await api('GET', '/api/dine-in/slots?outletId=rangoli', null, customer);
    const slot = slots.body.slots[0];
    const booked = await api('POST', '/api/dine-in/reservations', {
      outletId: 'rangoli', date: slots.body.date, time: slot.time, partySize: 2, guestName: 'Andrew Smith', area: 'Garden',
    }, customer);
    if (booked.status !== 201) throw new Error('could not book a Rangoli table: ' + JSON.stringify(booked.body));

    section('A booked table belongs to ONE restaurant on screen');
    await open('#/dine-in', `document.querySelectorAll('.dine-outlet').length === 2`, 'both restaurant cards');
    await screenshot(cdp, 'dine-in-tab-with-rangoli-table');

    check('the table shows inside the Rangoli card',
      await cdp.eval(`return !!document.querySelector('.dine-outlet[data-outlet="rangoli"] [data-res="rangoli"]');`));
    check('and the Dolphin card shows no table',
      await cdp.eval(`return !document.querySelector('.dine-outlet[data-outlet="dolphin"] [data-res]');`));
    check('the Rangoli card carries its own billing countdown',
      await cdp.eval(`
        const clock = document.querySelector('.dine-outlet[data-outlet="rangoli"] [data-lock-clock]');
        return !!clock && /^\\d\\d:\\d\\d$/.test(clock.textContent.trim());
      `), await cdp.eval(`const c = document.querySelector('[data-lock-clock]'); return c ? c.textContent : 'none';`));
    check('exactly one countdown is running, not one per card',
      (await cdp.eval(`return document.querySelectorAll('[data-lock-clock]').length;`)) === 1);
    check('the Dolphin card still offers the walk-in rate only',
      await cdp.eval(`
        const t = document.querySelector('.dine-outlet[data-outlet="dolphin"]').innerText;
        return /Pay Dolphin bill now/.test(t) && /Reserve at Dolphin/.test(t);
      `));
    check('cancelling is worded per restaurant',
      /Cancel this table/.test(await cdp.eval(`
        return document.querySelector('.dine-outlet[data-outlet="rangoli"] [data-action="cancel-res"]').textContent;
      `)));
    check('no console errors with a live table', noErrors(), errorDetail());

    // ── The mix-up ────────────────────────────────────────────────────────────
    section('Paying the OTHER restaurant is explained, not silently downgraded');
    await open('#/dine-in/bill/dolphin', `document.querySelector('.dine-ident') !== null`, 'the Dolphin bill screen');

    check('the bill screen is unmistakably Dolphin',
      await cdp.eval(`
        const el = document.querySelector('.dine-ident');
        return el.classList.contains('dine-ident--nonveg') && /Dolphin/.test(el.innerText);
      `));
    check('it asks the guest to check the printed bill says Dolphin',
      await cdp.eval(`return /printed bill says\\s*Dolphin/i.test(document.querySelector('.dine-bill-check').innerText);`),
      await cdp.eval(`const el = document.querySelector('.dine-bill-check'); return el ? el.innerText : 'missing';`));
    check('it warns that the 30% table is at Rangoli, with a switch button',
      await cdp.eval(`
        const el = document.querySelector('.dine-elsewhere');
        return !!el && /table is at Rangoli/.test(el.innerText) && !!el.querySelector('[data-action="go-outlet"]');
      `), await cdp.eval(`const el = document.querySelector('.dine-elsewhere'); return el ? el.innerText.replace(/\\n/g, ' / ') : 'missing';`));
    check('the pay bar names the restaurant being paid',
      /Dolphin/.test(await cdp.eval(`return document.querySelector('.actionbar__label').textContent;`)));
    check('no reserved/walk-in tier picker is offered \u2014 the table is not usable here',
      await cdp.eval(`return document.querySelector('[data-modes]') === null;`));

    // Type an amount and let the quote land.
    await cdp.eval(`
      const el = document.querySelector('[data-amount]');
      el.value = '2000';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await waitFor(cdp, `document.querySelector('.notice') !== null`, 'the priced notice');
    await sleep(300);
    await screenshot(cdp, 'dine-in-bill-dolphin-other-table');

    check('the priced bill applies the 10% walk-in rate, not the 30%',
      await cdp.eval(`return /10% off/.test(document.querySelector('[data-save]').innerText);`),
      await cdp.eval(`return document.querySelector('[data-save]').innerText;`));
    check('and the notice spells out why, naming both restaurants',
      await cdp.eval(`
        const t = document.querySelector('[data-notice]').innerText;
        return /booked at Rangoli/.test(t) && /bill is for Dolphin/.test(t) && /untouched/.test(t);
      `), await cdp.eval(`return document.querySelector('[data-notice]').innerText;`));

    // The confirm sheet is the last gate before money moves.
    await cdp.eval(`document.querySelector('[data-action="pay"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('.dine-confirm') !== null`, 'the confirm sheet');
    await screenshot(cdp, 'dine-in-bill-confirm-sheet');
    check('paying opens a confirm sheet naming the restaurant and its diet',
      await cdp.eval(`
        const t = document.querySelector('.sheet').innerText;
        return /Confirm the restaurant/.test(t) && /Dolphin/.test(t) && /non-vegetarian/i.test(t);
      `), await cdp.eval(`return document.querySelector('.sheet').innerText.replace(/\\n/g, ' / ');`));
    check('the sheet shows the diet mark too, not just the name',
      await cdp.eval(`return !!document.querySelector('.dine-confirm .veg-mark--nonveg');`));
    check('backing out of the sheet does not pay',
      await (async () => {
        await cdp.eval(`document.querySelector('.sheet [data-no]').click(); return true;`);
        await sleep(400);
        const list = await api('GET', '/api/dine-in/bills', null, customer);
        return list.body.bills.length === 0;
      })());

    // Now go through with it.
    await cdp.eval(`document.querySelector('[data-action="pay"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('.dine-confirm') !== null`, 'the confirm sheet again');
    await cdp.eval(`document.querySelector('.sheet [data-yes]').click(); return true;`);
    await waitFor(cdp, `location.hash.startsWith('#/dine-in/paid/')`, 'the receipt');
    await waitFor(cdp, `document.querySelector('.success-hero') !== null`, 'the receipt body');
    await sleep(300);
    await screenshot(cdp, 'dine-in-receipt-dolphin');

    section('The receipt answers "where did I eat?" on its own');
    check('the receipt names Dolphin',
      await cdp.eval(`return /Dolphin/.test(document.querySelector('.success-hero').innerText);`));
    check('it carries the non-veg mark and a Restaurant row',
      await cdp.eval(`return !!document.querySelector('.veg-mark--nonveg') && /Restaurant/.test(document.body.innerText);`));
    check('it separates the restaurant from the resort',
      await cdp.eval(`return /Venue/.test(document.body.innerText) && /Kingfisher Resort/.test(document.body.innerText);`));
    check('the Rangoli table is untouched by the Dolphin payment',
      (await api('GET', '/api/dine-in', null, customer)).body.outlets.find((o) => o.id === 'rangoli').reservation !== null);
    check('no console errors on the receipt', noErrors(), errorDetail());

    // ── The chooser ───────────────────────────────────────────────────────────
    section('An un-scoped link asks instead of guessing');
    await open('#/dine-in/bill', `document.querySelectorAll('.dine-pick').length === 2`, 'the restaurant chooser');
    await screenshot(cdp, 'dine-in-bill-chooser');
    check('the bare /dine-in/bill link offers both restaurants',
      (await cdp.eval(`return document.querySelectorAll('.dine-pick').length;`)) === 2);
    check('it asks which restaurant the bill is from',
      await cdp.eval(`return /Which restaurant is the bill from/i.test(document.body.innerText);`));
    check('and flags the restaurant the guest already has a table at',
      await cdp.eval(`return /You have a table here/.test(document.querySelector('.dine-pick--veg').innerText);`));
    check('choosing one goes to that restaurant\u2019s bill screen',
      await (async () => {
        await cdp.eval(`document.querySelector('[data-action="choose"][data-id="rangoli"]').click(); return true;`);
        await sleep(700);
        return cdp.eval(`return location.hash === '#/dine-in/bill/rangoli';`);
      })(), await cdp.eval(`return location.hash;`));
    check('no console errors in the chooser', noErrors(), errorDetail());

    // ── Account history ───────────────────────────────────────────────────────
    section('Account history is grouped by restaurant');
    await open('#/account/restaurant', `document.querySelector('.dine-group') !== null`, 'the grouped history');
    await screenshot(cdp, 'dine-in-account-history');
    check('bookings are grouped under a restaurant heading with its mark',
      await cdp.eval(`
        const heads = [...document.querySelectorAll('.dine-group-head')].map(h => h.innerText.replace(/\\n/g, ' '));
        return heads.some(h => /Rangoli/.test(h)) && heads.some(h => /Dolphin/.test(h));
      `), await cdp.eval(`return [...document.querySelectorAll('.dine-group-head')].map(h => h.innerText.replace(/\\n/g, ' ')).join(' | ');`));
    check('spend is broken out per restaurant',
      await cdp.eval(`return document.querySelectorAll('.dine-split__cell').length === 2;`));
    check('no console errors in the history', noErrors(), errorDetail());

    // ── The admin console ─────────────────────────────────────────────────────
    /* An operator has to be able to answer "which restaurant?" about every row in
       the ledger, and to edit each restaurant separately. */
    section('Admin console \u2014 a panel per restaurant, and ledgers that name them');
    await openAdmin('#dinein', `document.querySelectorAll('[data-edit-outlet]').length === 2`, 'both restaurant panels');
    await screenshot(cdp, 'admin-dine-in');

    check('the venue panel is titled with the resort, not a restaurant',
      await cdp.eval(`
        const titles = [...document.querySelectorAll('.panel__title')].map(t => t.textContent.trim());
        return titles[0] === 'Kingfisher Resort';
      `), await cdp.eval(`return [...document.querySelectorAll('.panel__title')].map(t => t.textContent.trim()).join(' | ');`));
    check('there is one editable panel per restaurant',
      await cdp.eval(`
        const ids = [...document.querySelectorAll('[data-edit-outlet]')].map(b => b.getAttribute('data-edit-outlet'));
        return ids.includes('rangoli') && ids.includes('dolphin');
      `));
    check('each restaurant panel carries its diet mark',
      (await cdp.eval(`return document.querySelectorAll('.panel__head .veg-mark').length;`)) === 2);
    check('the reservation ledger has a Restaurant column',
      await cdp.eval(`
        const th = [...document.querySelectorAll('table')][0].querySelectorAll('th');
        return [...th].some(x => x.textContent.trim() === 'Restaurant');
      `));
    check('the bill ledger has a Restaurant column too',
      await cdp.eval(`
        const t = [...document.querySelectorAll('table')][1];
        return !!t && [...t.querySelectorAll('th')].some(x => x.textContent.trim() === 'Restaurant');
      `));
    check('the "wrong restaurant" notice is previewed for the operator',
      await cdp.eval(`return /Wrong restaurant/.test(document.body.innerText);`));
    check('the old "Kingfisher Restaurant" is gone from the console as well',
      !(await cdp.eval(`return /Kingfisher Rest(a|u)urant/i.test(document.body.innerText);`)));
    check('no console errors on the admin page', noErrors(), errorDetail());

    await cdp.eval(`document.querySelector('[data-edit-outlet="rangoli"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('[name="diet"]') !== null`, 'the restaurant editor');
    await sleep(300);
    await screenshot(cdp, 'admin-dine-in-outlet-editor');
    check('the editor opens on Rangoli with its diet preselected',
      (await cdp.eval(`return document.querySelector('[name="diet"]').value;`)) === 'veg');
    check('the diet field warns what it controls',
      await cdp.eval(`return /wrong kitchen/i.test(document.querySelector('.modal, [class*="modal"]').innerText);`),
      await cdp.eval(`const m = document.querySelector('.modal, [class*="modal"]'); return m ? m.innerText.slice(0, 300) : 'no modal';`));
    check('hours and seats are editable per restaurant, from here',
      await cdp.eval(`return !!document.querySelector('[name="openTime"]') && !!document.querySelector('[name="capacityPerSlot"]');`));

    section('Admin edits reach guests, and bad ones are refused');
    const renamed = await api('PUT', '/api/admin/dine-in/outlets/rangoli', { name: 'Rangoli Veg Kitchen', capacityPerSlot: 30 }, admin);
    check('a restaurant can be renamed and re-sized',
      renamed.status === 200 && renamed.body.outlet.name === 'Rangoli Veg Kitchen' && renamed.body.outlet.capacityPerSlot === 30,
      `status ${renamed.status}: ${JSON.stringify(renamed.body?.outlet && { n: renamed.body.outlet.name, c: renamed.body.outlet.capacityPerSlot })}`);
    check('the rename does not disturb its diet mark', renamed.body.outlet.diet === 'veg');
    const liveNames = (await api('GET', '/api/dine-in', null, customer)).body.outlets.map((o) => o.name);
    check('and guests see the new name immediately',
      liveNames.includes('Rangoli Veg Kitchen'), liveNames.join(' / '));
    const badDiet = await api('PUT', '/api/admin/dine-in/outlets/rangoli', { diet: 'vegan' }, admin);
    check('an unrecognised diet is refused rather than stored',
      badDiet.status === 400 && /veg.*nonveg/i.test(badDiet.body?.error || ''), badDiet.body?.error);
    const badHours = await api('PUT', '/api/admin/dine-in/outlets/dolphin', { openTime: '22:00', closeTime: '09:00' }, admin);
    check('a restaurant that closes before it opens is refused',
      badHours.status === 400 && /closes before it opens/i.test(badHours.body?.error || ''), badHours.body?.error);
    const noOutlet = await api('PUT', '/api/admin/dine-in/outlets/tandoor', { name: 'X' }, admin);
    check('editing a restaurant that does not exist is a 404', noOutlet.status === 404, `status ${noOutlet.status}`);
    const asGuest = await api('PUT', '/api/admin/dine-in/outlets/rangoli', { name: 'Hacked' }, customer);
    check('a customer cannot edit a restaurant', asGuest.status === 403, `status ${asGuest.status}`);
    const shutBoth = await api('PUT', '/api/admin/dine-in/outlets/rangoli', { active: false }, admin);
    const shutSecond = await api('PUT', '/api/admin/dine-in/outlets/dolphin', { active: false }, admin);
    check('one restaurant may be closed for the evening', shutBoth.status === 200, `status ${shutBoth.status}`);
    check('but closing the last open one is refused — switch off the tab instead',
      shutSecond.status === 400 && /at least one restaurant/i.test(shutSecond.body?.error || ''),
      `status ${shutSecond.status}: ${shutSecond.body?.error}`);
    const bookClosed = await api('POST', '/api/dine-in/reservations', {
      outletId: 'rangoli', date: slots.body.date, time: slot.time, partySize: 2, guestName: 'Andrew',
    }, customer);
    check('and a closed restaurant refuses new bookings, naming the open one',
      bookClosed.status === 400 && /not taking bookings/i.test(bookClosed.body?.error || ''),
      `status ${bookClosed.status}: ${bookClosed.body?.error}`);
  } catch (err) {
    failed += 1;
    failures.push(`Harness error: ${err.message}`);
    console.error('\n\x1b[31mHarness error:\x1b[0m', err);
    if (serverLog.length) console.error('\nServer output (tail):\n' + serverLog.join('').split('\n').slice(-15).join('\n'));
    if (chromeLog.length) console.error('\nChrome output (tail):\n' + chromeLog.join('').split('\n').slice(-6).join('\n'));
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGKILL');
    server.kill('SIGTERM');
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_e) {}
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
