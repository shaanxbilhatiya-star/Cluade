'use strict';
/**
 * Code 39 barcode renderer (SVG). Code 39 is the symbology cinemas and event
 * venues most commonly use for printed tickets, needs no error-correction
 * tables, and encodes our booking references exactly (0-9, A-Z, -, ., space,
 * $, /, +, %). Rendered server side so the client needs no barcode library.
 *
 * Each character is 9 elements wide - 5 bars and 4 spaces, alternating,
 * starting with a bar. 'w' = wide element (3x), 'n' = narrow element (1x).
 */

const PATTERNS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
  E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn',
  I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn',
  Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn', // start / stop sentinel
};

/** Characters Code 39 cannot represent are dropped. */
function sanitize(value) {
  return String(value)
    .toUpperCase()
    .split('')
    .filter((ch) => PATTERNS[ch] && ch !== '*')
    .join('');
}

/**
 * @returns {{svg:string, encoded:string, width:number, height:number}}
 */
function render(value, opts = {}) {
  const narrow = opts.narrow || 2; // px per narrow element
  const wide = narrow * 3;
  const height = opts.height || 90;
  const quiet = opts.quiet != null ? opts.quiet : narrow * 10;
  const showText = opts.showText !== false;
  const textHeight = showText ? 26 : 0;
  const color = opts.color || '#111827';
  const background = opts.background || '#ffffff';

  const encoded = sanitize(value);
  if (!encoded) throw new Error('Nothing encodable in barcode value');

  const chars = `*${encoded}*`.split('');
  const bars = [];
  let x = quiet;

  chars.forEach((ch, charIdx) => {
    const pattern = PATTERNS[ch];
    for (let i = 0; i < 9; i += 1) {
      const w = pattern[i] === 'w' ? wide : narrow;
      const isBar = i % 2 === 0;
      if (isBar) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="${color}"/>`);
      x += w;
    }
    if (charIdx < chars.length - 1) x += narrow; // inter-character gap
  });

  const width = x + quiet;
  const totalHeight = height + textHeight;

  const text = showText
    ? `<text x="${width / 2}" y="${height + 20}" text-anchor="middle" font-family="'Courier New',monospace" font-size="17" letter-spacing="3" fill="${color}">${encoded}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="Barcode ${encoded}">
  <rect width="${width}" height="${totalHeight}" fill="${background}"/>
  ${bars.join('')}
  ${text}
</svg>`;

  return { svg, encoded, width, height: totalHeight };
}

module.exports = { render, sanitize, PATTERNS };
