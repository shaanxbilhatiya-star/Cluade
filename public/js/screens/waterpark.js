/* Water Park tab — Family Fun Day at Kingfisher Mandla.

   Two ways to buy the same day out, and the guest can see exactly why one is
   cheaper:
     · package    — a fixed bundle (Family of 3, Family of 4) at a flat price.
                    The card shows the full value breakup: every line, its
                    quantity, its rate and its value, then the total actual
                    value and what the package saves against it.
     · per person — the guest builds the day themselves from the same rate card
                    with every quantity editable. Nothing is bundled, so it
                    costs the counter price and saves nothing, which is what
                    makes the package a visible deal rather than a claim.

   Add-ons (fish spa, bull ride, massage chair, photography) sit on top of
   either. Every price, every package line and every line of copy comes from the
   API, which reads admin-editable settings — nothing here hardcodes a rupee
   figure, so changing a rate in the admin panel changes this screen. Totals are
   always quoted by the server, never added up here, so what the guest is shown
   is what they are charged. */
(function () {
  'use strict';

  var PAY_METHODS = [
    { id: 'upi', label: 'UPI', sub: 'GPay, PhonePe, Paytm', icon: 'wallet' },
    { id: 'card', label: 'Credit / Debit Card', sub: 'Visa, Mastercard, RuPay', icon: 'card' },
    { id: 'netbanking', label: 'Net Banking', sub: 'All major banks', icon: 'bank' },
    { id: 'cash', label: 'Pay at the gate', sub: 'Show this pass at the counter', icon: 'cash' },
  ];

  /* Icons for the "what's included" strip and the add-on list. The labels are
     admin-editable, so these match on meaning rather than on an exact string,
     and fall back to a tick. */
  var ICON_HINTS = [
    { match: /water|park|entry|slide|pool/i, icon: 'waves' },
    { match: /movie|cinema|film|ticket/i, icon: 'ticket' },
    { match: /costume|dress|swim/i, icon: 'hanger' },
    { match: /jump|kid|play|trampolin/i, icon: 'sparkle' },
    { match: /drink|juice|welcome|shake|coffee|tea/i, icon: 'cup' },
    { match: /food|snack|meal|combo|popcorn/i, icon: 'food' },
    { match: /massage|chair|spa|fish/i, icon: 'chair' },
    { match: /photo|camera/i, icon: 'eye' },
    { match: /ride|bull|horse/i, icon: 'sparkle' },
    { match: /locker|bag/i, icon: 'lock' },
  ];

  function iconFor(label) {
    for (var i = 0; i < ICON_HINTS.length; i += 1) {
      if (ICON_HINTS[i].match.test(String(label || ''))) return ICON_HINTS[i].icon;
    }
    return 'check';
  }

  function telHref(phone) { return 'tel:' + String(phone || '').replace(/[^0-9+]/g, ''); }

  function noticeBanner(text, kind) {
    if (!text) return '';
    return '<div class="notice' + (kind === 'warn' ? ' notice--warn' : '') + '">' + UI.esc(text) + '</div>';
  }

  /** YYYY-MM-DD, N days after the given key. */
  function addDays(key, days) {
    var d = new Date(key + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function addOnName(addOn) {
    return addOn.label + (addOn.note ? ' (' + addOn.note + ')' : '');
  }

  /**
   * The value breakup exactly as the poster prints it: particulars, qty, rate,
   * value, then the total. Every figure comes from the server already computed
   * from qty x rate, so the total can never disagree with its own lines.
   */
  function breakupTable(pkg) {
    return '<table class="wp-brk">' +
      '<thead><tr><th>Particulars</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Value</th></tr></thead>' +
      '<tbody>' +
        pkg.lines.map(function (l) {
          return '<tr>' +
            '<td>' + UI.esc(l.label) + '</td>' +
            '<td class="num">' + l.qty + '</td>' +
            '<td class="num">' + UI.money(l.rate) + '</td>' +
            '<td class="num">' + UI.money(l.value) + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody>' +
      '<tfoot><tr><td colspan="3">Total actual value</td>' +
        '<td class="num">' + UI.money(pkg.actualValue) + '</td></tr></tfoot>' +
    '</table>';
  }

  /** One editable quantity row: label, rate, running value and a stepper. */
  function stepperRow(attr, id, label, meta, qty, unitPrice, max) {
    return '<div class="wp-row" data-' + attr + '="' + UI.esc(id) + '" data-price="' + unitPrice + '"' +
      ' data-max="' + (max || 99) + '">' +
      '<div class="wp-row__text">' +
        '<div class="wp-row__label">' + UI.esc(label) + '</div>' +
        '<div class="wp-row__meta">' + UI.esc(meta) + '</div>' +
      '</div>' +
      '<div class="wp-row__value" data-row-value>' +
        (qty ? UI.money(unitPrice * qty) : '') + '</div>' +
      '<div class="stepper">' +
        '<button data-minus aria-label="Fewer ' + UI.esc(label) + '"' + (qty ? '' : ' disabled') + '>' +
          UI.icon('minus', 16) + '</button>' +
        '<span data-count>' + qty + '</span>' +
        '<button data-plus aria-label="More ' + UI.esc(label) + '">' + UI.icon('plus', 16) + '</button>' +
      '</div>' +
    '</div>';
  }

  function unitNote(item) {
    if (item.unit === 'adult') return UI.money(item.rate) + ' per adult';
    if (item.unit === 'child') return UI.money(item.rate) + ' per child';
    if (item.unit === 'booking') return UI.money(item.rate) + ' per booking';
    return UI.money(item.rate) + ' per person';
  }

  function closedScreen(title, text) {
    return UI.h(
      '<div class="screen">' + UI.appbar({ title: title }) +
        '<div class="scroll">' +
          UI.empty({ icon: 'waves', title: 'Water park booking is closed', text: text }) +
        '</div></div>'
    );
  }

  // ── Water Park home ───────────────────────────────────────────────────────
  window.Screens.waterpark = {
    tab: 'waterpark',
    render: async function () {
      var data = await API.waterpark();
      var s = data.settings;
      var packages = data.catalogue.packages;
      var addOns = data.catalogue.addOns;

      if (s.active === false) {
        return closedScreen(s.headline || 'Water Park',
          'Online booking is switched off right now. Please buy your tickets at the gate.');
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: s.headline || 'Water Park' }) +
          '<div class="scroll">' +

            '<div class="wp-hero">' +
              (s.subline ? '<span class="wp-hero__kicker">' + UI.esc(s.subline) + '</span>' : '') +
              '<h2 class="wp-hero__title">' + UI.esc(s.headline) + '</h2>' +
              (s.tagline ? '<p class="wp-hero__tagline">' + UI.esc(s.tagline) + '</p>' : '') +
              '<div class="wp-hero__meta">' + UI.icon('map-pin', 15) +
                '<span>' + UI.esc(s.parkName) + (s.address ? ' \u00B7 ' + UI.esc(s.address) : '') + '</span></div>' +
              '<div class="wp-hero__meta">' + UI.icon('clock', 15) +
                '<span>Open ' + UI.esc(s.openTime) + ' \u2013 ' + UI.esc(s.closeTime) +
                ' \u00B7 entry every ' + s.slotMinutes + ' min</span></div>' +
              (data.bestSaving
                ? '<div class="wp-hero__save">' + UI.icon('tag', 16) +
                  '<span>Save up to ' + UI.money(data.bestSaving) + ' with a family package</span></div>'
                : '') +
            '</div>' +

            /* Passes the guest already holds, so they can pull one up at the gate. */
            (data.myBookings && data.myBookings.length
              ? '<div class="section">' + UI.sectionHead('Your upcoming visits') +
                  '<div class="wp-mine">' +
                    data.myBookings.map(function (b) {
                      return '<button class="wp-mine__item" data-pass="' + UI.esc(b.id) + '">' +
                        '<div class="wp-mine__text">' +
                          '<strong>' + UI.esc(b.packageName || 'Day pass') + '</strong>' +
                          '<span>' + UI.esc(b.dateLabel) + ' \u00B7 ' + UI.esc(b.timeLabel) +
                            ' \u00B7 ' + b.guests.total + ' guest(s)</span>' +
                        '</div>' +
                        '<span class="wp-mine__ref">' + UI.esc(b.reference) + '</span>' +
                        UI.icon('chevron-right', 20) +
                      '</button>';
                    }).join('') +
                  '</div>' +
                '</div>'
              : '') +

            // ── Packages ──
            (packages.length
              ? '<div class="section">' +
                  UI.sectionHead('All-in-one packages') +
                  '<div class="wp-packs">' +
                    packages.map(function (p) {
                      return '<article class="card wp-pack-card">' +
                        '<div class="wp-pack-card__top">' +
                          '<span class="wp-pack-card__code">' + UI.esc(p.code || '\u2605') + '</span>' +
                          '<div class="wp-pack-card__id">' +
                            '<h3 class="wp-pack-card__name">' + UI.esc(p.name) + '</h3>' +
                            (p.composition
                              ? '<span class="wp-pack-card__sub">' + UI.esc(p.composition) + '</span>'
                              : '<span class="wp-pack-card__sub">' + p.guests + ' guest(s)</span>') +
                          '</div>' +
                          (p.badge ? '<span class="wp-pack-card__badge">' + UI.esc(p.badge) + '</span>' : '') +
                        '</div>' +

                        breakupTable(p) +

                        '<div class="wp-deal">' +
                          '<div class="wp-deal__price">' +
                            '<span class="wp-deal__label">Package price</span>' +
                            '<strong class="wp-deal__value">' + UI.money(p.price) + '</strong>' +
                            '<span class="wp-deal__only">only</span>' +
                          '</div>' +
                          (p.saving
                            ? '<div class="wp-deal__save">' +
                              '<span class="wp-deal__label">You save</span>' +
                              '<strong class="wp-deal__value">' + UI.money(p.saving) + '</strong>' +
                              '<span class="wp-deal__only">' + p.savingPercent + '% off</span>' +
                            '</div>'
                            : '') +
                        '</div>' +

                        '<button class="btn" data-book="' + UI.esc(p.id) + '">' +
                          'Book ' + UI.esc(p.name) + ' \u00B7 ' + UI.money(p.price) + '</button>' +
                      '</article>';
                    }).join('') +
                  '</div>' +
                '</div>'
              : '') +

            // ── Per-person ──
            (s.allowIndividual !== false
              ? '<div class="section">' +
                  '<div class="card wp-own">' +
                    '<div class="wp-own__head">' + UI.icon('user', 20) +
                      '<div><strong>Going on your own terms?</strong>' +
                      '<span>Build the day person by person \u2014 pick exactly what each guest wants ' +
                        'and pay only for that.</span></div>' +
                    '</div>' +
                    (data.notices.individual ? noticeBanner(data.notices.individual) : '') +
                    '<button class="btn-outline btn-outline--lg" data-action="build-own">' +
                      UI.icon('plus', 18) + ' Build my own day</button>' +
                  '</div>' +
                '</div>'
              : '') +

            // ── What's included ──
            ((data.catalogue.inclusions || []).length
              ? '<div class="section">' + UI.sectionHead("What's included") +
                  '<div class="wp-incl">' +
                    data.catalogue.inclusions.map(function (label) {
                      return '<div class="wp-incl-item">' +
                        '<span class="wp-incl-item__icon">' + UI.icon(iconFor(label), 22) + '</span>' +
                        '<span class="wp-incl-item__label">' + UI.esc(label) + '</span>' +
                      '</div>';
                    }).join('') +
                  '</div>' +
                  (s.validityNote
                    ? '<p class="wp-note">' + UI.icon('info', 15) + ' ' + UI.esc(s.validityNote) + '</p>'
                    : '') +
                '</div>'
              : '') +

            // ── Add-ons ──
            (addOns.length
              ? '<div class="section">' + UI.sectionHead('Make the day extra special') +
                  '<div class="wp-addons">' +
                    addOns.map(function (a) {
                      return '<div class="wp-addon">' +
                        '<span class="wp-addon__icon">' + UI.icon(iconFor(a.label), 20) + '</span>' +
                        '<div class="wp-addon__text">' +
                          '<strong>' + UI.esc(a.label) + '</strong>' +
                          (a.note ? '<span>' + UI.esc(a.note) + '</span>' : '') +
                        '</div>' +
                        '<span class="wp-addon__price">' + UI.money(a.price) + '</span>' +
                      '</div>';
                    }).join('') +
                  '</div>' +
                  '<p class="wp-note">' + UI.icon('info', 15) +
                    ' Add any of these while you book, for a package or a per-person day.</p>' +
                '</div>'
              : '') +

            '<div class="section">' +
              '<div class="card wp-contact">' +
                '<div><strong>Questions before you book?</strong>' +
                  '<span>' + UI.esc(s.parkName) + (s.address ? ' \u00B7 ' + UI.esc(s.address) : '') + '</span></div>' +
                (s.phone
                  ? '<a class="btn-outline" href="' + telHref(s.phone) + '">' +
                    UI.icon('phone', 17) + ' ' + UI.esc(s.phone) + '</a>'
                  : '') +
              '</div>' +
            '</div>' +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        'build-own': function () { App.navigate('/waterpark/book?mode=individual'); },
      });

      view.addEventListener('click', function (event) {
        var book = event.target.closest('[data-book]');
        if (book) {
          App.navigate('/waterpark/book?mode=package&package=' + encodeURIComponent(book.getAttribute('data-book')));
          return;
        }
        var pass = event.target.closest('[data-pass]');
        if (pass) App.navigate('/waterpark/pass/' + pass.getAttribute('data-pass'));
      });

      return view;
    },
  };

  // ── Booking ───────────────────────────────────────────────────────────────
  window.Screens.waterparkBook = {
    tab: 'waterpark',
    auth: true,
    backTo: '/waterpark',
    render: async function (params, query) {
      var data = await API.waterpark();
      var s = data.settings;
      var packages = data.catalogue.packages;
      var items = data.catalogue.items;
      var addOns = data.catalogue.addOns;

      if (s.active === false) {
        return closedScreen(s.headline || 'Water Park',
          'Online booking is switched off right now. Please buy your tickets at the gate.');
      }

      var wantIndividual = (query && query.mode) === 'individual' && s.allowIndividual !== false;
      if (!packages.length && s.allowIndividual === false) {
        return closedScreen(s.headline || 'Water Park', 'There is nothing on sale right now.');
      }

      var state = {
        mode: wantIndividual || !packages.length ? 'individual' : 'package',
        packageId: (query && query.package) || (packages[0] && packages[0].id) || null,
        packageQty: 1,
        extras: {},
        lines: {},
        addOns: {},
        date: data.today,
        time: null,
        slots: data.slots || [],
        offerCode: '',
        payment: 'upi',
        quote: null,
        error: null,
        seq: 0,
      };
      if (state.packageId && !packages.some(function (p) { return p.id === state.packageId; })) {
        state.packageId = packages[0] ? packages[0].id : null;
      }

      /* Late in the day every slot for today has gone. Roll on to the next
         bookable date rather than opening on a date with nothing to pick. */
      if (!state.slots.length && s.advanceDays > 0) {
        state.date = addDays(data.today, 1);
        try {
          state.slots = (await API.waterparkSlots(state.date)).slots;
        } catch (_e) { state.slots = []; }
      }
      var firstOpen = state.slots.filter(function (slot) { return !slot.full; })[0];
      state.time = firstOpen ? firstOpen.time : null;

      function currentPackage() {
        return packages.filter(function (p) { return p.id === state.packageId; })[0] || null;
      }

      function qtyMap(map) {
        return Object.keys(map)
          .filter(function (id) { return map[id] > 0; })
          .map(function (id) { return { itemId: id, qty: map[id] }; });
      }

      function addOnList() {
        return Object.keys(state.addOns)
          .filter(function (id) { return state.addOns[id] > 0; })
          .map(function (id) { return { id: id, qty: state.addOns[id] }; });
      }

      /** The payload every quote and the final payment are built from. */
      function orderPayload() {
        var order = {
          mode: state.mode,
          date: state.date,
          time: state.time || undefined,
          addOns: addOnList(),
        };
        if (state.offerCode) order.offerCode = state.offerCode;
        if (state.mode === 'package') {
          order.packageId = state.packageId;
          order.packageQty = state.packageQty;
          order.extras = qtyMap(state.extras);
        } else {
          order.lines = qtyMap(state.lines);
        }
        return order;
      }

      // ── Markup ──
      function modeChips() {
        if (!packages.length || s.allowIndividual === false) return '';
        return '<div class="chips wp-modes">' +
          '<button class="chip" data-mode="package" aria-pressed="' + (state.mode === 'package') + '">' +
            'Family packages</button>' +
          '<button class="chip" data-mode="individual" aria-pressed="' + (state.mode === 'individual') + '">' +
            'Per person</button>' +
        '</div>';
      }

      function packagePicker() {
        if (packages.length < 2) return '';
        return '<div class="chips">' + packages.map(function (p) {
          return '<button class="chip" data-pack="' + UI.esc(p.id) + '"' +
            ' aria-pressed="' + (p.id === state.packageId) + '">' +
            (p.code ? UI.esc(p.code) + ' \u00B7 ' : '') + UI.esc(p.name) + '</button>';
        }).join('') + '</div>';
      }

      function packageSection() {
        var pkg = currentPackage();
        if (!pkg) return '<div class="section">' + noticeBanner('No packages are on sale right now.', 'warn') + '</div>';
        return '<div class="section">' +
          UI.sectionHead('Your package') +
          packagePicker() +
          '<article class="card wp-pack-card wp-pack-card--compact">' +
            '<div class="wp-pack-card__top">' +
              '<span class="wp-pack-card__code">' + UI.esc(pkg.code || '\u2605') + '</span>' +
              '<div class="wp-pack-card__id">' +
                '<h3 class="wp-pack-card__name">' + UI.esc(pkg.name) + '</h3>' +
                '<span class="wp-pack-card__sub">' + UI.esc(pkg.composition || pkg.guests + ' guest(s)') + '</span>' +
              '</div>' +
            '</div>' +
            breakupTable(pkg) +
            '<div class="wp-deal">' +
              '<div class="wp-deal__price"><span class="wp-deal__label">Package price</span>' +
                '<strong class="wp-deal__value">' + UI.money(pkg.price) + '</strong></div>' +
              (pkg.saving
                ? '<div class="wp-deal__save"><span class="wp-deal__label">You save</span>' +
                  '<strong class="wp-deal__value">' + UI.money(pkg.saving) + '</strong></div>'
                : '') +
            '</div>' +
            '<div class="stepper-row">' +
              '<div><div class="stepper-row__label">How many of this package</div>' +
                '<div class="stepper-row__hint">Up to ' + s.maxPackagesPerBooking + ' per booking</div></div>' +
              '<div class="wp-row" data-packqty style="padding:0;border:0">' +
                '<div class="stepper">' +
                  '<button data-minus aria-label="Fewer packages"' + (state.packageQty > 1 ? '' : ' disabled') + '>' +
                    UI.icon('minus', 16) + '</button>' +
                  '<span data-count>' + state.packageQty + '</span>' +
                  '<button data-plus aria-label="More packages">' + UI.icon('plus', 16) + '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</article>' +

          '<details class="wp-extras">' +
            '<summary>Bringing someone else, or want more?</summary>' +
            '<p class="wp-note">Anything added here is charged at the normal counter rate, on top of the package.</p>' +
            items.map(function (i) {
              return stepperRow('extra', i.id, i.label, unitNote(i), state.extras[i.id] || 0, i.rate);
            }).join('') +
          '</details>' +
        '</div>';
      }

      function individualSection() {
        var guests = state.quote ? state.quote.guests : null;
        return '<div class="section">' +
          UI.sectionHead('Build your day') +
          '<p class="wp-note">' + UI.icon('info', 15) +
            ' Every line is yours to set. Start with an entry ticket for each guest \u2014 that is what gets ' +
            'you through the gate \u2014 then add only what they actually want.</p>' +
          '<div class="card wp-lines">' +
            items.map(function (i) {
              return stepperRow('line', i.id, i.label + (i.entry ? '' : ''),
                unitNote(i) + (i.entry ? ' \u00B7 gate entry' : ''), state.lines[i.id] || 0, i.rate);
            }).join('') +
          '</div>' +
          (guests && guests.total
            ? '<p class="wp-note">' + UI.icon('users', 15) + ' ' + guests.total + ' guest(s) \u00B7 ' +
              guests.adults + ' adult(s), ' + guests.children + ' child(ren)</p>'
            : '') +
        '</div>';
      }

      function slotsMarkup() {
        if (!state.slots.length) {
          return noticeBanner('No entry slots left on this date \u2014 please pick another day.', 'warn');
        }
        return '<div class="chips wp-slots">' + state.slots.map(function (slot) {
          return '<button class="chip" data-slot="' + UI.esc(slot.time) + '"' +
            (slot.full ? ' disabled' : '') +
            ' aria-pressed="' + (slot.time === state.time) + '">' +
            UI.esc(slot.label) +
            '<small>' + (slot.full ? 'full' : slot.seatsLeft + ' left') + '</small>' +
          '</button>';
        }).join('') + '</div>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: state.mode === 'individual' ? 'Build your day' : 'Book your day', back: true }) +
          '<div class="scroll">' +

            modeChips() +

            '<div class="section">' +
              UI.sectionHead('When are you visiting?') +
              '<div class="field"><label class="field__label" for="wp-date">Visit date</label>' +
                '<div class="field__control">' + UI.icon('calendar', 19) +
                  '<input id="wp-date" type="date" data-wp-date value="' + UI.esc(state.date) + '"' +
                    ' min="' + UI.esc(data.today) + '"' +
                    ' max="' + UI.esc(addDays(data.today, s.advanceDays)) + '"></div></div>' +
              '<div data-slots-host>' + slotsMarkup() + '</div>' +
            '</div>' +

            '<div data-order-host>' +
              (state.mode === 'package' ? packageSection() : individualSection()) +
            '</div>' +

            (addOns.length
              ? '<div class="section">' + UI.sectionHead('Add-ons') +
                  '<div class="card wp-lines">' +
                    addOns.map(function (a) {
                      return stepperRow('addon', a.id, addOnName(a), UI.money(a.price) + ' each',
                        state.addOns[a.id] || 0, a.price);
                    }).join('') +
                  '</div>' +
                '</div>'
              : '') +

            '<div class="section">' +
              '<div class="field"><label class="field__label" for="wp-offer">Offer code</label>' +
                '<div class="field__control">' + UI.icon('tag', 19) +
                  '<input id="wp-offer" type="text" data-wp-offer placeholder="Optional" autocapitalize="characters"></div></div>' +
              '<div data-offer-note></div>' +
            '</div>' +

            '<div class="section">' + UI.sectionHead('Payment method') +
              '<div class="options">' +
                PAY_METHODS.map(function (m) {
                  return '<button class="option" data-action="method" data-id="' + m.id + '"' +
                    ' aria-pressed="' + (m.id === state.payment ? 'true' : 'false') + '">' +
                    '<span class="option__icon">' + UI.icon(m.icon, 20) + '</span>' +
                    '<span class="option__text"><span class="option__title">' + m.label + '</span>' +
                      '<span class="option__sub">' + m.sub + '</span></span>' +
                    '<span class="option__radio"></span></button>';
                }).join('') +
              '</div>' +
            '</div>' +

            '<div class="section">' + UI.sectionHead('Summary') +
              '<div class="card" data-bill-host></div>' +
            '</div>' +

            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label">You pay</div>' +
              '<div class="actionbar__value" data-wp-total>\u2014</div>' +
            '</div>' +
            '<button class="btn" data-action="pay" disabled>Pay &amp; get pass</button>' +
          '</div>' +
        '</div>'
      );

      var slotsHost = view.querySelector('[data-slots-host]');
      var orderHost = view.querySelector('[data-order-host]');
      var billHost = view.querySelector('[data-bill-host]');
      var totalEl = view.querySelector('[data-wp-total]');
      var payBtn = view.querySelector('[data-action="pay"]');
      var offerNote = view.querySelector('[data-offer-note]');
      var dateInput = view.querySelector('[data-wp-date]');
      var offerInput = view.querySelector('[data-wp-offer]');

      // ── Rendering ──
      function renderSlots() {
        slotsHost.innerHTML = slotsMarkup();
      }

      function renderOrder() {
        orderHost.innerHTML = state.mode === 'package' ? packageSection() : individualSection();
      }

      /** Repaints one stepper row in place, so the whole list is not rebuilt. */
      function refreshRow(row, qty) {
        var price = Number(row.getAttribute('data-price')) || 0;
        row.querySelector('[data-count]').textContent = qty;
        var value = row.querySelector('[data-row-value]');
        if (value) value.textContent = qty ? UI.money(price * qty) : '';
        var minus = row.querySelector('[data-minus]');
        if (minus) minus.disabled = qty <= 0;
      }

      function renderBill() {
        var q = state.quote;
        if (state.error) {
          billHost.innerHTML = '<div class="wp-bill__hint">' + UI.esc(state.error) + '</div>';
          totalEl.textContent = '\u2014';
          payBtn.disabled = true;
          return;
        }
        if (!q) {
          billHost.innerHTML = '<div class="wp-bill__hint">Add what you want and your total appears here.</div>';
          totalEl.textContent = '\u2014';
          payBtn.disabled = true;
          return;
        }

        var a = q.amounts;
        billHost.innerHTML =
          '<div class="kv"><span class="kv__key">' +
            (q.mode === 'package'
              ? UI.esc((q.package && q.package.name) || 'Package') +
                (q.package && q.package.qty > 1 ? ' \u00D7' + q.package.qty : '')
              : 'Day out for ' + q.guests.total + ' guest(s)') +
            '</span><span class="kv__val">' + UI.money(a.baseAmount) + '</span></div>' +
          (a.addOnAmount
            ? '<div class="kv"><span class="kv__key">Add-ons</span>' +
              '<span class="kv__val">' + UI.money(a.addOnAmount) + '</span></div>'
            : '') +
          (a.offerDiscount
            ? '<div class="kv kv--discount"><span class="kv__key">Coupon ' + UI.esc(a.offerCode || '') + '</span>' +
              '<span class="kv__val">- ' + UI.money(a.offerDiscount) + '</span></div>'
            : '') +
          (a.convenienceFee
            ? '<div class="kv"><span class="kv__key">Booking fee</span>' +
              '<span class="kv__val">' + UI.money(a.convenienceFee) + '</span></div>'
            : '') +
          (a.gst
            ? '<div class="kv"><span class="kv__key">Taxes</span>' +
              '<span class="kv__val">' + UI.money(a.gst) + '</span></div>'
            : '') +
          '<div class="kv kv--total"><span class="kv__key">You pay</span>' +
            '<span class="kv__val">' + UI.money(a.total) + '</span></div>' +
          (a.totalSaving
            ? '<div class="wp-bill__save">' + UI.icon('tag', 16) +
              ' You save ' + UI.money(a.totalSaving) + ' against buying it all separately' +
              (a.actualValue ? ' (worth ' + UI.money(a.actualValue + a.addOnAmount) + ')' : '') + '</div>'
            : '') +
          (q.notice ? noticeBanner(q.notice) : '') +
          (q.slotWarning ? noticeBanner(q.slotWarning, 'warn') : '');

        totalEl.textContent = UI.money(a.total);
        payBtn.disabled = !state.time || !q.guests.total;
      }

      /**
       * Server-priced, debounced, and guarded by a sequence number so a slow
       * earlier response can never overwrite a newer one.
       */
      var quoteTimer = null;
      function quote() {
        clearTimeout(quoteTimer);
        quoteTimer = setTimeout(async function () {
          var mine = ++state.seq;
          try {
            var res = await API.waterparkQuote(orderPayload());
            if (mine !== state.seq || !document.body.contains(view)) return;
            state.quote = res;
            state.error = null;
            if (state.offerCode) {
              offerNote.innerHTML = res.offerRejected
                ? noticeBanner('That code cannot be used on this booking.', 'warn')
                : noticeBanner('Code ' + state.offerCode + ' applied.');
            } else {
              offerNote.innerHTML = '';
            }
          } catch (err) {
            if (mine !== state.seq || !document.body.contains(view)) return;
            state.quote = null;
            state.error = err.message;
          }
          renderBill();
          /* The guest count only becomes known once the server has resolved the
             order, so the per-person summary line is refreshed with it. */
          if (state.mode === 'individual') {
            var note = orderHost.querySelector('.wp-note:last-of-type');
            if (note && state.quote && state.quote.guests.total) {
              note.innerHTML = UI.icon('users', 15) + ' ' + state.quote.guests.total + ' guest(s) \u00B7 ' +
                state.quote.guests.adults + ' adult(s), ' + state.quote.guests.children + ' child(ren)';
            }
          }
        }, 240);
      }

      async function reloadSlots() {
        slotsHost.innerHTML = '<div class="wp-slots__loading">' + UI.icon('clock', 16) + ' Checking availability\u2026</div>';
        try {
          var res = await API.waterparkSlots(state.date);
          state.slots = res.slots;
        } catch (err) {
          state.slots = [];
          UI.toast(err.message, 'error');
        }
        var open = state.slots.filter(function (slot) { return !slot.full; });
        // Keep the chosen time if it survives, otherwise fall back to the first
        // slot that still has room.
        if (!state.time || !open.some(function (slot) { return slot.time === state.time; })) {
          state.time = open.length ? open[0].time : null;
        }
        renderSlots();
        quote();
      }

      // ── Interaction ──
      dateInput.addEventListener('change', function () {
        if (!dateInput.value) return;
        state.date = dateInput.value;
        reloadSlots();
      });

      offerInput.addEventListener('input', function () {
        state.offerCode = offerInput.value.trim().toUpperCase();
        quote();
      });

      view.addEventListener('click', function (event) {
        var mode = event.target.closest('[data-mode]');
        if (mode) {
          var next = mode.getAttribute('data-mode');
          if (next === state.mode) return;
          state.mode = next;
          view.querySelectorAll('[data-mode]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', String(btn.getAttribute('data-mode') === next));
          });
          renderOrder();
          quote();
          return;
        }

        var pack = event.target.closest('[data-pack]');
        if (pack) {
          state.packageId = pack.getAttribute('data-pack');
          state.packageQty = 1;
          renderOrder();
          quote();
          return;
        }

        var slot = event.target.closest('[data-slot]');
        if (slot && !slot.disabled) {
          state.time = slot.getAttribute('data-slot');
          view.querySelectorAll('[data-slot]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', String(btn.getAttribute('data-slot') === state.time));
          });
          quote();
          return;
        }

        var step = event.target.closest('[data-plus], [data-minus]');
        if (!step) return;
        var delta = step.hasAttribute('data-plus') ? 1 : -1;

        var qtyRow = step.closest('[data-packqty]');
        if (qtyRow) {
          var nextQty = Math.min(s.maxPackagesPerBooking, Math.max(1, state.packageQty + delta));
          if (nextQty === state.packageQty) return;
          state.packageQty = nextQty;
          qtyRow.querySelector('[data-count]').textContent = nextQty;
          qtyRow.querySelector('[data-minus]').disabled = nextQty <= 1;
          quote();
          return;
        }

        var row = step.closest('[data-line], [data-extra], [data-addon]');
        if (!row) return;
        var bucket = row.hasAttribute('data-line') ? state.lines
          : row.hasAttribute('data-extra') ? state.extras
          : state.addOns;
        var key = row.getAttribute('data-line') || row.getAttribute('data-extra') || row.getAttribute('data-addon');
        var max = Number(row.getAttribute('data-max')) || 99;
        var value = Math.min(max, Math.max(0, (bucket[key] || 0) + delta));
        if (value === (bucket[key] || 0)) return;
        bucket[key] = value;
        refreshRow(row, value);
        quote();
      });

      UI.actions(view, {
        method: function (btn) {
          state.payment = btn.getAttribute('data-id');
          view.querySelectorAll('[data-action="method"]').forEach(function (b) {
            b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === state.payment));
          });
        },
        pay: async function () {
          if (!state.time) { UI.toast('Pick an entry time first', 'error'); return; }
          payBtn.disabled = true;
          var label = payBtn.textContent;
          payBtn.textContent = 'Booking\u2026';
          try {
            var res = await API.bookWaterpark(Object.assign(orderPayload(), {
              payment: { method: state.payment },
              guestName: (Store.user && Store.user.name) || '',
              guestPhone: (Store.user && Store.user.phone) || '',
            }));
            App.navigate('/waterpark/pass/' + res.booking.id, { replace: true });
          } catch (err) {
            UI.toast(err.message, 'error');
            payBtn.disabled = false;
            payBtn.textContent = label;
            // A 409 means the slot filled while they were deciding.
            if (err.status === 409) reloadSlots();
          }
        },
      });

      renderBill();
      quote();
      return view;
    },
  };

  // ── The pass ──────────────────────────────────────────────────────────────
  window.Screens.waterparkPass = {
    tab: 'waterpark',
    auth: true,
    backTo: '/waterpark',
    render: async function (params) {
      var res = await API.waterparkBooking(params.id);
      var b = res.booking;
      var a = b.amounts;
      var cancelled = b.status === 'cancelled';

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Your day pass', back: true }) +
          '<div class="scroll">' +

            '<div class="wp-pass' + (cancelled ? ' wp-pass--void' : '') + '">' +
              '<div class="wp-pass__head">' +
                '<span class="wp-pass__label">' +
                  (cancelled ? 'Cancelled' : b.checkedInAt ? 'Checked in' : 'Confirmed') + '</span>' +
                '<h2 class="wp-pass__title">' + UI.esc(b.packageName || 'Water park day pass') + '</h2>' +
                '<p class="wp-pass__when">' + UI.esc(b.dateLabel) + ' \u00B7 entry at ' + UI.esc(b.timeLabel) + '</p>' +
              '</div>' +
              /* text=0 drops the barcode's own caption — the reference is
                 printed once below it, larger and easier to read out. */
              '<div class="wp-pass__code">' +
                '<img src="' + UI.esc(b.passUrl) + '?text=0" alt="Pass barcode ' + UI.esc(b.reference) + '">' +
                '<span class="wp-pass__ref">' + UI.esc(b.reference) + '</span>' +
              '</div>' +
              '<div class="wp-pass__facts">' +
                '<div><span>Guests</span><strong>' + b.guests.total + '</strong></div>' +
                '<div><span>Adults</span><strong>' + b.guests.adults + '</strong></div>' +
                '<div><span>Children</span><strong>' + b.guests.children + '</strong></div>' +
              '</div>' +
            '</div>' +

            (cancelled ? noticeBanner('This pass was cancelled and cannot be used at the gate.', 'warn') : '') +
            (!cancelled && b.notice ? noticeBanner(b.notice) : '') +

            '<div class="section">' + UI.sectionHead("What's on the pass") +
              '<div class="card">' +
                '<table class="wp-brk">' +
                  '<thead><tr><th>Particulars</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Value</th></tr></thead>' +
                  '<tbody>' +
                    (b.lines || []).map(function (l) {
                      return '<tr><td>' + UI.esc(l.label) + '</td>' +
                        '<td class="num">' + l.qty + '</td>' +
                        '<td class="num">' + UI.money(l.rate) + '</td>' +
                        '<td class="num">' + UI.money(l.value) + '</td></tr>';
                    }).join('') +
                  '</tbody>' +
                '</table>' +
                ((b.addOns || []).length
                  ? '<div class="wp-pass__addons">' +
                    b.addOns.map(function (x) {
                      return '<div class="kv"><span class="kv__key">' + UI.esc(addOnName(x)) +
                        ' \u00D7' + x.qty + '</span>' +
                        '<span class="kv__val">' + UI.money(x.value) + '</span></div>';
                    }).join('') +
                    '</div>'
                  : '') +
              '</div>' +
            '</div>' +

            '<div class="section">' + UI.sectionHead('Payment') +
              '<div class="card">' +
                '<div class="kv"><span class="kv__key">Day out</span>' +
                  '<span class="kv__val">' + UI.money(a.baseAmount) + '</span></div>' +
                (a.addOnAmount
                  ? '<div class="kv"><span class="kv__key">Add-ons</span>' +
                    '<span class="kv__val">' + UI.money(a.addOnAmount) + '</span></div>'
                  : '') +
                (a.offerDiscount
                  ? '<div class="kv kv--discount"><span class="kv__key">Coupon ' + UI.esc(a.offerCode || '') + '</span>' +
                    '<span class="kv__val">- ' + UI.money(a.offerDiscount) + '</span></div>'
                  : '') +
                (a.convenienceFee
                  ? '<div class="kv"><span class="kv__key">Booking fee</span>' +
                    '<span class="kv__val">' + UI.money(a.convenienceFee) + '</span></div>'
                  : '') +
                (a.gst
                  ? '<div class="kv"><span class="kv__key">Taxes</span>' +
                    '<span class="kv__val">' + UI.money(a.gst) + '</span></div>'
                  : '') +
                '<div class="kv kv--total"><span class="kv__key">Paid</span>' +
                  '<span class="kv__val">' + UI.money(a.total) + '</span></div>' +
                '<div class="kv"><span class="kv__key">Method</span>' +
                  '<span class="kv__val">' + UI.esc((b.payment && b.payment.methodLabel) || '\u2014') +
                  (b.payment && b.payment.status === 'pending' ? ' (due at the gate)' : '') + '</span></div>' +
                (a.totalSaving
                  ? '<div class="wp-bill__save">' + UI.icon('tag', 16) +
                    ' You saved ' + UI.money(a.totalSaving) + '</div>'
                  : '') +
              '</div>' +
            '</div>' +

            (!cancelled
              ? '<div class="section">' +
                  '<button class="btn-outline" data-action="cancel">Cancel this pass</button>' +
                  '<p class="wp-note">' + UI.icon('info', 15) +
                    ' A pass can be cancelled up to the day before your visit.</p>' +
                '</div>'
              : '') +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        cancel: async function () {
          var ok = await UI.confirm({
            title: 'Cancel this pass?',
            message: 'Your entry slot is released and the pass can no longer be used.',
            confirmLabel: 'Cancel pass',
            danger: true,
          });
          if (!ok) return;
          try {
            await API.cancelWaterparkBooking(b.id);
            UI.toast('Pass cancelled', 'success');
            App.render();
          } catch (err) { UI.toast(err.message, 'error'); }
        },
      });

      return view;
    },
  };
})();
