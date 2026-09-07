/**
 * generate-combo-images.js
 *
 * Fetches each component item's photo via HTTPS, base64-encodes it,
 * and embeds it directly into an SVG collage saved to public/img/food/.
 *
 * Because images are embedded as data-URIs the browser never needs to
 * load external URLs — the SVG works correctly when used as <img src>.
 *
 * Called automatically from server.js on startup (skipped if files exist).
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const OUT = path.join(__dirname, '../public/img/food');

// Unsplash photos for each individual item
const ITEM_PHOTOS = {
  'popcorn-large':      'https://images.unsplash.com/photo-1585647347483-22b66260dfff?w=400&q=75&fm=jpg&fit=crop&h=300',
  'popcorn-tub':        'https://images.unsplash.com/photo-1505686994434-e3cc5abf1330?w=400&q=75&fm=jpg&fit=crop&h=300',
  'coldrink-450ml':     'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?w=400&q=75&fm=jpg&fit=crop&h=300',
  'grill-sandwich':     'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400&q=75&fm=jpg&fit=crop&h=300',
  'cappuccino':         'https://images.unsplash.com/photo-1534778101976-62847782c213?w=400&q=75&fm=jpg&fit=crop&h=300',
  'paneer-tikka-pizza': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&q=75&fm=jpg&fit=crop&h=300',
  'french-fries':       'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&q=75&fm=jpg&fit=crop&h=300',
  'sweetcorn':          'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400&q=75&fm=jpg&fit=crop&h=300',
  'maggi-masala':       'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=400&q=75&fm=jpg&fit=crop&h=300',
  'cardamom-tea':       'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=400&q=75&fm=jpg&fit=crop&h=300',
};

// Which items go into each combo
const COMBO_ITEMS = {
  'movie-snack-combo':     ['popcorn-large',      'coldrink-450ml'],
  'sandwich-coffee-combo': ['grill-sandwich',      'cappuccino'],
  'pizza-coldrink-combo':  ['paneer-tikka-pizza',  'coldrink-450ml'],
  'snack-platter-combo':   ['french-fries',        'sweetcorn',    'coldrink-450ml'],
  'family-feast-combo':    ['popcorn-tub',         'coldrink-450ml', 'french-fries'],
  'maggi-tea-combo':       ['maggi-masala',        'cardamom-tea'],
};

// ─── helpers ────────────────────────────────────────────────────────────────

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'CineFlex/1.0' } }, (res) => {
      // Follow up to 5 redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function toDataURI(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ─── SVG builders ───────────────────────────────────────────────────────────

function twoPanel(uriA, uriB) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="400" height="260">
  <defs>
    <clipPath id="cl"><rect width="197" height="260"/></clipPath>
    <clipPath id="cr"><rect x="203" width="197" height="260"/></clipPath>
  </defs>
  <image href="${uriA}" width="197" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#cl)"/>
  <image href="${uriB}" x="203" width="197" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#cr)"/>
  <rect x="198" width="4" height="260" fill="white"/>
</svg>`;
}

function threePanel(uriA, uriB, uriC) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="400" height="260">
  <defs>
    <clipPath id="cl"><rect width="197" height="260"/></clipPath>
    <clipPath id="ct"><rect x="203" width="197" height="127"/></clipPath>
    <clipPath id="cb"><rect x="203" y="133" width="197" height="127"/></clipPath>
  </defs>
  <image href="${uriA}" width="197" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#cl)"/>
  <image href="${uriB}" x="203" width="197" height="127" preserveAspectRatio="xMidYMid slice" clip-path="url(#ct)"/>
  <image href="${uriC}" x="203" y="133" width="197" height="127" preserveAspectRatio="xMidYMid slice" clip-path="url(#cb)"/>
  <rect x="198" width="4" height="260" fill="white"/>
  <rect x="203" y="129" width="197" height="4" fill="white"/>
</svg>`;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function generateComboImages({ force = false } = {}) {
  const slugs = Object.keys(COMBO_ITEMS);
  const missing = force
    ? slugs
    : slugs.filter(s => !fs.existsSync(path.join(OUT, `${s}.svg`)) ||
                         fs.statSync(path.join(OUT, `${s}.svg`)).size < 500);

  if (missing.length === 0) {
    console.log('[combo-images] All combo SVGs present — skipping generation.');
    return;
  }

  console.log(`[combo-images] Generating ${missing.length} combo image(s)…`);

  // Collect which individual photos we actually need
  const needed = new Set(missing.flatMap(s => COMBO_ITEMS[s]));
  const dataURIs = {};

  await Promise.all([...needed].map(async (slug) => {
    try {
      const buf = await fetchBuffer(ITEM_PHOTOS[slug]);
      dataURIs[slug] = toDataURI(buf);
      console.log(`  ✓ fetched ${slug} (${(buf.length/1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`  ✗ failed ${slug}:`, err.message);
      dataURIs[slug] = null;
    }
  }));

  for (const slug of missing) {
    const items  = COMBO_ITEMS[slug];
    const uris   = items.map(i => dataURIs[i]).filter(Boolean);

    if (uris.length < 2) {
      console.warn(`  ✗ not enough photos for ${slug}, skipping`);
      continue;
    }

    const svg = uris.length >= 3
      ? threePanel(uris[0], uris[1], uris[2])
      : twoPanel(uris[0], uris[1]);

    fs.writeFileSync(path.join(OUT, `${slug}.svg`), svg);
    console.log(`  ✓ saved ${slug}.svg`);
  }
  console.log('[combo-images] Done.');
}

module.exports = { generateComboImages };

// Allow direct CLI usage: node tools/generate-combo-images.js [--force]
if (require.main === module) {
  const force = process.argv.includes('--force');
  generateComboImages({ force }).catch(console.error);
}
