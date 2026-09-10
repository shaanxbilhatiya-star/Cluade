/* Stay tab — hotel rooms at Kingfisher: browse room types, pick a date range,
   and book a stay. Room content, photos, pricing and inventory are all managed
   from the admin panel (Hotel & Rooms); these screens only render it.

   Screens: hotels · hotelRoom · hotelCheckout · hotelConfirmation            */
(function () {
  'use strict';

  /** Payment options at checkout. The ids are what the API accepts. */
  var PAY_METHODS = [
    { id: 'upi', label: 'UPI', sub: 'GPay, PhonePe, Paytm', icon: 'wallet' },
    { id: 'card', label: 'Credit / Debit Card', sub: 'Visa, Mastercard, RuPay', icon: 'card' },
    { id: 'netbanking', label: 'Net Banking', sub: 'All major banks', icon: 'bank' },
    { id: 'cash', label: 'Pay at the front desk', sub: 'Settle when you check in', icon: 'cash' },
  ];

  var STAY_KEY = 'cineflex.stay';
  var MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  var DOW_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var CALENDAR_MONTHS = 4;
  var MAX_ROOMS = 5;
  /** How many "Popular with Guests" chips to show before collapsing the rest. */
  var POPULAR_VISIBLE = 5;

  // ── Date helpers (all dates are local 'YYYY-MM-DD' keys) ───────────────────
  function keyOf(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function todayKey() { return keyOf(new Date()); }

  function parseKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
    var p = String(key).split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2] ? d : null;
  }

  function addDays(key, days) {
    var d = parseKey(key);
    if (!d) return key;
    d.setDate(d.getDate() + days);
    return keyOf(d);
  }

  function nightsBetween(checkIn, checkOut) {
    var a = parseKey(checkIn);
    var b = parseKey(checkOut);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  /** "Thu, 1 Oct" */
  function dayLabel(key) {
    var d = parseKey(key);
    if (!d) return '—';
    return UI.DOW[d.getDay()] + ', ' + d.getDate() + ' ' + UI.MONTHS[d.getMonth()];
  }

  function nightsLabel(n) {
    return n + ' night' + (n === 1 ? '' : 's');
  }

  function roomsLabel(n) {
    return n + ' room' + (n === 1 ? '' : 's');
  }

  function guestsLabel(g) {
    var out = g.adults + ' adult' + (g.adults === 1 ? '' : 's');
    if (g.children) out += ' · ' + g.children + ' child' + (g.children === 1 ? '' : 'ren');
    return out;
  }

  // ── Stay selection, remembered across screens and reloads ──────────────────
  function defaultStay() {
    var checkIn = todayKey();
    return { checkIn: checkIn, checkOut: addDays(checkIn, 1), rooms: 1, adults: 2, children: 0 };
  }

  function readStay() {
    var stay;
    try { stay = JSON.parse(localStorage.getItem(STAY_KEY) || 'null'); } catch (_e) { stay = null; }
    if (!stay) return defaultStay();

    var fallback = defaultStay();
    var out = {
      checkIn: parseKey(stay.checkIn) ? stay.checkIn : fallback.checkIn,
      checkOut: parseKey(stay.checkOut) ? stay.checkOut : fallback.checkOut,
      rooms: Math.min(MAX_ROOMS, Math.max(1, Number(stay.rooms) || 1)),
      adults: Math.max(1, Number(stay.adults) || 2),
      children: Math.max(0, Number(stay.children) || 0),
    };

    // A remembered range can go stale overnight — roll it forward, never back.
    if (out.checkIn < todayKey()) return fallback;
    if (nightsBetween(out.checkIn, out.checkOut) < 1) out.checkOut = addDays(out.checkIn, 1);
    return out;
  }

  function writeStay(stay) {
    try { localStorage.setItem(STAY_KEY, JSON.stringify(stay)); } catch (_e) {}
  }

  /** Merges the stay saved locally with anything passed in the URL. */
  function stayFrom(query) {
    var stay = readStay();
    if (query && parseKey(query.checkIn) && parseKey(query.checkOut) &&
      nightsBetween(query.checkIn, query.checkOut) >= 1 && query.checkIn >= todayKey()) {
      stay.checkIn = query.checkIn;
      stay.checkOut = query.checkOut;
    }
    if (query && query.rooms) stay.rooms = Math.min(MAX_ROOMS, Math.max(1, Number(query.rooms) || 1));
    if (query && query.adults) stay.adults = Math.max(1, Number(query.adults) || 1);
    if (query && query.children !== undefined) stay.children = Math.max(0, Number(query.children) || 0);
    return stay;
  }

  function stayQuery(stay, extra) {
    var params = {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      rooms: stay.rooms,
      adults: stay.adults,
      children: stay.children,
    };
    Object.keys(extra || {}).forEach(function (k) { params[k] = extra[k]; });
    return new URLSearchParams(params).toString();
  }

  // ── Amenity icons ──────────────────────────────────────────────────────────
  /**
   * Amenity label -> icon. First match wins, so the specific patterns must come
   * before the broad ones (e.g. "Geyser/Water Heater" before plain "Heater",
   * and "front desk"/housekeeping before the generic "desk").
   */
  var AMENITY_ICONS = [
    [/wi-?fi|internet/i, 'wifi'],
    [/air ?condition|^ac$|a\/c/i, 'snow'],
    [/mineral water|drinking water/i, 'droplet'],
    [/geyser|water heater|hot ?& ?cold|shower/i, 'droplet'],
    [/heater|warmer/i, 'sun'],
    [/laundry|iron/i, 'hanger'],
    [/closet|cupboard|wardrobe/i, 'hanger'],
    [/front desk|room service|housekeep/i, 'concierge'],
    [/tv|television|entertainment/i, 'tv'],
    [/telephone|phone|intercom/i, 'phone'],
    [/charging|socket|plug ?point/i, 'plug'],
    [/kettle|tea|coffee/i, 'cup'],
    [/fruit|welcome drink/i, 'food'],
    [/hairdryer|dryer/i, 'fan'],
    [/couch|sofa/i, 'sofa'],
    [/mirror/i, 'eye'],
    [/safe|lock|security/i, 'lock'],
    [/bathtub|bath ?tub/i, 'bath'],
    [/towel|toiletr|dental|slipper|toilet|bath/i, 'bath'],
    [/blanket|linen|duvet/i, 'blanket'],
    [/study|work desk/i, 'doc'],
    [/chair|desk|table/i, 'chair'],
    [/mosquito|net/i, 'shield'],
    [/newspaper|magazine/i, 'file'],
    [/garden|view|balcony/i, 'tree'],
    [/fan/i, 'fan'],
    [/bed/i, 'bed'],
    [/parking/i, 'map-pin'],
    [/restaurant|breakfast|food|meal/i, 'food'],
    [/power|backup|generator/i, 'sparkle'],
    [/pool|water park/i, 'waves'],
    [/cinema|movie/i, 'play'],
  ];

  function amenityIcon(name) {
    for (var i = 0; i < AMENITY_ICONS.length; i += 1) {
      if (AMENITY_ICONS[i][0].test(name)) return AMENITY_ICONS[i][1];
    }
    return 'check';
  }

  // ── Shared markup ──────────────────────────────────────────────────────────
  function photoOf(room, index) {
    var photos = room.photos || [];
    return photos[index || 0] || '/img/hotels/_placeholder.svg';
  }

  function img(src, alt, cls) {
    return '<img class="' + cls + '" src="' + UI.esc(src) + '" alt="' + UI.esc(alt || '') + '" ' +
      'loading="lazy" data-fallback="/img/hotels/_placeholder.svg">';
  }

  // ── Property photos ────────────────────────────────────────────────────────
  /* Galleries of the property itself (pool, reception, restaurant …). They live
     on the hotel record, not on a room type, so every room shows the same set —
     including rooms added long after the photos were uploaded. Categories are
     defined once in /js/hotel-photo-categories.js.                             */

  /** Tiles shown per category before the rest collapse behind "+N Photos". */
  var PHOTO_TILES = 6;

  function photoCategories() {
    return window.HotelPhotoCategories || [];
  }

  function photoCategoryLabel(id) {
    var match = photoCategories().filter(function (c) { return c.id === id; })[0];
    return match ? match.label : 'Photos';
  }

  function photosInCategory(hotel, id) {
    return (((hotel || {}).propertyPhotos || {})[id] || []).filter(Boolean);
  }

  /** Categories that actually have photos, in the order they're defined. */
  function photoGroups(hotel) {
    return photoCategories()
      .map(function (c) {
        return { id: c.id, label: c.label, icon: c.icon, photos: photosInCategory(hotel, c.id) };
      })
      .filter(function (g) { return g.photos.length; });
  }

  function propertyPhotos(hotel) {
    var groups = photoGroups(hotel);
    if (!groups.length) return '';

    return '<h2 class="subhead">Property photos</h2>' +
      '<p class="photo-intro">Shared spaces and facilities every guest can use.</p>' +
      '<div class="chips photo-nav">' +
        groups.map(function (g) {
          return '<button class="chip chip--sm" type="button" data-action="jump-photos" ' +
            'data-cat="' + UI.esc(g.id) + '">' + UI.esc(g.label) + '</button>';
        }).join('') +
      '</div>' +
      groups.map(function (g) {
        var shown = Math.min(g.photos.length, PHOTO_TILES);
        var hidden = g.photos.length - shown;

        return '<section class="photo-group" data-photo-group="' + UI.esc(g.id) + '">' +
          '<h3 class="photo-group__title">' + UI.icon(g.icon, 15) +
            '<span>' + UI.esc(g.label) + '</span>' +
            '<small>' + g.photos.length + '</small></h3>' +
          '<div class="photo-grid">' +
            g.photos.slice(0, shown).map(function (src, i) {
              // The last visible tile carries the overflow count, so nothing is
              // silently unreachable — tapping it opens the viewer mid-gallery.
              var overflow = i === shown - 1 ? hidden : 0;
              return '<button class="photo-tile" type="button" data-action="view-photo" ' +
                  'data-cat="' + UI.esc(g.id) + '" data-index="' + i + '" ' +
                  'aria-label="' + UI.esc(g.label + ' photo ' + (i + 1) + ' of ' + g.photos.length) + '">' +
                  img(src, g.label + ' photo ' + (i + 1), 'photo-tile__img') +
                  (overflow ? '<span class="photo-tile__more">+' + overflow + ' Photos</span>' : '') +
                '</button>';
            }).join('') +
          '</div>' +
        '</section>';
      }).join('');
  }

  /** Full-screen photo viewer: arrows, swipe, Esc and tap-outside all close/step. */
  function openPhotoViewer(photos, startIndex, label) {
    if (!photos.length) return;
    var index = Math.min(Math.max(startIndex || 0, 0), photos.length - 1);

    var node = UI.h(
      '<div class="photo-viewer" role="dialog" aria-modal="true" ' +
          'aria-label="' + UI.esc(label || 'Photos') + '">' +
        '<div class="photo-viewer__bar">' +
          '<button class="photo-viewer__btn" type="button" data-close aria-label="Close photos">' +
            UI.icon('close', 22) + '</button>' +
          '<span class="photo-viewer__label">' + UI.esc(label || '') + '</span>' +
          '<span class="photo-viewer__count" data-count></span>' +
        '</div>' +
        '<div class="photo-viewer__stage" data-stage></div>' +
        '<button class="photo-viewer__nav photo-viewer__nav--prev" type="button" data-prev ' +
          'aria-label="Previous photo">' + UI.icon('chevron-left', 26) + '</button>' +
        '<button class="photo-viewer__nav photo-viewer__nav--next" type="button" data-next ' +
          'aria-label="Next photo">' + UI.icon('chevron-right', 26) + '</button>' +
      '</div>'
    );

    var stage = node.querySelector('[data-stage]');
    var counter = node.querySelector('[data-count]');
    var prevBtn = node.querySelector('[data-prev]');
    var nextBtn = node.querySelector('[data-next]');

    function paint() {
      stage.innerHTML = '<img class="photo-viewer__img" src="' + UI.esc(photos[index]) + '" ' +
        'alt="' + UI.esc((label || 'Photo') + ' ' + (index + 1)) + '" ' +
        'data-fallback="/img/hotels/_placeholder.svg">';
      counter.textContent = (index + 1) + ' / ' + photos.length;
      prevBtn.hidden = photos.length < 2;
      nextBtn.hidden = photos.length < 2;
    }

    function step(delta) {
      index = (index + delta + photos.length) % photos.length;
      paint();
    }

    function close() {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('photo-viewer-open');
      node.remove();
    }

    function onKey(event) {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
    }

    node.addEventListener('click', function (event) {
      // Tapping the backdrop (but not the photo itself) dismisses the viewer.
      if (event.target.closest('[data-close]') || event.target === node || event.target === stage) {
        close();
      } else if (event.target.closest('[data-prev]')) {
        step(-1);
      } else if (event.target.closest('[data-next]')) {
        step(1);
      }
    });

    var swipeFrom = null;
    stage.addEventListener('touchstart', function (event) {
      swipeFrom = event.touches[0].clientX;
    }, { passive: true });
    stage.addEventListener('touchend', function (event) {
      if (swipeFrom === null) return;
      var dx = event.changedTouches[0].clientX - swipeFrom;
      swipeFrom = null;
      if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(node);
    document.body.classList.add('photo-viewer-open');
    paint();
  }

  /** Struck-through rack rate, live rate, and the per-night taxes line. */
  function priceBlock(room, cls) {
    var p = room.pricing || {};
    return '<div class="' + (cls || 'room-price') + '">' +
      '<div class="room-price__row">' +
        (p.mrpPerNight > p.pricePerNight
          ? '<span class="room-price__mrp">' + UI.money(p.mrpPerNight) + '</span>'
          : '') +
        '<span class="room-price__now">' + UI.money(p.pricePerNight) + '</span>' +
        (p.discountPercent ? '<span class="room-price__off">' + p.discountPercent + '% OFF</span>' : '') +
      '</div>' +
      '<div class="room-price__tax">+ ' + UI.money(p.taxesPerNight) + ' taxes &amp; fees · per night</div>' +
      '</div>';
  }

  function specRow(room) {
    var specs = [
      { icon: 'grid', text: room.sizeSqft ? room.sizeSqft + ' sq.ft (' + room.sizeSqmt + ' sq.mt)' : null },
      { icon: 'tree', text: room.view || null },
      { icon: 'bed', text: room.bedCount ? room.bedCount + ' ' + room.bedType : null },
      { icon: 'bath', text: room.bathrooms ? room.bathrooms + ' Bathroom' + (room.bathrooms === 1 ? '' : 's') : null },
    ].filter(function (s) { return s.text; });

    return '<ul class="room-specs">' +
      specs.map(function (s) {
        return '<li>' + UI.icon(s.icon, 15) + '<span>' + UI.esc(s.text) + '</span></li>';
      }).join('') +
      '</ul>';
  }

  /** "Popular with Guests" chips: first N, then a "+N More" toggle. */
  function popularAmenities(room, opts) {
    var list = room.popularAmenities || [];
    if (!list.length) return '';
    var o = opts || {};
    var visible = o.expanded ? list : list.slice(0, POPULAR_VISIBLE);
    var hidden = list.length - visible.length;

    return '<div class="amen-pop" data-amen-pop>' +
      '<h4 class="amen-pop__head">Popular with Guests</h4>' +
      '<div class="amen-pop__list">' +
        visible.map(function (a) {
          return '<span class="amen-chip">' + UI.icon(amenityIcon(a), 15) + UI.esc(a) + '</span>';
        }).join('') +
        (hidden > 0
          ? '<button class="amen-chip amen-chip--more" data-action="more-amenities" data-id="' + UI.esc(room.id) + '">' +
              hidden + ' More</button>'
          : '') +
      '</div></div>';
  }

  function amenityGroups(room) {
    var groups = (room.amenityGroups || []).filter(function (g) { return g.items && g.items.length; });
    if (!groups.length) return '';

    return '<h2 class="subhead">Room Amenities</h2>' +
      '<div class="amen-groups">' +
        groups.map(function (g) {
          return '<section class="amen-group">' +
            '<h3 class="amen-group__title">' + UI.esc(g.title) + '</h3>' +
            '<ul class="amen-group__list">' +
              g.items.map(function (item) {
                return '<li>' + UI.icon(amenityIcon(item), 16) + '<span>' + UI.esc(item) + '</span></li>';
              }).join('') +
            '</ul></section>';
        }).join('') +
      '</div>';
  }

  /** Availability copy under a room card. */
  function availabilityNote(room, wanted) {
    var a = room.availability;
    if (!a) return '';
    if (a.soldOut) return '<p class="room-avail room-avail--out">Sold out for these dates</p>';
    if (a.available < wanted) {
      return '<p class="room-avail room-avail--out">Only ' + a.available + ' left — reduce rooms to continue</p>';
    }
    if (a.available <= 3) return '<p class="room-avail room-avail--low">Only ' + a.available + ' rooms left</p>';
    return '<p class="room-avail">' + a.available + ' rooms available</p>';
  }

  /**
   * Property header. Swipeable when the admin has uploaded more than one photo,
   * a single still otherwise. The overlay is click-through so swiping the
   * gallery still works where the gradient covers it.
   */
  function hotelHero(hotel, slider) {
    var photos = (hotel.photos || []).filter(Boolean);
    if (!photos.length) photos = ['/img/hotels/_placeholder.svg'];

    /* Advances on its own so the property's other photos are seen without a
       swipe. The pace is the same admin-set interval the tab's promo slider
       uses, so "how fast things scroll on Stay" is one setting. */
    var media = photos.length > 1
      ? UI.carousel(photos.map(function (src) {
          return '<div class="carousel__slide">' + img(src, hotel.name, 'hotel-hero__img') + '</div>';
        }), { autoplay: (slider && slider.intervalMs) || 4500 })
      : img(photos[0], hotel.name, 'hotel-hero__img');

    return '<div class="hotel-hero">' +
      media +
      '<div class="hotel-hero__veil"></div>' +
      '<div class="hotel-hero__text">' +
        '<h2>' + UI.esc(hotel.name) + '</h2>' +
        '<p>' + UI.icon('map-pin', 14) + UI.esc([hotel.area, hotel.city].filter(Boolean).join(', ')) + '</p>' +
      '</div>' +
      (hotel.rating
        ? '<span class="hotel-hero__rating">' + UI.icon('star', 13) + Number(hotel.rating).toFixed(1) +
          (hotel.reviewCount ? '<small>' + hotel.reviewCount + '</small>' : '') + '</span>'
        : '') +
      (photos.length > 1
        ? '<span class="hotel-hero__count">' + UI.icon('grid', 12) + photos.length + '</span>'
        : '') +
      '</div>';
  }

  /** The search bar showing the chosen dates/guests; opens the pickers. */
  function stayBar(stay) {
    var nights = nightsBetween(stay.checkIn, stay.checkOut);
    return '<div class="staybar">' +
      '<button class="staybar__dates" data-action="pick-dates">' +
        '<span class="staybar__cell">' +
          '<span class="staybar__label">Check-in</span>' +
          '<span class="staybar__value">' + UI.esc(dayLabel(stay.checkIn)) + '</span>' +
        '</span>' +
        '<span class="staybar__nights">' + nights + '<small>' + (nights === 1 ? 'night' : 'nights') + '</small></span>' +
        '<span class="staybar__cell">' +
          '<span class="staybar__label">Check-out</span>' +
          '<span class="staybar__value">' + UI.esc(dayLabel(stay.checkOut)) + '</span>' +
        '</span>' +
      '</button>' +
      '<button class="staybar__guests" data-action="pick-guests">' +
        UI.icon('users', 17) +
        '<span>' + UI.esc(roomsLabel(stay.rooms) + ' · ' + guestsLabel(stay)) + '</span>' +
        UI.icon('chevron-down', 16) +
      '</button>' +
      '</div>';
  }

  // ── Date range picker sheet ────────────────────────────────────────────────
  /**
   * Two-tap range calendar. The first tap sets check-in and clears check-out,
   * the second sets check-out; tapping a date at or before check-in restarts
   * the selection.
   */
  function pickDates(stay, onApply) {
    var draft = { checkIn: stay.checkIn, checkOut: null };
    var min = todayKey();

    var view = UI.h(
      '<div class="cal">' +
        '<p class="cal__hint" data-hint></p>' +
        '<div class="cal__dow">' + DOW_SHORT.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
        '<div class="cal__months" data-months></div>' +
        '<div class="cal__foot">' +
          '<div class="cal__summary" data-summary></div>' +
          '<button class="btn" data-apply disabled>Select check-out</button>' +
        '</div>' +
      '</div>'
    );

    var monthsHost = view.querySelector('[data-months]');
    var hint = view.querySelector('[data-hint]');
    var summary = view.querySelector('[data-summary]');
    var applyBtn = view.querySelector('[data-apply]');

    function monthHtml(year, month) {
      var first = new Date(year, month, 1);
      var days = new Date(year, month + 1, 0).getDate();
      var cells = '';

      for (var b = 0; b < first.getDay(); b += 1) cells += '<span class="cal__pad"></span>';

      for (var day = 1; day <= days; day += 1) {
        var key = keyOf(new Date(year, month, day));
        var disabled = key < min;
        var isIn = key === draft.checkIn;
        var isOut = key === draft.checkOut;
        var inRange = draft.checkIn && draft.checkOut && key > draft.checkIn && key < draft.checkOut;

        var classes = 'cal__day';
        if (isIn) classes += ' cal__day--start';
        if (isOut) classes += ' cal__day--end';
        if (inRange) classes += ' cal__day--between';

        cells += '<button class="' + classes + '" data-day="' + key + '"' +
          (disabled ? ' disabled' : '') + '>' + day + '</button>';
      }

      return '<section class="cal__month">' +
        '<h4 class="cal__month-title">' + MONTHS_LONG[month] + ' ' + year + '</h4>' +
        '<div class="cal__grid">' + cells + '</div>' +
        '</section>';
    }

    function paint() {
      var now = new Date();
      var html = '';
      for (var i = 0; i < CALENDAR_MONTHS; i += 1) {
        var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        html += monthHtml(d.getFullYear(), d.getMonth());
      }
      monthsHost.innerHTML = html;

      var complete = Boolean(draft.checkIn && draft.checkOut);
      hint.textContent = complete
        ? 'Tap any date to start a new selection.'
        : draft.checkIn
          ? 'Now choose your check-out date.'
          : 'Choose your check-in date.';

      summary.innerHTML = complete
        ? '<strong>' + UI.esc(dayLabel(draft.checkIn)) + ' → ' + UI.esc(dayLabel(draft.checkOut)) + '</strong>' +
          '<span>' + nightsLabel(nightsBetween(draft.checkIn, draft.checkOut)) + '</span>'
        : draft.checkIn
          ? '<strong>' + UI.esc(dayLabel(draft.checkIn)) + '</strong><span>Select check-out</span>'
          : '<span>No dates selected</span>';

      applyBtn.disabled = !complete;
      applyBtn.textContent = complete
        ? 'Apply · ' + nightsLabel(nightsBetween(draft.checkIn, draft.checkOut))
        : draft.checkIn ? 'Select check-out' : 'Select check-in';
    }

    monthsHost.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-day]');
      if (!btn || btn.disabled) return;
      var key = btn.getAttribute('data-day');

      if (!draft.checkIn || draft.checkOut || key <= draft.checkIn) {
        draft.checkIn = key;
        draft.checkOut = null;
      } else {
        draft.checkOut = key;
      }
      paint();
    });

    var s = UI.sheet({ title: 'Select dates', body: view });

    applyBtn.addEventListener('click', function () {
      if (!draft.checkIn || !draft.checkOut) return;
      s.close();
      onApply({ checkIn: draft.checkIn, checkOut: draft.checkOut });
    });

    paint();
  }

  // ── Rooms & guests sheet ──────────────────────────────────────────────────
  function pickGuests(stay, room, onApply) {
    var draft = { rooms: stay.rooms, adults: stay.adults, children: stay.children };
    var perRoomAdults = room ? Math.max(1, Number(room.maxGuests) || 2) : 3;
    var perRoomChildren = room ? Math.max(0, Number(room.maxChildren) || 0) : 2;

    function stepper(label, hint, name, value, min, max) {
      return '<div class="stepper-row">' +
        '<div><div class="stepper-row__label">' + UI.esc(label) + '</div>' +
          '<div class="stepper-row__hint">' + UI.esc(hint) + '</div></div>' +
        '<div class="stepper">' +
          '<button data-step="' + name + '" data-delta="-1" aria-label="Fewer ' + UI.esc(label) +
            '"' + (value <= min ? ' disabled' : '') + '>' + UI.icon('minus', 16) + '</button>' +
          '<span data-value="' + name + '">' + value + '</span>' +
          '<button data-step="' + name + '" data-delta="1" aria-label="More ' + UI.esc(label) +
            '"' + (value >= max ? ' disabled' : '') + '>' + UI.icon('plus', 16) + '</button>' +
        '</div></div>';
    }

    var view = UI.h('<div class="guests"><div data-rows></div>' +
      '<p class="guests__note" data-note></p>' +
      '<button class="btn" data-apply>Apply</button></div>');

    var rows = view.querySelector('[data-rows]');
    var note = view.querySelector('[data-note]');

    function paint() {
      var maxAdults = perRoomAdults * draft.rooms;
      var maxChildren = perRoomChildren * draft.rooms;
      draft.adults = Math.min(Math.max(draft.rooms, draft.adults), maxAdults);
      draft.children = Math.min(draft.children, maxChildren);

      rows.innerHTML =
        stepper('Rooms', 'Up to ' + MAX_ROOMS + ' per booking', 'rooms', draft.rooms, 1, MAX_ROOMS) +
        stepper('Adults', 'Max ' + maxAdults + ' for ' + roomsLabel(draft.rooms), 'adults', draft.adults, draft.rooms, maxAdults) +
        stepper('Children', maxChildren ? 'Max ' + maxChildren + ' for ' + roomsLabel(draft.rooms) : 'Not available in this room', 'children', draft.children, 0, maxChildren);

      note.textContent = room
        ? room.name + ' sleeps ' + perRoomAdults + ' adult' + (perRoomAdults === 1 ? '' : 's') +
          (perRoomChildren ? ' + ' + perRoomChildren + ' child' + (perRoomChildren === 1 ? '' : 'ren') : '') + ' per room.'
        : 'Need more rooms? Call us and we will arrange it.';
    }

    rows.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-step]');
      if (!btn || btn.disabled) return;
      var name = btn.getAttribute('data-step');
      draft[name] += Number(btn.getAttribute('data-delta'));
      if (draft.rooms < 1) draft.rooms = 1;
      paint();
    });

    var s = UI.sheet({ title: 'Rooms & guests', body: view });

    view.querySelector('[data-apply]').addEventListener('click', function () {
      s.close();
      onApply(draft);
    });

    paint();
  }

  // ── Screen: hotels (tab) ──────────────────────────────────────────────────
  function callStrip(phone) {
    return '<a class="card exp-call" href="tel:' + UI.esc(String(phone).replace(/\s+/g, '')) + '">' +
      '<span class="exp-call__icon">' + UI.icon('phone', 22) + '</span>' +
      '<span class="exp-call__text">' +
        '<strong>Questions about your stay?</strong>' +
        '<span>Call ' + UI.esc(phone) + ' — we answer 24×7</span>' +
      '</span>' +
      '<span class="exp-call__arrow">' + UI.icon('arrow-right', 18) + '</span>' +
      '</a>';
  }

  function roomCard(room, stay, opts) {
    var soldOut = room.availability && room.availability.soldOut;
    var quote = room.quote;

    return '<article class="card room-card' + (soldOut ? ' room-card--out' : '') + '">' +
      '<button class="room-card__photo" data-action="room" data-id="' + UI.esc(room.id) + '" ' +
        'aria-label="' + UI.esc(room.name) + '">' +
        img(photoOf(room, 0), room.name, 'room-card__img') +
        (room.badge ? '<span class="room-card__badge">' + UI.esc(room.badge) + '</span>' : '') +
        ((room.photos || []).length > 1
          ? '<span class="room-card__count">' + UI.icon('grid', 13) + (room.photos.length) + ' photos</span>'
          : '') +
      '</button>' +
      '<div class="room-card__body">' +
        '<h3 class="room-card__title">' + UI.esc(room.name) + '</h3>' +
        (room.subtitle ? '<p class="room-card__sub">' + UI.esc(room.subtitle) + '</p>' : '') +
        specRow(room) +
        popularAmenities(room, opts) +
        '<div class="room-card__foot">' +
          priceBlock(room) +
          (soldOut
            ? '<button class="btn btn--sm" disabled>Sold out</button>'
            : '<button class="btn btn--sm" data-action="book" data-id="' + UI.esc(room.id) + '">Book now</button>') +
        '</div>' +
        (quote
          ? '<p class="room-card__total">' + UI.money(quote.total) + ' total for ' +
            nightsLabel(quote.nights) + (stay.rooms > 1 ? ' · ' + roomsLabel(stay.rooms) : '') +
            ' <span>(incl. taxes)</span></p>'
          : '') +
        availabilityNote(room, stay.rooms) +
      '</div>' +
      '</article>';
  }

  window.Screens.hotels = {
    tab: 'hotels',
    render: async function (_params, query) {
      var stay = stayFrom(query);
      writeStay(stay);

      var data = await API.hotels({
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        rooms: stay.rooms,
      });

      var hotel = data.hotel;
      var expanded = {};

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Stay with us' }) +
          '<div class="scroll">' +
            hotelHero(hotel, data.slider) +

            UI.promoSlider(data.slider) +

            (hotel.tagline ? '<p class="hotel-tagline">' + UI.esc(hotel.tagline) + '</p>' : '') +

            '<div data-staybar>' + stayBar(stay) + '</div>' +

            ((hotel.amenities || []).length
              ? '<div class="hotel-amens">' +
                hotel.amenities.map(function (a) {
                  return '<span class="amen-chip">' + UI.icon(amenityIcon(a), 15) + UI.esc(a) + '</span>';
                }).join('') +
                '</div>'
              : '') +

            '<h2 class="subhead">' + (data.count === 1 ? '1 room type' : data.count + ' room types') + '</h2>' +
            '<div class="room-list" data-rooms></div>' +

            '<div style="padding:18px 16px 0">' + callStrip(data.phone) + '</div>' +

            ((hotel.policies || []).length
              ? '<h2 class="subhead">Hotel policies</h2>' +
                '<ul class="policy-list">' +
                hotel.policies.map(function (p) {
                  return '<li>' + UI.icon('info', 15) + '<span>' + UI.esc(p) + '</span></li>';
                }).join('') +
                '</ul>'
              : '') +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      var roomsHost = view.querySelector('[data-rooms]');
      var barHost = view.querySelector('[data-staybar]');

      function paintRooms() {
        roomsHost.innerHTML = data.rooms.length
          ? data.rooms.map(function (r) {
              return roomCard(r, stay, { expanded: Boolean(expanded[r.id]) });
            }).join('')
          : UI.empty({ icon: 'bed', title: 'No rooms listed yet', text: 'Room types will appear here once they are published.' });
      }

      /** Re-fetch availability/quotes after the dates or guests change. */
      async function refresh() {
        writeStay(stay);
        barHost.innerHTML = stayBar(stay);
        roomsHost.innerHTML = UI.spinnerBlock();
        try {
          data = await API.hotels({ checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: stay.rooms });
          paintRooms();
        } catch (err) {
          roomsHost.innerHTML = UI.empty({ icon: 'alert-circle', title: 'Could not load rooms', text: err.message });
        }
      }

      UI.actions(view, {
        'pick-dates': function () {
          pickDates(stay, function (range) {
            stay.checkIn = range.checkIn;
            stay.checkOut = range.checkOut;
            refresh();
          });
        },
        'pick-guests': function () {
          pickGuests(stay, data.rooms[0], function (next) {
            stay.rooms = next.rooms;
            stay.adults = next.adults;
            stay.children = next.children;
            refresh();
          });
        },
        'more-amenities': function (el) {
          expanded[el.getAttribute('data-id')] = true;
          paintRooms();
        },
        room: function (el) {
          App.navigate('/hotel/room/' + el.getAttribute('data-id') + '?' + stayQuery(stay));
        },
        book: function (el) {
          App.navigate('/hotel/checkout?' + stayQuery(stay, { roomId: el.getAttribute('data-id') }));
        },
      });

      paintRooms();
      return view;
    },
  };

  // ── Screen: room detail ───────────────────────────────────────────────────
  window.Screens.hotelRoom = {
    tab: 'hotels',
    backTo: '/hotels',
    render: async function (params, query) {
      var stay = stayFrom(query);
      var data = await API.hotelRoom(params.id, {
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        rooms: stay.rooms,
      });

      var room = data.room;
      var hotel = data.hotel;
      var photos = (room.photos || []).length ? room.photos : ['/img/hotels/_placeholder.svg'];
      var expanded = false;

      var slides = photos.map(function (src) {
        return '<div class="carousel__slide">' + img(src, room.name, 'room-gallery__img') + '</div>';
      });

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: room.name, back: true, bordered: true }) +
          '<div class="scroll">' +
            '<div class="room-gallery">' + UI.carousel(slides) +
              (room.badge ? '<span class="room-card__badge room-gallery__badge">' + UI.esc(room.badge) + '</span>' : '') +
            '</div>' +

            '<div class="room-head">' +
              '<h1 class="room-head__title">' + UI.esc(room.name) + '</h1>' +
              (room.subtitle ? '<p class="room-head__sub">' + UI.esc(room.subtitle) + '</p>' : '') +
              specRow(room) +
              '<p class="room-head__sleeps">' + UI.icon('users', 15) + ' Sleeps up to ' + (room.maxGuests || 2) +
                ' adult' + ((room.maxGuests || 2) === 1 ? '' : 's') +
                (room.maxChildren ? ' + ' + room.maxChildren + ' child' + (room.maxChildren === 1 ? '' : 'ren') : '') +
                ' per room</p>' +
            '</div>' +

            '<div data-staybar>' + stayBar(stay) + '</div>' +
            '<div data-avail>' + availabilityNote(room, stay.rooms) + '</div>' +

            '<div class="room-detail-price card">' +
              priceBlock(room, 'room-price room-price--lg') +
              '<div class="room-detail-price__total" data-total></div>' +
            '</div>' +

            '<div data-pop>' + popularAmenities(room) + '</div>' +

            amenityGroups(room) +

            ((room.inclusions || []).length
              ? '<h2 class="subhead">Included with your stay</h2>' +
                '<ul class="policy-list">' +
                room.inclusions.map(function (i) {
                  return '<li>' + UI.icon('check', 15) + '<span>' + UI.esc(i) + '</span></li>';
                }).join('') + '</ul>'
              : '') +

            '<h2 class="subhead">Check-in &amp; check-out</h2>' +
            '<div class="list">' +
              UI.row({ icon: 'clock', label: 'Check-in', value: (hotel.checkInTime || '12:00') + ' onwards', action: 'noop' }) +
              UI.row({ icon: 'clock', label: 'Check-out', value: 'by ' + (hotel.checkOutTime || '11:00'), action: 'noop' }) +
            '</div>' +

            propertyPhotos(hotel) +

            ((hotel.policies || []).length
              ? '<h2 class="subhead">Things to know</h2><ul class="policy-list">' +
                hotel.policies.map(function (p) {
                  return '<li>' + UI.icon('info', 15) + '<span>' + UI.esc(p) + '</span></li>';
                }).join('') + '</ul>'
              : '') +

            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar" data-bar></div>' +
        '</div>'
      );

      var barHost = view.querySelector('[data-staybar]');
      var availHost = view.querySelector('[data-avail]');
      var popHost = view.querySelector('[data-pop]');
      var totalHost = view.querySelector('[data-total]');
      var actionBar = view.querySelector('[data-bar]');

      function paint() {
        barHost.innerHTML = stayBar(stay);
        availHost.innerHTML = availabilityNote(room, stay.rooms);
        popHost.innerHTML = popularAmenities(room, { expanded: expanded });

        var quote = room.quote;
        totalHost.innerHTML = quote
          ? '<strong>' + UI.money(quote.total) + '</strong>' +
            '<span>total · ' + nightsLabel(quote.nights) +
            (stay.rooms > 1 ? ' · ' + roomsLabel(stay.rooms) : '') + ' · incl. taxes</span>'
          : '';

        var soldOut = room.availability && room.availability.available < stay.rooms;
        actionBar.innerHTML =
          '<div class="actionbar__price">' +
            '<span class="actionbar__label">' + UI.esc(nightsLabel(nightsBetween(stay.checkIn, stay.checkOut))) + '</span>' +
            '<span class="actionbar__value">' + (quote ? UI.money(quote.total) : UI.money(room.pricing.pricePerNight)) + '</span>' +
          '</div>' +
          (soldOut
            ? '<button class="btn" disabled>Sold out</button>'
            : '<button class="btn" data-action="book">Book this room</button>');
      }

      async function refresh() {
        writeStay(stay);
        try {
          var next = await API.hotelRoom(params.id, {
            checkIn: stay.checkIn,
            checkOut: stay.checkOut,
            rooms: stay.rooms,
          });
          room = next.room;
          paint();
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      }

      UI.actions(view, {
        noop: function () {},
        'pick-dates': function () {
          pickDates(stay, function (range) {
            stay.checkIn = range.checkIn;
            stay.checkOut = range.checkOut;
            refresh();
          });
        },
        'pick-guests': function () {
          pickGuests(stay, room, function (next) {
            stay.rooms = next.rooms;
            stay.adults = next.adults;
            stay.children = next.children;
            refresh();
          });
        },
        'more-amenities': function () {
          expanded = true;
          paint();
        },
        'jump-photos': function (el) {
          var group = view.querySelector('[data-photo-group="' + el.getAttribute('data-cat') + '"]');
          if (group) group.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        'view-photo': function (el) {
          var category = el.getAttribute('data-cat');
          openPhotoViewer(
            photosInCategory(hotel, category),
            Number(el.getAttribute('data-index')) || 0,
            photoCategoryLabel(category)
          );
        },
        book: function () {
          App.navigate('/hotel/checkout?' + stayQuery(stay, { roomId: room.id }));
        },
      });

      paint();
      return view;
    },
  };

  // ── Screen: checkout ──────────────────────────────────────────────────────
  window.Screens.hotelCheckout = {
    tab: 'hotels',
    auth: true,
    backTo: '/hotels',
    render: async function (_params, query) {
      var stay = stayFrom(query);

      if (!query.roomId) {
        App.navigate('/hotels', { replace: true });
        return UI.h('<div class="screen"></div>');
      }

      var loaded = await Promise.all([
        API.hotelRoom(query.roomId, { checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: stay.rooms }),
        API.me(),
        API.offers('hotel'),
      ]);

      var room = loaded[0].room;
      var hotel = loaded[0].hotel;
      var user = loaded[1].user;
      var offers = loaded[2].offers || [];

      var state = {
        offerCode: null,
        payment: 'upi',
        quote: room.quote,
        guestName: user.name || '',
        guestPhone: user.phone || '',
        requests: '',
      };

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Review your stay', back: true, bordered: true }) +
          '<div class="scroll">' +
            '<article class="card stay-summary">' +
              img(photoOf(room, 0), room.name, 'stay-summary__img') +
              '<div class="stay-summary__text">' +
                '<h3>' + UI.esc(room.name) + '</h3>' +
                '<p>' + UI.esc(hotel.name) + '</p>' +
                '<p class="stay-summary__meta" data-meta></p>' +
              '</div>' +
            '</article>' +

            '<div data-staybar></div>' +
            '<div data-avail></div>' +

            '<h2 class="subhead">Guest details</h2>' +
            '<div class="field">' +
              '<label class="field__label" for="stay-guest-name">Primary guest name</label>' +
              '<div class="field__control">' + UI.icon('user', 20) +
                '<input id="stay-guest-name" data-guest-name type="text" autocomplete="name" ' +
                'placeholder="Full name as on your ID" value="' + UI.esc(state.guestName) + '"></div>' +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label" for="stay-guest-phone">Mobile number</label>' +
              '<div class="field__control">' + UI.icon('phone', 20) +
                '<input id="stay-guest-phone" data-guest-phone type="tel" autocomplete="tel" ' +
                'placeholder="10-digit mobile" value="' + UI.esc(state.guestPhone) + '"></div>' +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label" for="stay-requests">Special requests (optional)</label>' +
              '<div class="field__control">' + UI.icon('info', 20) +
                '<input id="stay-requests" data-requests type="text" ' +
                'placeholder="Early check-in, high floor…"></div>' +
            '</div>' +

            '<h2 class="subhead">Offers</h2>' +
            '<div style="padding:0 16px" data-offer-row></div>' +

            '<h2 class="subhead">Payment method</h2>' +
            '<div style="padding:0 16px" data-payment-row></div>' +

            '<h2 class="subhead">Price breakdown</h2>' +
            '<div style="padding:0 16px" data-bill></div>' +

            '<p class="checkout-note">' + UI.icon('shield', 14) +
              ' Free cancellation up to 24 hours before check-in. A valid photo ID is required at check-in.</p>' +

            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar" data-bar></div>' +
        '</div>'
      );

      var barHost = view.querySelector('[data-staybar]');
      var availHost = view.querySelector('[data-avail]');
      var metaHost = view.querySelector('[data-meta]');
      var billHost = view.querySelector('[data-bill]');
      var offerRow = view.querySelector('[data-offer-row]');
      var paymentRow = view.querySelector('[data-payment-row]');
      var actionBar = view.querySelector('[data-bar]');

      function payload(extra) {
        return Object.assign({
          roomId: room.id,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          rooms: stay.rooms,
          adults: stay.adults,
          children: stay.children,
          offerCode: state.offerCode,
        }, extra || {});
      }

      function paint() {
        var q = state.quote;
        barHost.innerHTML = stayBar(stay);
        availHost.innerHTML = availabilityNote(room, stay.rooms);
        metaHost.textContent = roomsLabel(stay.rooms) + ' · ' + guestsLabel(stay) +
          ' · ' + nightsLabel(nightsBetween(stay.checkIn, stay.checkOut));

        offerRow.innerHTML = state.offerCode
          ? '<div class="option" aria-pressed="true">' +
              '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
              '<span class="option__text"><span class="option__title">' + UI.esc(state.offerCode) + ' applied</span>' +
              '<span class="option__sub">' + (q && q.discount ? 'You saved ' + UI.money(q.discount) : 'Applied to your stay') + '</span></span>' +
              '<button class="link-btn" data-action="clear-offer">Remove</button></div>'
          : '<button class="option" data-action="offers">' +
              '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
              '<span class="option__text"><span class="option__title">Apply an offer</span>' +
              '<span class="option__sub">' + (offers.length ? offers.length + ' code' + (offers.length === 1 ? '' : 's') + ' available' : 'Enter a code') + '</span></span>' +
              '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span></button>';

        paymentRow.innerHTML = PAY_METHODS.map(function (m) {
          return '<button class="option" data-action="method" data-id="' + m.id + '"' +
            ' aria-pressed="' + (m.id === state.payment ? 'true' : 'false') + '">' +
            '<span class="option__icon">' + UI.icon(m.icon, 21) + '</span>' +
            '<span class="option__text"><span class="option__title">' + m.label + '</span>' +
              '<span class="option__sub">' + m.sub + '</span></span>' +
            '<span class="option__radio"></span></button>';
        }).join('');

        billHost.innerHTML = q
          ? '<div class="kv"><span class="kv__key">' + UI.esc(roomsLabel(q.rooms) + ' × ' + nightsLabel(q.nights)) +
              ' @ ' + UI.money(q.ratePerNight) + '</span><span class="kv__val">' + UI.money(q.roomCharge) + '</span></div>' +
            (q.rackSavings
              ? '<div class="kv kv--discount"><span class="kv__key">Saved off ' + UI.money(q.rackCharge) +
                ' rack rate</span><span class="kv__val">- ' + UI.money(q.rackSavings) + '</span></div>'
              : '') +
            '<div class="kv"><span class="kv__key">Taxes &amp; fees</span><span class="kv__val">' + UI.money(q.taxes) + '</span></div>' +
            (q.discount
              ? '<div class="kv kv--discount"><span class="kv__key">Offer ' + UI.esc(q.offerCode || '') +
                '</span><span class="kv__val">- ' + UI.money(q.discount) + '</span></div>'
              : '') +
            '<div class="kv kv--total"><span class="kv__key">Amount payable</span>' +
              '<span class="kv__val">' + UI.money(q.total) + '</span></div>'
          : UI.spinnerBlock();

        var blocked = !room.availability || room.availability.available < stay.rooms;
        actionBar.innerHTML =
          '<div class="actionbar__price">' +
            '<span class="actionbar__label">Total</span>' +
            '<span class="actionbar__value">' + (q ? UI.money(q.total) : '—') + '</span>' +
          '</div>' +
          (blocked
            ? '<button class="btn" disabled>Sold out</button>'
            : '<button class="btn" data-action="pay">' +
              (q ? 'Pay ' + UI.money(q.total) : 'Confirm booking') + '</button>');
      }

      /** Always re-price on the server so the bill can never drift. */
      async function reprice() {
        billHost.innerHTML = UI.spinnerBlock();
        try {
          var res = await API.hotelQuote(payload());
          state.quote = res.amounts;
          room.availability = res.availability;
        } catch (err) {
          UI.toast(err.message, 'error');
        }
        paint();
      }

      view.querySelector('[data-guest-name]').addEventListener('input', function (e) {
        state.guestName = e.target.value;
      });
      view.querySelector('[data-guest-phone]').addEventListener('input', function (e) {
        state.guestPhone = e.target.value;
      });
      view.querySelector('[data-requests]').addEventListener('input', function (e) {
        state.requests = e.target.value;
      });

      UI.actions(view, {
        'pick-dates': function () {
          pickDates(stay, function (range) {
            stay.checkIn = range.checkIn;
            stay.checkOut = range.checkOut;
            writeStay(stay);
            reprice();
          });
        },
        'pick-guests': function () {
          pickGuests(stay, room, function (next) {
            stay.rooms = next.rooms;
            stay.adults = next.adults;
            stay.children = next.children;
            writeStay(stay);
            reprice();
          });
        },

        offers: function () {
          var body = UI.h('<div class="offer-sheet">' +
            (offers.length
              ? offers.map(function (o) {
                  return '<button class="option" data-code="' + UI.esc(o.code) + '">' +
                    '<span class="option__icon">' + UI.icon('tag', 20) + '</span>' +
                    '<span class="option__text"><span class="option__title">' + UI.esc(o.title) + '</span>' +
                    '<span class="option__sub">Code ' + UI.esc(o.code) +
                    (o.subtitle ? ' · ' + UI.esc(o.subtitle) : '') + '</span></span></button>';
                }).join('')
              : '<p class="text-muted" style="padding:4px 0 14px">No stay offers are running right now.</p>') +
            '<label class="field"><span class="field__label">Have a code?</span>' +
              '<input class="field__control" data-code-input placeholder="Enter code" autocapitalize="characters"></label>' +
            '<button class="btn" data-apply-code>Apply code</button>' +
            (state.offerCode ? '<button class="btn-outline" data-clear-code style="margin-top:10px">Remove offer</button>' : '') +
            '</div>');

          var s = UI.sheet({ title: 'Offers for your stay', body: body });

          async function apply(code) {
            try {
              await API.validateHotelOffer(payload({ code: code }));
              state.offerCode = code.toUpperCase();
              s.close();
              UI.toast('Offer ' + state.offerCode + ' applied', 'success');
              reprice();
            } catch (err) {
              UI.toast(err.message, 'error');
            }
          }

          body.querySelectorAll('[data-code]').forEach(function (btn) {
            btn.addEventListener('click', function () { apply(btn.getAttribute('data-code')); });
          });
          body.querySelector('[data-apply-code]').addEventListener('click', function () {
            var code = body.querySelector('[data-code-input]').value.trim();
            if (code) apply(code);
          });
        },

        'clear-offer': function () {
          state.offerCode = null;
          reprice();
        },

        method: function (btn) {
          state.payment = btn.getAttribute('data-id');
          paint();
        },

        pay: async function (el) {
          if (!state.guestName.trim()) {
            UI.toast('Enter the primary guest name', 'error');
            view.querySelector('[data-guest-name]').focus();
            return;
          }

          el.disabled = true;
          el.textContent = 'Confirming…';
          try {
            var res = await API.bookHotel(payload({
              guestName: state.guestName.trim(),
              guestPhone: state.guestPhone.trim(),
              specialRequests: state.requests.trim(),
              payment: { method: state.payment },
            }));
            App.navigate('/hotel/confirmed/' + res.booking.id, { replace: true });
          } catch (err) {
            el.disabled = false;
            UI.toast(err.message, 'error');
            // Someone else took the last room while this form was open.
            if (err.status === 409) reprice();
            else paint();
          }
        },
      });

      paint();
      return view;
    },
  };

  // ── Screen: confirmation ──────────────────────────────────────────────────
  window.Screens.hotelConfirmation = {
    tab: 'hotels',
    auth: true,
    backTo: '/hotels',
    render: async function (params) {
      var res = await API.booking(params.bookingId);
      var b = res.booking;
      var stay = b.stay || {};

      function cell(label, value) {
        return '<div><div class="stub__cell-label">' + UI.esc(label) + '</div>' +
          '<div class="stub__cell-value">' + UI.esc(value) + '</div></div>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Booking confirmed', logo: false }) +
          '<div class="scroll">' +
            '<div class="success-hero">' +
              '<div class="success-hero__ring">' + UI.icon('check', 34) + '</div>' +
              '<h2>Your stay is booked</h2>' +
              '<p>' + UI.esc(stay.hotelName || '') + ' · ' + UI.esc(dayLabel(stay.checkIn)) + '</p>' +
            '</div>' +

            '<div style="padding:6px 16px 0">' +
              '<div class="stub">' +
                '<div class="stub__top">' +
                  img(b.posterUrl, b.title, 'stub__poster') +
                  '<div style="flex:1;min-width:0">' +
                    '<h2 style="margin:0;font-size:18px;font-weight:800;line-height:1.3">' +
                      UI.esc(stay.roomName || b.title) + '</h2>' +
                    '<p style="margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.45">' +
                      UI.esc(stay.hotelName || '') +
                      (b.hotel && b.hotel.address ? '<br>' + UI.esc(b.hotel.address) : '') +
                    '</p>' +
                    '<div style="margin-top:9px">' + UI.statusPill(b) + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="stub__grid">' +
                  cell('Check-in', dayLabel(stay.checkIn) + ' · ' + (stay.checkInTime || '12:00')) +
                  cell('Check-out', dayLabel(stay.checkOut) + ' · ' + (stay.checkOutTime || '11:00')) +
                  cell('Rooms', roomsLabel(stay.rooms || 1) + ' · ' + nightsLabel(stay.nights || 1)) +
                  cell('Guests', stay.guests ? guestsLabel(stay.guests) : '—') +
                '</div>' +
                '<div class="stub__perf"><div class="stub__perf-line"></div></div>' +
                '<div class="stub__code">' +
                  '<img src="' + UI.esc(b.barcodeUrl) + '" alt="Barcode for booking ' + UI.esc(b.reference) + '">' +
                  '<p class="stub__code-hint">Show this at the front desk · Booking ' + UI.esc(b.reference) + '</p>' +
                '</div>' +
              '</div>' +
            '</div>' +

            (b.amounts
              ? '<p class="paid-line">' + UI.icon('check', 15) + ' You paid ' + UI.money(b.amounts.total) + '</p>'
              : '') +

            (b.guest && b.guest.name
              ? '<h2 class="subhead">Guest</h2><div class="list">' +
                UI.row({ icon: 'user', label: b.guest.name, value: b.guest.phone || '', action: 'noop' }) +
                (b.guest.specialRequests
                  ? UI.row({ icon: 'info', label: 'Requests', value: b.guest.specialRequests, action: 'noop' })
                  : '') +
                '</div>'
              : '') +

            '<div style="padding:22px 16px 0">' +
              '<button class="btn" data-action="ticket">View booking</button>' +
              '<div style="height:10px"></div>' +
              '<button class="btn-outline btn-outline--lg" data-action="home">Back to home</button>' +
            '</div>' +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        noop: function () {},
        ticket: function () { App.navigate('/ticket/' + b.id); },
        home: function () { App.navigate('/home'); },
      });

      return view;
    },
  };
})();
