/* End-to-end check for the categorised property photo galleries.
 *
 * Part 1 asserts the markup the room booking page produces, by loading the real
 * public/js/screens/hotels.js in a sandbox.
 * Part 2 boots the real server in-process and drives the admin + customer APIs.
 *
 * Run: NODE_OPTIONS= node tools/verify-property-photos.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const PORT = Number(process.env.PORT || 3211);
const PUBLIC = path.join(__dirname, '..', 'public');
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ── Part 1: the markup the room page renders ─────────────────────────────────

/**
 * hotels.js is a browser IIFE that only exports window.Screens, so the gallery
 * helpers aren't reachable from outside. Inject one statement before the IIFE
 * closes to hand them out, then run it with just enough of a browser around it.
 */
function loadScreenHelpers() {
  const file = path.join(PUBLIC, 'js', 'screens', 'hotels.js');
  const source = fs.readFileSync(file, 'utf8');
  const closing = /\}\)\(\);\s*$/;
  if (!closing.test(source)) throw new Error('hotels.js is not the expected IIFE — update this harness');

  const patched = source.replace(closing, `
    globalThis.__helpers = {
      propertyPhotos: propertyPhotos,
      photoGroups: photoGroups,
      photosInCategory: photosInCategory,
      photoCategoryLabel: photoCategoryLabel,
    };
  })();`);

  const esc = (v) => (v === null || v === undefined ? '' : String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

  const sandbox = { console, setTimeout, clearTimeout, Math, Date, JSON };
  sandbox.window = sandbox;
  sandbox.document = { addEventListener() {}, createElement: () => ({ style: {} }) };
  sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sandbox.Screens = {};
  sandbox.App = { navigate() {} };
  sandbox.API = {};
  sandbox.UI = {
    esc,
    icon: (name) => `<svg data-icon="${esc(name)}"></svg>`,
    h: () => ({}),
    row: () => '',
    carousel: () => '',
    appbar: () => '',
    money: (n) => `\u20b9${n}`,
    actions() {},
    toast() {},
  };

  const context = vm.createContext(sandbox);
  // Load the shared category list first — hotels.js reads window.HotelPhotoCategories.
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'js', 'hotel-photo-categories.js'), 'utf8'), context);
  vm.runInContext(patched, context);
  return { helpers: sandbox.__helpers, categories: sandbox.HotelPhotoCategories };
}

function verifyMarkup() {
  const { helpers, categories } = loadScreenHelpers();

  section('A. category list is shared and complete');
  const labels = categories.map((c) => c.label);
  const expected = ['Outdoors', 'Washroom', 'Swimming Pool', 'Entrance', 'Reception', 'Common Area',
    'Facade', 'Restaurant', 'Play Area', 'Garden', 'Jacuzzi', 'Others'];
  check('12 categories in the requested order', labels.join('|') === expected.join('|'), labels);

  const serverIds = require('../src/hotelPhotos').PROPERTY_PHOTO_CATEGORY_IDS;
  check('browser ids match the server allowlist',
    categories.map((c) => c.id).join(',') === serverIds.join(','), { browser: categories.map((c) => c.id), server: serverIds });

  section('B. a hotel with no property photos renders nothing');
  check('empty map → empty string', helpers.propertyPhotos({ propertyPhotos: {} }) === '');
  check('missing field → empty string', helpers.propertyPhotos({}) === '');

  section('C. galleries render one block per non-empty category');
  const hotel = {
    name: 'Hotel Kingfisher',
    propertyPhotos: {
      outdoors: ['/uploads/hotels/o1.jpg', '/uploads/hotels/o2.jpg'],
      // 9 photos: 6 tiles shown, "+3 Photos" on the last one.
      'swimming-pool': Array.from({ length: 9 }, (_v, i) => `/uploads/hotels/p${i + 1}.jpg`),
      restaurant: ['/uploads/hotels/r1.jpg'],
      garden: [],
    },
  };
  const html = helpers.propertyPhotos(hotel);

  check('has the Property photos heading', html.includes('<h2 class="subhead">Property photos</h2>'));
  check('3 category sections rendered', (html.match(/class="photo-group"/g) || []).length === 3,
    (html.match(/class="photo-group"/g) || []).length);
  check('empty garden category skipped', !html.includes('data-photo-group="garden"'));
  check('sections follow the defined order',
    html.indexOf('data-photo-group="outdoors"') < html.indexOf('data-photo-group="swimming-pool"')
    && html.indexOf('data-photo-group="swimming-pool"') < html.indexOf('data-photo-group="restaurant"'));

  section('D. tiles, overflow badge and jump chips');
  const sectionOf = (id) => html.split(`data-photo-group="${id}"`)[1].split('</section>')[0];
  const tilesIn = (id) => (sectionOf(id).match(/class="photo-tile"/g) || []).length;
  check('6 tiles for a 9-photo category', tilesIn('swimming-pool') === 6, tilesIn('swimming-pool'));
  check('2 tiles for a 2-photo category', tilesIn('outdoors') === 2, tilesIn('outdoors'));
  check('1 tile for a 1-photo category', tilesIn('restaurant') === 1, tilesIn('restaurant'));
  check('"+3 Photos" badge on the overflowing category', html.includes('>+3 Photos<'));
  check('no badge when everything fits', !html.includes('>+0 Photos<'));
  check('tiles carry category + index for the viewer',
    html.includes('data-action="view-photo" data-cat="swimming-pool" data-index="5"'));
  check('per-category count shown', html.includes('<small>9</small>'));
  check('a jump chip per category', (html.match(/data-action="jump-photos"/g) || []).length === 3);

  section('E. lookups used by the viewer');
  check('photosInCategory reads the map', helpers.photosInCategory(hotel, 'swimming-pool').length === 9);
  check('unknown category → empty list', helpers.photosInCategory(hotel, 'nope').length === 0);
  check('label lookup', helpers.photoCategoryLabel('common-area') === 'Common Area');
  check('photoGroups drops empties', helpers.photoGroups(hotel).map((g) => g.id).join(',') === 'outdoors,swimming-pool,restaurant');

  section('F. output is escaped');
  const nasty = helpers.propertyPhotos({ propertyPhotos: { others: ['/x.jpg"><script>alert(1)</script>'] } });
  check('quotes in a path cannot break out of the attribute', !nasty.includes('<script>'), nasty.slice(0, 160));
}

// ── Part 2: the API ──────────────────────────────────────────────────────────

let token = '';

function call(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { accept: 'application/json' };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;

    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_e) { /* non-JSON (an image, say) */ }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// A real 1x1 PNG, so the data: URL → file on disk path runs for real.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAF/gJ+n1AVpwAAAABJRU5ErkJggg==';

async function verifyApi() {
  const login = await call('POST', '/api/auth/login', { email: 'admin@cineflex.com', password: 'admin123' });
  token = (login.body && login.body.token) || '';
  if (!token) throw new Error(`admin login failed (${login.status})`);

  section('G. upload photos to a category');
  let res = await call('PUT', '/api/admin/hotel/photos', { category: 'swimming-pool', photos: [PNG, PNG], mode: 'replace' });
  check('status 200', res.status === 200, res.raw.slice(0, 200));
  check('2 photos stored', res.body.photos.length === 2, res.body.photos);
  check('written under /uploads/hotels/', res.body.photos.every((p) => p.startsWith('/uploads/hotels/')), res.body.photos);

  section('H. append mode (how a large gallery is chunked past the body limit)');
  res = await call('PUT', '/api/admin/hotel/photos', { category: 'swimming-pool', photos: [PNG], mode: 'append' });
  check('3 photos after append', res.body.photos.length === 3, res.body.photos);

  section('I. existing paths survive alongside new uploads');
  const keep = res.body.photos[0];
  res = await call('PUT', '/api/admin/hotel/photos', { category: 'restaurant', photos: [keep, PNG], mode: 'replace' });
  check('existing path passed through untouched', res.body.photos[0] === keep, res.body.photos);
  check('new upload saved beside it', res.body.photos.length === 2 && res.body.photos[1] !== keep, res.body.photos);
  check('other categories untouched', res.body.propertyPhotos['swimming-pool'].length === 3, res.body.propertyPhotos);

  section('J. bad input is rejected');
  check('unknown category → 400',
    (await call('PUT', '/api/admin/hotel/photos', { category: 'rooftop-helipad', photos: [PNG] })).status === 400);
  check('missing category → 400',
    (await call('PUT', '/api/admin/hotel/photos', { photos: [PNG] })).status === 400);
  token = '';
  check('unauthenticated → 401', (await call('PUT', '/api/admin/hotel/photos', { category: 'garden', photos: [] })).status === 401);
  token = (await call('POST', '/api/auth/login', { email: 'admin@cineflex.com', password: 'admin123' })).body.token;

  section('K. saving property details must not wipe the galleries');
  const before = (await call('GET', '/api/admin/hotel')).body.hotel;
  res = await call('PUT', '/api/admin/hotel', {
    name: before.name, tagline: before.tagline, area: before.area, city: before.city,
    address: before.address, phone: before.phone, rating: before.rating, reviewCount: before.reviewCount,
    checkInTime: before.checkInTime, checkOutTime: before.checkOutTime, photos: before.photos,
    amenities: before.amenities, policies: before.policies, active: true,
  });
  check('galleries survived the property form',
    res.body.hotel.propertyPhotos['swimming-pool'].length === 3 && res.body.hotel.propertyPhotos.restaurant.length === 2,
    res.body.hotel.propertyPhotos);

  section('L. every room booking page receives them');
  const rooms = (await call('GET', '/api/hotels')).body.rooms;
  check('more than one room type exists', rooms.length > 1, rooms.length);
  const seen = [];
  for (const room of rooms) {
    const detail = await call('GET', `/api/hotels/rooms/${room.id}`);
    const pp = detail.body.hotel.propertyPhotos || {};
    seen.push(pp['swimming-pool'] ? pp['swimming-pool'].length : 0);
  }
  check('all rooms report the same 3 pool photos', seen.every((n) => n === 3), seen);

  const pp = (await call('GET', `/api/hotels/rooms/${rooms[0].id}`)).body.hotel.propertyPhotos;
  check('only non-empty categories are stored',
    Object.keys(pp).sort().join(',') === 'restaurant,swimming-pool', Object.keys(pp));

  section('M. uploaded files are served');
  check('GET an uploaded photo → 200', (await call('GET', pp['swimming-pool'][0])).status === 200);

  section('N. clearing a category removes it');
  res = await call('PUT', '/api/admin/hotel/photos', { category: 'restaurant', photos: [], mode: 'replace' });
  check('restaurant key dropped', !res.body.propertyPhotos.restaurant, res.body.propertyPhotos);
  check('swimming-pool still intact', res.body.propertyPhotos['swimming-pool'].length === 3);
}

async function main() {
  console.log('── Room page markup ──');
  verifyMarkup();

  console.log('\n── API ──');
  process.env.PORT = String(PORT);
  require('../server.js');
  await new Promise((r) => setTimeout(r, 1500));
  await verifyApi();
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
  })
  .catch((err) => {
    console.error('\nverification error:', err.stack || err.message);
    process.exit(1);
  });
