'use strict';
/**
 * Headless UI check for the admin console and the customer app.
 *
 * Drives Chrome directly over the DevTools Protocol using Node's built-in
 * WebSocket, so it needs no browser-automation dependency — the project has no
 * dependencies and this keeps it that way.
 *
 * It boots the server against a throwaway data directory, signs in, opens a
 * page, and then asserts against the rendered DOM. Crucially it fails on any
 * console error or unhandled rejection, which is what catches a screen that
 * "loads" but is actually broken.
 *
 *   node tools/ui-check.js            check every page
 *   node tools/ui-check.js --shots    also write PNGs to tools/screenshots/
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3961;
const CDP_PORT = Number(process.env.CDP_PORT) || 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cineflex-ui-'));
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

async function waitForHttp(url, tries = 150) {
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

  /** Evaluates an expression in the page and returns its JSON value. */
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

  clearErrors() {
    this.consoleErrors = [];
    this.pageErrors = [];
  }

  close() { try { this.ws.close(); } catch (_e) {} }
}

/** Waits until an expression returns truthy, or throws. */
async function waitFor(cdp, expression, label, tries = 80) {
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

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-prof-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1500,1400',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chromeLog = [];
  chrome.stdout.on('data', (d) => chromeLog.push(d.toString()));
  chrome.stderr.on('data', (d) => chromeLog.push(d.toString()));

  let cdp = null;
  try {
    await waitForHttp(`${BASE}/api/health`);
    const version = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    console.log(`\nTesting ${BASE} with ${version.Browser}`);

    /* The /json/version socket is the browser-level endpoint, which has no
       Page or Runtime domain. Everything below drives a page, so attach to the
       page target instead. */
    const pageTarget = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page;
        await sleep(200);
      }
      throw new Error('Chrome never exposed a page target');
    })();

    const admin = (await api('POST', '/api/auth/login', { email: 'admin@cineflex.com', password: 'admin123' })).body.token;
    const customer = (await api('POST', '/api/auth/login', { email: 'andrew@example.com', password: '1234' })).body.token;
    if (!admin || !customer) throw new Error('could not sign in with the demo accounts');

    cdp = new CDP(pageTarget.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1500, height: 1400, deviceScaleFactor: 1, mobile: false,
    });

    /** Loads a URL with a token already in localStorage, then waits for boot. */
    async function open(url, token, readyExpr, label) {
      await cdp.send('Page.navigate', { url: `${BASE}/blank-for-origin` });
      await sleep(250);
      await cdp.eval(`localStorage.setItem('cineflex.token', ${JSON.stringify(token)}); return true;`);
      cdp.clearErrors();
      await cdp.send('Page.navigate', { url });
      await sleep(400);
      await waitFor(cdp, readyExpr, label);
    }

    // ── Admin: the Water Park tab ─────────────────────────────────────────────
    section('Admin console \u2014 Water Park tab renders');
    await open(`${BASE}/admin/#waterpark`, admin,
      `document.querySelector('[data-content] .wp-pack') !== null`, 'the water park packages');

    check('the tab appears in the sidebar',
      await cdp.eval(`return [...document.querySelectorAll('.side__link')].some(b => b.textContent.trim() === 'Water Park');`));
    check('it is the selected page',
      await cdp.eval(`const b = document.querySelector('[data-page="waterpark"]'); return b && b.getAttribute('aria-current') === 'page';`));
    check('the page title reads Water Park',
      (await cdp.eval(`return document.querySelector('[data-title]').textContent;`)) === 'Water Park');

    const packCards = await cdp.eval(`
      return [...document.querySelectorAll('.wp-pack')].map(el => ({
        code: el.querySelector('.wp-pack__code').textContent.trim(),
        name: el.querySelector('.wp-pack__name').textContent.trim(),
        sub: el.querySelector('.wp-pack__sub').textContent.trim(),
        rows: [...el.querySelectorAll('.wp-break tbody tr')].map(tr =>
          [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
        total: el.querySelector('.wp-break tfoot td.num').textContent.trim(),
        prices: [...el.querySelectorAll('.wp-price')].map(p => ({
          label: p.querySelector('.wp-price__label').textContent.trim(),
          value: p.querySelector('.wp-price__value').textContent.trim(),
        })),
      }));
    `);
    check('both packages are rendered as cards', packCards.length === 2, `got ${packCards.length}`);

    const cardA = packCards.find((c) => c.code === 'A');
    const cardB = packCards.find((c) => c.code === 'B');
    check('card A is "Family of 3"', cardA && cardA.name === 'Family of 3', cardA && cardA.name);
    check('card A names its composition and head count',
      cardA && /2 Adults \+ 1 Child/.test(cardA.sub) && /3 guest/.test(cardA.sub), cardA && cardA.sub);
    check('card A shows all six value-breakup rows', cardA && cardA.rows.length === 6, cardA && String(cardA.rows.length));
    check('card A prints the adult line as 2 \u00D7 \u20B9550 = \u20B91,100',
      cardA && cardA.rows[0][1] === '2' && cardA.rows[0][2] === '\u20B9550' && cardA.rows[0][3] === '\u20B91,100',
      cardA && JSON.stringify(cardA.rows[0]));
    check('card A totals \u20B92,450', cardA && cardA.total === '\u20B92,450', cardA && cardA.total);
    check('card A shows package price \u20B91,499',
      cardA && cardA.prices[0].value === '\u20B91,499', cardA && JSON.stringify(cardA.prices));
    check('card A shows "You save" \u20B9951',
      cardA && cardA.prices[1].label === 'You save' && cardA.prices[1].value === '\u20B9951',
      cardA && JSON.stringify(cardA.prices[1]));
    check('card B totals \u20B93,200 and saves \u20B91,401',
      cardB && cardB.total === '\u20B93,200' && cardB.prices[1].value === '\u20B91,401',
      cardB && `${cardB.total} / ${cardB.prices[1].value}`);

    const rateRows = await cdp.eval(`
      const panels = [...document.querySelectorAll('.panel')];
      const panel = panels.find(p => (p.querySelector('.panel__title')||{}).textContent === 'Rate card');
      return [...panel.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
    `);
    check('the rate card lists all six lines', rateRows.length === 6, `got ${rateRows.length}`);
    check('adult entry is shown at \u20B9550 per adult',
      rateRows[0][0] === 'Water Park Entry \u2013 Adult' && rateRows[0][1] === 'per adult' && rateRows[0][2] === '\u20B9550',
      JSON.stringify(rateRows[0]));
    check('entry lines are flagged as admitting a guest', /Admits a guest/.test(rateRows[0][3]), rateRows[0][3]);
    check('the costume line shows the packages that depend on it',
      /Family of 3/.test(rateRows[2][4]) && /Family of 4/.test(rateRows[2][4]), rateRows[2][4]);

    const addOnRows = await cdp.eval(`
      const panels = [...document.querySelectorAll('.panel')];
      const panel = panels.find(p => (p.querySelector('.panel__title')||{}).textContent === 'Add-ons');
      return [...panel.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
    `);
    check('all five add-ons are listed', addOnRows.length === 5, `got ${addOnRows.length}`);
    check('the two massage chair variants are told apart by price',
      addOnRows.some((r) => r[0] === 'Massage Chair' && r[1] === '15 min' && r[2] === '\u20B999') &&
      addOnRows.some((r) => r[0] === 'Massage Chair' && r[1] === '30 min' && r[2] === '\u20B9129'),
      JSON.stringify(addOnRows.map((r) => r.slice(0, 3))));

    check('the stat cards are populated',
      (await cdp.eval(`return document.querySelectorAll('[data-content] .stat-card').length;`)) === 6);
    /* Late in the day every remaining slot has gone, and the panel correctly
       says so instead of drawing an empty grid — so accept either. */
    check("today's gate load is drawn slot by slot",
      await cdp.eval(`
        const panels = [...document.querySelectorAll('.panel')];
        const panel = panels.find(p => (p.querySelector('.panel__title')||{}).textContent === 'Gate load today');
        return panel.querySelectorAll('.wp-slot').length > 0
          || /No entry slots left today/.test(panel.textContent);
      `));
    check('all four customer notices are previewed with tokens filled in',
      await cdp.eval(`return [...document.querySelectorAll('.wp-notice')].filter(n => n.textContent.includes('\u20B9')).length >= 2;`));
    check('the empty pass ledger shows an empty state',
      await cdp.eval(`return document.querySelector('[data-rows] .empty-state') !== null;`));
    check('no console errors while rendering the tab', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    check('no uncaught exceptions while rendering the tab', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));
    await screenshot(cdp, 'admin-waterpark');

    // ── Admin: the package editor computes live ───────────────────────────────
    section('Admin console \u2014 the package editor recomputes as you type');
    cdp.clearErrors();
    await cdp.eval(`document.querySelector('[data-pack-edit="family-of-3"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('.modal [data-live-value]') !== null`, 'the package editor');
    check('the editor opens wide enough for the breakup',
      await cdp.eval(`return document.querySelector('.modal--wide') !== null;`));
    check('it opens showing the current value \u20B92,450 and saving \u20B9951',
      (await cdp.eval(`return document.querySelector('[data-live-value]').textContent;`)) === '\u20B92,450' &&
      (await cdp.eval(`return document.querySelector('[data-live-save]').textContent;`)) === '\u20B9951');
    check('a quantity input exists for every rate-card line',
      (await cdp.eval(`return document.querySelectorAll('.modal [data-qty]').length;`)) === 6);
    await screenshot(cdp, 'admin-package-editor');

    // Raise the costume quantity from 3 to 5: +2 x 100 = value 2,650, saving 1,151.
    await cdp.eval(`
      const input = document.querySelector('.modal [data-qty="costume"]');
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await sleep(150);
    check('raising a quantity moves the total actual value immediately',
      (await cdp.eval(`return document.querySelector('[data-live-value]').textContent;`)) === '\u20B92,650',
      await cdp.eval(`return document.querySelector('[data-live-value]').textContent;`));
    check('and the saving follows to \u20B91,151',
      (await cdp.eval(`return document.querySelector('[data-live-save]').textContent;`)) === '\u20B91,151');
    check('and the line value column updates too',
      (await cdp.eval(`return document.querySelector('[data-value-for="costume"]').textContent;`)) === '\u20B9500');

    // Price it above its own value: the editor must say so.
    await cdp.eval(`
      const price = document.querySelector('.modal [name="price"]');
      price.value = '9999';
      price.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await sleep(150);
    check('pricing a package above its own value is called out',
      /costs .* MORE than its parts/i.test(await cdp.eval(`return document.querySelector('[data-live-warn]').textContent;`)),
      await cdp.eval(`return document.querySelector('[data-live-warn]').textContent;`));

    // Break the head count: 6 entry tickets for 3 guests.
    await cdp.eval(`
      const price = document.querySelector('.modal [name="price"]');
      price.value = '1499';
      price.dispatchEvent(new Event('input', { bubbles: true }));
      const adult = document.querySelector('.modal [data-qty="entry-adult"]');
      adult.value = '5';
      adult.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await sleep(150);
    check('a head count that disagrees with the entry tickets is called out',
      /entry ticket\(s\) for 3 guest\(s\)/.test(await cdp.eval(`return document.querySelector('[data-live-warn]').textContent;`)),
      await cdp.eval(`return document.querySelector('[data-live-warn]').textContent;`));

    check('the autofill button fills quantities from the head count', await cdp.eval(`
      document.querySelector('.modal [data-action="autofill"]').click();
      return document.querySelector('[data-qty="entry-adult"]').value === '2'
        && document.querySelector('[data-qty="entry-child"]').value === '1'
        && document.querySelector('[data-qty="costume"]').value === '3'
        && document.querySelector('[data-qty="kids-jumping"]').value === '1';
    `));
    await sleep(150);
    check('after autofill the value is back to \u20B92,450',
      (await cdp.eval(`return document.querySelector('[data-live-value]').textContent;`)) === '\u20B92,450');
    check('no console errors in the package editor', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    await cdp.eval(`document.querySelector('.modal [data-close]').click(); return true;`);

    // ── Admin: the counter booking builder ───────────────────────────────────
    section('Admin console \u2014 the counter booking builder quotes live');
    cdp.clearErrors();
    await cdp.eval(`document.querySelector('[data-action="new-booking"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('.modal [data-q-total]') !== null`, 'the booking builder');
    await waitFor(cdp, `document.querySelector('.modal [data-slots]').options.length > 0
      && !document.querySelector('.modal [data-slots]').options[0].textContent.includes('Loading')`, 'entry slots to load');
    check('entry slots load into the form',
      (await cdp.eval(`return document.querySelector('.modal [data-slots]').options.length;`)) > 0);
    check('slots show how much room is left',
      /left|full/.test(await cdp.eval(`return document.querySelector('.modal [data-slots]').options[0].textContent;`)));

    try {
      await waitFor(cdp, `document.querySelector('[data-q-total]').textContent !== '\u2014'`, 'the first live quote', 40);
    } catch (_e) {
      console.log('      \x1b[33mquote error box:\x1b[0m ' +
        (await cdp.eval(`const e = document.querySelector('[data-q-error]'); return e.hidden ? '(hidden)' : e.textContent;`)));
      console.log('      \x1b[33mform state:\x1b[0m ' + JSON.stringify(await cdp.eval(`
        const out = {};
        document.querySelectorAll('.modal [name]').forEach(el => { out[el.getAttribute('name')] = el.value; });
        return out;
      `)));
    }
    check('a package is quoted by the server as \u20B91,499',
      (await cdp.eval(`return document.querySelector('[data-q-total]').textContent;`)) === '\u20B91,499',
      await cdp.eval(`return document.querySelector('[data-q-total]').textContent;`));
    check('and reports 3 guests',
      (await cdp.eval(`return document.querySelector('[data-q-guests]').textContent;`)) === '3');
    check('and the \u20B9951 saving',
      (await cdp.eval(`return document.querySelector('[data-q-save]').textContent;`)) === '\u20B9951');
    await screenshot(cdp, 'admin-counter-booking');

    // Add two fish spas: 1,499 + 198 = 1,697.
    await cdp.eval(`
      const spa = document.querySelector('.modal [data-addon="fish-spa"]');
      spa.value = '2';
      spa.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await waitFor(cdp, `document.querySelector('[data-q-total]').textContent === '\u20B91,697'`, 'the add-on to be priced');
    check('adding two fish spas re-quotes to \u20B91,697', true);
    check('the breakdown names the add-on total',
      /add-ons \u20B9198/.test(await cdp.eval(`return document.querySelector('[data-q-detail]').textContent;`)),
      await cdp.eval(`return document.querySelector('[data-q-detail]').textContent;`));

    // Switch to per-person and check the editor swaps over.
    await cdp.eval(`
      const mode = document.querySelector('.modal [name="mode"]');
      mode.value = 'individual';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await sleep(200);
    check('switching to per-person hides the package picker',
      await cdp.eval(`return document.querySelector('[data-section="package"]').hidden === true
        && document.querySelector('[data-section="individual"]').hidden === false;`));
    check('every rate-card line is individually editable',
      (await cdp.eval(`return document.querySelectorAll('.modal [data-line]').length;`)) === 6);

    // One adult entry only: 550 + the two fish spas already added = 748.
    await cdp.eval(`
      const adult = document.querySelector('.modal [data-line="entry-adult"]');
      adult.value = '1';
      adult.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await waitFor(cdp, `document.querySelector('[data-q-total]').textContent === '\u20B9748'`, 'the per-person quote');
    check('one adult entry plus the add-ons quotes \u20B9748', true);
    check('a per-person booking reports no saving',
      (await cdp.eval(`return document.querySelector('[data-q-save]').textContent;`)) === '\u2014');

    // An order with no entry ticket must be refused, and say so in the form.
    await cdp.eval(`
      const adult = document.querySelector('.modal [data-line="entry-adult"]');
      adult.value = '0';
      adult.dispatchEvent(new Event('input', { bubbles: true }));
      const costume = document.querySelector('.modal [data-line="costume"]');
      costume.value = '2';
      costume.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await waitFor(cdp, `!document.querySelector('[data-q-error]').hidden`, 'the validation error');
    check('an order with no entry ticket is refused in the form',
      /entry ticket/i.test(await cdp.eval(`return document.querySelector('[data-q-error]').textContent;`)),
      await cdp.eval(`return document.querySelector('[data-q-error]').textContent;`));

    // Now actually sell one per person, and confirm the ledger picks it up.
    await cdp.eval(`
      const adult = document.querySelector('.modal [data-line="entry-adult"]');
      adult.value = '2';
      adult.dispatchEvent(new Event('input', { bubbles: true }));
      const child = document.querySelector('.modal [data-line="entry-child"]');
      child.value = '1';
      child.dispatchEvent(new Event('input', { bubbles: true }));
      const spa = document.querySelector('.modal [data-addon="fish-spa"]');
      spa.value = '0';
      spa.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.modal [name="guestName"]').value = 'Sharma family';
      document.querySelector('.modal [name="guestPhone"]').value = '9303017878';
      return true;
    `);
    // 2 x 550 + 350 + 2 costume x 100 = 1,650
    await waitFor(cdp, `document.querySelector('[data-q-total]').textContent === '\u20B91,650'`, 'the final quote');
    check('the walk-up order prices at \u20B91,650', true);
    await cdp.eval(`document.querySelector('.modal [data-confirm]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('.modal') === null`, 'the sale to complete');
    await waitFor(cdp, `document.querySelector('[data-rows] tr[data-search]') !== null`, 'the ledger to reload');

    const ledger = await cdp.eval(`
      return [...document.querySelectorAll('[data-rows] tr[data-search]')].map(tr =>
        [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
    `);
    check('the pass appears in the ledger', ledger.length === 1, `got ${ledger.length}`);
    check('it is named after the walk-up guest', /Sharma family/.test(ledger[0][1]), ledger[0][1]);
    check('it is labelled a per-person sale', /Per person/.test(ledger[0][3]), ledger[0][3]);
    check('it records 3 guests and \u20B91,650 taken',
      ledger[0][4] === '3' && ledger[0][5] === '\u20B91,650', JSON.stringify(ledger[0].slice(4, 6)));
    check('it is flagged as a counter sale', /counter/.test(ledger[0][1]), ledger[0][1]);
    check('it offers a check-in button',
      await cdp.eval(`return document.querySelector('[data-checkin]') !== null;`));
    check('the revenue stat card picked it up',
      /1,650/.test(await cdp.eval(`return document.querySelector('.stat-card__value').textContent;`)),
      await cdp.eval(`return document.querySelector('.stat-card__value').textContent;`));
    check('no console errors through the whole counter sale', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    check('no uncaught exceptions through the whole counter sale', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));
    await screenshot(cdp, 'admin-waterpark-ledger');

    section('Admin console \u2014 the gate');
    cdp.clearErrors();
    await cdp.eval(`document.querySelector('[data-checkin]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('[data-undo-checkin]') !== null`, 'the check-in to register');
    check('checking a pass in flips it to arrived',
      await cdp.eval(`return /In at/.test(document.querySelector('[data-rows] tr[data-search]').textContent);`));
    check('the ledger filter can isolate arrivals', await cdp.eval(`
      const sel = document.querySelector('[data-filter-status]');
      sel.value = 'pending-gate';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const rows = [...document.querySelectorAll('[data-rows] tr[data-search]')];
      return rows.every(r => r.hidden);
    `));
    check('and the text filter matches on guest name', await cdp.eval(`
      const sel = document.querySelector('[data-filter-status]');
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const box = document.querySelector('[data-filter-text]');
      box.value = 'sharma';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = [...document.querySelectorAll('[data-rows] tr[data-search]')];
      if (rows.some(r => r.hidden)) return false;
      box.value = 'nobody';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return rows.every(r => r.hidden);
    `));
    check('no console errors at the gate', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));

    section('Admin console \u2014 editing a rate reprices both packages on screen');
    cdp.clearErrors();
    await cdp.eval(`document.querySelector('[data-item-edit="entry-adult"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('.modal [name="rate"]') !== null`, 'the rate editor');
    await cdp.eval(`
      const rate = document.querySelector('.modal [name="rate"]');
      rate.value = '600';
      rate.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.modal [data-confirm]').click();
      return true;
    `);
    await waitFor(cdp, `document.querySelector('.modal') === null`, 'the rate to save');
    await waitFor(cdp, `document.querySelector('.wp-pack') !== null`, 'the tab to reload');
    const afterRaise = await cdp.eval(`
      return [...document.querySelectorAll('.wp-pack')].map(el => ({
        code: el.querySelector('.wp-pack__code').textContent.trim(),
        total: el.querySelector('.wp-break tfoot td.num').textContent.trim(),
        save: el.querySelectorAll('.wp-price__value')[1].textContent.trim(),
      }));
    `);
    check('raising the adult rate to \u20B9600 moves A to \u20B92,550 / save \u20B91,051',
      afterRaise.find((c) => c.code === 'A').total === '\u20B92,550' &&
      afterRaise.find((c) => c.code === 'A').save === '\u20B91,051', JSON.stringify(afterRaise));
    check('and B to \u20B93,300 / save \u20B91,501',
      afterRaise.find((c) => c.code === 'B').total === '\u20B93,300' &&
      afterRaise.find((c) => c.code === 'B').save === '\u20B91,501', JSON.stringify(afterRaise));
    check('the rate card shows the new rate',
      /\u20B9600/.test(await cdp.eval(`
        const panels = [...document.querySelectorAll('.panel')];
        const panel = panels.find(p => (p.querySelector('.panel__title')||{}).textContent === 'Rate card');
        return panel.querySelector('tbody tr').textContent;
      `)));
    check('no console errors while repricing', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));

    // Put it back so the customer-app checks below see poster prices.
    await fetch(`${BASE}/api/admin/waterpark/items/entry-adult`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ label: 'Water Park Entry \u2013 Adult', rate: 550, unit: 'adult', entry: true, active: true }),
    });

    section('Admin console \u2014 the dashboard');
    cdp.clearErrors();
    await open(`${BASE}/admin/#dashboard`, admin, `document.querySelector('.stat-card') !== null`, 'the dashboard');
    check('the dashboard carries a water park revenue card',
      await cdp.eval(`return [...document.querySelectorAll('.stat-card__label')].some(l => /Water park revenue/i.test(l.textContent));`));
    check('and a water park guests card',
      await cdp.eval(`return [...document.querySelectorAll('.stat-card__label')].some(l => /Water park guests/i.test(l.textContent));`));
    check('no console errors on the dashboard', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));

    // ── Customer app ─────────────────────────────────────────────────────────
    section('Customer app \u2014 the Water Park tab');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 420, height: 900, deviceScaleFactor: 2, mobile: true,
    });
    cdp.clearErrors();
    await open(`${BASE}/#/waterpark`, customer, `document.querySelector('.wp-pack-card') !== null`, 'the package cards');

    check('the tab bar shows a Water Park entry',
      await cdp.eval(`return [...document.querySelectorAll('.tabbar__item span')].some(s => /Water Park/i.test(s.textContent));`));
    check('and it is the active tab',
      await cdp.eval(`const b = document.querySelector('[data-tab="waterpark"]'); return b && b.getAttribute('aria-current') === 'page';`));
    check('the headline is shown', await cdp.eval(`return /Family Fun Day/i.test(document.body.textContent);`));

    const custCards = await cdp.eval(`
      return [...document.querySelectorAll('.wp-pack-card')].map(el => ({
        text: el.textContent.replace(/\\s+/g, ' ').trim(),
        rows: el.querySelectorAll('.wp-brk tbody tr').length,
      }));
    `);
    check('both packages are offered', custCards.length === 2, `got ${custCards.length}`);
    check('package A shows its value, price and saving',
      /\u20B92,450/.test(custCards[0].text) && /\u20B91,499/.test(custCards[0].text) && /951/.test(custCards[0].text),
      custCards[0].text.slice(0, 200));
    check('package B shows its value, price and saving',
      /\u20B93,200/.test(custCards[1].text) && /\u20B91,799/.test(custCards[1].text) && /1,401/.test(custCards[1].text),
      custCards[1].text.slice(0, 200));
    check('the value breakup is itemised for the guest', custCards[0].rows === 6, String(custCards[0].rows));
    check('the add-ons are listed with prices',
      await cdp.eval(`return /Fish Spa/.test(document.body.textContent) && /\u20B9199/.test(document.body.textContent);`));
    check("the what's-included strip is shown",
      await cdp.eval(`return document.querySelectorAll('.wp-incl-item').length === 5;`));
    check('the one-day validity note is shown',
      await cdp.eval(`return /one day only/i.test(document.body.textContent);`));
    check('a per-person option is offered',
      await cdp.eval(`return document.querySelector('[data-action="build-own"]') !== null;`));
    check('no console errors on the tab', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    check('no uncaught exceptions on the tab', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));
    await screenshot(cdp, 'app-waterpark');

    section('Customer app \u2014 booking a package');
    cdp.clearErrors();
    await cdp.eval(`document.querySelector('[data-book="family-of-3"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('[data-wp-total]') !== null`, 'the booking screen');
    await waitFor(cdp, `document.querySelector('[data-wp-total]').textContent.indexOf('\u2014') === -1`, 'the live quote');
    check('the booking screen quotes \u20B91,499',
      /1,499/.test(await cdp.eval(`return document.querySelector('[data-wp-total]').textContent;`)),
      await cdp.eval(`return document.querySelector('[data-wp-total]').textContent;`));
    check('entry slots are offered',
      (await cdp.eval(`return document.querySelectorAll('[data-slot]').length;`)) > 0);
    check('the guest can pick a date',
      await cdp.eval(`return document.querySelector('[data-wp-date]') !== null;`));
    await screenshot(cdp, 'app-waterpark-book');

    await cdp.eval(`
      const spa = document.querySelector('[data-addon="fish-spa"] [data-plus]');
      if (spa) spa.click();
      return true;
    `);
    await waitFor(cdp, `/1,598/.test(document.querySelector('[data-wp-total]').textContent)`, 'the add-on to price');
    check('adding a fish spa re-quotes to \u20B91,598', true);

    await cdp.eval(`document.querySelector('[data-action="pay"]').click(); return true;`);
    await waitFor(cdp, `/waterpark\\/pass/.test(location.hash)`, 'the pass screen', 120);
    check('paying issues a pass', await cdp.eval(`return /waterpark\\/pass/.test(location.hash);`));
    check('the pass shows a WP reference',
      await cdp.eval(`return /WP[0-9A-Z]{8}/.test(document.body.textContent);`));
    check('the pass shows a scannable barcode',
      await cdp.eval(`return document.querySelector('img[src*="barcode.svg"]') !== null;`));
    check('the pass repeats the saving', await cdp.eval(`return /951/.test(document.body.textContent);`));
    check('no console errors while booking', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    check('no uncaught exceptions while booking', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));
    await screenshot(cdp, 'app-waterpark-pass');

    section('Customer app \u2014 building a day person by person');
    cdp.clearErrors();
    await open(`${BASE}/#/waterpark`, customer, `document.querySelector('[data-action="build-own"]') !== null`, 'the tab');
    await cdp.eval(`document.querySelector('[data-action="build-own"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('[data-line]') !== null`, 'the per-person builder');
    check('every rate-card line is editable by the guest',
      (await cdp.eval(`return document.querySelectorAll('[data-line]').length;`)) === 6);
    check('each line shows its own rate',
      await cdp.eval(`return /\u20B9550/.test(document.body.textContent) && /\u20B9350/.test(document.body.textContent);`));
    await cdp.eval(`
      const plus = document.querySelector('[data-line="entry-adult"] [data-plus]');
      plus.click();
      return true;
    `);
    await waitFor(cdp, `/550/.test(document.querySelector('[data-wp-total]').textContent)`, 'the per-person quote');
    check('adding one adult entry quotes \u20B9550', true);
    check('the guest is nudged that a package is better value',
      await cdp.eval(`return /package/i.test(document.body.textContent);`));
    await screenshot(cdp, 'app-waterpark-individual');
    check('no console errors in the builder', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    check('no uncaught exceptions in the builder', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));

    // ── Account screen ───────────────────────────────────────────────────────
    section('Customer app \u2014 the Account screen is grouped as specified');
    cdp.clearErrors();
    await open(`${BASE}/#/account`, customer, `document.querySelector('.list .row') !== null`, 'the account rows');

    /* The rows must appear in the requested order, in five separated groups:
       (1) Movie Tickets, Movie Food & Beverages | (2) Hotel Reservations,
       Restaurant Reservations | (3) Waterpark Bookings | (4) General |
       (5) About. */
    const groups = await cdp.eval(`
      const scroll = document.querySelector('.scroll');
      const out = [];
      scroll.querySelectorAll('.list').forEach(list => {
        const label = list.previousElementSibling &&
          list.previousElementSibling.classList.contains('list__group-label')
            ? list.previousElementSibling.textContent.trim() : null;
        out.push({
          label: label,
          separated: Boolean(list.previousElementSibling &&
            (list.previousElementSibling.classList.contains('list__sep') ||
             list.previousElementSibling.classList.contains('profile__divider'))),
          rows: [...list.querySelectorAll('.row__label')].map(r => r.textContent.trim()),
        });
      });
      return out;
    `);

    check('there are five groups of rows', groups.length === 5,
      JSON.stringify(groups.map((g) => g.rows)));
    check('group 1 is Movie Tickets then Movie Food & Beverages',
      String(groups[0] && groups[0].rows) === 'Movie Tickets,Movie Food & Beverages',
      JSON.stringify(groups[0]));
    check('group 2 is Hotel Reservations then Restaurant Reservations',
      String(groups[1] && groups[1].rows) === 'Hotel Reservations,Restaurant Reservations',
      JSON.stringify(groups[1]));
    check('group 3 is Waterpark Bookings on its own',
      String(groups[2] && groups[2].rows) === 'Waterpark Bookings',
      JSON.stringify(groups[2]));
    check('group 4 is the General section',
      groups[3] && groups[3].label === 'General', JSON.stringify(groups[3] && groups[3].label));
    check('group 5 is the About section',
      groups[4] && groups[4].label === 'About', JSON.stringify(groups[4] && groups[4].label));
    check('the first three groups are visually separated by dividers',
      groups[0].separated && groups[1].separated && groups[2].separated,
      JSON.stringify(groups.slice(0, 3).map((g) => g.separated)));

    /* A divider that renders the same as the hairline between two rows would
       not read as a group break at all, so measure it. */
    const gaps = await cdp.eval(`
      const lists = [...document.querySelectorAll('.scroll .list')];
      const rowsIn = i => [...lists[i].querySelectorAll('.row')];
      const bottom = el => el.getBoundingClientRect().bottom;
      const top = el => el.getBoundingClientRect().top;
      const g0 = rowsIn(0);
      const withinGroup = Math.round(top(g0[1]) - bottom(g0[0]));
      const betweenGroups = Math.round(top(rowsIn(1)[0]) - bottom(g0[g0.length - 1]));
      return { withinGroup, betweenGroups };
    `);
    check('a group break is visibly wider than the gap between rows in a group',
      gaps.betweenGroups >= gaps.withinGroup + 20,
      `within ${gaps.withinGroup}px vs between ${gaps.betweenGroups}px`);

    const accountText = await cdp.eval(`return document.querySelector('.scroll').textContent;`);
    check('Watchlist is gone from the account screen', !/Watchlist/i.test(accountText));
    check('Movie Interest is gone from the account screen', !/Movie Interest/i.test(accountText));
    check('Payment Methods is gone from the account screen', !/Payment Method/i.test(accountText));
    check('the Points stat is gone', !/Points/i.test(accountText), accountText.slice(0, 160));
    check('Bookings and Spent stats remain',
      (await cdp.eval(`return document.querySelectorAll('.stat').length;`)) === 2);
    check('the two remaining stats fill the strip evenly', await cdp.eval(`
      const cells = [...document.querySelectorAll('.stat')];
      const widths = cells.map(c => Math.round(c.getBoundingClientRect().width));
      return widths.length === 2 && Math.abs(widths[0] - widths[1]) <= 1 && widths[0] > 120;
    `), await cdp.eval(`return JSON.stringify([...document.querySelectorAll('.stat')].map(c => Math.round(c.getBoundingClientRect().width)));`));
    check('General still offers Personal Info, Notification, Security, Language and Dark Mode',
      String(groups[3].rows) === 'Personal Info,Notification,Security,Language,Dark Mode',
      JSON.stringify(groups[3].rows));
    check('no console errors on the account screen', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    check('no uncaught exceptions on the account screen', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));
    await screenshot(cdp, 'app-account');

    section('Customer app \u2014 every Account row lands somewhere real');
    for (const [label, expectHash, ready, expectHeading] of [
      ['Movie Tickets', '#/tickets?type=movie', `document.querySelector('.appbar__title') !== null`, 'Movie Tickets'],
      ['Movie Food & Beverages', '#/tickets?type=food', `document.querySelector('.appbar__title') !== null`, 'Food & Beverages'],
      ['Hotel Reservations', '#/tickets?type=hotel', `document.querySelector('.appbar__title') !== null`, 'Hotel Reservations'],
      ['Restaurant Reservations', '#/account/restaurant', `document.querySelector('.appbar__title') !== null`, 'Restaurant Reservations'],
      ['Waterpark Bookings', '#/account/waterpark', `document.querySelector('.appbar__title') !== null`, 'Waterpark Bookings'],
    ]) {
      cdp.clearErrors();
      await open(`${BASE}/#/account`, customer, `document.querySelector('.list .row') !== null`, 'the account rows');
      await cdp.eval(`
        const row = [...document.querySelectorAll('.row')]
          .find(r => r.querySelector('.row__label').textContent.trim() === ${JSON.stringify(label)});
        row.click();
        return true;
      `);
      await waitFor(cdp, ready, `the ${label} screen`);
      await sleep(400);
      const hash = await cdp.eval(`return location.hash;`);
      const heading = await cdp.eval(`return document.querySelector('.appbar__title').textContent.trim();`);
      check(`"${label}" opens ${expectHash}`, hash === expectHash, hash);
      check(`and its screen is titled "${expectHeading}"`, heading === expectHeading, heading);
      /* Each row is its own section, so nothing on it may offer to switch to a
         different booking type — that is what made it feel like a tab. */
      check(`and it shows no booking-type switcher`,
        await cdp.eval(`return document.querySelector('[data-types]') === null
          && document.querySelector('[data-type]') === null;`));
      check(`and it offers a way back to Account`,
        await cdp.eval(`return document.querySelector('[data-action="back"]') !== null;`));
      check(`and renders with no console errors`,
        cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
        [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));
    }



    section('Customer app \u2014 the water park pass is listed under Account');
    cdp.clearErrors();
    await open(`${BASE}/#/account/waterpark`, customer, `document.querySelector('.card') !== null`, 'the pass list');
    check('the pass bought earlier is listed',
      await cdp.eval(`return /WP[0-9A-Z]{8}/.test(document.body.textContent);`));
    check('it shows the package name and guest count',
      await cdp.eval(`return /Family of 3/.test(document.body.textContent) && /3 guests/.test(document.body.textContent);`),
      await cdp.eval(`return document.querySelector('.ticket__text').textContent;`));
    check('tapping it opens the pass with its barcode', await cdp.eval(`
      document.querySelector('[data-action="open"]').click();
      return true;
    `));
    await waitFor(cdp, `document.querySelector('img[src*="barcode.svg"]') !== null`, 'the pass barcode');
    check('the pass screen renders its gate barcode', true);
    check('no console errors in the pass list', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));

    section('Customer app \u2014 checkout no longer offers saved cards');
    cdp.clearErrors();
    await open(`${BASE}/#/movie/mov_jawan`, customer, `document.querySelector('.detail-head__title') !== null`, 'the movie detail');
    check('the watchlist heart is gone from the movie detail',
      await cdp.eval(`return document.querySelector('[data-action="watchlist"]') === null;`));
    check('the share button is still there',
      await cdp.eval(`return document.querySelector('[data-action="share"]') !== null;`));
    check('no console errors on the movie detail', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));

    cdp.clearErrors();
    await open(`${BASE}/#/home`, customer, `document.querySelector('.screen') !== null`, 'home');
    await sleep(400);
    check('the "Because you like" rail is gone from Home',
      await cdp.eval(`return !/Because you like/i.test(document.body.textContent);`));
    check('Home still renders its Now Playing rail',
      await cdp.eval(`return /Now Playing/i.test(document.body.textContent);`));
    check('no console errors on Home', cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
      [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));

    section('Admin console \u2014 the Points column is gone');
    cdp.clearErrors();
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1500, height: 1400, deviceScaleFactor: 1, mobile: false,
    });
    await open(`${BASE}/admin/#customers`, admin, `document.querySelector('[data-rows] tr') !== null`, 'the customers table');
    const custHeaders = await cdp.eval(`
      return [...document.querySelectorAll('thead th')].map(th => th.textContent.trim());
    `);
    check('the customers table has no Points column', !custHeaders.includes('Points'), JSON.stringify(custHeaders));
    check('every row has one cell per header', await cdp.eval(`
      const headers = document.querySelectorAll('thead th').length;
      const rows = [...document.querySelectorAll('[data-rows] tr')];
      return rows.length > 0 && rows.every(r => r.querySelectorAll('td').length === headers);
    `), `headers ${custHeaders.length}`);
    check('no console errors on the customers page', cdp.consoleErrors.length === 0, cdp.consoleErrors.join(' | '));
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 420, height: 900, deviceScaleFactor: 2, mobile: true,
    });

    /* The saved-card pickers were replaced with a plain method choice in three
       checkouts. These drive two of them for real, because a picker that fails
       to set state would still look fine on screen. */
    section('Customer app \u2014 the food checkout pays with a chosen method');
    cdp.clearErrors();
    const anItem = (await api('GET', '/api/food/home')).body.rails
      .flatMap((r) => r.items)
      .find((i) => i.price > 0);
    await cdp.send('Page.navigate', { url: `${BASE}/blank-for-origin` });
    await sleep(250);
    await cdp.eval(`
      localStorage.setItem('cineflex.token', ${JSON.stringify(customer)});
      localStorage.setItem('cineflex.cart', JSON.stringify([{
        itemId: ${JSON.stringify(anItem.id)},
        name: ${JSON.stringify(anItem.name)},
        price: ${anItem.price},
        imageUrl: ${JSON.stringify(anItem.imageUrl || '')},
        qty: 2,
      }]));
      return true;
    `);
    cdp.clearErrors();
    await cdp.send('Page.navigate', { url: `${BASE}/#/food/cart` });
    await waitFor(cdp, `document.querySelector('[data-action="method"]') !== null`, 'the food payment options');
    check('the food checkout lists the payment methods',
      (await cdp.eval(`return document.querySelectorAll('[data-action="method"]').length;`)) === 4);
    check('no saved-card picker remains',
      await cdp.eval(`return document.querySelector('[data-action="pick-payment"]') === null;`));
    check('UPI is preselected',
      await cdp.eval(`return document.querySelector('[data-action="method"][data-id="upi"]').getAttribute('aria-pressed') === 'true';`));
    check('choosing "Pay at counter" moves the selection', await cdp.eval(`
      document.querySelector('[data-action="method"][data-id="cash"]').click();
      return document.querySelector('[data-action="method"][data-id="cash"]').getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-action="method"][data-id="upi"]').getAttribute('aria-pressed') === 'false';
    `));
    await screenshot(cdp, 'app-food-checkout');

    const ordersBefore = (await api('GET', '/api/bookings?type=food&bucket=all', null, customer)).body.bookings.length;
    await cdp.eval(`
      const btn = document.querySelector('[data-action="place"]');
      if (btn) btn.click();
      return true;
    `);
    await sleep(1800);
    const ordersAfter = (await api('GET', '/api/bookings?type=food&bucket=all', null, customer)).body.bookings;
    check('the order is actually placed', ordersAfter.length === ordersBefore + 1,
      `${ordersBefore} -> ${ordersAfter.length}`);
    check('and it records the chosen method as pay-at-counter',
      ordersAfter[0] && ordersAfter[0].payment.method === 'cash' && ordersAfter[0].payment.status === 'pending',
      ordersAfter[0] && JSON.stringify(ordersAfter[0].payment));
    check('no console errors through the food checkout',
      cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
      [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));

    section('Customer app \u2014 the movie checkout pays with a chosen method');
    cdp.clearErrors();
    /* Must be a show that has not started, or the seat hold is refused with
       "This show has already started" depending on the time of day. */
    const showDay = new Date();
    showDay.setDate(showDay.getDate() + 2);
    const someShow = (await api('GET', `/api/movies/mov_jawan/showtimes?date=${showDay.toISOString().slice(0, 10)}`))
      .body.cinemas.flatMap((c) => c.shows).find((s) => !s.isPast && !s.soldOut);
    check('a future showtime is available to book', Boolean(someShow));
    await open(`${BASE}/#/seats/${someShow.id}`, customer,
      `document.querySelector('[data-seat][data-status="available"]') !== null`, 'the seat map');
    check('the seat map renders', true);
    await cdp.eval(`
      const free = [...document.querySelectorAll('[data-seat][data-status="available"]')].slice(0, 2);
      free.forEach(s => s.click());
      return true;
    `);
    await sleep(300);
    await cdp.eval(`document.querySelector('[data-action="proceed"]').click(); return true;`);
    await waitFor(cdp, `document.querySelector('[data-action="method"]') !== null`, 'the movie payment options', 120);
    check('the movie checkout lists the payment methods',
      (await cdp.eval(`return document.querySelectorAll('[data-action="method"]').length;`)) === 4);
    check('UPI is preselected there too',
      await cdp.eval(`return document.querySelector('[data-action="method"][data-id="upi"]').getAttribute('aria-pressed') === 'true';`));
    await screenshot(cdp, 'app-movie-checkout');

    await cdp.eval(`
      document.querySelector('[data-action="method"][data-id="netbanking"]').click();
      return true;
    `);
    await sleep(200);
    await cdp.eval(`document.querySelector('[data-action="pay"]').click(); return true;`);
    await waitFor(cdp, `/\\/confirmed\\//.test(location.hash)`, 'the confirmation screen', 120);
    check('paying issues a movie ticket', await cdp.eval(`return /\\/confirmed\\//.test(location.hash);`));
    check('the confirmation shows no reward-points line',
      await cdp.eval(`return !/reward point/i.test(document.body.textContent);`));
    /* Read back the booking just created, by id from the confirmation URL —
       the demo seed contains older bookings that would otherwise be picked up. */
    const newBookingId = await cdp.eval(`return location.hash.split('/confirmed/')[1];`);
    const movieBooking = (await api('GET', `/api/bookings/${newBookingId}`, null, customer)).body.booking;
    check('the booking records the method chosen in the picker',
      movieBooking && movieBooking.payment.method === 'netbanking',
      movieBooking && JSON.stringify(movieBooking.payment));
    check('and it carries the generic method label, not a saved card',
      movieBooking && movieBooking.payment.methodLabel === 'Net Banking',
      movieBooking && movieBooking.payment.methodLabel);
    check('no console errors through the movie checkout',
      cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
      [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));

    /* Runs after both checkouts above, so a food order and a movie ticket both
       exist in the polymorphic bookings collection. That is what makes this
       meaningful: it proves each section filters, rather than showing the same
       list under a different heading. */
    section('Customer app \u2014 each section shows only its own bookings');
    cdp.clearErrors();
    await open(`${BASE}/#/tickets?type=food`, customer, `document.querySelector('[data-list]') !== null`, 'the food section');
    await waitFor(cdp, `document.querySelector('[data-list] .card') !== null`, 'the food order to list');
    const foodSection = await cdp.eval(`return document.querySelector('[data-list]').textContent;`);
    check('the Food & Beverages section lists the food order',
      /Food/i.test(foodSection), foodSection.slice(0, 140));
    check('and does not list the movie ticket', !/Jawan/i.test(foodSection), foodSection.slice(0, 140));
    check('the status tabs are still offered inside a section',
      (await cdp.eval(`return document.querySelectorAll('[data-bucket]').length;`)) === 3);
    check('no console errors in the food section',
      cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
      [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));
    await screenshot(cdp, 'app-section-food');

    cdp.clearErrors();
    await open(`${BASE}/#/tickets?type=movie`, customer, `document.querySelector('[data-list]') !== null`, 'the movie section');
    await waitFor(cdp, `document.querySelector('[data-list] .card') !== null`, 'the movie ticket to list');
    const movieSection = await cdp.eval(`return document.querySelector('[data-list]').textContent;`);
    check('the Movie Tickets section lists the movie ticket', /Jawan/i.test(movieSection), movieSection.slice(0, 140));
    check('and does not list the food order', !/Food & Beverages/i.test(movieSection), movieSection.slice(0, 140));
    check('no console errors in the movie section',
      cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
      [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));
    await screenshot(cdp, 'app-section-movie');

    section('Customer app \u2014 the other tabs still work');
    for (const [hash, ready, label] of [
      ['#/home', `document.querySelector('.screen') !== null`, 'Movie'],
      ['#/hotels', `document.querySelector('.screen') !== null`, 'Stay'],
      ['#/dine-in', `document.querySelector('.screen') !== null`, 'Dine-In'],
      ['#/account', `document.querySelector('.screen') !== null`, 'Account'],
    ]) {
      cdp.clearErrors();
      await open(`${BASE}/${hash}`, customer, ready, label);
      await sleep(300);
      check(`${label} still renders with no console errors`,
        cdp.consoleErrors.length === 0 && cdp.pageErrors.length === 0,
        [].concat(cdp.consoleErrors, cdp.pageErrors).join(' | '));
    }
    check('the tab bar now has six tabs',
      (await cdp.eval(`return document.querySelectorAll('.tabbar__item').length;`)) === 6,
      String(await cdp.eval(`return document.querySelectorAll('.tabbar__item').length;`)));
  } catch (err) {
    failed += 1;
    failures.push(`Harness error: ${err.message}`);
    console.error('\n\x1b[31mHarness error:\x1b[0m', err);
    if (serverLog.length) console.error('\nServer output (tail):\n' + serverLog.join('').split('\n').slice(-25).join('\n'));
    if (chromeLog.length) console.error('\nChrome output (tail):\n' + chromeLog.join('').split('\n').slice(-10).join('\n'));
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
