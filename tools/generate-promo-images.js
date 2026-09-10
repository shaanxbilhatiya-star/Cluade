/**
 * generate-promo-images.js
 *
 * Draws the starter artwork for the tab sliders into public/img/promos/.
 * Same approach as tools/generate-hotel-images.js: no binary assets in the
 * repo, no network at boot, every file reproducible from this script.
 *
 * These are deliberately TEXT-FREE. A slide's heading and sub-heading are
 * rendered by the app as a caption over the image, so artwork carrying its own
 * baked-in words collides with that caption and reads as a mistake. The
 * existing /img/banners/*.svg files are finished banners with their own
 * headline, which is exactly why they are not used for captioned slides.
 *
 * Each panel is a wide gradient with a few abstract shapes, weighted to the
 * right so the caption (which sits left, over a dark scrim) stays readable.
 *
 * Existing files are never overwritten, so uploads and manual edits survive.
 * Called from server.js on startup.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'promos');
const W = 960;
const H = 420;

/**
 * One panel per slide. `from`/`to` drive the gradient, `accent` the shapes, and
 * `motif` picks which abstract decoration is drawn.
 */
const PANELS = [
  { slug: 'movie-tickets', from: '#4C1D95', to: '#7C3AED', accent: '#C4B5FD', motif: 'reel' },
  { slug: 'movie-snacks', from: '#7C2D12', to: '#EA580C', accent: '#FED7AA', motif: 'bubbles' },
  { slug: 'movie-morning', from: '#0F766E', to: '#14B8A6', accent: '#99F6E4', motif: 'sunrise' },
  { slug: 'stay-weekend', from: '#1E3A5F', to: '#3B82F6', accent: '#BFDBFE', motif: 'skyline' },
  { slug: 'stay-suite', from: '#5B3A1F', to: '#B4762F', accent: '#F5DEB3', motif: 'bubbles' },
  { slug: 'dinein-table', from: '#7F1D1D', to: '#DC2626', accent: '#FECACA', motif: 'plate' },
  { slug: 'dinein-bill', from: '#312E5F', to: '#6366F1', accent: '#C7D2FE', motif: 'bubbles' },
  { slug: 'waterpark-family', from: '#075985', to: '#38BDF8', accent: '#BAE6FD', motif: 'waves' },
  { slug: 'waterpark-addons', from: '#134E4A', to: '#2DD4BF', accent: '#CCFBF1', motif: 'bubbles' },
];

/** Abstract decoration, all of it on the right two-thirds of the panel. */
function motifShapes(motif, accent) {
  const soft = (o) => `fill="${accent}" fill-opacity="${o}"`;

  if (motif === 'reel') {
    return (
      `<circle cx="760" cy="210" r="132" ${soft(0.16)}/>` +
      `<circle cx="760" cy="210" r="86" ${soft(0.2)}/>` +
      `<circle cx="760" cy="210" r="26" ${soft(0.5)}/>` +
      [0, 60, 120, 180, 240, 300]
        .map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const cx = 760 + Math.cos(rad) * 56;
          const cy = 210 + Math.sin(rad) * 56;
          return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="15" ${soft(0.42)}/>`;
        })
        .join('')
    );
  }

  if (motif === 'waves') {
    return [0, 1, 2, 3]
      .map((i) => {
        const y = 250 + i * 44;
        return `<path d="M420 ${y} q 60 -34 120 0 t 120 0 t 120 0 t 120 0 t 120 0 V${H} H420 Z" ${soft(0.1 + i * 0.05)}/>`;
      })
      .join('');
  }

  if (motif === 'sunrise') {
    return (
      `<circle cx="740" cy="300" r="150" ${soft(0.18)}/>` +
      `<circle cx="740" cy="300" r="96" ${soft(0.26)}/>` +
      [0, 1, 2, 3, 4].map((i) => `<rect x="${470 + i * 96}" y="${330 + i * 12}" width="72" height="10" rx="5" ${soft(0.3)}/>`).join('')
    );
  }

  if (motif === 'skyline') {
    const towers = [
      [470, 250, 78], [560, 190, 66], [638, 286, 58], [708, 156, 74], [794, 232, 62], [868, 274, 54],
    ];
    return (
      towers.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${H - y}" rx="6" ${soft(0.2)}/>`).join('') +
      towers
        .map(([x, y, w]) =>
          [0, 1, 2]
            .map((r) => `<rect x="${x + 12}" y="${y + 20 + r * 34}" width="${w - 24}" height="14" rx="3" ${soft(0.34)}/>`)
            .join('')
        )
        .join('')
    );
  }

  if (motif === 'plate') {
    return (
      `<circle cx="760" cy="210" r="128" ${soft(0.18)}/>` +
      `<circle cx="760" cy="210" r="92" ${soft(0.26)}/>` +
      `<rect x="596" y="150" width="10" height="120" rx="5" ${soft(0.4)}/>` +
      `<rect x="916" y="150" width="10" height="120" rx="5" ${soft(0.4)}/>`
    );
  }

  // bubbles — the neutral default
  return [
    [700, 130, 74], [826, 220, 108], [648, 300, 58], [900, 96, 42], [760, 350, 46], [560, 190, 34],
  ]
    .map(([cx, cy, r], i) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${soft(0.14 + (i % 3) * 0.07)}/>`)
    .join('');
}

function draw(panel) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="">` +
    '<defs>' +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${panel.from}"/><stop offset="1" stop-color="${panel.to}"/>` +
    '</linearGradient>' +
    '</defs>' +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    motifShapes(panel.motif, panel.accent) +
    // A soft left-hand darkening so a caption stays legible whatever the palette.
    `<rect width="${Math.round(W * 0.62)}" height="${H}" fill="#0B0A18" fill-opacity="0.2"/>` +
    '</svg>'
  );
}

function generatePromoImages() {
  try {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

    let written = 0;
    for (const panel of PANELS) {
      const target = path.join(OUT, `${panel.slug}.svg`);
      if (fs.existsSync(target)) continue;
      fs.writeFileSync(target, draw(panel), 'utf8');
      written += 1;
    }

    if (written) console.log(`[promo-images] wrote ${written} placeholder image(s) to public/img/promos/`);
    return written;
  } catch (err) {
    // Artwork is cosmetic — never let it stop the server from booting.
    console.warn('[promo-images] skipped:', err.message);
    return 0;
  }
}

module.exports = { generatePromoImages, PANELS };

// Allow `node tools/generate-promo-images.js` for a manual regen.
if (require.main === module) generatePromoImages();
