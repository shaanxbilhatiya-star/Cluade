'use strict';
/**
 * Tab slider end-to-end test.
 *
 * Proves the promo slider is genuinely admin-driven: what the admin saves is
 * what each customer tab is served, a slide is only tappable to an in-app path,
 * and the scroll speed is a setting rather than a constant.
 *
 *   npm run test:promos
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3948;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cineflex-promos-'));

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

/** The four tabs, and where each one's slider is embedded in its payload. */
const TABS = [
  { section: 'movie', endpoint: '/api/home' },
  { section: 'stay', endpoint: '/api/hotels' },
  { section: 'dinein', endpoint: '/api/dine-in' },
  { section: 'waterpark', endpoint: '/api/waterpark' },
];

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

    const adminLogin = await api('POST', '/api/auth/login', { body: { email: 'admin@cineflex.com', password: 'admin123' } });
    const adminToken = adminLogin.body.token;
    if (!adminToken) throw new Error('Could not sign in as admin');

    // ── Defaults ──────────────────────────────────────────────────────────────
    section('Every tab ships with a working slider');
    const all = await api('GET', '/api/promos');
    check('GET /api/promos succeeds', all.status === 200, `status ${all.status}`);
    check('it covers all four tabs', all.body.sections.length === 4,
      JSON.stringify(all.body.sections.map((s) => s.section)));
    check('health counts the new collection', (await api('GET', '/api/health')).body.counts.promoSlides > 0);

    for (const tab of TABS) {
      const one = await api('GET', `/api/promos/${tab.section}`);
      check(`${tab.section}: has its own slider`, one.status === 200 && one.body.section === tab.section);
      check(`${tab.section}: is on by default`, one.body.active === true);
      check(`${tab.section}: auto-scrolls every 4.5s by default`, one.body.intervalMs === 4500, `got ${one.body.intervalMs}`);
      check(`${tab.section}: ships at least one slide`, one.body.slides.length > 0, `got ${one.body.slides.length}`);
      check(`${tab.section}: every slide has an image`, one.body.slides.every((s) => Boolean(s.imageUrl)));
      check(`${tab.section}: no slide links outside the app`,
        one.body.slides.every((s) => !s.ctaPath || s.ctaPath.startsWith('/')),
        JSON.stringify(one.body.slides.map((s) => s.ctaPath)));
    }

    const unknown = await api('GET', '/api/promos/nope');
    check('an unknown section is refused', unknown.status === 400, `status ${unknown.status}`);

    // ── Embedded in the tab payloads ──────────────────────────────────────────
    section('Each tab payload carries its own slider, so the app needs no extra call');
    for (const tab of TABS) {
      const payload = await api('GET', tab.endpoint);
      check(`${tab.endpoint} embeds a slider`, Boolean(payload.body.slider), `status ${payload.status}`);
      check(`${tab.endpoint} embeds the right section`,
        payload.body.slider.section === tab.section, payload.body.slider && payload.body.slider.section);
      const direct = await api('GET', `/api/promos/${tab.section}`);
      check(`${tab.endpoint} matches GET /api/promos/${tab.section}`,
        JSON.stringify(payload.body.slider) === JSON.stringify(direct.body));
    }

    // ── Admin payload ─────────────────────────────────────────────────────────
    section('The admin sees every section, including hidden slides');
    const adminView = await api('GET', '/api/admin/promos', { token: adminToken });
    check('GET /api/admin/promos succeeds', adminView.status === 200, `status ${adminView.status}`);
    check('it requires an admin', (await api('GET', '/api/admin/promos')).status === 401);
    check('it lists all four sections', adminView.body.sections.length === 4);
    check('each section carries its settings and slides',
      adminView.body.sections.every((s) => s.settings && Array.isArray(s.slides) && s.label));
    check('it reports how many slides are live', adminView.body.sections.every((s) => typeof s.liveCount === 'number'));
    check('it exposes the interval bounds for the form',
      adminView.body.intervalBounds.min === 1500 && adminView.body.intervalBounds.max === 30000);

    // ── Adding a slide ────────────────────────────────────────────────────────
    section('Adding a slide puts it on the tab');
    const before = (await api('GET', '/api/promos/waterpark')).body.slides.length;
    const created = await api('POST', '/api/admin/promos', {
      token: adminToken,
      body: {
        section: 'waterpark',
        title: 'Monsoon splash',
        subtitle: 'Half price on rainy weekdays',
        imageUrl: '/img/banners/weekend-cashback.svg',
        ctaLabel: 'Book now',
        ctaPath: '/waterpark',
      },
    });
    check('a slide can be added', created.status === 201, `status ${created.status}: ${created.body?.error}`);
    check('it lands at the end of the order',
      created.body.slides[created.body.slides.length - 1].id === created.body.slide.id);

    const afterAdd = await api('GET', '/api/promos/waterpark');
    check('the tab serves it immediately', afterAdd.body.slides.length === before + 1);
    check('with its heading, link and artwork intact', (() => {
      const s = afterAdd.body.slides.find((x) => x.id === created.body.slide.id);
      return s && s.title === 'Monsoon splash' && s.ctaPath === '/waterpark' &&
        s.imageUrl === '/img/banners/weekend-cashback.svg';
    })());
    check('and the water park tab payload shows it too',
      (await api('GET', '/api/waterpark')).body.slider.slides.some((s) => s.title === 'Monsoon splash'));

    // ── Validation ────────────────────────────────────────────────────────────
    section('A slide cannot be saved in a broken state');
    const noImage = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'movie', title: 'No art' },
    });
    check('a slide without an image is refused', noImage.status === 400, noImage.body?.error);

    const badSection = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'lobby', imageUrl: '/img/logo.svg' },
    });
    check('an unknown section is refused', badSection.status === 400, badSection.body?.error);

    const jsLink = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'movie', imageUrl: '/img/logo.svg', ctaPath: 'javascript:alert(1)' },
    });
    check('a javascript: link is refused', jsLink.status === 400, jsLink.body?.error);

    const external = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'movie', imageUrl: '/img/logo.svg', ctaPath: 'https://example.com' },
    });
    check('an external link is refused', external.status === 400, external.body?.error);

    const protocolRelative = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'movie', imageUrl: '/img/logo.svg', ctaPath: '//example.com' },
    });
    check('a protocol-relative link is refused', protocolRelative.status === 400, protocolRelative.body?.error);

    const relative = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'movie', imageUrl: '/img/logo.svg', ctaPath: 'waterpark' },
    });
    check('a link without a leading slash is refused', relative.status === 400, relative.body?.error);

    const danglingLabel = await api('POST', '/api/admin/promos', {
      token: adminToken, body: { section: 'movie', imageUrl: '/img/logo.svg', ctaLabel: 'Go' },
    });
    check('a button label with nowhere to go is refused', danglingLabel.status === 400, danglingLabel.body?.error);

    // ── Editing and hiding ────────────────────────────────────────────────────
    section('Editing and hiding a slide');
    const edited = await api('PUT', `/api/admin/promos/slides/${created.body.slide.id}`, {
      token: adminToken, body: { title: 'Monsoon splash \u2014 now 50% off' },
    });
    check('a slide can be edited', edited.status === 200 && /50% off/.test(edited.body.slide.title));
    check('editing does not lose the rest of the slide',
      edited.body.slide.ctaPath === '/waterpark' && edited.body.slide.imageUrl === '/img/banners/weekend-cashback.svg');
    check('the tab serves the new wording',
      (await api('GET', '/api/promos/waterpark')).body.slides.some((s) => /50% off/.test(s.title)));

    const hidden = await api('PUT', `/api/admin/promos/slides/${created.body.slide.id}`, {
      token: adminToken, body: { active: false },
    });
    check('a slide can be hidden', hidden.status === 200);
    check('a hidden slide is not served to the app',
      !(await api('GET', '/api/promos/waterpark')).body.slides.some((s) => s.id === created.body.slide.id));
    check('but the admin still sees it', (await api('GET', '/api/admin/promos', { token: adminToken }))
      .body.sections.find((s) => s.id === 'waterpark').slides.some((s) => s.id === created.body.slide.id));
    await api('PUT', `/api/admin/promos/slides/${created.body.slide.id}`, { token: adminToken, body: { active: true } });

    // ── Ordering ──────────────────────────────────────────────────────────────
    section('Reordering slides');
    const order0 = (await api('GET', '/api/promos/waterpark')).body.slides.map((s) => s.id);
    const moved = await api('POST', `/api/admin/promos/slides/${order0[0]}/move`, {
      token: adminToken, body: { direction: 'down' },
    });
    check('a slide can be moved down', moved.status === 200 && moved.body.moved === true);
    const order1 = (await api('GET', '/api/promos/waterpark')).body.slides.map((s) => s.id);
    check('the order the app sees actually changes',
      order1[0] === order0[1] && order1[1] === order0[0], `${order0.join(',')} -> ${order1.join(',')}`);
    check('moving it back restores the order', await (async () => {
      await api('POST', `/api/admin/promos/slides/${order0[0]}/move`, { token: adminToken, body: { direction: 'up' } });
      const back = (await api('GET', '/api/promos/waterpark')).body.slides.map((s) => s.id);
      return back.join(',') === order0.join(',');
    })());
    const offTop = await api('POST', `/api/admin/promos/slides/${order0[0]}/move`, {
      token: adminToken, body: { direction: 'up' },
    });
    check('moving the first slide up is a no-op, not an error',
      offTop.status === 200 && offTop.body.moved === false, `status ${offTop.status}`);
    const badDirection = await api('POST', `/api/admin/promos/slides/${order0[0]}/move`, {
      token: adminToken, body: { direction: 'sideways' },
    });
    check('an unknown direction is refused', badDirection.status === 400);

    // ── Scroll speed ──────────────────────────────────────────────────────────
    section('The scroll speed is a setting, not a constant');
    const faster = await api('PUT', '/api/admin/promos/stay/settings', {
      token: adminToken, body: { intervalMs: 2000 },
    });
    check('the interval can be changed', faster.status === 200 && faster.body.settings.intervalMs === 2000);
    check('the Stay tab is served the new speed',
      (await api('GET', '/api/hotels')).body.slider.intervalMs === 2000);
    check('other tabs are unaffected',
      (await api('GET', '/api/promos/movie')).body.intervalMs === 4500);

    const tooFast = await api('PUT', '/api/admin/promos/stay/settings', { token: adminToken, body: { intervalMs: 200 } });
    check('an unreadably fast interval is refused', tooFast.status === 400, tooFast.body?.error);
    const tooSlow = await api('PUT', '/api/admin/promos/stay/settings', { token: adminToken, body: { intervalMs: 120000 } });
    check('an absurdly slow interval is refused', tooSlow.status === 400, tooSlow.body?.error);
    check('and the rejected values did not stick',
      (await api('GET', '/api/promos/stay')).body.intervalMs === 2000);
    await api('PUT', '/api/admin/promos/stay/settings', { token: adminToken, body: { intervalMs: 4500 } });

    // ── The kill switch ───────────────────────────────────────────────────────
    section('A slider can be switched off per tab');
    const off = await api('PUT', '/api/admin/promos/dinein/settings', { token: adminToken, body: { active: false } });
    check('the Dine-In slider can be switched off', off.status === 200);
    const offSlider = await api('GET', '/api/promos/dinein');
    check('it reports itself inactive', offSlider.body.active === false);
    check('and serves no slides, so the tab renders nothing', offSlider.body.slides.length === 0);
    check('the Dine-In tab payload agrees', (await api('GET', '/api/dine-in')).body.slider.active === false);
    check('other tabs keep their sliders', (await api('GET', '/api/promos/movie')).body.slides.length > 0);
    await api('PUT', '/api/admin/promos/dinein/settings', { token: adminToken, body: { active: true } });
    check('switching it back on restores the slides',
      (await api('GET', '/api/promos/dinein')).body.slides.length > 0);

    // ── Deleting ──────────────────────────────────────────────────────────────
    section('Deleting a slide');
    const del = await api('DELETE', `/api/admin/promos/slides/${created.body.slide.id}`, { token: adminToken });
    check('a slide can be deleted', del.status === 200 && del.body.deleted === true);
    check('and the tab stops serving it',
      !(await api('GET', '/api/promos/waterpark')).body.slides.some((s) => s.id === created.body.slide.id));
    check('deleting it twice is a clean 404',
      (await api('DELETE', `/api/admin/promos/slides/${created.body.slide.id}`, { token: adminToken })).status === 404);

    section('Guests cannot edit sliders');
    const login = await api('POST', '/api/auth/login', { body: { email: 'andrew@example.com', password: '1234' } });
    const userToken = login.body.token;
    check('a customer cannot add a slide',
      (await api('POST', '/api/admin/promos', { token: userToken, body: { section: 'movie', imageUrl: '/img/logo.svg' } })).status === 403);
    check('a customer cannot change the speed',
      (await api('PUT', '/api/admin/promos/movie/settings', { token: userToken, body: { intervalMs: 2000 } })).status === 403);
    check('an anonymous visitor cannot either',
      (await api('PUT', '/api/admin/promos/movie/settings', { body: { intervalMs: 2000 } })).status === 401);
  } catch (err) {
    failed += 1;
    failures.push(`Harness error: ${err.message}`);
    console.error('\n\x1b[31mHarness error:\x1b[0m', err);
    if (serverLog.length) console.error('\nServer output:\n' + serverLog.join('').split('\n').slice(-20).join('\n'));
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
