/**
 * generate-hotel-images.js
 *
 * Draws the hotel/room artwork as deterministic SVGs into public/img/hotels/.
 * Same approach as tools/generate-assets.js: no binary assets in the repo, no
 * network at boot, and every file is reproducible from this script.
 *
 * These are placeholders that mirror the real rooms' look (cream walls, dark
 * wood panelling, wooden floor), with a distinct palette per room type so the
 * listing does not look like the same room five times. The admin panel's photo
 * picker uploads real photographs over the top of them — anything uploaded
 * lands in this same folder and is stored as a path on the room record.
 *
 * Existing files are never overwritten, so uploads and manual edits survive.
 * Called from server.js on startup.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'hotels');

// Base palette, sampled from the Deluxe room photos.
const BASE = {
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
  // Garden-view scenery
  sky: '#BFE0F2',
  lawn: '#7FA85A',
  lawnDark: '#628843',
  foliage: '#4E7A3A',
  trunk: '#6B4A2E',
};

function palette(over) {
  return Object.assign({}, BASE, over || {});
}

/** One palette per room type, so each room reads as its own space. */
const ROOM_PALETTES = {
  'deluxe-double-room': palette(),
  'super-deluxe-room': palette({
    wallTop: '#EFEAD6', wall: '#E8E1C8', wallShade: '#DCD3B4', wallDark: '#CBBF98',
    ceiling: '#F6F2E4', wood: '#3F2E20', woodLight: '#5E4530', floor: '#C08F5C', floorAlt: '#B58452',
  }),
  'executive-room': palette({
    wallTop: '#F3E7CC', wall: '#EEDFBE', wallShade: '#E2D0A8', wallDark: '#D2BC8B',
    ceiling: '#FAF3E2', wood: '#4E3419', woodLight: '#6F4C26', floor: '#CE9F66', floorAlt: '#C4945B',
  }),
  'luxury-room': palette({
    wallTop: '#E9EDE4', wall: '#E1E7DA', wallShade: '#D2DAC9', wallDark: '#BDC7B2',
    ceiling: '#F3F6EF', wood: '#3B2C22', woodLight: '#5A4433', floor: '#B98F63', floorAlt: '#AE8558',
    headboard: '#E7EADF',
  }),
  'suite-room': palette({
    wallTop: '#F5EEDC', wall: '#F0E7D0', wallShade: '#E4D8B9', wallDark: '#D3C39B',
    ceiling: '#FBF6E8', wood: '#33241A', woodLight: '#50392A', floor: '#C79A66', floorAlt: '#BC8F5B',
    headboard: '#F2EBD9',
  }),
};

function svg(width, height, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">` +
    body +
    '</svg>'
  );
}

/** Shared backdrop: ceiling with a cove light, wall and wooden floor. */
function roomShell(w, h, P, opts = {}) {
  const floorY = opts.floorY || Math.round(h * 0.68);
  const ceilingY = Math.round(h * 0.16);

  let out =
    `<defs>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${P.wallTop}"/><stop offset="1" stop-color="${P.wallShade}"/>` +
    `</linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${P.floorAlt}"/><stop offset="1" stop-color="${P.floor}"/>` +
    `</linearGradient>` +
    `<radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="${P.glow}" stop-opacity=".95"/>` +
    `<stop offset="1" stop-color="${P.glow}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>`;

  out += `<rect width="${w}" height="${h}" fill="url(#wall)"/>`;
  out += `<rect width="${w}" height="${ceilingY}" fill="${P.ceiling}"/>`;
  out += `<rect y="${ceilingY - 8}" width="${w}" height="8" fill="${P.wallDark}" opacity=".45"/>`;

  if (opts.light !== false) {
    const lx = opts.lightX || Math.round(w * 0.3);
    out += `<circle cx="${lx}" cy="${ceilingY - 16}" r="9" fill="${P.glow}"/>`;
    out += `<ellipse cx="${lx}" cy="${ceilingY + 60}" rx="${Math.round(w * 0.28)}" ry="90" fill="url(#lamp)"/>`;
  }

  out += `<rect y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#floor)"/>`;
  out += `<rect y="${floorY}" width="${w}" height="4" fill="${P.woodEdge}" opacity=".3"/>`;
  for (let i = 1; i < 5; i += 1) {
    const y = floorY + Math.round(((h - floorY) / 5) * i);
    out += `<rect y="${y}" width="${w}" height="1.5" fill="${P.woodEdge}" opacity=".16"/>`;
  }

  return out;
}

/** Wall-mounted split air conditioner. */
function airConditioner(x, y, w, h, P) {
  return (
    `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="#FBFBF9" stroke="${P.wallDark}" stroke-width="1.5"/>` +
    `<rect x="${x + 6}" y="${y + h - 13}" width="${w - 12}" height="7" rx="3.5" fill="${P.tileDark}" opacity=".8"/>` +
    `<circle cx="${x + w - 22}" cy="${y + 13}" r="5" fill="${P.brand}" opacity=".55"/>` +
    `</g>`
  );
}

/** Flat-screen TV on a dark wood panel. */
function tvPanel(x, y, w, h, P) {
  const tvW = Math.round(w * 0.56);
  const tvH = Math.round(tvW * 0.58);
  const tvX = x + Math.round((w - tvW) / 2);
  const tvY = y + Math.round(h * 0.22);

  return (
    `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${P.wood}"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${P.woodEdge}" stroke-width="3"/>` +
    `<rect x="${x + 14}" y="${y + 16}" width="${w - 28}" height="${Math.round(h * 0.1)}" fill="${P.headboard}" opacity=".9"/>` +
    `<rect x="${x + 14}" y="${y + h - Math.round(h * 0.16)}" width="${w - 28}" height="${Math.round(h * 0.1)}" fill="${P.headboard}" opacity=".9"/>` +
    `<rect x="${tvX}" y="${tvY}" width="${tvW}" height="${tvH}" rx="4" fill="${P.screen}"/>` +
    `<rect x="${tvX + 4}" y="${tvY + 4}" width="${tvW - 8}" height="${tvH - 8}" rx="2" fill="#2A2A33"/>` +
    `<rect x="${tvX + Math.round(tvW / 2) - 14}" y="${tvY + tvH}" width="28" height="7" fill="${P.screen}"/>` +
    `</g>`
  );
}

/** Double bed seen from the foot, with an upholstered headboard. */
function bed(w, h, floorY, P) {
  const bedW = Math.round(w * 0.7);
  const bedX = Math.round((w - bedW) / 2);
  const headY = Math.round(h * 0.3);
  const mattressY = Math.round(h * 0.56);
  // Run the base past the floor line so the bed stands on the floor.
  const baseH = floorY - mattressY + 18;

  let out = '';

  const hbW = Math.round(bedW * 1.12);
  const hbX = Math.round((w - hbW) / 2);
  out += `<rect x="${hbX}" y="${headY - 26}" width="${hbW}" height="${mattressY - headY + 26}" fill="${P.wood}"/>`;
  const pads = 4;
  const padW = Math.round((bedW - 16) / pads);
  for (let i = 0; i < pads; i += 1) {
    out +=
      `<rect x="${bedX + 8 + i * padW + 3}" y="${headY}" width="${padW - 6}" height="${Math.round(h * 0.2)}" rx="5" ` +
      `fill="${P.headboard}" stroke="${P.linenShade}" stroke-width="1"/>`;
  }

  out += `<rect x="${bedX - 10}" y="${mattressY}" width="${bedW + 20}" height="${baseH}" rx="4" fill="${P.woodLight}"/>`;
  out += `<rect x="${bedX - 16}" y="${mattressY - 30}" width="${bedW + 32}" height="34" rx="8" fill="${P.linen}"/>`;
  out += `<rect x="${bedX - 16}" y="${mattressY - 6}" width="${bedW + 32}" height="12" fill="${P.linenShade}" opacity=".7"/>`;

  const pw = Math.round(bedW * 0.3);
  out += `<rect x="${bedX + Math.round(bedW * 0.1)}" y="${mattressY - 52}" width="${pw}" height="26" rx="10" fill="${P.linen}" stroke="${P.linenShade}"/>`;
  out += `<rect x="${bedX + Math.round(bedW * 0.58)}" y="${mattressY - 52}" width="${pw}" height="26" rx="10" fill="${P.linen}" stroke="${P.linenShade}"/>`;

  out += `<ellipse cx="${Math.round(w / 2)}" cy="${floorY + 14}" rx="${Math.round(bedW * 0.6)}" ry="10" fill="${P.woodEdge}" opacity=".16"/>`;

  return out;
}

/** Mirrored wardrobe with locking doors. */
function wardrobe(x, y, w, h, P) {
  return (
    `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${P.wood}"/>` +
    `<rect x="${x + 5}" y="${y + 5}" width="${Math.round(w * 0.42)}" height="${h - 10}" fill="${P.headboard}"/>` +
    `<rect x="${x + Math.round(w * 0.5)}" y="${y + 5}" width="${Math.round(w * 0.45)}" height="${h - 10}" fill="#D6DEE2"/>` +
    `<rect x="${x + Math.round(w * 0.5)}" y="${y + 5}" width="${Math.round(w * 0.45)}" height="${h - 10}" fill="none" stroke="${P.woodEdge}" stroke-width="1.5"/>` +
    `<rect x="${x + Math.round(w * 0.44)}" y="${y + Math.round(h * 0.42)}" width="4" height="34" rx="2" fill="${P.chrome}"/>` +
    `<rect x="${x + Math.round(w * 0.52)}" y="${y + Math.round(h * 0.42)}" width="4" height="34" rx="2" fill="${P.chrome}"/>` +
    `</g>`
  );
}

// ─── room shots ─────────────────────────────────────────────────────────────

/** Bed + air conditioner (the hero shot). */
function roomBed(w, h, P) {
  const floorY = Math.round(h * 0.7);
  let body = roomShell(w, h, P, { floorY, lightX: Math.round(w * 0.28) });
  body += airConditioner(Math.round(w * 0.66), Math.round(h * 0.16), Math.round(w * 0.24), Math.round(h * 0.1), P);
  body += bed(w, h, floorY, P);
  body += `<rect x="${Math.round(w * 0.03)}" y="${Math.round(h * 0.58)}" width="${Math.round(w * 0.09)}" height="${Math.round(h * 0.06)}" rx="3" fill="${P.wood}"/>`;
  body += `<rect x="${Math.round(w * 0.05)}" y="${Math.round(h * 0.53)}" width="${Math.round(w * 0.045)}" height="${Math.round(h * 0.05)}" rx="3" fill="#B02A37"/>`;
  return svg(w, h, body);
}

/** TV wall with the bathroom and entry doors. */
function roomTv(w, h, P) {
  const floorY = Math.round(h * 0.66);
  let body = roomShell(w, h, P, { floorY, lightX: Math.round(w * 0.2) });

  body += tvPanel(Math.round(w * 0.04), Math.round(h * 0.2), Math.round(w * 0.3), Math.round(h * 0.42), P);

  const dX = Math.round(w * 0.44);
  const dW = Math.round(w * 0.14);
  body += `<rect x="${dX}" y="${Math.round(h * 0.17)}" width="${dW}" height="${floorY - Math.round(h * 0.17)}" fill="${P.woodEdge}"/>`;
  body += `<rect x="${dX + 4}" y="${Math.round(h * 0.19)}" width="${dW - 8}" height="${floorY - Math.round(h * 0.21)}" fill="${P.wood}"/>`;
  body += `<circle cx="${dX + dW - 12}" cy="${Math.round(h * 0.42)}" r="4" fill="${P.chrome}"/>`;

  const gX = Math.round(w * 0.63);
  const gW = Math.round(w * 0.14);
  body += `<rect x="${gX}" y="${Math.round(h * 0.17)}" width="${gW}" height="${floorY - Math.round(h * 0.17)}" fill="${P.woodEdge}"/>`;
  body += `<rect x="${gX + 4}" y="${Math.round(h * 0.19)}" width="${gW - 8}" height="${floorY - Math.round(h * 0.21)}" fill="#DCE6E4" opacity=".92"/>`;
  body += `<rect x="${gX + gW - 14}" y="${Math.round(h * 0.36)}" width="4" height="46" rx="2" fill="${P.chrome}"/>`;

  body += `<rect x="0" y="${Math.round(h * 0.78)}" width="${w}" height="${h - Math.round(h * 0.78)}" rx="10" fill="${P.linen}"/>`;
  body += `<rect x="0" y="${Math.round(h * 0.78)}" width="${w}" height="10" fill="${P.linenShade}" opacity=".75"/>`;
  return svg(w, h, body);
}

/** Wardrobe beside the TV panel. */
function roomWardrobe(w, h, P) {
  const floorY = Math.round(h * 0.66);
  let body = roomShell(w, h, P, { floorY, lightX: Math.round(w * 0.78) });
  body += wardrobe(Math.round(w * 0.42), Math.round(h * 0.2), Math.round(w * 0.2), Math.round(h * 0.46), P);
  body += tvPanel(Math.round(w * 0.66), Math.round(h * 0.22), Math.round(w * 0.3), Math.round(h * 0.4), P);
  body += `<rect x="0" y="${Math.round(h * 0.76)}" width="${w}" height="${h - Math.round(h * 0.76)}" rx="10" fill="${P.linen}"/>`;
  body += `<rect x="0" y="${Math.round(h * 0.76)}" width="${w}" height="10" fill="${P.linenShade}" opacity=".75"/>`;
  return svg(w, h, body);
}

/**
 * Garden view: sliding window onto a lawn with trees, plus an armchair and
 * side table. Used for the Garden View room types.
 */
function roomGarden(w, h, P) {
  const floorY = Math.round(h * 0.72);
  let body = roomShell(w, h, P, { floorY, lightX: Math.round(w * 0.15) });

  // Window opening
  const wx = Math.round(w * 0.2);
  const wy = Math.round(h * 0.2);
  const ww = Math.round(w * 0.62);
  const wh = Math.round(h * 0.44);

  body += `<rect x="${wx - 8}" y="${wy - 8}" width="${ww + 16}" height="${wh + 16}" rx="4" fill="${P.wood}"/>`;
  body += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="${P.sky}"/>`;

  // Distant treeline + lawn seen through the glass
  const horizon = wy + Math.round(wh * 0.52);
  body += `<rect x="${wx}" y="${horizon}" width="${ww}" height="${wy + wh - horizon}" fill="${P.lawn}"/>`;
  body += `<rect x="${wx}" y="${horizon}" width="${ww}" height="6" fill="${P.lawnDark}" opacity=".7"/>`;

  for (let i = 0; i < 5; i += 1) {
    const cx = wx + Math.round(ww * (0.1 + i * 0.2));
    const r = 26 + ((i * 7) % 14);
    const ty = horizon - r + 6;
    body += `<circle cx="${cx}" cy="${ty}" r="${r}" fill="${P.foliage}" opacity=".95"/>`;
    body += `<circle cx="${cx - r * 0.5}" cy="${ty + r * 0.35}" r="${Math.round(r * 0.6)}" fill="${P.foliage}" opacity=".8"/>`;
    body += `<rect x="${cx - 3}" y="${ty + r - 4}" width="6" height="${horizon - ty - r + 12}" fill="${P.trunk}"/>`;
  }

  // Shrub row along the bottom of the view
  for (let i = 0; i < 8; i += 1) {
    const cx = wx + Math.round((ww / 8) * i + ww / 16);
    body += `<ellipse cx="${cx}" cy="${wy + wh - 8}" rx="24" ry="14" fill="${P.lawnDark}" opacity=".85"/>`;
  }

  // Mullions + glass sheen
  body += `<rect x="${wx + Math.round(ww / 2) - 4}" y="${wy}" width="8" height="${wh}" fill="${P.wood}"/>`;
  body += `<rect x="${wx}" y="${wy + Math.round(wh * 0.55)}" width="${ww}" height="5" fill="${P.wood}" opacity=".85"/>`;
  body += `<polygon points="${wx},${wy + wh} ${wx + Math.round(ww * 0.3)},${wy} ${wx + Math.round(ww * 0.46)},${wy} ${wx + Math.round(ww * 0.14)},${wy + wh}" fill="#FFFFFF" opacity=".16"/>`;

  // Curtains
  body += `<rect x="${wx - 26}" y="${wy - 14}" width="30" height="${wh + 40}" fill="${P.linenShade}" opacity=".95"/>`;
  body += `<rect x="${wx + ww - 4}" y="${wy - 14}" width="30" height="${wh + 40}" fill="${P.linenShade}" opacity=".95"/>`;

  // Armchair + side table in the foreground
  const ax = Math.round(w * 0.12);
  const ay = Math.round(h * 0.62);
  body += `<rect x="${ax}" y="${ay}" width="${Math.round(w * 0.2)}" height="${Math.round(h * 0.16)}" rx="10" fill="${P.towel}" opacity=".9"/>`;
  body += `<rect x="${ax + 6}" y="${ay - 26}" width="${Math.round(w * 0.2) - 12}" height="34" rx="9" fill="${P.towel}"/>`;
  body += `<rect x="${Math.round(w * 0.38)}" y="${Math.round(h * 0.7)}" width="${Math.round(w * 0.1)}" height="8" rx="4" fill="${P.wood}"/>`;
  body += `<rect x="${Math.round(w * 0.42)}" y="${Math.round(h * 0.71)}" width="6" height="${Math.round(h * 0.1)}" fill="${P.wood}"/>`;

  return svg(w, h, body);
}

/** Bathroom: vanity, mirror, WC and a stone-tile feature wall. */
function roomBathroom(w, h, P, opts = {}) {
  const floorY = Math.round(h * 0.8);
  let body =
    `<rect width="${w}" height="${h}" fill="${P.tile}"/>` +
    `<rect width="${w}" height="${Math.round(h * 0.08)}" fill="#F2F5EC"/>`;

  // Stone-tile feature wall (right third)
  const fw = Math.round(w * 0.4);
  const fx = w - fw;
  body += `<rect x="${fx}" y="0" width="${fw}" height="${floorY}" fill="${P.grout}"/>`;
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

  body += `<rect y="${floorY}" width="${w}" height="${h - floorY}" fill="#E7E7E2"/>`;
  for (let i = 1; i < 6; i += 1) {
    body += `<rect x="${Math.round((fx / 6) * i)}" y="0" width="1.5" height="${floorY}" fill="${P.grout}" opacity=".7"/>`;
  }
  for (let i = 1; i < 5; i += 1) {
    body += `<rect x="0" y="${Math.round((floorY / 5) * i)}" width="${fx}" height="1.5" fill="${P.grout}" opacity=".7"/>`;
  }

  // Mirror
  body += `<rect x="${Math.round(w * 0.06)}" y="${Math.round(h * 0.1)}" width="${Math.round(w * 0.3)}" height="${Math.round(h * 0.26)}" rx="3" fill="#DCE7EA" stroke="${P.chrome}" stroke-width="2"/>`;

  // Vanity counter + basin
  const cy = Math.round(h * 0.52);
  body += `<rect x="${Math.round(w * 0.03)}" y="${cy}" width="${Math.round(w * 0.42)}" height="14" rx="3" fill="#2E2E33"/>`;
  body += `<rect x="${Math.round(w * 0.06)}" y="${cy - 26}" width="${Math.round(w * 0.24)}" height="28" rx="7" fill="#FCFCFA" stroke="${P.tileDark}"/>`;
  body += `<rect x="${Math.round(w * 0.17)}" y="${cy - 46}" width="5" height="22" rx="2.5" fill="${P.chrome}"/>`;
  body += `<rect x="${Math.round(w * 0.17)}" y="${cy - 46}" width="22" height="5" rx="2.5" fill="${P.chrome}"/>`;

  // Towel rail with folded towels
  body += `<rect x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.05)}" width="${Math.round(w * 0.26)}" height="4" rx="2" fill="${P.chrome}"/>`;
  body += `<rect x="${Math.round(w * 0.1)}" y="${Math.round(h * 0.02)}" width="${Math.round(w * 0.1)}" height="13" rx="3" fill="${P.towel}"/>`;
  body += `<rect x="${Math.round(w * 0.22)}" y="${Math.round(h * 0.02)}" width="${Math.round(w * 0.1)}" height="13" rx="3" fill="#5D7CAB"/>`;

  if (opts.bathtub) {
    // Freestanding tub instead of the WC, for suite-grade bathrooms.
    const tx = Math.round(w * 0.5);
    const tw = Math.round(w * 0.4);
    const ty = Math.round(h * 0.54);
    const th = Math.round(h * 0.2);
    body += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="${Math.round(th / 2)}" fill="#FCFCFA" stroke="${P.tileDark}" stroke-width="2"/>`;
    body += `<rect x="${tx + 10}" y="${ty + 8}" width="${tw - 20}" height="${th - 18}" rx="${Math.round((th - 18) / 2)}" fill="#DCEAF0"/>`;
    body += `<rect x="${tx + 6}" y="${ty + th}" width="14" height="16" fill="#EDEDE8"/>`;
    body += `<rect x="${tx + tw - 20}" y="${ty + th}" width="14" height="16" fill="#EDEDE8"/>`;
    body += `<rect x="${tx + tw - 30}" y="${ty - 34}" width="5" height="34" rx="2.5" fill="${P.chrome}"/>`;
    body += `<rect x="${tx + tw - 48}" y="${ty - 34}" width="23" height="5" rx="2.5" fill="${P.chrome}"/>`;
  } else {
    const tx = Math.round(w * 0.52);
    body += `<rect x="${tx}" y="${cy - 4}" width="${Math.round(w * 0.16)}" height="18" rx="5" fill="#FAFAF8" stroke="${P.tileDark}"/>`;
    body += `<ellipse cx="${tx + Math.round(w * 0.08)}" cy="${cy + 34}" rx="${Math.round(w * 0.075)}" ry="24" fill="#FCFCFA" stroke="${P.tileDark}"/>`;
    body += `<ellipse cx="${tx + Math.round(w * 0.08)}" cy="${cy + 34}" rx="${Math.round(w * 0.05)}" ry="15" fill="#EDEDE8"/>`;
    body += `<rect x="${tx + Math.round(w * 0.03)}" y="${cy + 52}" width="${Math.round(w * 0.1)}" height="${floorY - cy - 52}" fill="#F2F2EE"/>`;
  }

  return svg(w, h, body);
}

/** Property hero: the building at dusk. */
function hotelHero(w, h) {
  const P = BASE;
  const groundY = Math.round(h * 0.78);
  let body =
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#3B2A63"/><stop offset="0.55" stop-color="#7A4C7E"/><stop offset="1" stop-color="#E0A06A"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;

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
        `fill="${lit ? P.glow : '#4A3F5C'}" opacity="${lit ? 0.92 : 0.7}"/>`;
    }
  }

  body += `<rect x="${Math.round(w / 2 - bw * 0.14)}" y="${groundY - 44}" width="${Math.round(bw * 0.28)}" height="44" fill="#4A3F5C"/>`;
  body += `<rect x="${Math.round(w / 2 - bw * 0.16)}" y="${groundY - 50}" width="${Math.round(bw * 0.32)}" height="9" rx="4" fill="${P.brand}"/>`;

  body += `<rect y="${groundY}" width="${w}" height="${h - groundY}" fill="#1E2A3A"/>`;
  body += `<rect y="${groundY}" width="${w}" height="4" fill="#33465E"/>`;
  for (let i = 0; i < 5; i += 1) {
    body += `<rect x="${Math.round(w * (0.2 + i * 0.14))}" y="${groundY + 14 + i * 6}" width="${Math.round(w * 0.08)}" height="3" rx="1.5" fill="${P.glow}" opacity=".28"/>`;
  }

  return svg(w, h, body);
}

/** Neutral fallback used when a room has no photos at all. */
function placeholder(w, h) {
  const P = BASE;
  const body =
    `<rect width="${w}" height="${h}" fill="${P.wallShade}"/>` +
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="none" stroke="${P.wallDark}" stroke-width="2"/>` +
    `<g transform="translate(${w / 2 - 60}, ${h / 2 - 34})" fill="none" stroke="${P.wood}" stroke-width="5" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity=".55">` +
    `<path d="M6 62V22"/><path d="M6 40h108v22"/><path d="M114 62V40"/>` +
    `<path d="M22 40V26a6 6 0 0 1 6-6h26a6 6 0 0 1 6 6v14"/>` +
    `<rect x="30" y="26" width="18" height="12" rx="4"/>` +
    `</g>` +
    `<text x="${w / 2}" y="${h / 2 + 52}" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="15" font-weight="600" fill="${P.woodLight}" opacity=".75">Room photo</text>`;
  return svg(w, h, body);
}

// ─── which shots each room type gets ────────────────────────────────────────
const SHOTS = {
  bed: (P) => roomBed(750, 500, P),
  tv: (P) => roomTv(750, 500, P),
  wardrobe: (P) => roomWardrobe(750, 500, P),
  garden: (P) => roomGarden(750, 500, P),
  bathroom: (P) => roomBathroom(750, 500, P),
  bathtub: (P) => roomBathroom(750, 500, P, { bathtub: true }),
};

const ROOM_SHOTS = {
  'deluxe-double-room': ['bed', 'tv', 'wardrobe', 'bathroom'],
  'super-deluxe-room': ['bed', 'tv', 'wardrobe', 'bathroom'],
  'executive-room': ['bed', 'garden', 'tv', 'bathroom'],
  'luxury-room': ['bed', 'garden', 'wardrobe', 'bathroom'],
  'suite-room': ['bed', 'garden', 'bathtub', 'tv'],
};

/** filename -> draw function, built from the room/shot tables. */
function fileMap() {
  const files = {
    '_placeholder.svg': () => placeholder(750, 500),
    'kingfisher-mandla-1.svg': () => hotelHero(900, 520),
  };

  for (const [slug, shots] of Object.entries(ROOM_SHOTS)) {
    const P = ROOM_PALETTES[slug] || BASE;
    shots.forEach((shot, i) => {
      files[`${slug}-${i + 1}.svg`] = () => SHOTS[shot](P);
    });
  }

  return files;
}

/**
 * Writes any missing hotel artwork. Never overwrites, so real uploaded photos
 * and manual tweaks are safe. Synchronous and cheap (pure string building).
 */
function generateHotelImages() {
  try {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

    let written = 0;
    for (const [name, draw] of Object.entries(fileMap())) {
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
