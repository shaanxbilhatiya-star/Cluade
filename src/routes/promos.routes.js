'use strict';
/**
 * Promo sliders, read side.
 *
 *   GET /api/promos            every section's slider
 *   GET /api/promos/:section   one tab's slider
 *
 * The four tab payloads (/api/home, /api/hotels, /api/dine-in, /api/waterpark)
 * already embed their own slider, so the app needs no extra request on load.
 * These endpoints exist for refreshing a slider on its own and for tests.
 */
const promos = require('../promos');
const { Router } = require('../router');

const router = new Router();

router.get('/promos', () => ({
  sections: promos.SECTIONS.map((s) => promos.publicSlider(s.id)),
}));

router.get('/promos/:section', (ctx) => promos.publicSlider(ctx.params.section));

module.exports = router;
