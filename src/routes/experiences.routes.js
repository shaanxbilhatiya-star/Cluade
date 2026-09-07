'use strict';
const db = require('../db');
const { Router } = require('../router');

const router = new Router();

function slim(e) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    category: e.category,
    subtitle: e.subtitle,
    priceLabel: e.priceLabel,
    priceNote: e.priceNote,
    features: e.features || [],
    badge: e.badge || null,
    icon: e.icon,
    order: e.order,
    imageUrl: e.imageUrl,
  };
}

/** All active experiences, sorted by order (lower first), then insertion order. */
router.get('/experiences', () => {
  const experiences = db
    .get('experiences')
    .filter((e) => e.active !== false)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ao = typeof a.e.order === 'number' ? a.e.order : Infinity;
      const bo = typeof b.e.order === 'number' ? b.e.order : Infinity;
      return ao - bo || a.i - b.i;
    })
    .map(({ e }) => slim(e));

  return { experiences };
});

module.exports = router;
