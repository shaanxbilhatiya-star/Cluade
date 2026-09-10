'use strict';
/**
 * Tab slider end-to-end test.
 *
 * A slider is a list of photos the admin uploads, per tab, plus how fast it
 * advances and whether it shows at all. This proves the photos the admin saves
 * are the photos each tab is served, that an upload is written to disk rather
 * than stored as a giant data: URL, and that the scroll speed is a setting.
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

/** A 1x1 PNG, as the admin photo picker would send it. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

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

    // ── Empty by default ──────────────────────────────────────────────────────
    section('A tab has no slider until the admin adds photos');
    const all = await api('GET', '/api/promos');
    check('GET /api/promos succeeds', all.status === 200, `status ${all.status}`);
    check('it covers all four tabs', all.body.sections.length === 4,
      JSON.stringify(all.body.sections.map((s) => s.section)));
    check('every slider starts empty, so nothing is invented for the admin',
      all.body.sections.every((s) => s.photos.length === 0),
      JSON.stringify(all.body.sections.map((s) => s.photos.length)));
    check('an empty slider reports itself inactive, so the tab renders nothing',
      all.body.sections.every((s) => s.active === false));
    check('the default speed is 4.5s', all.body.sections.every((s) => s.intervalMs === 4500));

    const unknown = await api('GET', '/api/promos/nope');
    check('an unknown section is refused', unknown.status === 400, `status ${unknown.status}`);

    // ── Adding photos ─────────────────────────────────────────────────────────
    section('Adding photos to a tab');
    const added = await api('PUT', '/api/admin/promos/waterpark', {
      token: adminToken,
      body: { photos: ['/img/banners/best-ticket-offers.svg', '/img/banners/popcorn-party.svg'] },
    });
    check('photos can be saved for a tab', added.status === 200, `status ${added.status}: ${added.body?.error}`);
    check('both are stored, in the order given',
      JSON.stringify(added.body.slider.photos) ===
        JSON.stringify(['/img/banners/best-ticket-offers.svg', '/img/banners/popcorn-party.svg']),
      JSON.stringify(added.body.slider.photos));

    const live = await api('GET', '/api/promos/waterpark');
    check('the tab is served them immediately', live.body.photos.length === 2);
    check('and the slider is now active', live.body.active === true);
    check('the water park tab payload carries them too',
      (await api('GET', '/api/waterpark')).body.slider.photos.length === 2);

    section('The order the admin sets is the order guests swipe');
    const reordered = await api('PUT', '/api/admin/promos/waterpark', {
      token: adminToken,
      body: { photos: ['/img/banners/popcorn-party.svg', '/img/banners/best-ticket-offers.svg'] },
    });
    check('reordering is just saving a reordered list', reordered.status === 200);
    check('and the app sees the new order',
      (await api('GET', '/api/promos/waterpark')).body.photos[0] === '/img/banners/popcorn-party.svg');

    section('Removing photos');
    const trimmed = await api('PUT', '/api/admin/promos/waterpark', {
      token: adminToken, body: { photos: ['/img/banners/popcorn-party.svg'] },
    });
    check('a photo can be removed', trimmed.body.slider.photos.length === 1);
    check('one photo still shows (as a still, not a scroller)',
      (await api('GET', '/api/promos/waterpark')).body.photos.length === 1);
    const emptied = await api('PUT', '/api/admin/promos/waterpark', { token: adminToken, body: { photos: [] } });
    check('all photos can be removed', emptied.body.slider.photos.length === 0);
    check('and the tab then shows no slider at all',
      (await api('GET', '/api/promos/waterpark')).body.active === false);
    await api('PUT', '/api/admin/promos/waterpark', {
      token: adminToken,
      body: { photos: ['/img/banners/best-ticket-offers.svg', '/img/banners/popcorn-party.svg'] },
    });

    // ── Uploads ───────────────────────────────────────────────────────────────
    section('An uploaded photo is written to disk, not stored as a data: URL');
    const uploaded = await api('PUT', '/api/admin/promos/movie', {
      token: adminToken, body: { photos: [PNG_DATA_URL, '/img/banners/combo-saver.svg'] },
    });
    check('an upload is accepted', uploaded.status === 200, `status ${uploaded.status}: ${uploaded.body?.error}`);
    const savedPath = uploaded.body.slider.photos[0];
    check('it comes back as an /uploads path', /^\/uploads\/promos\//.test(savedPath || ''), savedPath);
    check('the file is actually served', (await fetch(BASE + savedPath)).status === 200);
    check('an existing path alongside it is left alone',
      uploaded.body.slider.photos[1] === '/img/banners/combo-saver.svg');
    check('the Movie tab is served the uploaded photo',
      (await api('GET', '/api/home')).body.slider.photos[0] === savedPath);

    const junk = await api('PUT', '/api/admin/promos/movie', {
      token: adminToken, body: { photos: ['data:text/html,<script>alert(1)</script>'] },
    });
    check('a non-image data: URL is refused', junk.status === 400, junk.body?.error);
    check('and the message names the format rather than talking about paths',
      /could not be uploaded/.test(junk.body?.error || '') && /text\/html/.test(junk.body?.error || ''),
      junk.body?.error);

    /* GIF and AVIF used to be rejected outright: the upload regex only knew
       png/jpeg/webp, so the file was passed through unsaved and then refused,
       which is what produced the unexplained save failure. */
    section('Every format a browser hands over is stored');
    for (const [label, dataUrl] of [
      ['PNG', PNG_DATA_URL],
      ['GIF', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7'],
      ['JPEG', 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA//9k='],
      ['WEBP', 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='],
      ['AVIF', 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAABCaWluZgAAAAAAAQAAABphdjAxQ29sb3IAAAAAAAAAAAAAAAAAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEDQgMgkQAAAAFLm0lHmm+B0IEA=='],
    ]) {
      const saved = await api('PUT', '/api/admin/promos/movie', { token: adminToken, body: { photos: [dataUrl] } });
      check(`a ${label} upload is accepted`, saved.status === 200, `status ${saved.status}: ${saved.body?.error}`);
      const stored = saved.body.slider && saved.body.slider.photos[0];
      check(`the ${label} is written to /uploads`, /^\/uploads\/promos\//.test(stored || ''), stored);
      check(`and the ${label} file is served back`, stored ? (await fetch(BASE + stored)).status === 200 : false);
    }
    await api('PUT', '/api/admin/promos/movie', {
      token: adminToken, body: { photos: [PNG_DATA_URL, '/img/banners/combo-saver.svg'] },
    });

    section('There is a cap on how many photos a slider holds');
    const many = await api('PUT', '/api/admin/promos/dinein', {
      token: adminToken,
      body: { photos: Array.from({ length: 25 }, (_v, i) => `/img/banners/combo-saver.svg?x=${i}`) },
    });
    check('a huge list is capped rather than rejected', many.status === 200);
    check(`it keeps at most ${10} photos`, many.body.slider.photos.length === 10,
      String(many.body.slider.photos.length));

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
    section('The admin page gets everything it needs in one call');
    const adminView = await api('GET', '/api/admin/promos', { token: adminToken });
    check('GET /api/admin/promos succeeds', adminView.status === 200, `status ${adminView.status}`);
    check('it requires an admin', (await api('GET', '/api/admin/promos')).status === 401);
    check('it lists all four sections with labels', adminView.body.sections.length === 4 &&
      adminView.body.sections.every((s) => s.label));
    check('each section carries its photos, speed and on/off state',
      adminView.body.sections.every((s) => Array.isArray(s.photos) &&
        typeof s.intervalMs === 'number' && typeof s.active === 'boolean'));
    check('it exposes the interval bounds and photo cap for the form',
      adminView.body.intervalBounds.min === 1500 && adminView.body.intervalBounds.max === 30000 &&
      adminView.body.maxPhotos === 10);
    check('a hidden slider still shows its photos to the admin', await (async () => {
      await api('PUT', '/api/admin/promos/stay', {
        token: adminToken, body: { photos: ['/img/banners/weekend-cashback.svg'], active: false },
      });
      const view = await api('GET', '/api/admin/promos', { token: adminToken });
      const stay = view.body.sections.find((s) => s.id === 'stay');
      return stay.photos.length === 1 && stay.active === false;
    })());
    check('while the app is served nothing for it',
      (await api('GET', '/api/promos/stay')).body.photos.length === 0);
    await api('PUT', '/api/admin/promos/stay', { token: adminToken, body: { active: true } });
    check('switching it back on restores the photo',
      (await api('GET', '/api/promos/stay')).body.photos.length === 1);

    // ── Scroll speed ──────────────────────────────────────────────────────────
    section('The scroll speed is a setting, not a constant');
    const faster = await api('PUT', '/api/admin/promos/stay', { token: adminToken, body: { intervalMs: 2000 } });
    check('the interval can be changed', faster.status === 200 && faster.body.slider.intervalMs === 2000);
    check('the Stay tab is served the new speed',
      (await api('GET', '/api/hotels')).body.slider.intervalMs === 2000);
    check('other tabs are unaffected', (await api('GET', '/api/promos/movie')).body.intervalMs === 4500);
    check('changing the speed does not disturb the photos',
      (await api('GET', '/api/promos/stay')).body.photos.length === 1);

    const tooFast = await api('PUT', '/api/admin/promos/stay', { token: adminToken, body: { intervalMs: 200 } });
    check('an unreadably fast interval is refused', tooFast.status === 400, tooFast.body?.error);
    const tooSlow = await api('PUT', '/api/admin/promos/stay', { token: adminToken, body: { intervalMs: 120000 } });
    check('an absurdly slow interval is refused', tooSlow.status === 400, tooSlow.body?.error);
    check('and the rejected values did not stick',
      (await api('GET', '/api/promos/stay')).body.intervalMs === 2000);

    const badSection = await api('PUT', '/api/admin/promos/lobby', { token: adminToken, body: { intervalMs: 3000 } });
    check('an unknown section cannot be configured', badSection.status === 400, badSection.body?.error);

    // ── Persistence ───────────────────────────────────────────────────────────
    section('Photos survive a restart');
    const beforeRestart = (await api('GET', '/api/promos/waterpark')).body.photos;
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 700));
    const restarted = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    restarted.stdout.on('data', (d) => serverLog.push(d.toString()));
    restarted.stderr.on('data', (d) => serverLog.push(d.toString()));
    await waitForServer(restarted);
    const afterRestart = (await api('GET', '/api/promos/waterpark')).body.photos;
    check('the slider photos are still there after a restart',
      JSON.stringify(afterRestart) === JSON.stringify(beforeRestart),
      `${JSON.stringify(beforeRestart)} -> ${JSON.stringify(afterRestart)}`);
    check('and no starter photos are added behind the admin\u2019s back',
      (await api('GET', '/api/promos/waterpark')).body.photos.length === beforeRestart.length);
    restarted.kill('SIGTERM');

    // ── Permissions ───────────────────────────────────────────────────────────
    const relaunched = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    relaunched.stdout.on('data', (d) => serverLog.push(d.toString()));
    relaunched.stderr.on('data', (d) => serverLog.push(d.toString()));
    await waitForServer(relaunched);

    section('Guests cannot edit sliders');
    const login = await api('POST', '/api/auth/login', { body: { email: 'andrew@example.com', password: '1234' } });
    const userToken = login.body.token;
    check('a customer cannot change the photos',
      (await api('PUT', '/api/admin/promos/movie', { token: userToken, body: { photos: [] } })).status === 403);
    check('a customer cannot change the speed',
      (await api('PUT', '/api/admin/promos/movie', { token: userToken, body: { intervalMs: 2000 } })).status === 403);
    check('an anonymous visitor cannot either',
      (await api('PUT', '/api/admin/promos/movie', { body: { intervalMs: 2000 } })).status === 401);
    check('but anyone may read a slider, since the app needs it',
      (await api('GET', '/api/promos/movie')).status === 200);
    relaunched.kill('SIGTERM');
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
