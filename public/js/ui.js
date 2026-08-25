/* DOM helpers, formatters and shared components. */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CURRENCY = '\u20B9';

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Build a detached element from an HTML string. */
  function h(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html).trim();
    return tpl.content.firstElementChild;
  }

  function money(amount, opts) {
    var n = Number(amount) || 0;
    var body = n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (opts && opts.plain) return body;
    return CURRENCY + body;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      var p = value.split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]);
    }
    return new Date(value);
  }

  /** "Dec 22, 2023" */
  function shortDate(value) {
    var d = toDate(value);
    if (isNaN(d)) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /** "17:30" */
  function hhmm(value) {
    var d = toDate(value);
    if (isNaN(d)) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** "Dec 22, 2023 · 17:30 - 20:38" (matches the ticket rows in the design) */
  function showLine(startsAt, endsAt) {
    if (!startsAt) return '';
    var out = shortDate(startsAt) + ' · ' + hhmm(startsAt);
    if (endsAt) out += ' - ' + hhmm(endsAt);
    return out;
  }

  /** "Today", "Tomorrow" or "Fri, Dec 22" */
  function relativeDay(value) {
    var d = toDate(value);
    if (isNaN(d)) return '';
    var today = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var days = Math.round((a - b) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return DOW[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function timeAgo(value) {
    var diff = Date.now() - toDate(value).getTime();
    if (isNaN(diff)) return '';
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.round(hrs / 24);
    if (days < 7) return days + 'd ago';
    return shortDate(value);
  }

  function runtime(minutes) {
    var m = Number(minutes) || 0;
    if (!m) return '';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0); })
      .join('')
      .toUpperCase();
  }

  function icon(name, size, opts) { return window.Icons.svg(name, size, opts); }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(message, type) {
    var host = document.getElementById('toast-host');
    if (!host) return;
    var iconName = type === 'error' ? 'alert-circle' : type === 'success' ? 'check' : 'info';
    var node = h(
      '<div class="toast' + (type ? ' toast--' + type : '') + '" role="status">' +
      icon(iconName, 17) + '<span>' + esc(message) + '</span></div>'
    );
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(10px)';
      setTimeout(function () { node.remove(); }, 260);
    }, type === 'error' ? 4200 : 2600);
  }

  // ── Bottom sheet ───────────────────────────────────────────────────────────
  var openSheet = null;

  function sheet(options) {
    var host = document.getElementById('sheet-host');
    if (openSheet) openSheet.close();

    host.hidden = false;
    host.innerHTML =
      '<div class="sheet-host__backdrop" data-sheet-close></div>' +
      '<div class="sheet" role="dialog" aria-modal="true"' + (options.title ? ' aria-label="' + esc(options.title) + '"' : '') + '>' +
        '<div class="sheet__grip"></div>' +
        (options.title
          ? '<div class="sheet__head"><h2 class="sheet__title">' + esc(options.title) + '</h2>' +
            '<button class="icon-btn" data-sheet-close aria-label="Close">' + icon('close', 22) + '</button></div>'
          : '') +
        '<div class="sheet__body"></div>' +
      '</div>';

    var body = host.querySelector('.sheet__body');
    if (typeof options.body === 'string') body.innerHTML = options.body;
    else if (options.body) body.appendChild(options.body);

    function close() {
      if (openSheet !== api) return;
      host.hidden = true;
      host.innerHTML = '';
      openSheet = null;
      document.removeEventListener('keydown', onKey);
      if (options.onClose) options.onClose();
    }

    function onKey(e) { if (e.key === 'Escape') close(); }

    host.querySelectorAll('[data-sheet-close]').forEach(function (node) {
      node.addEventListener('click', close);
    });
    document.addEventListener('keydown', onKey);

    var api = { close: close, body: body, root: host.querySelector('.sheet') };
    openSheet = api;
    return api;
  }

  /** Promise-based confirmation sheet. Resolves true when confirmed. */
  function confirmSheet(options) {
    return new Promise(function (resolve) {
      var settled = false;
      var view = h(
        '<div style="padding:0 16px 8px">' +
          '<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:var(--ink-soft)">' + esc(options.message) + '</p>' +
          '<button class="btn' + (options.danger ? ' btn--danger' : '') + '" data-yes>' + esc(options.confirmLabel || 'Confirm') + '</button>' +
          '<div style="height:10px"></div>' +
          '<button class="btn-outline btn-outline--lg" data-no>' + esc(options.cancelLabel || 'Cancel') + '</button>' +
        '</div>'
      );
      var s = sheet({
        title: options.title,
        body: view,
        onClose: function () { if (!settled) { settled = true; resolve(false); } },
      });
      view.querySelector('[data-yes]').addEventListener('click', function () {
        settled = true; resolve(true); s.close();
      });
      view.querySelector('[data-no]').addEventListener('click', function () {
        settled = true; resolve(false); s.close();
      });
    });
  }

  // ── Shared markup ──────────────────────────────────────────────────────────
  function appbar(options) {
    var o = options || {};
    var left = o.back
      ? '<button class="icon-btn" data-action="back" aria-label="Go back">' + icon('arrow-left', 23) + '</button>'
      : o.logo === false
        ? '<span class="appbar__spacer"></span>'
        : '<img class="appbar__logo" src="/img/logo.svg" alt="CineFlex">';

    return '<header class="appbar' + (o.plain ? ' appbar--plain' : '') + (o.bordered ? ' appbar--bordered' : '') + '">' +
      left +
      '<h1 class="appbar__title' + (o.alignLeft ? ' appbar__title--left' : '') + '">' + esc(o.title || '') + '</h1>' +
      (o.right || '<span class="appbar__spacer"></span>') +
      '</header>';
  }

  function sectionHead(title, moreAction) {
    return '<div class="section__head"><h2 class="section__title">' + esc(title) + '</h2>' +
      (moreAction
        ? '<button class="section__more" data-action="' + esc(moreAction) + '">View All ' + icon('chevron-right', 15) + '</button>'
        : '') +
      '</div>';
  }

  function posterImg(url, alt, cls) {
    return '<img class="' + (cls || '') + '" src="' + esc(url || '/img/posters/_placeholder.svg') + '" alt="' + esc(alt || '') + '" loading="lazy" data-fallback="/img/posters/_placeholder.svg">';
  }

  function ratingBadge(movie) {
    if (!movie.rating) return '';
    return '<span class="poster__badge">' + icon('star', 11, { solid: false }) + Number(movie.rating).toFixed(1) + '</span>';
  }

  /** Poster + title + optional "Book Now" — the Now Playing / Coming Soon card. */
  function movieCard(movie, options) {
    var o = options || {};
    var meta = o.meta !== undefined
      ? o.meta
      : movie.status === 'coming_soon'
        ? shortDate(movie.releaseDate)
        : (movie.genres || []).slice(0, 2).join(', ');

    return '<article class="movie-card">' +
      '<button class="poster" data-action="movie" data-id="' + esc(movie.id) + '" aria-label="' + esc(movie.title) + '">' +
        posterImg(movie.posterUrl, movie.title) +
        ratingBadge(movie) +
        (movie.certificate ? '<span class="poster__cert">' + esc(movie.certificate) + '</span>' : '') +
      '</button>' +
      '<h3 class="movie-card__title">' + esc(movie.title) + '</h3>' +
      (meta ? '<p class="movie-card__meta">' + esc(meta) + '</p>' : '') +
      (o.book === false
        ? ''
        : '<button class="btn-outline" data-action="' + (movie.status === 'coming_soon' ? 'movie' : 'book') + '" data-id="' + esc(movie.id) + '">' +
            (movie.status === 'coming_soon' ? 'Details' : 'Book Now') + '</button>') +
      '</article>';
  }

  function foodCard(item) {
    return '<article class="food-card">' +
      '<button data-action="food-item" data-id="' + esc(item.id) + '" style="width:100%;text-align:left">' +
        '<img class="food-card__img" src="' + esc(item.imageUrl) + '" alt="' + esc(item.name) + '" loading="lazy" data-fallback="/img/food/_placeholder.svg">' +
        '<h3 class="food-card__name">' + esc(item.name) + '</h3>' +
        '<p class="food-card__price">' + money(item.price) + '</p>' +
      '</button>' +
      '</article>';
  }

  function empty(options) {
    var o = options || {};
    return '<div class="empty">' +
      '<div class="empty__icon">' + icon(o.icon || 'inbox', 34) + '</div>' +
      '<h3 class="empty__title">' + esc(o.title || 'Nothing here yet') + '</h3>' +
      (o.text ? '<p class="empty__text">' + esc(o.text) + '</p>' : '') +
      (o.actionLabel ? '<button class="btn btn--sm" data-action="' + esc(o.action) + '">' + esc(o.actionLabel) + '</button>' : '') +
      '</div>';
  }

  /** Account-style list row. */
  function row(options) {
    var o = options;
    var right = '';
    if (o.toggle !== undefined) {
      right = '<button class="switch" role="switch" aria-checked="' + (o.toggle ? 'true' : 'false') +
        '" data-action="' + esc(o.action) + '" aria-label="' + esc(o.label) + '"></button>';
    } else {
      right = (o.value ? '<span class="row__value">' + esc(o.value) + '</span>' : '') +
        '<span class="row__chevron">' + icon('chevron-right', 19) + '</span>';
    }

    var tag = o.toggle !== undefined ? 'div' : 'button';
    var attrs = o.toggle !== undefined ? '' : ' data-action="' + esc(o.action) + '"' + (o.id ? ' data-id="' + esc(o.id) + '"' : '');

    return '<' + tag + ' class="row' + (o.danger ? ' row--danger' : '') + '"' + attrs + '>' +
      '<span class="row__icon">' + icon(o.icon, 23) + '</span>' +
      '<span class="row__label">' + esc(o.label) + '</span>' +
      right +
      '</' + tag + '>';
  }

  function statusPill(booking) {
    var label = booking.status === 'cancelled' ? 'Cancelled'
      : booking.status === 'completed' ? 'Watched'
      : booking.payment && booking.payment.status === 'pending' ? 'Pay at counter'
      : 'Confirmed';
    var kind = booking.status === 'cancelled' ? 'cancelled'
      : booking.status === 'completed' ? 'completed'
      : booking.payment && booking.payment.status === 'pending' ? 'pending'
      : 'confirmed';
    return '<span class="status-pill status-pill--' + kind + '">' + label + '</span>';
  }

  function spinnerBlock() {
    return '<div class="loading-block"><div class="spinner" role="status" aria-label="Loading"></div></div>';
  }

  /** Horizontally scrolling carousel with dot indicators. */
  function carousel(slidesHtml, options) {
    var o = options || {};
    return '<div class="carousel" data-carousel' + (o.autoplay ? ' data-autoplay="' + o.autoplay + '"' : '') + '>' +
      '<div class="carousel__track">' + slidesHtml.join('') + '</div>' +
      '<div class="carousel__dots">' +
        slidesHtml.map(function (_s, i) {
          return '<span class="carousel__dot" aria-current="' + (i === 0 ? 'true' : 'false') + '"></span>';
        }).join('') +
      '</div></div>';
  }

  /** Wires dot indicators (and optional autoplay) for every carousel in root. */
  function initCarousels(root) {
    root.querySelectorAll('[data-carousel]').forEach(function (car) {
      var track = car.querySelector('.carousel__track');
      var dots = Array.prototype.slice.call(car.querySelectorAll('.carousel__dot'));
      if (!track || dots.length < 2) return;

      function sync() {
        var slide = track.firstElementChild;
        if (!slide) return;
        var step = slide.getBoundingClientRect().width + 12;
        var index = Math.round(track.scrollLeft / step);
        dots.forEach(function (dot, i) { dot.setAttribute('aria-current', i === index ? 'true' : 'false'); });
      }

      track.addEventListener('scroll', function () {
        window.clearTimeout(track._syncTimer);
        track._syncTimer = window.setTimeout(sync, 60);
      });

      var interval = Number(car.getAttribute('data-autoplay'));
      if (interval > 0) {
        var timer = setInterval(function () {
          if (!document.body.contains(car)) { clearInterval(timer); return; }
          if (document.hidden) return;
          var slide = track.firstElementChild;
          if (!slide) return;
          var step = slide.getBoundingClientRect().width + 12;
          var next = Math.round(track.scrollLeft / step) + 1;
          if (next >= dots.length) next = 0;
          track.scrollTo({ left: next * step, behavior: 'smooth' });
        }, interval);
      }
    });
  }

  /** Delegated click handling: UI.actions(root, { book: fn, movie: fn }) */
  function actions(root, handlers) {
    root.addEventListener('click', function (event) {
      var target = event.target.closest('[data-action]');
      if (!target || !root.contains(target)) return;
      var name = target.getAttribute('data-action');
      var handler = handlers[name];
      if (!handler) return;
      event.preventDefault();
      handler(target, event);
    });
  }

  /** Swap in a fallback image whenever one fails to load (e.g. remote poster). */
  document.addEventListener(
    'error',
    function (event) {
      var node = event.target;
      if (!node || node.tagName !== 'IMG') return;
      var fallback = node.getAttribute('data-fallback');
      if (!fallback || node.src.indexOf(fallback) !== -1) return;
      node.src = fallback;
    },
    true
  );

  /* Screen registry. Created here because every js/screens/*.js file registers
     itself into it, and those files load before app.js (which does the routing). */
  window.Screens = window.Screens || {};

  window.UI = {
    esc: esc, h: h, money: money, icon: icon,
    shortDate: shortDate, hhmm: hhmm, showLine: showLine, relativeDay: relativeDay,
    timeAgo: timeAgo, runtime: runtime, initials: initials, toDate: toDate,
    toast: toast, sheet: sheet, confirm: confirmSheet,
    appbar: appbar, sectionHead: sectionHead, posterImg: posterImg, movieCard: movieCard,
    foodCard: foodCard, empty: empty, row: row, statusPill: statusPill,
    spinnerBlock: spinnerBlock, carousel: carousel, initCarousels: initCarousels,
    actions: actions, MONTHS: MONTHS, DOW: DOW, CURRENCY: CURRENCY,
  };
})();
