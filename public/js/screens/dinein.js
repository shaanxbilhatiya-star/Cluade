/* Dine-In tab — the resort's TWO restaurants, then reserve a table and settle
   the bill from your seat.

   ── Which restaurant? ─────────────────────────────────────────────────────
   Kingfisher Resort has two, and guests frequently do not know that:

     · Rangoli — PURE VEG, its own kitchen
     · Dolphin — NON-VEG

   That single fact drives the whole layout. The tab opens on the resort with
   both restaurants side by side and their veg / non-veg marks in the first
   thing you see; reserving and paying are separate screens per restaurant, each
   wearing a banner naming it; and the pay button asks you to confirm the
   restaurant before it takes any money. Nothing in this file can render a table
   or a bill without saying which kitchen it belongs to.

   ── The two discount tiers ────────────────────────────────────────────────
   The server decides which applies:
     · reserved — a reservation held for at least `lockMinutes` (30 by default)
       bills at the higher rate (30%). Billing against a reservation is LOCKED
       until that window passes, so booking a table while already sitting at it
       cannot buy the bigger discount. This screen shows the countdown and
       unlocks itself when it reaches zero.
     · walk-in — no reservation, bills instantly at the lower rate (10%).

   A table earns its discount AT ITS OWN RESTAURANT ONLY. Holding a Rangoli
   table and paying a Dolphin bill gets the walk-in rate, and the screen says so
   out loud rather than quietly charging the lower saving.

   The same offer runs at both restaurants, so choosing between them is only ever
   about what you feel like eating. Every percentage and every line of notice
   copy comes from the API, which reads admin-editable settings — nothing here
   hardcodes a discount or a message. */
(function () {
  'use strict';

  var PAY_METHODS = [
    { id: 'upi', label: 'UPI', sub: 'GPay, PhonePe, Paytm', icon: 'wallet' },
    { id: 'card', label: 'Credit / Debit Card', sub: 'Visa, Mastercard, RuPay', icon: 'card' },
    { id: 'netbanking', label: 'Net Banking', sub: 'All major banks', icon: 'bank' },
    { id: 'cash', label: 'Pay at the counter', sub: 'Show this bill to the cashier', icon: 'cash' },
  ];

  // ── shared bits ───────────────────────────────────────────────────────────
  function telHref(phone) { return 'tel:' + String(phone || '').replace(/\s+/g, ''); }

  /**
   * The mark Indian diners read before they read anything else: a green dot in a
   * green box for vegetarian, a maroon triangle in a maroon box for non-veg.
   *
   * It is drawn in CSS rather than as text so it survives every font, and it
   * always ships an accessible label — a colour-blind or screen-reader guest must
   * get the same answer as everyone else, since this is the one detail on the
   * screen that nobody can afford to misread.
   */
  function dietMark(diet, label) {
    var veg = diet !== 'nonveg';
    return '<span class="veg-mark veg-mark--' + (veg ? 'veg' : 'nonveg') + '" role="img" aria-label="' +
      UI.esc(label || (veg ? 'Vegetarian' : 'Non-vegetarian')) + '"></span>';
  }

  /** Mark + wording together, e.g. a green mark next to "PURE VEG". */
  function dietTag(outlet) {
    return '<span class="diet-tag diet-tag--' + (outlet.diet === 'nonveg' ? 'nonveg' : 'veg') + '">' +
      dietMark(outlet.diet, outlet.dietLong) +
      UI.esc((outlet.dietLabel || '').toUpperCase()) +
    '</span>';
  }

  /**
   * The banner every reserve/pay screen wears.
   *
   * It is sticky, so however far a guest scrolls down a bill they can still see
   * which restaurant they are about to pay. "Change" is offered right there
   * because realising you are on the wrong one is exactly the moment this whole
   * design is built for.
   */
  function outletIdentity(outlet, venueName, options) {
    var o = options || {};
    return '<div class="dine-ident dine-ident--' + (outlet.diet === 'nonveg' ? 'nonveg' : 'veg') + '">' +
      dietMark(outlet.diet, outlet.dietLong) +
      '<span class="dine-ident__text">' +
        '<span class="dine-ident__name">' + UI.esc(outlet.name) +
          '<small>' + UI.esc(outlet.dietLabel) + '</small></span>' +
        '<span class="dine-ident__sub">' + UI.esc(o.sub || (outlet.dietLong + ' · ' + (venueName || ''))) + '</span>' +
      '</span>' +
      (o.switchable === false
        ? ''
        : '<button class="dine-ident__switch" data-action="switch-outlet">Change</button>') +
    '</div>';
  }

  function noticeBanner(text, kind, style) {
    if (!text) return '';
    var cls = 'notice';
    if (kind === 'warn') cls += ' notice--warn';
    if (kind === 'info') cls += ' notice--info';
    return '<div class="' + cls + '"' +
      (style ? ' style="' + style + '"' : '') + '>' + UI.esc(text) + '</div>';
  }

  /** "04:38" for a seconds countdown. */
  function mmss(seconds) {
    var s = Math.max(0, Math.round(seconds));
    var m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /**
   * Runs `tick` every second until the view leaves the DOM, so a countdown never
   * outlives the screen it belongs to (the router swaps views out wholesale).
   */
  function everySecond(view, tick) {
    tick();
    var timer = setInterval(function () {
      if (!document.body.contains(view)) { clearInterval(timer); return; }
      tick();
    }, 1000);
    return timer;
  }

  function partyLine(reservation) {
    return reservation.partySize + ' guest' + (reservation.partySize === 1 ? '' : 's') +
      (reservation.area ? ' · ' + reservation.area : '');
  }

  function slotLabel(reservation) {
    return UI.relativeDay(reservation.date) + ' · ' + UI.hhmm(reservation.startsAt);
  }

  /** "Rangoli" for a tagged row, and an honest shrug for a pre-split one. */
  function outletName(row) {
    return (row && row.outlet && row.outlet.name) || row.restaurantName || 'Restaurant not recorded';
  }

  function hoursLine(outlet) {
    return 'Open ' + UI.esc(outlet.openTime) + ' – ' + UI.esc(outlet.closeTime) +
      (outlet.openNow ? '' : ' · <span class="dine-outlet__closed">Closed right now</span>');
  }

  /** Bill breakdown, shared by the pay screen and the receipt. */
  function billKv(amounts, discountLabel) {
    return '<div class="kv"><span class="kv__key">Restaurant bill</span>' +
        '<span class="kv__val">' + UI.money(amounts.billAmount) + '</span></div>' +
      (amounts.instantDiscount
        ? '<div class="kv kv--discount"><span class="kv__key">' + UI.esc(discountLabel) + '</span>' +
          '<span class="kv__val">- ' + UI.money(amounts.instantDiscount) + '</span></div>'
        : '') +
      (amounts.offerDiscount
        ? '<div class="kv kv--discount"><span class="kv__key">Coupon ' + UI.esc(amounts.offerCode || '') + '</span>' +
          '<span class="kv__val">- ' + UI.money(amounts.offerDiscount) + '</span></div>'
        : '') +
      '<div class="kv kv--total"><span class="kv__key">You pay</span>' +
        '<span class="kv__val">' + UI.money(amounts.total) + '</span></div>';
  }

  function signInPrompt(message) {
    return '<div class="section">' +
      '<div class="card" style="padding:18px;text-align:center">' +
        '<p style="margin:0 0 14px;font-size:14px;color:var(--ink-soft);line-height:1.55">' + UI.esc(message) + '</p>' +
        '<button class="btn" data-action="signin">Sign in to continue</button>' +
      '</div></div>';
  }

  /**
   * Loads the tab payload and pins it to one restaurant.
   *
   * A bad or missing id bounces the guest back to the chooser instead of falling
   * through to a default — the whole point is that the app never decides which
   * restaurant someone is eating at.
   */
  async function loadOutlet(outletId) {
    var data = await API.dineIn();
    var outlet = (data.outlets || []).find(function (o) { return o.id === outletId; });
    if (!outlet) {
      UI.toast('Choose which restaurant first', 'error');
      App.navigate('/dine-in');
      return null;
    }
    return { data: data, outlet: outlet };
  }

  /** Wires up the "Change" button on the identity banner. */
  function bindSwitch(view, data, outlet, basePath) {
    var others = (data.outlets || []).filter(function (o) { return o.id !== outlet.id; });
    return function () {
      // Two restaurants means "change" has exactly one answer — just go there.
      if (others.length === 1) App.navigate(basePath + '/' + others[0].id);
      else App.navigate(basePath);
    };
  }

  // ── Dine-In home ──────────────────────────────────────────────────────────
  /* The tab opens on the RESORT and lists both restaurants. It deliberately does
     not open on a single restaurant, and it deliberately does not open on a
     forced chooser either: a guest who does not yet know there are two needs to
     see them together, marked, with their hours, before being asked to pick. */
  window.Screens.dineIn = {
    tab: 'dinein',
    render: async function () {
      var data = await API.dineIn();
      var s = data.settings;
      var venue = data.venue;
      var outlets = data.outlets || [];
      var reserved = data.tiers.reserved;
      var walkin = data.tiers.walkin;

      if (s.active === false) {
        return UI.h(
          '<div class="screen">' + UI.appbar({ title: 'Dine-In' }) +
            '<div class="scroll">' +
              UI.empty({ icon: 'dine', title: 'Dine-In is closed', text: 'In-app billing is switched off right now. Please pay at the counter.' }) +
            '</div></div>'
        );
      }

      /** One card per restaurant: what it is, when it opens, and my state there. */
      function outletCard(outlet) {
        var mine = outlet.reservation;
        var pct = mine ? reserved.discountPercent : walkin.discountPercent;

        return '<section class="dine-outlet dine-outlet--' + (outlet.diet === 'nonveg' ? 'nonveg' : 'veg') + '"' +
            ' data-outlet="' + UI.esc(outlet.id) + '">' +

          '<header class="dine-outlet__head">' +
            '<div class="dine-outlet__title">' +
              '<h3 class="dine-outlet__name">' + UI.esc(outlet.name) + '</h3>' +
              dietTag(outlet) +
            '</div>' +
            (outlet.cuisine ? '<p class="dine-outlet__cuisine">' + UI.esc(outlet.cuisine) + '</p>' : '') +
          '</header>' +

          /* The diet note in plain words, under the mark. Two ways of saying the
             same thing, because this is the detail nobody may misread. */
          (outlet.dietNote
            ? '<p class="dine-outlet__diet-note">' + UI.esc(outlet.dietNote) + '</p>'
            : '') +

          '<p class="dine-outlet__hours">' + UI.icon('clock', 14) + '<span>' + hoursLine(outlet) + '</span></p>' +

          (mine
            /* A table here. The countdown and the pay button belong to THIS card,
               so a guest holding tables at both can never confuse the two. */
            ? '<div class="dine-outlet__res" data-res="' + UI.esc(outlet.id) + '">' +
                '<div class="dine-outlet__res-head">' +
                  '<span class="dine-outlet__res-badge">' + UI.icon('check', 12) + ' Table booked here</span>' +
                  '<span class="dine-outlet__res-pct">' + reserved.discountPercent + '% off</span>' +
                '</div>' +
                '<div class="dine-outlet__res-when">' + UI.esc(slotLabel(mine)) + '</div>' +
                '<div class="dine-outlet__res-meta">' + UI.esc(partyLine(mine)) + ' · ' + UI.esc(mine.reference) + '</div>' +
                '<div class="dine-lock" data-lock>' +
                  UI.icon('lock', 20) +
                  '<span class="dine-lock__text">' +
                    '<span class="dine-lock__title" data-lock-title></span>' +
                    '<span class="dine-lock__sub" data-lock-sub></span>' +
                  '</span>' +
                  '<span class="dine-lock__clock" data-lock-clock></span>' +
                '</div>' +
              '</div>' +
              '<div class="dine-outlet__actions">' +
                '<button class="btn" data-action="pay" data-id="' + UI.esc(outlet.id) + '" data-pay-btn>' +
                  'Pay ' + UI.esc(outlet.name) + ' bill · ' + reserved.discountPercent + '% off</button>' +
                '<button class="btn-outline" data-action="cancel-res" data-id="' + UI.esc(mine.id) + '"' +
                  ' data-name="' + UI.esc(outlet.name) + '">Cancel this table</button>' +
              '</div>'

            /* No table here. Reserving is the primary action because it is worth
               three times as much to the guest. */
            : '<div class="dine-outlet__actions">' +
                '<button class="btn" data-action="reserve" data-id="' + UI.esc(outlet.id) + '">' +
                  UI.icon('calendar', 16) + ' Reserve at ' + UI.esc(outlet.name) + ' · ' +
                  reserved.discountPercent + '% off</button>' +
                '<button class="btn-outline" data-action="pay" data-id="' + UI.esc(outlet.id) + '">' +
                  'Pay ' + UI.esc(outlet.name) + ' bill now · ' + walkin.discountPercent + '% off</button>' +
              '</div>') +

          (outlet.active === false
            ? '<p class="dine-outlet__shut">' + UI.esc(outlet.name) + ' is not taking bookings right now.</p>'
            : '') +
        '</section>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Dine-In' }) +
          '<div class="scroll">' +

            /* The hero is the RESORT. It used to carry an invented single
               restaurant name, which is what hid the second one. */
            UI.propertyHero(Object.assign({}, venue, {
              name: venue.name,
              location: venue.address,
            })) +

            (venue.tagline ? '<p class="hotel-tagline">' + UI.esc(venue.tagline) + '</p>' : '') +

            /* The explainer. First thing after the hero, because "there are two
               restaurants in here" is the fact guests are missing. */
            '<div class="dine-explainer">' +
              '<h2 class="dine-explainer__title">' + UI.icon('info', 16) +
                ' Two restaurants, one resort</h2>' +
              '<p class="dine-explainer__text">' +
                UI.esc(venue.name) + ' has two separate restaurants with separate kitchens, ' +
                'separate tables and separate bills. Pick the one you are eating at — ' +
                'the discount is the same at both.' +
              '</p>' +
              '<ul class="dine-explainer__list">' +
                outlets.map(function (o) {
                  return '<li>' + dietMark(o.diet, o.dietLong) +
                    '<span><strong>' + UI.esc(o.name) + '</strong> — ' + UI.esc(o.dietLong) +
                    (o.cuisine ? '<small>' + UI.esc(o.cuisine) + '</small>' : '') + '</span></li>';
                }).join('') +
              '</ul>' +
            '</div>' +

            /* The offer, stated once for the whole resort. Saying it per card
               would imply the two restaurants compete on price. */
            '<div class="dine-deal">' +
              '<div class="dine-deal__row">' +
                '<span class="dine-deal__pct">' + reserved.discountPercent + '%</span>' +
                '<span class="dine-deal__text"><strong>With a reservation</strong>' +
                  '<span>Book at least ' + reserved.lockMinutes + ' min before you arrive.</span></span>' +
              '</div>' +
              '<div class="dine-deal__row dine-deal__row--plain">' +
                '<span class="dine-deal__pct">' + walkin.discountPercent + '%</span>' +
                '<span class="dine-deal__text"><strong>Walk in &amp; pay</strong>' +
                  '<span>No booking needed — pay your bill instantly.</span></span>' +
              '</div>' +
              '<p class="dine-deal__note">Same offer at ' +
                UI.esc(outlets.map(function (o) { return o.name; }).join(' and ')) +
                '. Your table earns its discount at its own restaurant only.</p>' +
            '</div>' +

            '<div class="dine-outlets">' + outlets.map(outletCard).join('') + '</div>' +

            (!data.signedIn
              ? signInPrompt('Sign in to reserve a table and pay your bill with an instant discount.')
              : '') +

            /* Past bills, each labelled with the restaurant it was rung up at. */
            (data.recentBills && data.recentBills.length
              ? '<div class="section">' +
                  UI.sectionHead('Recent bills') +
                  '<div class="card" style="padding:4px 16px">' +
                    data.recentBills.map(function (b) {
                      return '<button class="dine-bill-row" data-action="receipt" data-id="' + UI.esc(b.id) + '" style="width:100%;text-align:left">' +
                        '<span class="dine-bill-row__text">' +
                          '<span class="dine-bill-row__title">' +
                            (b.outlet ? dietMark(b.outlet.diet, b.outlet.dietLabel) : '') +
                            UI.esc(outletName(b)) + '</span>' +
                          '<span class="dine-bill-row__meta">' + UI.esc(UI.shortDate(b.paidAt || b.createdAt)) +
                            ' · ' + (b.mode === 'reserved' ? 'Reserved table' : 'Walk-in') + '</span>' +
                        '</span>' +
                        '<span class="dine-bill-row__amt">' + UI.money(b.amounts.total) +
                          '<span class="dine-bill-row__saved">Saved ' + UI.money(b.amounts.discount) + '</span>' +
                        '</span></button>';
                    }).join('') +
                  '</div>' +
                '</div>'
              : '') +

            (venue.phone
              ? '<div class="section">' +
                  '<a class="card exp-call" href="' + telHref(venue.phone) + '">' +
                    '<span class="exp-call__icon">' + UI.icon('phone', 22) + '</span>' +
                    '<span class="exp-call__text"><strong>Not sure which restaurant to book?</strong>' +
                      '<span>Call the resort · ' + UI.esc(venue.phone) + '</span></span>' +
                    '<span class="exp-call__arrow">' + UI.icon('arrow-right', 18) + '</span>' +
                  '</a></div>'
              : '') +

            UI.propertyExtras(venue) +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      /* One countdown per booked restaurant. Each is scoped to its own card, so
         a guest holding tables at both sees two independent timers rather than
         one ambiguous one. */
      outlets.forEach(function (outlet) {
        if (!outlet.reservation) return;
        var card = view.querySelector('[data-res="' + outlet.id + '"]');
        if (!card) return;
        var lockRow = card.querySelector('[data-lock]');
        var titleEl = card.querySelector('[data-lock-title]');
        var subEl = card.querySelector('[data-lock-sub]');
        var clockEl = card.querySelector('[data-lock-clock]');
        var payBtn = view.querySelector('.dine-outlet[data-outlet="' + outlet.id + '"] [data-pay-btn]');
        var lock = outlet.reservation.lock;
        var deadline = new Date(lock.unlocksAt).getTime();

        everySecond(view, function () {
          var secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          if (secondsLeft > 0) {
            lockRow.classList.remove('dine-lock--open');
            titleEl.textContent = 'Billing locked';
            subEl.textContent = 'Your ' + reserved.discountPercent + '% ' + outlet.name +
              ' discount unlocks at ' + lock.unlockLabel + '.';
            clockEl.textContent = mmss(secondsLeft);
            if (payBtn) {
              payBtn.disabled = true;
              payBtn.textContent = 'Unlocks in ' + mmss(secondsLeft);
            }
          } else {
            lockRow.classList.add('dine-lock--open');
            titleEl.textContent = 'Ready to pay';
            subEl.textContent = 'Your ' + reserved.discountPercent + '% reserved-table discount is active at ' +
              outlet.name + '.';
            clockEl.textContent = '';
            if (payBtn) {
              payBtn.disabled = false;
              payBtn.textContent = 'Pay ' + outlet.name + ' bill · ' + reserved.discountPercent + '% off';
            }
          }
        });
      });

      UI.actions(view, {
        reserve: function (el) { App.navigate('/dine-in/reserve/' + el.getAttribute('data-id')); },
        pay: function (el) { App.navigate('/dine-in/bill/' + el.getAttribute('data-id')); },
        signin: function () { App.navigate('/login'); },
        receipt: function (el) { App.navigate('/dine-in/paid/' + el.getAttribute('data-id')); },
        'cancel-res': async function (el) {
          var name = el.getAttribute('data-name');
          var ok = await UI.confirm({
            title: 'Cancel your ' + name + ' table?',
            message: 'Your table at ' + name + ' will be released and you will lose the ' +
              reserved.discountPercent + '% in-app billing discount there. Bookings at the other restaurant are not affected.',
            confirmLabel: 'Cancel ' + name + ' table',
            cancelLabel: 'Keep it',
            danger: true,
          });
          if (!ok) return;
          try {
            await API.cancelReservation(el.getAttribute('data-id'));
            UI.toast(name + ' reservation cancelled');
            App.render();
          } catch (err) { UI.toast(err.message, 'error'); }
        },
      });

      return view;
    },
  };

  // ── "Which restaurant?" chooser ───────────────────────────────────────────
  /* Reached by the bare /dine-in/reserve and /dine-in/bill paths — old links,
     bookmarks, anything that arrives without naming a restaurant. It asks rather
     than assuming, which is the same rule the API enforces. */
  function outletPicker(config) {
    return {
      tab: 'dinein',
      auth: true,
      backTo: '/dine-in',
      render: async function () {
        var data = await API.dineIn();
        var outlets = data.outlets || [];

        var view = UI.h(
          '<div class="screen">' +
            UI.appbar({ title: config.title, back: true }) +
            '<div class="scroll">' +

              '<div class="dine-pick-intro">' +
                '<h2>' + UI.esc(config.heading) + '</h2>' +
                '<p>' + UI.esc(config.blurb) + '</p>' +
              '</div>' +

              '<div class="dine-picks">' +
                outlets.map(function (o) {
                  return '<button class="dine-pick dine-pick--' + (o.diet === 'nonveg' ? 'nonveg' : 'veg') + '"' +
                      ' data-action="choose" data-id="' + UI.esc(o.id) + '"' +
                      (o.active === false ? ' disabled' : '') + '>' +
                    '<span class="dine-pick__top">' + dietMark(o.diet, o.dietLong) + dietTag(o) + '</span>' +
                    '<span class="dine-pick__name">' + UI.esc(o.name) + '</span>' +
                    (o.cuisine ? '<span class="dine-pick__cuisine">' + UI.esc(o.cuisine) + '</span>' : '') +
                    (o.dietNote ? '<span class="dine-pick__note">' + UI.esc(o.dietNote) + '</span>' : '') +
                    '<span class="dine-pick__hours">' + hoursLine(o) + '</span>' +
                    (o.reservation
                      ? '<span class="dine-pick__flag">' + UI.icon('check', 12) + ' You have a table here</span>'
                      : '') +
                    (o.active === false ? '<span class="dine-pick__shut">Not available right now</span>' : '') +
                  '</button>';
                }).join('') +
              '</div>' +

              '<div class="spacer-24"></div>' +
            '</div>' +
          '</div>'
        );

        UI.actions(view, {
          choose: function (el) {
            App.navigate(config.basePath + '/' + el.getAttribute('data-id'));
          },
        });

        return view;
      },
    };
  }

  window.Screens.dineReservePick = outletPicker({
    title: 'Reserve a table',
    heading: 'Which restaurant?',
    blurb: 'The resort has two, with separate kitchens and separate tables. Pick the one you want to eat at.',
    basePath: '/dine-in/reserve',
  });

  window.Screens.dineBillPick = outletPicker({
    title: 'Pay your bill',
    heading: 'Which restaurant is the bill from?',
    blurb: 'Check the top of your printed bill. The two restaurants are billed separately, so this has to match.',
    basePath: '/dine-in/bill',
  });

  // ── Reserve a table ───────────────────────────────────────────────────────
  window.Screens.dineReserve = {
    tab: 'dinein',
    auth: true,
    backTo: '/dine-in',
    render: async function (params) {
      var loaded = await loadOutlet(params.outletId);
      if (!loaded) return UI.h('<div class="screen"><div class="scroll"></div></div>');
      var data = loaded.data;
      var outlet = loaded.outlet;
      var s = data.settings;
      var slotData = await API.dineSlots(outlet.id);

      var state = {
        date: slotData.date,
        time: null,
        partySize: 2,
        // Seating areas belong to the restaurant — Dolphin has a rooftop, Rangoli does not.
        area: (outlet.areas && outlet.areas[0]) || '',
        slots: slotData.slots,
      };

      /** The next `advanceDays` dates, as chips. */
      function dateChips() {
        var out = [];
        for (var i = 0; i <= Math.min(13, s.advanceDays); i += 1) {
          var d = new Date();
          d.setDate(d.getDate() + i);
          var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
          out.push('<button class="chip chip--sm" data-action="date" data-key="' + key + '" aria-pressed="' +
            (key === state.date ? 'true' : 'false') + '">' + UI.esc(UI.relativeDay(key)) + '</button>');
        }
        return out.join('');
      }

      function slotChips() {
        if (!state.slots.length) {
          return '<p style="padding:0 16px;margin:0;font-size:13px;color:var(--muted)">' +
            'No slots left at ' + UI.esc(outlet.name) + ' for this date — try another day.</p>';
        }
        return '<div class="chips">' + state.slots.map(function (slot) {
          return '<button class="chip chip--sm" data-action="slot" data-time="' + UI.esc(slot.time) + '"' +
            (slot.full ? ' disabled' : '') +
            ' aria-pressed="' + (slot.time === state.time ? 'true' : 'false') + '">' +
            UI.esc(slot.label) + '</button>';
        }).join('') + '</div>';
      }

      function areaChips() {
        if (!outlet.areas || !outlet.areas.length) return '';
        return '<div class="section"><div class="subhead">Seating at ' + UI.esc(outlet.name) + '</div><div class="chips">' +
          outlet.areas.map(function (area) {
            return '<button class="chip chip--sm" data-action="area" data-area="' + UI.esc(area) + '"' +
              ' aria-pressed="' + (area === state.area ? 'true' : 'false') + '">' + UI.esc(area) + '</button>';
          }).join('') + '</div></div>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Reserve a table', back: true }) +
          '<div class="scroll">' +

            /* Which restaurant, pinned to the top of the screen. */
            outletIdentity(outlet, data.venue.name, {
              sub: 'Booking a table here · ' + outlet.dietLong,
            }) +

            (outlet.dietNote
              ? '<p class="dine-ident-note">' + UI.esc(outlet.dietNote) + '</p>'
              : '') +

            noticeBanner(
              'Book at least ' + s.lockMinutes + ' minutes before you arrive — that is what unlocks ' +
              data.tiers.reserved.discountPercent + '% off when you pay your ' + outlet.name +
              ' bill in the app.',
              'info',
              'margin-top:12px'
            ) +

            '<div class="section"><div class="subhead">Date</div>' +
              '<div class="chips" data-dates>' + dateChips() + '</div></div>' +

            '<div class="section"><div class="subhead">Time · ' + UI.esc(outlet.name) +
              ' serves ' + UI.esc(outlet.openTime) + '–' + UI.esc(outlet.closeTime) + '</div>' +
              '<div data-slots>' + slotChips() + '</div></div>' +

            areaChips() +

            '<div class="guests">' +
              '<div class="stepper-row">' +
                '<div><div class="stepper-row__label">Guests</div>' +
                  '<div class="stepper-row__hint">Up to ' + s.maxPartySize + ' per booking</div></div>' +
                '<div class="stepper">' +
                  '<button data-action="party-minus" aria-label="Fewer guests">' + UI.icon('minus', 16) + '</button>' +
                  '<span data-party>' + state.partySize + '</span>' +
                  '<button data-action="party-plus" aria-label="More guests">' + UI.icon('plus', 16) + '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="field"><label class="field__label" for="dine-name">Name for the booking</label>' +
              '<div class="field__control">' + UI.icon('user', 19) +
                '<input id="dine-name" type="text" value="" placeholder="Your name"></div></div>' +

            '<div class="field"><label class="field__label" for="dine-phone">Phone</label>' +
              '<div class="field__control">' + UI.icon('phone', 19) +
                '<input id="dine-phone" type="tel" value="" placeholder="Contact number"></div></div>' +

            '<div class="field"><label class="field__label" for="dine-notes">Anything we should know? (optional)</label>' +
              '<div class="field__control">' +
                '<textarea id="dine-notes" placeholder="Birthday, high chair, seating preference..."></textarea></div></div>' +

            '<div class="section"><button class="btn" data-action="confirm">Reserve at ' +
              UI.esc(outlet.name) + '</button></div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      function syncPressed(selector, attr, value) {
        view.querySelectorAll(selector).forEach(function (btn) {
          btn.setAttribute('aria-pressed', btn.getAttribute(attr) === value ? 'true' : 'false');
        });
      }

      async function reloadSlots() {
        var box = view.querySelector('[data-slots]');
        box.innerHTML = UI.spinnerBlock();
        try {
          var fresh = await API.dineSlots(outlet.id, state.date);
          state.slots = fresh.slots;
          state.time = null;
          box.innerHTML = slotChips();
        } catch (err) {
          box.innerHTML = '<p style="padding:0 16px;margin:0;font-size:13px;color:var(--danger)">' +
            UI.esc(err.message) + '</p>';
        }
      }

      UI.actions(view, {
        'switch-outlet': bindSwitch(view, data, outlet, '/dine-in/reserve'),
        date: function (el) {
          state.date = el.getAttribute('data-key');
          syncPressed('[data-action="date"]', 'data-key', state.date);
          reloadSlots();
        },
        slot: function (el) {
          state.time = el.getAttribute('data-time');
          syncPressed('[data-action="slot"]', 'data-time', state.time);
        },
        area: function (el) {
          state.area = el.getAttribute('data-area');
          syncPressed('[data-action="area"]', 'data-area', state.area);
        },
        'party-minus': function () {
          state.partySize = Math.max(1, state.partySize - 1);
          view.querySelector('[data-party]').textContent = state.partySize;
        },
        'party-plus': function () {
          state.partySize = Math.min(s.maxPartySize, state.partySize + 1);
          view.querySelector('[data-party]').textContent = state.partySize;
        },
        confirm: async function (btn) {
          if (!state.time) { UI.toast('Pick a time for your table', 'error'); return; }
          var name = view.querySelector('#dine-name').value.trim();
          if (!name) { UI.toast('Enter a name for the booking', 'error'); return; }

          btn.disabled = true;
          btn.textContent = 'Reserving…';
          try {
            var res = await API.reserveTable({
              outletId: outlet.id,
              date: state.date,
              time: state.time,
              partySize: state.partySize,
              area: state.area,
              guestName: name,
              guestPhone: view.querySelector('#dine-phone').value.trim(),
              notes: view.querySelector('#dine-notes').value.trim(),
            });
            UI.toast(
              'Table booked at ' + outlet.name + ' (' + outlet.dietLabel + ') — billing unlocks at ' +
                res.reservation.lock.unlockLabel,
              'success'
            );
            App.navigate('/dine-in');
          } catch (err) {
            UI.toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Reserve at ' + outlet.name;
          }
        },
      });

      return view;
    },
  };

  // ── Pay the bill ──────────────────────────────────────────────────────────
  window.Screens.dineBill = {
    tab: 'dinein',
    auth: true,
    backTo: '/dine-in',
    render: async function (params) {
      var loaded = await loadOutlet(params.outletId);
      if (!loaded) return UI.h('<div class="screen"><div class="scroll"></div></div>');
      var data = loaded.data;
      var outlet = loaded.outlet;
      var s = data.settings;

      /* Only THIS restaurant's table can discount this bill. */
      var reservation = outlet.reservation;
      /* A table at the other one is still worth mentioning — a guest who booked
         Rangoli and is paying at Dolphin is about to wonder where their 30% went. */
      var elsewhere = (data.outlets || []).filter(function (o) {
        return o.id !== outlet.id && o.reservation;
      });

      /* Whether the reserved tier is currently unbillable. Start a locked guest
         on the walk-in tier so the bill they see is one they can actually pay;
         the locked 30% row stays visible with its countdown, and we switch them
         over automatically the moment it opens. */
      var startsLocked = Boolean(
        reservation && reservation.lock.locked &&
        new Date(reservation.lock.unlocksAt).getTime() > Date.now() &&
        s.allowWalkinWhileLocked !== false
      );

      var state = {
        amount: '',
        /** null = let the server pick the best tier, 'walkin' = force the instant rate. */
        mode: startsLocked ? 'walkin' : null,
        offerCode: null,
        payment: 'upi',
        quote: null,
        seq: 0,
      };

      var reservedPct = data.tiers.reserved.discountPercent;
      var walkinPct = data.tiers.walkin.discountPercent;

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Pay your bill', back: true }) +
          '<div class="scroll">' +

            /* Sticky: whatever the guest scrolls to, the restaurant stays on screen. */
            outletIdentity(outlet, data.venue.name, {
              sub: 'Paying this restaurant · ' + outlet.dietLong,
            }) +

            /* Named check before anything else, because settling the wrong
               restaurant's bill is the expensive mistake here. */
            /* The text is wrapped in one span so the flex row has exactly two
               children — otherwise the <strong> becomes its own flex item and the
               sentence breaks apart mid-line. */
            '<p class="dine-bill-check">' + UI.icon('info', 14) +
              '<span>Make sure your printed bill says <strong>' + UI.esc(outlet.name) + '</strong>. ' +
              'The two restaurants are billed separately.</span></p>' +

            /* Holding a table at the other restaurant. */
            (elsewhere.length
              ? '<div class="dine-elsewhere">' +
                  dietMark(elsewhere[0].diet, elsewhere[0].dietLabel) +
                  '<span class="dine-elsewhere__text">' +
                    '<strong>Your ' + reservedPct + '% table is at ' + UI.esc(elsewhere[0].name) + '</strong>' +
                    '<span>It does not apply to a ' + UI.esc(outlet.name) + ' bill. If you ate at ' +
                      UI.esc(elsewhere[0].name) + ', switch over to use it.</span>' +
                  '</span>' +
                  '<button class="dine-elsewhere__btn" data-action="go-outlet" data-id="' +
                    UI.esc(elsewhere[0].id) + '">Switch</button>' +
                '</div>'
              : '') +

            '<div class="dine-amount">' +
              '<div class="dine-amount__label">Enter the total on your ' + UI.esc(outlet.name) + ' bill</div>' +
              '<div class="dine-amount__field">' +
                '<span class="dine-amount__currency">' + UI.CURRENCY + '</span>' +
                '<input class="dine-amount__input" data-amount type="number" inputmode="numeric" ' +
                  'min="1" step="1" placeholder="0" aria-label="Bill amount">' +
              '</div>' +
              '<div class="dine-amount__hint" data-amount-hint>' +
                (s.minBillAmount ? 'Minimum ' + UI.money(s.minBillAmount) : 'We will apply your discount automatically') +
              '</div>' +
            '</div>' +

            '<div data-save></div>' +

            /* Tier picker: only meaningful with a table at THIS restaurant. */
            (reservation
              ? '<div class="section"><div class="subhead">Discount</div><div data-modes></div></div>'
              : '') +

            '<div data-notice></div>' +

            '<div class="section"><div class="subhead">Bill</div>' +
              '<div class="card card__body" data-bill>' +
                '<p style="margin:0;font-size:13.5px;color:var(--muted)">' +
                  'Enter your bill amount to see the discount.</p>' +
              '</div>' +
            '</div>' +

            '<div class="section"><div class="subhead">Coupon</div>' +
              '<div class="field" style="padding:0">' +
                '<div class="field__control">' + UI.icon('tag', 19) +
                  '<input data-offer type="text" placeholder="Have a code?" autocapitalize="characters">' +
                  '<button class="link-btn" data-action="apply-offer">Apply</button>' +
                '</div>' +
                '<div class="field__hint" data-offer-msg></div>' +
              '</div>' +
            '</div>' +

            '<div class="section"><div class="subhead">Pay using</div>' +
              PAY_METHODS.map(function (m) {
                return '<button class="option" data-action="method" data-id="' + m.id + '"' +
                  ' aria-pressed="' + (m.id === state.payment ? 'true' : 'false') + '">' +
                  '<span class="option__icon">' + UI.icon(m.icon, 20) + '</span>' +
                  '<span class="option__text"><span class="option__title">' + m.label + '</span>' +
                    '<span class="option__sub">' + m.sub + '</span></span>' +
                  '<span class="option__radio"></span></button>';
              }).join('') +
            '</div>' +

            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              /* The restaurant name rides on the pay bar itself. */
              '<div class="actionbar__label">' + UI.esc(outlet.name) + ' · you pay</div>' +
              '<div class="actionbar__value" data-total>' + UI.money(0) + '</div>' +
            '</div>' +
            '<button class="btn" data-action="pay" disabled>Pay bill</button>' +
          '</div>' +
        '</div>'
      );

      var amountEl = view.querySelector('[data-amount]');
      var saveEl = view.querySelector('[data-save]');
      var modesEl = view.querySelector('[data-modes]');
      var noticeEl = view.querySelector('[data-notice]');
      var billEl = view.querySelector('[data-bill]');
      var totalEl = view.querySelector('[data-total]');
      var payBtn = view.querySelector('[data-action="pay"]');
      var offerMsg = view.querySelector('[data-offer-msg]');

      /** Redraws the reserved/walk-in choice, including the live lock state. */
      function renderModes() {
        if (!modesEl) return;
        // While locked the server reports canPayNow=false for the reserved tier.
        var locked = reservation.lock.locked &&
          new Date(reservation.lock.unlocksAt).getTime() > Date.now();
        /* The quote is the authority once we have one, so the highlighted row can
           never disagree with the bill underneath it. */
        var active = state.quote ? state.quote.mode : (state.mode === 'walkin' ? 'walkin' : 'reserved');
        // With the fallback switched off there is nothing to choose while locked.
        var offerWalkin = s.allowWalkinWhileLocked !== false || !locked;

        modesEl.innerHTML =
          '<button class="option' + (locked ? ' option--locked' : '') + '" data-action="mode" data-mode="reserved"' +
            ' aria-pressed="' + (active === 'reserved' && !locked ? 'true' : 'false') + '"' +
            (locked ? ' disabled' : '') + '>' +
            '<span class="option__icon">' + UI.icon(locked ? 'lock' : 'check', 20) + '</span>' +
            '<span class="option__text">' +
              '<span class="option__title">Use my ' + UI.esc(outlet.name) + ' table</span>' +
              '<span class="option__sub" data-mode-sub>' +
                (locked
                  ? 'Unlocks at ' + UI.esc(reservation.lock.unlockLabel)
                  : 'Table reserved · ' + UI.esc(slotLabel(reservation))) +
              '</span></span>' +
            '<span class="dine-option__off">' + reservedPct + '% off</span></button>' +

          (offerWalkin
            ? '<button class="option" data-action="mode" data-mode="walkin"' +
                ' aria-pressed="' + (active === 'walkin' ? 'true' : 'false') + '">' +
                '<span class="option__icon">' + UI.icon('wallet', 20) + '</span>' +
                '<span class="option__text">' +
                  '<span class="option__title">Pay now as a walk-in</span>' +
                  '<span class="option__sub">' +
                    (locked ? 'Skip the wait at the lower rate' : 'Instant, no waiting') + '</span></span>' +
                '<span class="dine-option__off">' + walkinPct + '% off</span></button>'
            : '');
      }

      /** The amount currently typed in, normalised the way the server will read it. */
      function typedAmount() {
        return Math.round(Number(state.amount) || 0);
      }

      function renderQuote() {
        var q = state.quote;
        if (!q) {
          saveEl.innerHTML = '';
          noticeEl.innerHTML = '';
          billEl.innerHTML = '<p style="margin:0;font-size:13.5px;color:var(--muted)">' +
            'Enter your bill amount to see the discount.</p>';
          totalEl.textContent = UI.money(0);
          payBtn.disabled = true;
          payBtn.textContent = 'Pay bill';
          if (modesEl) renderModes();
          return;
        }

        saveEl.innerHTML = q.amounts.discount
          ? '<div class="dine-save">You save ' + UI.money(q.amounts.discount) +
            ' (' + q.amounts.effectivePercent + '% off)</div>'
          : '<div class="dine-save dine-save--muted">No discount on this bill</div>';

        /* Coupon feedback follows the quote, so a code that stops qualifying when
           the amount changes stops claiming to be applied. */
        if (state.offerCode) {
          if (q.offerApplied) {
            offerMsg.style.color = 'var(--success)';
            offerMsg.textContent = q.offerApplied + ' applied';
          } else {
            offerMsg.style.color = 'var(--muted)';
            offerMsg.textContent = state.offerCode + ' does not apply to this bill';
          }
        }

        noticeEl.innerHTML = noticeBanner(q.notice, q.noticeKind, 'margin-top:14px');
        billEl.innerHTML = billKv(
          q.amounts,
          (q.mode === 'reserved' ? 'Reserved-table discount' : 'Walk-in discount') +
            ' (' + q.discountPercent + '%)'
        );
        totalEl.textContent = UI.money(q.amounts.total);

        if (modesEl) renderModes();

        /* Only ever offer to charge the figure on the button. If the guest has
           typed further since this quote was priced, stay disabled until the
           next one lands rather than charging an amount they never saw. */
        var current = q.amounts.billAmount === typedAmount();
        payBtn.disabled = !q.canPayNow || !current;
        payBtn.textContent = !q.canPayNow
          ? 'Locked until ' + (q.lock ? q.lock.unlockLabel : 'later')
          : current
            ? 'Pay ' + UI.money(q.amounts.total)
            : 'Updating…';
      }

      /** Asks the server to price the bill. Debounced by a sequence number. */
      async function refreshQuote() {
        var amount = Math.round(Number(state.amount) || 0);
        if (!amount || amount <= 0) { state.quote = null; renderQuote(); return; }

        var mySeq = ++state.seq;
        try {
          var quote = await API.dineQuote({
            outletId: outlet.id,
            billAmount: amount,
            mode: state.mode || undefined,
            offerCode: state.offerCode || undefined,
          });
          if (mySeq !== state.seq) return; // a newer keystroke already won
          state.quote = quote;
          renderQuote();
        } catch (err) {
          if (mySeq !== state.seq) return;
          state.quote = null;
          renderQuote();
          billEl.innerHTML = '<p style="margin:0;font-size:13.5px;color:var(--danger)">' +
            UI.esc(err.message) + '</p>';
        }
      }

      var debounce = null;
      amountEl.addEventListener('input', function () {
        state.amount = amountEl.value;
        // Stale-proofing: the button cannot be pressed between the keystroke and
        // the quote that prices it.
        payBtn.disabled = true;
        if (state.quote) payBtn.textContent = 'Updating…';
        clearTimeout(debounce);
        debounce = setTimeout(refreshQuote, 320);
      });

      /* Once the lock expires, re-quote so the 30% appears without a reload. */
      if (reservation && reservation.lock.locked) {
        var deadline = new Date(reservation.lock.unlocksAt).getTime();
        var released = false;
        everySecond(view, function () {
          var left = deadline - Date.now();
          if (!released && left <= 0) {
            released = true;
            reservation.lock.locked = false;
            state.mode = null;
            refreshQuote();
            UI.toast('Your ' + reservedPct + '% ' + outlet.name + ' discount is now active', 'success');
          } else if (!released && modesEl) {
            var sub = modesEl.querySelector('[data-mode-sub]');
            if (sub) sub.textContent = 'Unlocks in ' + mmss(left / 1000);
          }
        });
      }

      renderModes();

      /**
       * The last gate before money moves: name the restaurant, show its mark, and
       * make the guest agree. A wrong-restaurant payment cannot be undone by them,
       * so one deliberate tap here is worth the friction.
       */
      function confirmOutlet(total) {
        return new Promise(function (resolve) {
          var settled = false;
          var body = UI.h(
            '<div style="padding:0 16px 8px">' +
              '<div class="dine-confirm dine-confirm--' + (outlet.diet === 'nonveg' ? 'nonveg' : 'veg') + '">' +
                dietMark(outlet.diet, outlet.dietLong) +
                '<span><strong>' + UI.esc(outlet.name) + '</strong>' +
                  '<small>' + UI.esc(outlet.dietLong) + '</small></span>' +
              '</div>' +
              '<p style="margin:14px 0 20px;font-size:14.5px;line-height:1.6;color:var(--ink-soft)">' +
                'You are paying <strong>' + UI.money(total) + '</strong> to <strong>' +
                UI.esc(outlet.name) + '</strong>. Is that the restaurant you ate at?' +
              '</p>' +
              '<button class="btn" data-yes>Yes, pay ' + UI.esc(outlet.name) + '</button>' +
              '<div style="height:10px"></div>' +
              '<button class="btn-outline btn-outline--lg" data-no>No, go back</button>' +
            '</div>'
          );
          var sheet = UI.sheet({
            title: 'Confirm the restaurant',
            body: body,
            onClose: function () { if (!settled) { settled = true; resolve(false); } },
          });
          body.querySelector('[data-yes]').addEventListener('click', function () {
            settled = true; resolve(true); sheet.close();
          });
          body.querySelector('[data-no]').addEventListener('click', function () {
            settled = true; resolve(false); sheet.close();
          });
        });
      }

      UI.actions(view, {
        'switch-outlet': bindSwitch(view, data, outlet, '/dine-in/bill'),
        'go-outlet': function (el) { App.navigate('/dine-in/bill/' + el.getAttribute('data-id')); },
        mode: function (el) {
          state.mode = el.getAttribute('data-mode') === 'walkin' ? 'walkin' : null;
          refreshQuote();
        },
        method: function (el) {
          state.payment = el.getAttribute('data-id');
          view.querySelectorAll('[data-action="method"]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', btn === el ? 'true' : 'false');
          });
        },
        'apply-offer': async function (btn) {
          var input = view.querySelector('[data-offer]');
          var code = input.value.trim().toUpperCase();
          var amount = Math.round(Number(state.amount) || 0);
          if (!code) { state.offerCode = null; offerMsg.textContent = ''; refreshQuote(); return; }
          if (!amount) { UI.toast('Enter your bill amount first', 'error'); return; }

          btn.disabled = true;
          try {
            await API.validateDineOffer({
              code: code,
              outletId: outlet.id,
              billAmount: amount,
              mode: state.mode || undefined,
            });
            state.offerCode = code;
            offerMsg.style.color = 'var(--success)';
            offerMsg.textContent = code + ' applied';
            await refreshQuote();
          } catch (err) {
            state.offerCode = null;
            offerMsg.style.color = 'var(--danger)';
            offerMsg.textContent = err.message;
            await refreshQuote();
          } finally {
            btn.disabled = false;
          }
        },
        pay: async function (btn) {
          /* Pay exactly what was quoted, never the raw input — the two can differ
             for the 320ms a debounced keystroke is still in flight. */
          var q = state.quote;
          if (!q || q.amounts.billAmount !== typedAmount()) {
            UI.toast('One moment — still working out your discount', 'error');
            refreshQuote();
            return;
          }
          var amount = q.amounts.billAmount;

          if (!(await confirmOutlet(q.amounts.total))) return;

          btn.disabled = true;
          btn.textContent = 'Paying…';
          try {
            var res = await API.payDineBill({
              outletId: outlet.id,
              billAmount: amount,
              mode: state.mode || undefined,
              offerCode: state.offerCode || undefined,
              tableNumber: '',
              payment: { method: state.payment },
            });
            App.navigate('/dine-in/paid/' + res.bill.id);
          } catch (err) {
            UI.toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Pay ' + UI.money(amount);
            // A 423 means the lock closed under them — resync the real state.
            if (err.status === 423) refreshQuote();
          }
        },
      });

      return view;
    },
  };

  // ── Receipt ───────────────────────────────────────────────────────────────
  window.Screens.dinePaid = {
    tab: 'dinein',
    auth: true,
    backTo: '/dine-in',
    render: async function (params) {
      var data = await API.dineBill(params.id);
      var bill = data.bill;
      var pending = bill.payment && bill.payment.status === 'pending';
      var where = bill.outlet;

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Bill paid', back: true }) +
          '<div class="scroll">' +

            '<div class="success-hero">' +
              '<div class="success-hero__ring">' + UI.icon('check', 34) + '</div>' +
              '<h2>' + (pending ? 'Show this at the counter' : 'Payment successful') + '</h2>' +
              '<p>You saved ' + UI.money(bill.amounts.discount) + ' on a ' +
                UI.money(bill.amounts.billAmount) + ' bill at ' + UI.esc(outletName(bill)) + '.</p>' +
            '</div>' +

            /* Which restaurant, with its mark — the receipt has to answer this on
               its own months later, without the app's help. */
            (where
              ? '<div class="section">' +
                  outletIdentity(where, bill.venueName, {
                    sub: 'Bill settled here · ' + (where.dietLabel || ''),
                    switchable: false,
                  }) +
                '</div>'
              : '') +

            '<div class="section">' +
              '<div class="card card__body">' +
                '<div class="kv"><span class="kv__key">Restaurant</span>' +
                  '<span class="kv__val">' + UI.esc(outletName(bill)) +
                  (where ? ' · ' + UI.esc(where.dietLabel) : '') + '</span></div>' +
                (bill.venueName
                  ? '<div class="kv"><span class="kv__key">Venue</span>' +
                    '<span class="kv__val">' + UI.esc(bill.venueName) + '</span></div>'
                  : '') +
                '<div class="kv"><span class="kv__key">Reference</span>' +
                  '<span class="kv__val">' + UI.esc(bill.reference) + '</span></div>' +
                '<div class="kv"><span class="kv__key">Paid</span>' +
                  '<span class="kv__val">' + UI.esc(UI.shortDate(bill.paidAt)) + ' · ' +
                  UI.esc(UI.hhmm(bill.paidAt)) + '</span></div>' +
                '<div class="kv"><span class="kv__key">Discount tier</span>' +
                  '<span class="kv__val">' + (bill.mode === 'reserved' ? 'Reserved table' : 'Walk-in') +
                  ' · ' + bill.amounts.discountPercent + '%</span></div>' +
                '<div class="kv"><span class="kv__key">Payment</span>' +
                  '<span class="kv__val">' + UI.esc(bill.payment.methodLabel) +
                  (pending ? ' (due)' : '') + '</span></div>' +
                '<div class="card__divider"></div>' +
                billKv(bill.amounts,
                  (bill.mode === 'reserved' ? 'Reserved-table discount' : 'Walk-in discount') +
                  ' (' + bill.amounts.discountPercent + '%)') +
              '</div>' +
            '</div>' +

            noticeBanner(bill.notice, bill.mode === 'reserved' ? 'info' : 'warn') +

            '<div class="section">' +
              '<button class="btn" data-action="done">Back to Dine-In</button>' +
            '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        done: function () { App.navigate('/dine-in'); },
      });

      return view;
    },
  };

  // ── Restaurant reservations (from the Account tab) ─────────────────────────
  /* The guest's own restaurant history: tables they have booked, and bills they
     have settled in the app. Grouped BY RESTAURANT, because "which one was that?"
     is the question this list gets asked, and an undifferentiated pile of
     bookings is what made it unanswerable. */
  window.Screens.restaurantBookings = {
    auth: true,
    backTo: '/account',
    render: async function () {
      var res = await Promise.all([API.dineReservations(), API.dineBills()]);
      var reservations = res[0].reservations || [];
      var outlets = res[0].outlets || [];
      var bills = res[1].bills || [];
      var totalSaved = res[1].totalSaved || 0;
      var byOutlet = res[1].byOutlet || [];

      function reservationCard(r) {
        var pill = r.status === 'cancelled'
          ? '<span class="status-pill status-pill--cancelled">Cancelled</span>'
          : r.billId
            ? '<span class="status-pill status-pill--completed">Bill settled</span>'
            : r.expired
              ? '<span class="status-pill status-pill--cancelled">Expired</span>'
              : '<span class="status-pill status-pill--confirmed">Confirmed</span>';

        return '<article class="card">' +
          '<button class="ticket__main" data-action="open-tab">' +
            '<div class="ticket__text">' +
              '<h3 class="ticket__title">' + UI.esc(slotLabel(r)) + '</h3>' +
              '<p class="ticket__sub">' +
                (r.outlet ? dietMark(r.outlet.diet, r.outlet.dietLabel) + UI.esc(r.outlet.name) + ' · ' : '') +
                UI.esc(partyLine(r)) + '</p>' +
              '<p class="ticket__seats">' + UI.esc(r.reference) + '</p>' +
              '<div style="margin-top:7px">' + pill + '</div>' +
            '</div>' +
            '<span class="row__chevron">' + UI.icon('chevron-right', 20) + '</span>' +
          '</button>' +
        '</article>';
      }

      function billCard(b) {
        return '<article class="card">' +
          '<button class="ticket__main" data-action="open-bill" data-id="' + UI.esc(b.id) + '">' +
            '<div class="ticket__text">' +
              '<h3 class="ticket__title">' + UI.money(b.amounts.total) + ' paid</h3>' +
              '<p class="ticket__sub">' +
                (b.outlet ? dietMark(b.outlet.diet, b.outlet.dietLabel) : '') +
                UI.esc(outletName(b)) + ' · ' + UI.esc(UI.shortDate(b.paidAt || b.createdAt)) +
                ' · ' + (b.mode === 'reserved' ? 'Reserved table' : 'Walk-in') +
                ' · ' + b.amounts.discountPercent + '% off</p>' +
              '<p class="ticket__seats">' + UI.esc(b.reference) +
                (b.amounts.discount ? ' · saved ' + UI.money(b.amounts.discount) : '') + '</p>' +
            '</div>' +
            '<span class="row__chevron">' + UI.icon('chevron-right', 20) + '</span>' +
          '</button>' +
        '</article>';
      }

      /** A restaurant heading, mark included, over the rows that belong to it. */
      function groupHead(outlet) {
        return '<div class="dine-group-head">' + dietMark(outlet.diet, outlet.dietLabel) +
          '<strong>' + UI.esc(outlet.name) + '</strong>' +
          '<span>' + UI.esc(outlet.dietLabel) + '</span></div>';
      }

      /** Rows for one restaurant, plus any that predate the split. */
      function groupsOf(rows) {
        var out = outlets.map(function (o) {
          return { outlet: o, rows: rows.filter(function (r) { return r.outletId === o.id; }) };
        }).filter(function (g) { return g.rows.length; });
        var untagged = rows.filter(function (r) { return !r.outletId; });
        if (untagged.length) out.push({ outlet: null, rows: untagged });
        return out;
      }

      function renderGroups(rows, cardFn) {
        return groupsOf(rows).map(function (g) {
          return '<div class="dine-group">' +
            (g.outlet
              ? groupHead(g.outlet)
              : '<div class="dine-group-head dine-group-head--unknown">' +
                '<strong>Restaurant not recorded</strong>' +
                '<span>booked before the two restaurants were listed separately</span></div>') +
            '<div class="stack">' + g.rows.map(cardFn).join('') + '</div>' +
          '</div>';
        }).join('');
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Restaurant Reservations', back: true }) +
          '<div class="scroll">' +

            (!reservations.length && !bills.length
              ? UI.empty({
                  icon: 'dine',
                  title: 'No restaurant bookings yet',
                  text: 'Reserve a table ahead of your visit and settle the bill from your seat.',
                  action: 'open-tab',
                  actionLabel: 'Open Dine-In',
                })
              : '') +

            /* Spend per restaurant, so the split is visible at a glance. */
            (byOutlet.some(function (o) { return o.bills; })
              ? '<div class="section">' + UI.sectionHead('Where you have eaten') +
                  '<div class="dine-split">' +
                    byOutlet.map(function (o) {
                      return '<div class="dine-split__cell">' +
                        '<div class="dine-split__head">' + dietMark(o.diet, o.dietLabel) +
                          '<strong>' + UI.esc(o.name) + '</strong></div>' +
                        '<div class="dine-split__amt">' + UI.money(o.paid) + '</div>' +
                        '<div class="dine-split__meta">' + o.bills + ' bill' + (o.bills === 1 ? '' : 's') +
                          (o.saved ? ' · saved ' + UI.money(o.saved) : '') + '</div>' +
                      '</div>';
                    }).join('') +
                  '</div>' +
                '</div>'
              : '') +

            (reservations.length
              ? '<div class="section">' + UI.sectionHead('Table reservations') +
                  renderGroups(reservations, reservationCard) +
                '</div>'
              : '') +

            (bills.length
              ? '<div class="section">' + UI.sectionHead('Bills paid in the app') +
                  (totalSaved
                    ? noticeBanner('You have saved ' + UI.money(totalSaved) + ' on restaurant bills so far.')
                    : '') +
                  renderGroups(bills, billCard) +
                '</div>'
              : '') +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        'open-tab': function () { App.navigate('/dine-in'); },
        'open-bill': function (el) { App.navigate('/dine-in/paid/' + el.getAttribute('data-id')); },
      });

      return view;
    },
  };
})();
