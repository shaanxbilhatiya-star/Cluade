/**
 * generate-hotel-images.js
 *
 * Draws the hotel/room artwork as deterministic SVGs into public/img/hotels/.
 * Same approach as tools/generate-assets.js: no binary assets in the repo, no
 * network at boot, and every file is reproducible from this script.
 *
 * These are placeholders that mirror the real room's look (cream walls, dark
 * wood headboard/panelling, wooden floor). The admin panel's photo picker
 * uploads real photographs over the top of them — anything uploaded lands in
 * this same folder and is stored as a path on the room record.
 *
 * Existing files are never overwritten, so uploads and manual edits survive.
 * Called from server.js on startup.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'hotels');

// Palette sampled from the room photos.
const C = {
  wallTop: '#F0E4C0',
  wall: '#EFE2BC',
  wallShade: '#E3D3A6',
  wallDark: '#D9C68F',
  ceiling: '#F7EFD8',
  wood: '#4A3524',
  woodLight: '#6B4E35',
  woodEdge: '#3A2A1C',
  floor: '#C89A63',
  floorAlt: '#BE8E57',
  linen: '#FDFCF8',
  linenShade: '#ECE7DC',
  headboard: '#EDE6D4',
  tile: '#EDEDEA',
  tileDark: '#C9C6BE',
  grout: '#D8D5CD',
  chrome: '#B9BCC0',
  screen: '#1B1B20',
  glow: '#FFF6DC',
  towel: '#3E5C8A',
  brand: '#5B21B6',
};

function svg(width, height, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">` +
    body +
    '</svg>'
  );
}

/** Shared backdrop: ceiling with a cove light, wall and wooden floor. */
function roomShell(w, h, opts = {}) {
  const floorY = opts.floorY || Math.round(h * 0.68);
  const ceilingY = Math.round(h * 0.16);

  let out =
    `<defs>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${C.wallTop}"/><stop offset="1" stop-color="${C.wallShade}"/>` +
    `</linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${C.floorAlt}"/><stop offset="1" stop-color="${C.floor}"/>` +
    `</linearGradient>` +
    `<radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="${C.glow}" stop-opacity=".95"/>` +
    `<stop offset="1" stop-color="${C.glow}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>`;

  // Ceiling + cove
  out += `<rect width="${w}" height="${h}" fill="url(#wall)"/>`;
  out += `<rect width="${w}" height="${ceilingY}" fill="${C.ceiling}"/>`;
  out += `<rect y="${ceilingY - 8}" width="${w}" height="8" fill="${C.wallDark}" opacity=".45"/>`;

  // Recessed ceiling light + its pool of light on the wall
  if (opts.light !== false) {
    const lx = opts.lightX || Math.round(w * 0.3);
    out += `<circle cx="${lx}" cy="${ceilingY - 16}" r="9" fill="${C.glow}"/>`;
    out += `<ellipse cx="${lx}" cy="${ceilingY + 60}" rx="${Math.round(w * 0.28)}" ry="90" fill="url(#lamp)"/>`;
  }

  // Floor with plank seams
  out += `<rect y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#floor)"/>`;
  out += `<rect y="${floorY}" width="${w}" height="4" fill="${C.woodEdge}" opacity=".3"/>`;
  for (let i = 1; i < 5; i += 1) {
    const y = floorY + Math.round(((h - floorY) / 5) * i);
    out += `<rect y="${y}" width="${w}" height="1.5" fill="${C.woodEdge}" opacity=".16"/>`;
  }

  return out;
}

/** Wall-mounted split air conditioner. */
function airConditioner(x, y, w = 150, h = 44) {
  return (
    `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#FBFBF9" stroke="${C.wallDark}" stroke-width="1.5"/>` +
    `<rect x="${x + 6}" y="${y + h - 13}" width="${w - 12}" height="7" rx="3.5" fill="${C.tileDark}" opacity=".8"/>` +
    `<circle cx="${x + w - 22}" cy="${y + 13}" r="5" fill="${C.brand}" opacity=".55"/>` +
    `</g>`
  );
}

/** Flat-screen TV on a dark wood panel. */
function tvPanel(x, y, w, h) {
  const tvW = Math.round(w * 0.56);
  const tvH = Math.round(tvW * 0.58);
  const tvX = x + Math.round((w - tvW) / 2);
  const tvY = y + Math.round(h * 0.22);

  return (
    `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.wood}"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${C.woodEdge}" stroke-width="3"/>` +
    // Inset niches
    `<rect x="${x + 14}" y="${y + 16}" width="${w - 28}" height="${Math.round(h * 0.1)}" fill="${C.headboard}" opacity=".9"/>` +
    `<rect x="${x + 14}" y="${y + h - Math.round(h * 0.16)}" width="${w - 28}" height="${Math.round(h * 0.1)}" fill="${C.headboard}" opacity=".9"/>` +
    // Screen
    `<rect x="${tvX}" y="${tvY}" width="${tvW}" height="${tvH}" rx="4" fill="${C.screen}"/>` +
    `<rect x="${tvX + 4}" y="${tvY + 4}" width="${tvW - 8}" height="${tvH - 8}" rx="2" fill="#2A2A33"/>` +
    `<rect x="${tvX + Math.round(tvW / 2) - 14}" y="${tvY + tvH}" width="28" height="7" fill="${C.screen}"/>` +
    `</g>`
  );
}

/** Double bed seen from the foot, with headboard. */
function bed(w, h, floorY) {
  const bedW = Math.round(w * 0.7);
  const bedX = Math.round((w - bedW) / 2);
  const headY = Math.round(h * 0.3);
  const mattressY = Math.round(h * 0.56);
  // Run the base past the floor line so the bed reads as standing on the floor
  // rather than floating above it.
  const baseH = floorY - mattressY + 18;

  let out = '';

  // Dark wood headboard wall panel + cream upholstered pads
  const hbW = Math.round(bedW * 1.12);
  const hbX = Math.round((w - hbW) / 2);
  out += `<rect x="${hbX}" y="${headY - 26}" width="${hbW}" height="${mattressY - headY + 26}" fill="${C.wood}"/>`;
  const pads = 4;
  const padW = Math.round((bedW - 16) / pads);
  for (let i = 0; i < pads; i += 1) {
    out +=
      `<rect x="${bedX + 8 + i * padW + 3}" y="${headY}" width="${padW - 6}" height="${Math.round(h * 0.2)}" rx="5" ` +
      `fill="${C.headboard}" stroke="${C.linenShade}" stroke-width="1"/>`;
  }

  // Mattress + duvet
  out += `<rect x="${bedX - 10}" y="${mattressY}" width="${bedW + 20}" height="${baseH}" rx="4" fill="${C.woodLight}"/>`;
  out += `<rect x="${bedX - 16}" y="${mattressY - 30}" width="${bedW + 32}" height="34" rx="8" fill="${C.linen}"/>`;
  out += `<rect x="${bedX - 16}" y="${mattressY - 6}" width="${bedW + 32}" height="12" fill="${C.linenShade}" opacity=".7"/>`;

  // Pillows
  const pw = Math.round(bedW * 0.3);
  out += `<rect x="${bedX + Math.round(bedW * 0.1)}" y="${mattressY - 52}" width="${pw}" height="26" rx="10" fill="${C.linen}" stroke="${C.linenShade}"/>`;
  out += `<rect x="${bedX + Math.round(bedW * 0.58)}" y="${mattressY - 52}" width="${pw}" height="26" rx="10" fill="${C.linen}" stroke="${C.linenShade}"/>`;

  // Bed shadow on the floor
  out += `<ellipse cx="${Math.round(w / 2)}" cy="${floorY + 14}" rx="${Math.round(bedW * 0.6)}" ry="10" fill="${C.woodEdge}" opacity=".16"/>`;

  return out;
}

/** Mirrored wardrobe with locking doors. */
function wardrobe(x, y, w, h) {
  return (
    `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.wood}"/>` +
    `<rect x="${x + 5}" y="${y + 5}" width="${Math.round(w * 0.42)}" height="${h - 10}" fill="${C.headboard}"/>` +
    `<rect x="${x + Math.round(w * 0.5)}" y="${y + 5}" width="${Math.round(w * 0.45)}" height="${h - 10}" fill="#D6DEE2"/>` +
    `<rect x="${x + Math.round(w * 0.5)}" y="${y + 5}" width="${Math.round(w * 0.45)}" height="${h - 10}" fill="none" stroke="${C.woodEdge}" stroke-width="1.5"/>` +
    // Handles
    `<rect x="${x + Math.round(w * 0.44)}" y="${y + Math.round(h * 0.42)}" width="4" height="34" rx="2" fill="${C.chrome}"/>` +
    `<rect x="${x + Math.round(w * 0.52)}" y="${y + Math.round(h * 0.42)}" width="4" height="34" rx="2" fill="${C.chrome}"/>` +
    `</g>`
  );
}

// ─── the five images ────────────────────────────────────────────────────────

/** 1. Bed + air conditioner (the hero shot). */
function roomBed(w, h) {
  const floorY = Math.round(h * 0.7);
  let body = roomShell(w, h, { floorY, lightX: Math.round(w * 0.28) });
  body += airConditioner(Math.round(w * 0.66), Math.round(h * 0.16), Math.round(w * 0.24), Math.round(h * 0.1));
  body += bed(w, h, floorY);
  // Bedside table with a lamp
  body += `<rect x="${Math.round(w * 0.05)}" y="${Math.round(h * 0.58)}" width="${Math.round(w * 0.11)}" height="${Math.round(h * 0.06)}" rx="3" fill="${C.wood}"/>`;
  body += `<rect x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.53)}" width="${Math.round(w * 0.05)}" height="${Math.round(h * 0.05)}" rx="3" fill="#B02A37"/>`;
  return svg(w, h, body);
}

/** 2. TV wall with the bathroom and entry doors. */
function roomTv(w, h) {
  const floorY = Math.round(h * 0.66);
  let body = roomShell(w, h, { floorY, lightX: Math.round(w * 0.2) });

  body += tvPanel(Math.round(w * 0.04), Math.round(h * 0.2), Math.round(w * 0.3), Math.round(h * 0.42));

  // Solid entry door
  const dX = Math.round(w * 0.44);
  const dW = Math.round(w * 0.14);
  body += `<rect x="${dX}" y="${Math.round(h * 0.17)}" width="${dW}" height="${floorY - Math.round(h * 0.17)}" fill="${C.woodEdge}"/>`;
  body += `<rect x="${dX + 4}" y="${Math.round(h * 0.19)}" width="${dW - 8}" height="${floorY - Math.round(h * 0.21)}" fill="${C.wood}"/>`;
  body += `<circle cx="${dX + dW - 12}" cy="${Math.round(h * 0.42)}" r="4" fill="${C.chrome}"/>`;

  // Frosted-glass bathroom door
  const gX = Math.round(w * 0.63);
  const gW = Math.round(w * 0.14);
  body += `<rect x="${gX}" y="${Math.round(h * 0.17)}" width="${gW}" height="${floorY - Math.round(h * 0.17)}" fill="${C.woodEdge}"/>`;
  body += `<rect x="${gX + 4}" y="${Math.round(h * 0.19)}" width="${gW - 8}" height="${floorY - Math.round(h * 0.21)}" fill="#DCE6E4" opacity=".92"/>`;
  body += `<rect x="${gX + gW - 14}" y="${Math.round(h * 0.36)}" width="4" height="46" rx="2" fill="${C.chrome}"/>`;

  // Foot of the bed in the foreground
  body += `<rect x="0" y="${Math.round(h * 0.78)}" width="${w}" height="${h - Math.round(h * 0.78)}" rx="10" fill="${C.linen}"/>`;
  body += `<rect x="0" y="${Math.round(h * 0.78)}" width="${w}" height="10" fill="${C.linenShade}" opacity=".75"/>`;
  return svg(w, h, body);
}

/** 3. Wardrobe beside the TV panel. */
function roomWardrobe(w, h) {
  const floorY = Math.round(h * 0.66);
  let body = roomShell(w, h, { floorY, lightX: Math.round(w * 0.78) });
  body += wardrobe(Math.round(w * 0.42), Math.round(h * 0.2), Math.round(w * 0.2), Math.round(h * 0.46));
  body += tvPanel(Math.round(w * 0.66), Math.round(h * 0.22), Math.round(w * 0.3), Math.round(h * 0.4));
  body += `<rect x="0" y="${Math.round(h * 0.76)}" width="${w}" height="${h - Math.round(h * 0.76)}" rx="10" fill="${C.linen}"/>`;
  body += `<rect x="0" y="${Math.round(h * 0.76)}" width="${w}" height="10" fill="${C.linenShade}" opacity=".75"/>`;
  return svg(w, h, body);
}

/** 4. Bathroom: vanity, mirror, WC and a stone-tile feature wall. */
function roomBathroom(w, h) {
  const floorY = Math.round(h * 0.8);
  let body =
    `<rect width="${w}" height="${h}" fill="${C.tile}"/>` +
    `<rect width="${w}" height="${Math.round(h * 0.08)}" fill="#F2F5EC"/>`;

  // Stone-tile feature wall (right third)
  const fw = Math.round(w * 0.4);
  const fx = w - fw;
  body += `<rect x="${fx}" y="0" width="${fw}" height="${floorY}" fill="${C.grout}"/>`;
  const rows = 16;
  const rh = Math.round(floorY / rows);
  const shades = ['#B9B4AA', '#CFCAC0', '#A79F94', '#DAD6CD', '#948C81'];
  for (let r = 0; r < rows; r += 1) {
    let x = fx + (r % 2 ? -18 : 0);
    let i = 0;
    while (x < w) {
      const bw = 34 + ((r * 7 + i * 13) % 26);
      body +=
        `<rect x="${Math.max(fx, x) + 1}" y="${r * rh + 1}" width="${Math.min(bw, w - x) - 2}" height="${rh - 2}" ` +
        `fill="${shades[(r + i) % shades.length]}"/>`;
      x += bw;
      i += 1;
    }
  }

  // Floor + wall tile grid on the left
  body += `<rect y="${floorY}" width="${w}" height="${h - floorY}" fill="#E7E7E2"/>`;
  for (let i = 1; i < 6; i += 1) {
    body += `<rect x="${Math.round((fx / 6) * i)}" y="0" width="1.5" height="${floorY}" fill="${C.grout}" opacity=".7"/>`;
  }
  for (let i = 1; i < 5; i += 1) {
    body += `<rect x="0" y="${Math.round((floorY / 5) * i)}" width="${fx}" height="1.5" fill="${C.grout}" opacity=".7"/>`;
  }

  // Mirror
  body += `<rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.1)}" width="${Math.round(w * 0.3)}" height="${Math.round(h * 0.26)}" rx="3" fill="#DCE7EA" stroke="${C.chrome}" stroke-width="2"/>`;

  // Vanity counter + basin
  const cy = Math.round(h * 0.52);
  body += `<rect x="${Math.round(w * 0.03)}" y="${cy}" width="${Math.round(w * 0.42)}" height="14" rx="3" fill="#2E2E33"/>`;
  body += `<rect x="${Math.round(w * 0.06)}" y="${cy - 26}" width="${Math.round(w * 0.24)}" height="28" rx="7" fill="#FCFCFA" stroke="${C.tileDark}"/>`;
  body += `<rect x="${Math.round(w * 0.17)}" y="${cy - 46}" width="5" height="22" rx="2.5" fill="${C.chrome}"/>`;
  body += `<rect x="${Math.round(w * 0.17)}" y="${cy - 46}" width="22" height="5" rx="2.5" fill="${C.chrome}"/>`;

  // Towel rail with folded towels
  body += `<rect x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.05)}" width="${Math.round(w * 0.26)}" height="4" rx="2" fill="${C.chrome}"/>`;
  body += `<rect x="${Math.round(w * 0.1)}" y="${Math.round(h * 0.02)}" width="${Math.round(w * 0.1)}" height="13" rx="3" fill="${C.towel}"/>`;
  body += `<rect x="${Math.round(w * 0.22)}" y="${Math.round(h * 0.02)}" width="${Math.round(w * 0.1)}" height="13" rx="3" fill="#5D7CAB"/>`;

  // WC
  const tx = Math.round(w * 0.52);
  body += `<rect x="${tx}" y="${cy - 4}" width="${Math.round(w * 0.16)}" height="18" rx="5" fill="#FAFAF8" stroke="${C.tileDark}"/>`;
  body += `<ellipse cx="${tx + Math.round(w * 0.08)}" cy="${cy + 34}" rx="${Math.round(w * 0.075)}" ry="24" fill="#FCFCFA" stroke="${C.tileDark}"/>`;
  body += `<ellipse cx="${tx + Math.round(w * 0.08)}" cy="${cy + 34}" rx="${Math.round(w * 0.05)}" ry="15" fill="#EDEDE8"/>`;
  body += `<rect x="${tx + Math.round(w * 0.03)}" y="${cy + 52}" width="${Math.round(w * 0.1)}" height="${floorY - cy - 52}" fill="#F2F2EE"/>`;

  return svg(w, h, body);
}

/** 5. Property hero: the building at dusk. */
function hotelHero(w, h) {
  const groundY = Math.round(h * 0.78);
  let body =
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#3B2A63"/><stop offset="0.55" stop-color="#7A4C7E"/><stop offset="1" stop-color="#E0A06A"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;

  // Building block with lit windows
  const bx = Math.round(w * 0.16);
  const bw = Math.round(w * 0.68);
  const by = Math.round(h * 0.24);
  body += `<rect x="${bx}" y="${by}" width="${bw}" height="${groundY - by}" fill="#2C2338"/>`;
  body += `<rect x="${bx}" y="${by}" width="${bw}" height="10" fill="#3D3150"/>`;

  const cols = 6;
  const rows = 4;
  const gapX = bw / cols;
  const gapY = (groundY - by - 40) / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lit = (r * cols + c) % 3 !== 1;
      body +=
        `<rect x="${Math.round(bx + gapX * c + gapX * 0.22)}" y="${Math.round(by + 26 + gapY * r)}" ` +
        `width="${Math.round(gapX * 0.56)}" height="${Math.round(gapY * 0.52)}" rx="2" ` +
        `fill="${lit ? C.glow : '#4A3F5C'}" opacity="${lit ? 0.92 : 0.7}"/>`;
    }
  }

  // Lit entrance canopy
  body += `<rect x="${Math.round(w / 2 - bw * 0.14)}" y="${groundY - 44}" width="${Math.round(bw * 0.28)}" height="44" fill="#4A3F5C"/>`;
  body += `<rect x="${Math.round(w / 2 - bw * 0.16)}" y="${groundY - 50}" width="${Math.round(bw * 0.32)}" height="9" rx="4" fill="${C.brand}"/>`;

  // Ground + pool reflection
  body += `<rect y="${groundY}" width="${w}" height="${h - groundY}" fill="#1E2A3A"/>`;
  body += `<rect y="${groundY}" width="${w}" height="4" fill="#33465E"/>`;
  for (let i = 0; i < 5; i += 1) {
    body += `<rect x="${Math.round(w * (0.2 + i * 0.14))}" y="${groundY + 14 + i * 6}" width="${Math.round(w * 0.08)}" height="3" rx="1.5" fill="${C.glow}" opacity=".28"/>`;
  }

  return svg(w, h, body);
}

/** Neutral fallback used when a room has no photos at all. */
function placeholder(w, h) {
  const body =
    `<rect width="${w}" height="${h}" fill="${C.wallShade}"/>` +
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="none" stroke="${C.wallDark}" stroke-width="2"/>` +
    // Simple bed glyph
    `<g transform="translate(${w / 2 - 60}, ${h / 2 - 34})" fill="none" stroke="${C.wood}" stroke-width="5" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity=".55">` +
    `<path d="M6 62V22"/><path d="M6 40h108v22"/><path d="M114 62V40"/>` +
    `<path d="M22 40V26a6 6 0 0 1 6-6h26a6 6 0 0 1 6 6v14"/>` +
    `<rect x="30" y="26" width="18" height="12" rx="4"/>` +
    `</g>` +
    `<text x="${w / 2}" y="${h / 2 + 52}" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="15" font-weight="600" fill="${C.woodLight}" opacity=".75">Room photo</text>`;
  return svg(w, h, body);
}

const FILES = {
  '_placeholder.svg': () => placeholder(750, 500),
  'kingfisher-mandla-1.svg': () => hotelHero(900, 520),
  'deluxe-double-room-1.svg': () => roomBed(750, 500),
  'deluxe-double-room-2.svg': () => roomTv(750, 500),
  'deluxe-double-room-3.svg': () => roomWardrobe(750, 500),
  'deluxe-double-room-4.svg': () => roomBathroom(750, 500),
};

/**
 * Writes any missing hotel artwork. Never overwrites, so real uploaded photos
 * and manual tweaks are safe. Synchronous and cheap (pure string building).
 */
function generateHotelImages() {
  try {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

    let written = 0;
    for (const [name, draw] of Object.entries(FILES)) {
      const target = path.join(OUT, name);
      if (fs.existsSync(target)) continue;
      fs.writeFileSync(target, draw(), 'utf8');
      written += 1;
    }

    if (written) console.log(`[hotel-images] wrote ${written} placeholder image(s) to public/img/hotels/`);
    return written;
  } catch (err) {
    // Artwork is cosmetic — never let it stop the server from booting.
    console.warn('[hotel-images] skipped:', err.message);
    return 0;
  }
}

module.exports = { generateHotelImages };

// Allow `node tools/generate-hotel-images.js` for a manual regen.
if (require.main === module) generateHotelImages();
