'use strict';
const db = require('../db');
const { Router } = require('../router');

const router = new Router();

/** Everything the Experiences tab needs, sorted for display. */
router.get('/experiences', () => {
  const list = db
    .get('experiences')
    .filter((e) => e.active !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return {
    count: list.length,
    phone: '7648913272',
    experiences: list,
  };
});

module.exports = router;
