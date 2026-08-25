'use strict';
const db = require('../db');
const { Router, HttpError } = require('../router');

const router = new Router();

router.get('/food', (ctx) => {
  const { category, q, popular, veg, limit } = ctx.query;
  let list = db.get('foodItems').filter((f) => f.available !== false);

  if (category && category !== 'All') list = list.filter((f) => f.category.toLowerCase() === category.toLowerCase());
  if (popular === 'true') list = list.filter((f) => f.popular);
  if (veg === 'true') list = list.filter((f) => f.veg);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (f) => f.name.toLowerCase().includes(needle) || f.category.toLowerCase().includes(needle) || String(f.description).toLowerCase().includes(needle)
    );
  }

  const capped = limit ? list.slice(0, Number(limit)) : list;
  return { count: capped.length, items: capped };
});

/** Everything the Food Order screen needs in one round trip. */
router.get('/food/home', () => {
  const items = db.get('foodItems').filter((f) => f.available !== false);
  const byCategory = (cat) => items.filter((f) => f.category === cat);

  return {
    banners: db
      .get('offers')
      .filter((o) => o.active !== false && (o.appliesTo === 'food' || o.appliesTo === 'all'))
      .map((o) => ({ id: o.id, title: o.title, subtitle: o.subtitle, code: o.code, bannerUrl: o.bannerUrl })),
    categories: ['All', ...new Set(items.map((f) => f.category))],
    rails: [
      { key: 'popular', title: 'Most Popular', items: items.filter((f) => f.popular) },
      { key: 'beverages', title: 'New Beverages', items: byCategory('Beverages') },
      { key: 'combos', title: 'Value Combos', items: byCategory('Combos') },
      { key: 'snacks', title: 'Quick Snacks', items: [...byCategory('Snacks'), ...byCategory('Popcorn')] },
      { key: 'desserts', title: 'Sweet Endings', items: [...byCategory('Desserts'), ...byCategory('Meals')] },
    ].filter((rail) => rail.items.length > 0),
  };
});

router.get('/food/categories', () => ({
  categories: ['All', ...new Set(db.get('foodItems').map((f) => f.category))],
}));

router.get('/food/:id', (ctx) => {
  const item = db.byId('foodItems', ctx.params.id) || db.findOne('foodItems', (f) => f.slug === ctx.params.id);
  if (!item) throw new HttpError(404, 'Food item not found');
  const related = db
    .get('foodItems')
    .filter((f) => f.id !== item.id && f.category === item.category && f.available !== false)
    .slice(0, 6);
  return Object.assign({}, item, { related });
});

router.get('/offers', (ctx) => {
  const { appliesTo } = ctx.query;
  let list = db.get('offers').filter((o) => o.active !== false);
  if (appliesTo) list = list.filter((o) => o.appliesTo === appliesTo || o.appliesTo === 'all');
  return { count: list.length, offers: list };
});

module.exports = router;
