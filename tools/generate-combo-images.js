/**
 * Generates SVG collage images for each combo.
 * Each SVG embeds the component item images in a split-panel layout.
 * The browser fetches the Unsplash images directly — no server download needed.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../public/img/food');

// 2-panel side-by-side SVG (400x260)
function twoPanel(urlA, urlB) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 260" width="400" height="260">
  <defs>
    <clipPath id="left"><rect x="0" y="0" width="198" height="260"/></clipPath>
    <clipPath id="right"><rect x="202" y="0" width="198" height="260"/></clipPath>
  </defs>
  <image href="${urlA}" x="0" y="0" width="198" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#left)"/>
  <image href="${urlB}" x="202" y="0" width="198" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#right)"/>
  <line x1="200" y1="0" x2="200" y2="260" stroke="white" stroke-width="4"/>
</svg>`;
}

// 3-panel: big left, two stacked right (400x260)
function threePanel(urlA, urlB, urlC) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 260" width="400" height="260">
  <defs>
    <clipPath id="cl"><rect x="0" y="0" width="198" height="260"/></clipPath>
    <clipPath id="ct"><rect x="202" y="0" width="198" height="128"/></clipPath>
    <clipPath id="cb"><rect x="202" y="132" width="198" height="128"/></clipPath>
  </defs>
  <image href="${urlA}" x="0" y="0" width="198" height="260" preserveAspectRatio="xMidYMid slice" clip-path="url(#cl)"/>
  <image href="${urlB}" x="202" y="0" width="198" height="128" preserveAspectRatio="xMidYMid slice" clip-path="url(#ct)"/>
  <image href="${urlC}" x="202" y="132" width="198" height="128" preserveAspectRatio="xMidYMid slice" clip-path="url(#cb)"/>
  <line x1="200" y1="0" x2="200" y2="260" stroke="white" stroke-width="4"/>
  <line x1="200" y1="130" x2="400" y2="130" stroke="white" stroke-width="4"/>
</svg>`;
}

const imgs = {
  'popcorn-large':  'https://images.unsplash.com/photo-1585647347483-22b66260dfff?w=400&q=80&fm=jpg&fit=crop',
  'popcorn-tub':    'https://images.unsplash.com/photo-1505686994434-e3cc5abf1330?w=400&q=80&fm=jpg&fit=crop',
  'coldrink-450ml': 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?w=400&q=80&fm=jpg&fit=crop',
  'grill-sandwich': 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400&q=80&fm=jpg&fit=crop',
  'cappuccino':     'https://images.unsplash.com/photo-1534778101976-62847782c213?w=400&q=80&fm=jpg&fit=crop',
  'paneer-tikka-pizza': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&q=80&fm=jpg&fit=crop',
  'french-fries':   'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400&q=80&fm=jpg&fit=crop',
  'sweetcorn':      'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400&q=80&fm=jpg&fit=crop',
  'maggi-masala':   'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=400&q=80&fm=jpg&fit=crop',
  'cardamom-tea':   'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?w=400&q=80&fm=jpg&fit=crop',
};

const combos = {
  'movie-snack-combo':     twoPanel(imgs['popcorn-large'], imgs['coldrink-450ml']),
  'sandwich-coffee-combo': twoPanel(imgs['grill-sandwich'], imgs['cappuccino']),
  'pizza-coldrink-combo':  twoPanel(imgs['paneer-tikka-pizza'], imgs['coldrink-450ml']),
  'snack-platter-combo':   threePanel(imgs['french-fries'], imgs['sweetcorn'], imgs['coldrink-450ml']),
  'family-feast-combo':    threePanel(imgs['popcorn-tub'], imgs['coldrink-450ml'], imgs['french-fries']),
  'maggi-tea-combo':       twoPanel(imgs['maggi-masala'], imgs['cardamom-tea']),
};

for (const [slug, svg] of Object.entries(combos)) {
  const outPath = path.join(OUT, `${slug}.svg`);
  fs.writeFileSync(outPath, svg);
  console.log(`✓ Generated ${slug}.svg`);
}
