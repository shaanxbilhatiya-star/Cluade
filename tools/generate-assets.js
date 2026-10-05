'use strict';
/**
 * Generates every image the app needs as a local SVG file, so the UI looks
 * complete with no internet access and no binary assets in git.
 *
 *   node tools/generate-assets.js
 *
 * Output: public/img/{posters,backdrops,food,banners,avatars}
 * Admins can still point any movie at a real remote posterUrl later - the UI
 * falls back to these files whenever a remote image fails to load.
 */
const fs = require('fs');
const path = require('path');
const { MOVIES, FOOD_ITEMS, OFFERS } = require('../src/catalog');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img');
const SANS = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function write(dir, name, svg) {
  const target = path.join(IMG_DIR, dir);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, name), svg.trim() + '\n');
}

/** Deterministic pseudo-random so regenerating assets produces identical files. */
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h |= 0;
    h ^= h >>> 17;
    h ^= h << 5; h |= 0;
    return ((h >>> 0) % 100000) / 100000;
  };
}

function shade(hex, amount) {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Naive word wrap using an average glyph-width estimate. */
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

const grain = (id, opacity = 0.16, freq = 0.9) => `
  <filter id="${id}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="7" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="${opacity}"/></feComponentTransfer>
  </filter>`;

// ─────────────────────────────────────────────────────────────────────────────
// Style decorations (shared between posters and backdrops)
// ─────────────────────────────────────────────────────────────────────────────
function decoration(style, accent, w, h, seed) {
  const rand = rng(seed + style);
  const parts = [];

  if (style === 'slash') {
    for (let i = 0; i < 7; i += 1) {
      const x = -w * 0.3 + rand() * w * 1.4;
      const bw = 12 + rand() * 46;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${-h * 0.25}" width="${bw.toFixed(1)}" height="${h * 1.5}" fill="${accent}" opacity="${(0.1 + rand() * 0.4).toFixed(2)}" transform="rotate(${(-18 - rand() * 10).toFixed(1)} ${w / 2} ${h / 2})"/>`
      );
    }
    parts.push(`<ellipse cx="${w * 0.5}" cy="${h * 0.42}" rx="${w * 0.55}" ry="${h * 0.4}" fill="url(#glow)" opacity="0.55"/>`);
  }

  if (style === 'veil') {
    for (let i = 8; i >= 1; i -= 1) {
      const r = (w * 0.09) * i;
      parts.push(`<circle cx="${w / 2}" cy="${h * 0.4}" r="${r.toFixed(1)}" fill="none" stroke="${accent}" stroke-width="1.1" opacity="${(0.34 - i * 0.03).toFixed(2)}"/>`);
    }
    for (let i = 0; i < 22; i += 1) {
      const a = (i / 22) * Math.PI * 2;
      parts.push(
        `<line x1="${w / 2}" y1="${h * 0.4}" x2="${(w / 2 + Math.cos(a) * w * 0.72).toFixed(1)}" y2="${(h * 0.4 + Math.sin(a) * w * 0.72).toFixed(1)}" stroke="${accent}" stroke-width="0.8" opacity="0.14"/>`
      );
    }
    parts.push(`<ellipse cx="${w / 2}" cy="${h * 0.4}" rx="${w * 0.2}" ry="${w * 0.2}" fill="url(#glow)" opacity="0.75"/>`);
  }

  if (style === 'sunny') {
    parts.push(`<circle cx="${w * 0.74}" cy="${h * 0.2}" r="${w * 0.2}" fill="${accent}" opacity="0.95"/>`);
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2;
      parts.push(
        `<line x1="${w * 0.74}" y1="${h * 0.2}" x2="${(w * 0.74 + Math.cos(a) * w * 0.34).toFixed(1)}" y2="${(h * 0.2 + Math.sin(a) * w * 0.34).toFixed(1)}" stroke="${accent}" stroke-width="5" opacity="0.35" stroke-linecap="round"/>`
      );
    }
    for (let i = 0; i < 5; i += 1) {
      const cy = h * (0.55 + i * 0.09);
      parts.push(`<ellipse cx="${(w * (0.15 + rand() * 0.7)).toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w * (0.18 + rand() * 0.2)).toFixed(1)}" ry="${(h * 0.035).toFixed(1)}" fill="#ffffff" opacity="${(0.08 + rand() * 0.12).toFixed(2)}"/>`);
    }
  }

  if (style === 'blaze') {
    parts.push(`<ellipse cx="${w / 2}" cy="${h * 0.92}" rx="${w * 0.85}" ry="${h * 0.6}" fill="url(#blazeGrad)"/>`);
    for (let i = 0; i < 60; i += 1) {
      const x = rand() * w;
      const y = h * (0.35 + rand() * 0.65);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1 + rand() * 3.4).toFixed(1)}" fill="${shade(accent, 60)}" opacity="${(0.25 + rand() * 0.6).toFixed(2)}"/>`);
    }
  }

  if (style === 'storm') {
    parts.push(`<rect width="${w}" height="${h}" fill="${accent}" opacity="0.22" filter="url(#clouds)"/>`);
    const zx = w * 0.6;
    parts.push(
      `<polyline points="${zx},${h * 0.1} ${zx - w * 0.08},${h * 0.34} ${zx + w * 0.03},${h * 0.34} ${zx - w * 0.1},${h * 0.62}" fill="none" stroke="#F8FAFC" stroke-width="5" opacity="0.85" stroke-linejoin="round"/>`
    );
    parts.push(`<ellipse cx="${zx}" cy="${h * 0.35}" rx="${w * 0.3}" ry="${h * 0.22}" fill="url(#glow)" opacity="0.5"/>`);
  }

  if (style === 'cosmic') {
    for (let i = 0; i < 90; i += 1) {
      parts.push(`<circle cx="${(rand() * w).toFixed(1)}" cy="${(rand() * h).toFixed(1)}" r="${(0.6 + rand() * 1.9).toFixed(1)}" fill="#ffffff" opacity="${(0.15 + rand() * 0.75).toFixed(2)}"/>`);
    }
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.4}" r="${w * 0.27}" fill="none" stroke="${accent}" stroke-width="7" opacity="0.85"/>`);
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.4}" r="${w * 0.34}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.4"/>`);
    parts.push(`<ellipse cx="${w * 0.5}" cy="${h * 0.4}" rx="${w * 0.26}" ry="${w * 0.26}" fill="url(#glow)" opacity="0.6"/>`);
  }

  if (style === 'neon') {
    for (let i = 1; i < 9; i += 1) {
      parts.push(`<line x1="0" y1="${(h * i) / 9}" x2="${w}" y2="${(h * i) / 9}" stroke="${accent}" stroke-width="1" opacity="0.16"/>`);
    }
    for (let i = 1; i < 7; i += 1) {
      parts.push(`<line x1="${(w * i) / 7}" y1="0" x2="${(w * i) / 7}" y2="${h}" stroke="${accent}" stroke-width="1" opacity="0.1"/>`);
    }
    parts.push(`<rect x="${w * 0.12}" y="${h * 0.16}" width="${w * 0.76}" height="${h * 0.44}" fill="none" stroke="${accent}" stroke-width="3" opacity="0.75" rx="6"/>`);
    parts.push(`<ellipse cx="${w * 0.5}" cy="${h * 0.38}" rx="${w * 0.42}" ry="${h * 0.24}" fill="url(#glow)" opacity="0.5"/>`);
  }

  if (style === 'retro') {
    for (let y = 0; y < 26; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const r = 1 + rand() * 3.6;
        parts.push(`<circle cx="${((x + 0.5) * w) / 16}" cy="${((y + 0.5) * h) / 26}" r="${r.toFixed(1)}" fill="${accent}" opacity="${(0.06 + rand() * 0.22).toFixed(2)}"/>`);
      }
    }
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.36}" r="${w * 0.22}" fill="${accent}" opacity="0.9"/>`);
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.36}" r="${w * 0.22}" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.5"/>`);
  }

  return parts.join('\n  ');
}

function defs(style, deep, accent) {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${shade(deep, 26)}"/>
      <stop offset="0.55" stop-color="${deep}"/>
      <stop offset="1" stop-color="${shade(deep, -12)}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="blazeGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${shade(accent, 70)}" stop-opacity="0.95"/>
      <stop offset="0.45" stop-color="${accent}" stop-opacity="0.7"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#000000" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.93"/>
    </linearGradient>
    <filter id="clouds">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.02" numOctaves="5" seed="11"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    ${grain('grain')}
  </defs>`;
}

// ── Poster (2:3) ─────────────────────────────────────────────────────────────
function poster(movie) {
  const W = 500;
  const H = 750;
  const [deep, accent] = movie.art.colors;
  const style = movie.art.style;
  const serifStyles = new Set(['veil', 'storm']);
  const font = serifStyles.has(style) ? SERIF : SANS;

  const lines = wrap(movie.title.toUpperCase(), 11);
  const size = lines.length > 2 ? 52 : lines.length > 1 ? 64 : 74;
  const baseY = H - 150 - (lines.length - 1) * size * 0.92;

  const titleTspans = lines
    .map((l, i) => `<tspan x="${W / 2}" y="${(baseY + i * size * 0.98).toFixed(0)}">${esc(l)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(movie.title)} poster">
  ${defs(style, deep, accent)}
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${decoration(style, accent, W, H, movie.slug)}
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.5"/>
  <text text-anchor="middle" font-family="${font}" font-size="${size}" font-weight="800" fill="#ffffff" letter-spacing="${style === 'veil' ? 6 : 1.5}" style="paint-order:stroke" stroke="#000000" stroke-opacity="0.35" stroke-width="1.2">${titleTspans}</text>
  <text x="${W / 2}" y="${H - 104}" text-anchor="middle" font-family="${SANS}" font-size="19" fill="${shade(accent, 90)}" letter-spacing="1.4">${esc(movie.tagline)}</text>
  <line x1="${W * 0.28}" y1="${H - 84}" x2="${W * 0.72}" y2="${H - 84}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="1"/>
  <text x="${W / 2}" y="${H - 54}" text-anchor="middle" font-family="${SANS}" font-size="18" fill="#ffffff" fill-opacity="0.82" letter-spacing="2.6">${esc(movie.genres.slice(0, 3).join('  •  ').toUpperCase())}</text>
  <text x="${W / 2}" y="${H - 24}" text-anchor="middle" font-family="${SANS}" font-size="15" fill="#ffffff" fill-opacity="0.55" letter-spacing="1.6">${esc(movie.certificate)}  |  ${esc(movie.languages[0])}  |  ${movie.runtime}m</text>
</svg>`;
}

// ── Backdrop (16:9) ──────────────────────────────────────────────────────────
function backdrop(movie) {
  const W = 1280;
  const H = 720;
  const [deep, accent] = movie.art.colors;
  const style = movie.art.style;
  const font = new Set(['veil', 'storm']).has(style) ? SERIF : SANS;
  const lines = wrap(movie.title.toUpperCase(), 16);
  const size = lines.length > 1 ? 96 : 118;
  const baseY = H - 180 - (lines.length - 1) * size * 0.9;

  const titleTspans = lines
    .map((l, i) => `<tspan x="72" y="${(baseY + i * size * 0.95).toFixed(0)}">${esc(l)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(movie.title)} backdrop">
  ${defs(style, deep, accent)}
  <linearGradient id="sideScrim" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000000" stop-opacity="0.85"/>
    <stop offset="0.62" stop-color="#000000" stop-opacity="0.15"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0.45"/>
  </linearGradient>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${decoration(style, accent, W, H, movie.slug + 'bd')}
  <rect width="${W}" height="${H}" fill="url(#sideScrim)"/>
  <rect width="${W}" height="${H}" fill="url(#scrim)" opacity="0.75"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.45"/>
  <text font-family="${font}" font-size="${size}" font-weight="800" fill="#ffffff" letter-spacing="${style === 'veil' ? 8 : 2}">${titleTspans}</text>
  <text x="74" y="${H - 118}" font-family="${SANS}" font-size="30" fill="${shade(accent, 100)}" letter-spacing="1.6">${esc(movie.tagline)}</text>
  <text x="74" y="${H - 72}" font-family="${SANS}" font-size="24" fill="#ffffff" fill-opacity="0.78" letter-spacing="3">${esc(movie.genres.join('   •   ').toUpperCase())}</text>
</svg>`;
}

// ── Food illustrations ───────────────────────────────────────────────────────
/**
 * Pure-vector food glyphs drawn in a 0-100 box. Deliberately not emoji: emoji
 * need a colour-emoji font installed, and fall back to empty boxes when one is
 * missing (headless browsers, minimal Linux installs, some kiosks).
 */
const GLYPHS = {
  popcorn: (a) => `
    <g>
      <circle cx="34" cy="34" r="11" fill="#FFF8E7"/><circle cx="50" cy="26" r="12" fill="#FFFDF5"/>
      <circle cx="66" cy="34" r="11" fill="#FFF8E7"/><circle cx="42" cy="42" r="9" fill="#FFFDF5"/>
      <circle cx="58" cy="42" r="9" fill="#FFF3D6"/>
      <path d="M28 46 h44 l-6 46 a4 4 0 0 1 -4 3.5 H38 a4 4 0 0 1 -4 -3.5 Z" fill="#F4F1EA"/>
      <path d="M28 46 h8 l-4 49.5 h-5.6 Z" fill="${a}"/>
      <path d="M44 46 h8 l-1.6 49.5 h-6.4 Z" fill="${a}"/>
      <path d="M60 46 h8 l1.6 49.5 h-6.4 Z" fill="${a}"/>
      <rect x="26" y="43" width="48" height="6" rx="3" fill="#FFFFFF" opacity="0.9"/>
    </g>`,
  cup: (a) => `
    <g>
      <rect x="52" y="8" width="5" height="26" rx="2.5" fill="#FFFFFF" opacity="0.9" transform="rotate(14 54 20)"/>
      <rect x="27" y="26" width="46" height="9" rx="4.5" fill="#FFFFFF" opacity="0.95"/>
      <path d="M30 36 h40 l-5 54 a5 5 0 0 1 -5 4.5 H40 a5 5 0 0 1 -5 -4.5 Z" fill="#F6F4F0"/>
      <path d="M32 48 h36 l-3.6 40 a4 4 0 0 1 -4 3.5 H39.6 a4 4 0 0 1 -4 -3.5 Z" fill="${a}"/>
      <ellipse cx="50" cy="60" rx="12" ry="4" fill="#FFFFFF" opacity="0.35"/>
    </g>`,
  fries: (a) => `
    <g>
      ${[
        [36, 22, 8, 46, -9], [46, 15, 8, 52, -2], [56, 20, 8, 48, 6], [65, 27, 7, 42, 13], [30, 30, 7, 38, -16],
      ].map(([x, y, w, hh, rot]) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="3.5" fill="#FBD46A" transform="rotate(${rot} ${x + w / 2} ${y + hh / 2})"/>`).join('\n      ')}
      <path d="M28 56 h44 l-5 36 a4 4 0 0 1 -4 3.5 H37 a4 4 0 0 1 -4 -3.5 Z" fill="${a}"/>
      <path d="M28 56 h44 l-1.4 10 H29.4 Z" fill="#FFFFFF" opacity="0.28"/>
      <circle cx="50" cy="78" r="9" fill="#FFFFFF" opacity="0.35"/>
    </g>`,
  nachos: (a) => `
    <g>
      <path d="M24 40 L46 34 L36 62 Z" fill="#F6C868"/>
      <path d="M44 30 L68 38 L54 60 Z" fill="#FBD98A"/>
      <path d="M60 44 L80 52 L62 68 Z" fill="#F0BB55"/>
      <path d="M18 62 h64 a32 32 0 0 1 -64 0 Z" fill="${a}"/>
      <path d="M18 62 h64 v5 H18 Z" fill="#FFFFFF" opacity="0.3"/>
      <circle cx="40" cy="52" r="5" fill="#C0392B" opacity="0.85"/>
      <circle cx="58" cy="48" r="4" fill="#2E7D32" opacity="0.8"/>
    </g>`,
  burger: (a) => `
    <g>
      <path d="M22 44 a28 22 0 0 1 56 0 Z" fill="#E8A54C"/>
      <circle cx="40" cy="32" r="2.4" fill="#FFF6E0"/><circle cx="52" cy="27" r="2.4" fill="#FFF6E0"/>
      <circle cx="63" cy="34" r="2.4" fill="#FFF6E0"/>
      <path d="M20 46 q30 12 60 0 v6 q-30 11 -60 0 Z" fill="#5FA84B"/>
      <rect x="21" y="54" width="58" height="13" rx="5" fill="${a}"/>
      <path d="M24 70 q26 8 52 0 v8 a6 6 0 0 1 -6 6 H30 a6 6 0 0 1 -6 -6 Z" fill="#D99247"/>
    </g>`,
  shake: (a) => `
    <g>
      <rect x="56" y="6" width="5" height="30" rx="2.5" fill="#FFFFFF" opacity="0.9" transform="rotate(12 58 20)"/>
      <circle cx="42" cy="28" r="11" fill="#FFFFFF" opacity="0.95"/>
      <circle cx="56" cy="24" r="9" fill="#FFFFFF" opacity="0.9"/>
      <circle cx="50" cy="34" r="10" fill="#FFFDFB" opacity="0.95"/>
      <path d="M32 40 h36 l-6 52 a5 5 0 0 1 -5 4.5 H43 a5 5 0 0 1 -5 -4.5 Z" fill="#F5F3F8"/>
      <path d="M34 50 h32 l-4.6 42 a4 4 0 0 1 -4 3.5 H42.6 a4 4 0 0 1 -4 -3.5 Z" fill="${a}"/>
      <circle cx="45" cy="66" r="3" fill="#FFFFFF" opacity="0.5"/>
      <circle cx="56" cy="76" r="2.4" fill="#FFFFFF" opacity="0.4"/>
    </g>`,
  coffee: (a) => `
    <g>
      <path d="M22 34 h50 v30 a25 25 0 0 1 -50 0 Z" fill="#F4F1EA"/>
      <path d="M26 42 h42 v22 a21 21 0 0 1 -42 0 Z" fill="${a}"/>
      <path d="M72 40 h9 a11 11 0 0 1 0 22 h-9" fill="none" stroke="#F4F1EA" stroke-width="7"/>
      <rect x="16" y="88" width="62" height="7" rx="3.5" fill="#F4F1EA" opacity="0.85"/>
      <path d="M40 24 q6 -7 0 -14" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M54 24 q6 -7 0 -14" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="3.5" stroke-linecap="round"/>
    </g>`,
  wrap: (a) => `
    <g transform="rotate(-24 50 50)">
      <rect x="30" y="20" width="40" height="62" rx="19" fill="#EBCB92"/>
      <rect x="35" y="24" width="30" height="54" rx="15" fill="#F6E3B8"/>
      <path d="M35 40 h30 v9 H35 Z" fill="${a}"/>
      <path d="M35 56 h30 v9 H35 Z" fill="#5FA84B" opacity="0.85"/>
      <path d="M30 78 q20 12 40 0 v4 a20 12 0 0 1 -40 0 Z" fill="#DBB877"/>
    </g>`,
  brownie: (a) => `
    <g>
      <circle cx="62" cy="30" r="15" fill="#FFFBF2"/>
      <path d="M22 46 h56 l-4 34 a6 6 0 0 1 -6 5 H32 a6 6 0 0 1 -6 -5 Z" fill="#4A2410"/>
      <path d="M22 46 h56 l-1.4 12 H23.4 Z" fill="${a}" opacity="0.9"/>
      <circle cx="38" cy="66" r="3.5" fill="${a}"/><circle cx="52" cy="72" r="3" fill="${a}"/>
      <circle cx="64" cy="64" r="3.2" fill="${a}"/>
      <path d="M30 46 q10 10 20 0 q10 10 20 0" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="3"/>
    </g>`,
  samosa: (a) => `
    <g>
      <path d="M18 76 L44 24 L70 76 Z" fill="#E3B25E"/>
      <path d="M24 72 L44 32 L64 72 Z" fill="#F0C87C"/>
      <path d="M52 82 L72 44 L92 82 Z" fill="${a}" opacity="0.92"/>
      <path d="M44 24 L44 76" stroke="#C9964A" stroke-width="2.4"/>
      <circle cx="30" cy="86" r="6" fill="#7B3F16" opacity="0.7"/>
      <circle cx="46" cy="88" r="5" fill="#2E7D32" opacity="0.65"/>
    </g>`,
  combo: (a) => `
    <g>
      <path d="M14 44 h26 l-3.5 44 a4 4 0 0 1 -4 3.5 H21.5 a4 4 0 0 1 -4 -3.5 Z" fill="#F4F1EA"/>
      <path d="M16 54 h22 l-3 34 H19 Z" fill="${a}"/>
      <circle cx="21" cy="36" r="7" fill="#FFF8E7"/><circle cx="32" cy="32" r="8" fill="#FFFDF5"/>
      <circle cx="27" cy="42" r="6" fill="#FFF3D6"/>
      <rect x="50" y="30" width="9" height="8" rx="4" fill="#FFFFFF" opacity="0.9"/>
      <path d="M46 38 h20 l-3 52 a4 4 0 0 1 -4 3.5 H53 a4 4 0 0 1 -4 -3.5 Z" fill="#F6F4F0"/>
      <path d="M48 48 h16 l-2.4 40 H50.4 Z" fill="${a}"/>
      <rect x="74" y="30" width="9" height="8" rx="4" fill="#FFFFFF" opacity="0.9"/>
      <path d="M70 38 h20 l-3 52 a4 4 0 0 1 -4 3.5 H77 a4 4 0 0 1 -4 -3.5 Z" fill="#F6F4F0"/>
      <path d="M72 48 h16 l-2.4 40 H74.4 Z" fill="${a}"/>
    </g>`,
  glass: (a) => `
    <g>
      <path d="M30 26 h40 l-5 66 a5 5 0 0 1 -5 4.5 H40 a5 5 0 0 1 -5 -4.5 Z" fill="#F6F4F0" opacity="0.55"/>
      <path d="M33 42 h34 l-4 50 a4 4 0 0 1 -4 3.5 H41 a4 4 0 0 1 -4 -3.5 Z" fill="${a}"/>
      <rect x="38" y="48" width="13" height="13" rx="3" fill="#FFFFFF" opacity="0.45" transform="rotate(-12 44 54)"/>
      <rect x="52" y="62" width="12" height="12" rx="3" fill="#FFFFFF" opacity="0.35" transform="rotate(16 58 68)"/>
      <path d="M56 20 a13 13 0 0 1 0 20 Z" fill="#FFB86B"/>
      <circle cx="56" cy="30" r="3" fill="#FFFFFF" opacity="0.6"/>
      <rect x="64" y="14" width="4.5" height="34" rx="2.2" fill="#FFFFFF" opacity="0.85" transform="rotate(16 66 30)"/>
    </g>`,
};

function foodTile(item) {
  const S = 420;
  const [deep, accent] = item.colors;
  const rand = rng(item.slug);
  const bubbles = Array.from({ length: 9 }, () => {
    const r = 18 + rand() * 76;
    return `<circle cx="${(rand() * S).toFixed(0)}" cy="${(rand() * S).toFixed(0)}" r="${r.toFixed(0)}" fill="#ffffff" opacity="${(0.03 + rand() * 0.09).toFixed(2)}"/>`;
  }).join('\n  ');

  const draw = GLYPHS[item.art] || GLYPHS.combo;
  const glyphSize = S * 0.56;
  const offset = (S - glyphSize) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(item.name)}">
  <defs>
    <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${shade(deep, 34)}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.44" r="0.5">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.7"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#fg)"/>
  ${bubbles}
  <circle cx="${S / 2}" cy="${S * 0.44}" r="${S * 0.3}" fill="url(#halo)"/>
  <g transform="translate(${offset.toFixed(1)} ${(offset - S * 0.06).toFixed(1)}) scale(${(glyphSize / 100).toFixed(4)})">${draw(accent)}</g>
  <text x="${S / 2}" y="${S - 38}" text-anchor="middle" font-family="${SANS}" font-size="26" font-weight="700" fill="#ffffff" fill-opacity="0.95">${esc(item.category.toUpperCase())}</text>
  <text x="${S / 2}" y="${S - 14}" text-anchor="middle" font-family="${SANS}" font-size="19" fill="#ffffff" fill-opacity="0.6">${esc(item.size || '')}</text>
</svg>`;
}

// ── Offer banner (~2.4:1) ────────────────────────────────────────────────────
function offerBanner(offer) {
  const W = 960;
  const H = 400;
  const [deep, accent] = offer.art.colors;
  const style = offer.art.style;
  const rand = rng(offer.slug);

  let deco = '';
  if (style === 'reel') {
    const holes = [];
    for (let x = 26; x < W; x += 54) {
      holes.push(`<rect x="${x}" y="16" width="26" height="34" rx="6" fill="#ffffff" opacity="0.85"/>`);
      holes.push(`<rect x="${x}" y="${H - 50}" width="26" height="34" rx="6" fill="#ffffff" opacity="0.85"/>`);
    }
    deco = holes.join('\n  ');
    deco += `\n  <rect x="52" y="70" width="${W - 104}" height="${H - 140}" rx="10" fill="${accent}" opacity="0.94"/>`;
    deco += `\n  <rect x="66" y="84" width="${W - 132}" height="${H - 168}" rx="6" fill="none" stroke="${shade(deep, -20)}" stroke-width="3" opacity="0.5"/>`;
  } else if (style === 'pop') {
    for (let i = 0; i < 28; i += 1) {
      deco += `\n  <circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H).toFixed(0)}" r="${(10 + rand() * 44).toFixed(0)}" fill="${accent}" opacity="${(0.08 + rand() * 0.25).toFixed(2)}"/>`;
    }
  } else {
    deco = `<circle cx="${W * 0.82}" cy="${H * 0.72}" r="${H * 0.42}" fill="${accent}" opacity="0.9"/>`;
    for (let i = 0; i < 10; i += 1) {
      deco += `\n  <line x1="0" y1="${(H * i) / 10}" x2="${W}" y2="${(H * i) / 10 + 40}" stroke="${accent}" stroke-width="2" opacity="0.14"/>`;
    }
  }

  const dark = style === 'reel';
  const titleFill = dark ? shade(deep, -60) : '#ffffff';
  const subFill = dark ? shade(deep, -20) : '#ffffff';
  const titleLines = wrap(offer.title, 20);
  const ty = titleLines.length > 1 ? H * 0.42 : H * 0.48;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(offer.title)}">
  <defs>
    <linearGradient id="ob" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${shade(deep, 30)}"/>
      <stop offset="1" stop-color="${deep}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ob)"/>
  ${deco}
  <text text-anchor="middle" font-family="${SANS}" font-size="${titleLines.length > 1 ? 58 : 66}" font-weight="800" fill="${titleFill}">
    ${titleLines.map((l, i) => `<tspan x="${W / 2}" y="${(ty + i * 62).toFixed(0)}">${esc(l)}</tspan>`).join('\n    ')}
  </text>
  <text x="${W / 2}" y="${ty + titleLines.length * 62 + 6}" text-anchor="middle" font-family="${SANS}" font-size="30" fill="${subFill}" fill-opacity="0.9">${esc(offer.subtitle)}</text>
  <text x="${W / 2}" y="${H - 46}" text-anchor="middle" font-family="${SANS}" font-size="24" font-weight="700" fill="${titleFill}" fill-opacity="0.8" letter-spacing="3">CODE: ${esc(offer.code)}</text>
</svg>`;
}

// ── Avatar ───────────────────────────────────────────────────────────────────
function avatar(name, colors) {
  const S = 200;
  const initials = String(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(name)}">
  <defs><linearGradient id="av" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
  </linearGradient></defs>
  <rect width="${S}" height="${S}" rx="${S / 2}" fill="url(#av)"/>
  <text x="${S / 2}" y="${S * 0.63}" text-anchor="middle" font-family="${SANS}" font-size="80" font-weight="700" fill="#ffffff">${esc(initials)}</text>
</svg>`;
}

// ── App icon / logo ──────────────────────────────────────────────────────────
function logo() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Ruralift">
  <rect width="512" height="512" rx="120" fill="#5B21D5"/>
  <path fill="#ffffff" fill-rule="evenodd" d="M182.7 201.3 L182.5 383.8 L182.9 384.2 L225.3 384.2 L226.1 383.4 L225.9 285.9 L226.8 285.2 L228.7 286.3 L259.8 317.7 L260.9 318.3 L261.7 319.6 L293.1 350.7 L293.7 352.0 L305.2 363.4 L306.2 363.9 L308.3 366.6 L309.8 367.5 L318.9 376.6 L320.0 378.5 L321.5 379.1 L323.4 380.8 L324.0 382.3 L325.3 383.8 L326.1 384.2 L402.0 384.0 L402.0 383.4 L363.0 344.8 L361.3 342.7 L358.6 340.1 L357.1 339.3 L354.1 336.3 L353.9 335.7 L349.2 331.4 L348.4 330.0 L347.3 329.5 L265.1 247.5 L264.9 246.5 L265.3 246.0 L303.7 246.0 L304.5 245.6 L304.9 244.8 L304.9 202.0 L302.4 200.1 L184.4 200.1 Z M110.4 129.1 L110.0 382.9 L110.4 384.0 L156.4 384.2 L157.0 383.6 L157.0 178.4 L157.9 177.4 L208.7 177.4 L209.8 177.0 L259.6 177.0 L260.7 177.4 L292.7 177.4 L300.9 178.2 L302.4 179.5 L303.9 179.5 L305.8 180.4 L307.7 180.6 L310.2 182.0 L311.7 182.3 L312.4 182.9 L314.7 183.7 L317.2 185.6 L320.8 187.6 L322.7 189.7 L324.2 190.3 L329.3 195.4 L330.2 196.9 L333.6 200.7 L334.4 203.0 L336.3 205.4 L338.6 209.4 L338.9 210.9 L341.2 215.3 L341.6 217.6 L342.7 219.6 L342.9 221.2 L343.5 222.5 L344.4 228.7 L345.2 230.6 L345.2 242.4 L344.4 244.1 L343.9 249.0 L342.7 252.4 L342.5 254.5 L341.6 255.8 L341.4 257.1 L340.1 259.2 L339.9 260.2 L339.1 261.3 L338.9 262.6 L337.6 264.1 L337.4 265.1 L329.3 276.6 L327.2 278.9 L327.2 281.0 L334.6 288.6 L336.3 289.9 L338.2 292.2 L340.8 293.9 L342.2 295.8 L343.1 296.3 L359.6 313.0 L360.3 313.2 L361.5 313.0 L362.4 312.4 L364.3 309.8 L367.9 306.2 L368.3 305.2 L370.9 302.6 L374.7 297.5 L377.0 293.3 L378.9 291.0 L379.5 289.3 L381.9 285.7 L382.1 284.4 L383.1 283.5 L384.4 280.2 L385.7 278.5 L388.0 273.4 L388.2 271.5 L390.6 265.7 L391.2 263.4 L391.2 261.7 L392.0 260.4 L392.0 257.9 L393.1 256.6 L393.9 248.4 L393.9 242.7 L394.6 241.2 L394.6 234.0 L393.9 232.3 L393.9 227.2 L393.5 225.9 L393.1 218.5 L392.3 217.2 L392.0 214.9 L391.0 211.9 L390.8 209.0 L388.7 204.3 L388.7 203.0 L387.4 200.3 L386.7 197.3 L384.6 193.7 L383.4 189.5 L381.9 187.8 L380.8 184.6 L379.5 182.9 L377.8 179.1 L375.7 176.5 L375.3 175.3 L371.1 168.9 L369.2 167.2 L368.7 165.9 L366.2 163.6 L365.6 162.3 L355.2 152.0 L346.9 145.8 L345.8 145.4 L344.6 144.1 L341.0 142.4 L338.0 140.3 L336.1 140.1 L334.4 138.8 L329.5 136.5 L328.0 136.3 L324.0 134.4 L322.5 134.2 L320.2 133.1 L317.0 132.7 L314.7 131.4 L312.6 131.4 L306.0 130.1 L302.6 130.1 L301.1 128.9 L296.0 128.9 L295.0 128.4 L271.0 128.4 L268.5 127.8 L114.0 127.8 Z"/>
</svg>`;
}

// ── Run ──────────────────────────────────────────────────────────────────────
function run() {
  let count = 0;
  for (const movie of MOVIES) {
    write('posters', `${movie.slug}.svg`, poster(movie));
    write('backdrops', `${movie.slug}.svg`, backdrop(movie));
    count += 2;
  }
  for (const item of FOOD_ITEMS) {
    write('food', `${item.slug}.svg`, foodTile(item));
    count += 1;
  }
  for (const offer of OFFERS) {
    write('banners', `${offer.slug}.svg`, offerBanner(offer));
    count += 1;
  }

  const avatars = [
    ['andrew', 'Andrew Ainsely', ['#F59E0B', '#B45309']],
    ['priya', 'Priya Sharma', ['#EC4899', '#9D174D']],
    ['rahul', 'Rahul Mehta', ['#3B82F6', '#1E3A8A']],
    ['admin', 'Cine Admin', ['#8B5CF6', '#4C1D95']],
    ['guest', 'Guest User', ['#64748B', '#334155']],
  ];
  for (const [slug, name, colors] of avatars) {
    write('avatars', `${slug}.svg`, avatar(name, colors));
    count += 1;
  }

  write('.', 'logo.svg', logo());
  count += 1;

  // Generic poster fallback used when a remote posterUrl fails to load.
  write('posters', '_placeholder.svg', poster({
    slug: 'placeholder',
    title: 'Coming Soon',
    tagline: 'Artwork on the way',
    genres: ['Cinema'],
    certificate: 'U',
    languages: ['—'],
    runtime: 0,
    art: { style: 'cosmic', colors: ['#1E1B4B', '#8B5CF6'] },
  }));
  write('food', '_placeholder.svg', foodTile({
    slug: 'placeholder', name: 'Food item', category: 'Snacks', size: '', art: 'combo', colors: ['#334155', '#94A3B8'],
  }));
  count += 2;

  console.log(`[assets] wrote ${count} SVG files into public/img/`);
}

if (require.main === module) run();
module.exports = { run, poster, backdrop, foodTile, offerBanner, avatar };
