/* Dine-In tab — reserve a table, then settle the restaurant bill from your seat
   and take the instant discount.

   Two tiers, and the server decides which one applies:
     · reserved — a reservation held for at least `lockMinutes` (30 by default)
       bills at the higher rate (30% by default). Billing against a reservation
       is LOCKED until that window passes, so booking a table while already
       sitting at it cannot buy the bigger discount. This screen shows the
       countdown and unlocks itself when it reaches zero.
     · walk-in — no reservation, bills instantly at the lower rate (10%) and the
       guest is shown the "book ahead next time" notice.

   Every percentage and every line of notice copy comes from the API, which reads
   it from admin-editable settings — nothing here hardcodes a discount or a
   message, so changing them in the admin panel changes this screen. */
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

  function noticeBanner(text, kind, style) {
    if (!text) return '';
    return '<div class="notice' + (kind === 'warn' ? ' notice--warn' : '') + '"' +
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

  // ── Dine-In home ──────────────────────────────────────────────────────────
  window.Screens.dineIn = {
    tab: 'dinein',
    render: async function () {
      var data = await API.dineIn();
      var s = data.settings;
      var reserved = data.tiers.reserved;
      var walkin = data.tiers.walkin;
      var current = data.current;
      var reservation = data.reservation;

      if (s.active === false) {
        return UI.h(
          '<div class="screen">' + UI.appbar({ title: 'Dine-In' }) +
            '<div class="scroll">' +
              UI.empty({ icon: 'dine', title: 'Dine-In is closed', text: 'In-app billing is switched off right now. Please pay at the counter.' }) +
            '</div></div>'
        );
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Dine-In' }) +
          '<div class="scroll">' +

            UI.propertyHero(Object.assign({}, s, {
              name: s.restaurantName,
              location: s.address,
            })) +

            (s.tagline ? '<p class="hotel-tagline">' + UI.esc(s.tagline) + '</p>' : '') +

            '<div class="dine-hero">' +
              '<div class="dine-hero__meta">' + UI.icon('clock', 15) +
                '<span>Open ' + UI.esc(s.openTime) + ' – ' + UI.esc(s.closeTime) + '</span></div>' +
              '<div class="dine-hero__actions">' +
                '<button class="dine-hero__btn dine-hero__btn--solid" data-action="reserve">' +
                  UI.icon('calendar', 17) + 'Reserve a table</button>' +
                '<button class="dine-hero__btn" data-action="pay">' +
                  UI.icon('wallet', 17) + 'Pay bill</button>' +
              '</div>' +
            '</div>' +

            /* The two tiers, straight from the admin's live settings. */
            '<div class="dine-tiers">' +
              '<div class="dine-tier dine-tier--best">' +
                '<span class="dine-tier__flag">Best deal</span>' +
                '<span class="dine-tier__off">' + reserved.discountPercent + '% OFF</span>' +
                '<span class="dine-tier__label">With a reservation</span>' +
                '<span class="dine-tier__hint">Book at least ' + reserved.lockMinutes +
                  ' min before you arrive, then pay in the app.</span>' +
              '</div>' +
              '<div class="dine-tier dine-tier--plain">' +
                '<span class="dine-tier__off">' + walkin.discountPercent + '% OFF</span>' +
                '<span class="dine-tier__label">Walk in &amp; pay</span>' +
                '<span class="dine-tier__hint">No booking needed — pay your bill instantly.</span>' +
              '</div>' +
            '</div>' +

            (data.signedIn ? '' : signInPrompt(
              'Sign in to reserve a table and pay your bill with an instant discount.')) +

            /* Live reservation + its billing lock. */
            (reservation
              ? '<div class="card dine-res" data-res>' +
                  '<div class="dine-res__head">' +
                    '<div>' +
                      '<div class="dine-res__when">' + UI.esc(slotLabel(reservation)) + '</div>' +
                      '<div class="dine-res__meta">' + UI.esc(partyLine(reservation)) + '</div>' +
                      '<div class="dine-res__ref">' + UI.esc(reservation.reference) + '</div>' +
                    '</div>' +
                    '<span class="status-pill status-pill--confirmed">Reserved</span>' +
                  '</div>' +
                  '<div class="dine-lock" data-lock>' +
                    UI.icon('lock', 20) +
                    '<span class="dine-lock__text">' +
                      '<span class="dine-lock__title" data-lock-title></span>' +
                      '<span class="dine-lock__sub" data-lock-sub></span>' +
                    '</span>' +
                    '<span class="dine-lock__clock" data-lock-clock></span>' +
                  '</div>' +
                  '<div style="height:12px"></div>' +
                  '<button class="btn" data-action="pay" data-pay-btn>Pay bill with ' +
                    reserved.discountPercent + '% off</button>' +
                  '<div style="height:8px"></div>' +
                  '<button class="btn-outline" data-action="cancel-res">Cancel reservation</button>' +
                '</div>'
              : '') +

            noticeBanner(current.notice, current.noticeKind) +

            /* Past bills, so the savings are visible over time. */
            (data.recentBills && data.recentBills.length
              ? '<div class="section">' +
                  UI.sectionHead('Recent bills') +
                  '<div class="card" style="padding:4px 16px">' +
                    data.recentBills.map(function (b) {
                      return '<button class="dine-bill-row" data-action="receipt" data-id="' + UI.esc(b.id) + '" style="width:100%;text-align:left">' +
                        '<span class="dine-bill-row__text">' +
                          '<span class="dine-bill-row__title">' + UI.esc(b.restaurantName || s.restaurantName) + '</span>' +
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

            (s.phone
              ? '<div class="section">' +
                  '<a class="card exp-call" href="' + telHref(s.phone) + '">' +
                    '<span class="exp-call__icon">' + UI.icon('phone', 22) + '</span>' +
                    '<span class="exp-call__text"><strong>Call the restaurant</strong>' +
                      '<span>' + UI.esc(s.phone) + '</span></span>' +
                    '<span class="exp-call__arrow">' + UI.icon('arrow-right', 18) + '</span>' +
                  '</a></div>'
              : '') +

            UI.propertyExtras(s) +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      /* Countdown: re-renders the lock row each second and flips the pay button
         on by itself the moment the window opens, with no reload needed. */
      if (reservation) {
        var lockRow = view.querySelector('[data-lock]');
        var titleEl = view.querySelector('[data-lock-title]');
        var subEl = view.querySelector('[data-lock-sub]');
        var clockEl = view.querySelector('[data-lock-clock]');
        var payBtn = view.querySelector('[data-pay-btn]');
        var deadline = new Date(reservation.lock.unlocksAt).getTime();

        everySecond(view, function () {
          var secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          if (secondsLeft > 0) {
            lockRow.classList.remove('dine-lock--open');
            titleEl.textContent = 'Billing locked';
            subEl.textContent = 'Your ' + reserved.discountPercent + '% discount unlocks at ' +
              reservation.lock.unlockLabel + '.';
            clockEl.textContent = mmss(secondsLeft);
            payBtn.disabled = true;
            payBtn.textContent = 'Unlocks in ' + mmss(secondsLeft);
          } else {
            lockRow.classList.add('dine-lock--open');
            titleEl.textContent = 'Ready to pay';
            subEl.textContent = 'Your ' + reserved.discountPercent + '% reserved-table discount is active.';
            clockEl.textContent = '';
            payBtn.disabled = false;
            payBtn.textContent = 'Pay bill with ' + reserved.discountPercent + '% off';
          }
        });
      }

      UI.actions(view, {
        reserve: function () { App.navigate('/dine-in/reserve'); },
        pay: function () { App.navigate('/dine-in/bill'); },
        signin: function () { App.navigate('/login'); },
        receipt: function (el) { App.navigate('/dine-in/paid/' + el.getAttribute('data-id')); },
        'cancel-res': async function () {
          var ok = await UI.confirm({
            title: 'Cancel this reservation?',
            message: 'Your table will be released and you will lose the ' +
              reserved.discountPercent + '% in-app billing discount.',
            confirmLabel: 'Cancel reservation',
            cancelLabel: 'Keep it',
            danger: true,
          });
          if (!ok) return;
          try {
            await API.cancelReservation(reservation.id);
            UI.toast('Reservation cancelled');
            App.render();
          } catch (err) { UI.toast(err.message, 'error'); }
        },
      });

      return view;
    },
  };

  // ── Reserve a table ───────────────────────────────────────────────────────
  window.Screens.dineReserve = {
    tab: 'dinein',
    auth: true,
    backTo: '/dine-in',
    render: async function () {
      var data = await API.dineIn();
      var s = data.settings;
      var slotData = await API.dineSlots();

      var state = {
        date: slotData.date,
        time: null,
        partySize: 2,
        area: (s.areas && s.areas[0]) || '',
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
            'No slots left for this date — try another day.</p>';
        }
        return '<div class="chips">' + state.slots.map(function (slot) {
          return '<button class="chip chip--sm" data-action="slot" data-time="' + UI.esc(slot.time) + '"' +
            (slot.full ? ' disabled' : '') +
            ' aria-pressed="' + (slot.time === state.time ? 'true' : 'false') + '">' +
            UI.esc(slot.label) + '</button>';
        }).join('') + '</div>';
      }

      function areaChips() {
        if (!s.areas || !s.areas.length) return '';
        return '<div class="section"><div class="subhead">Seating</div><div class="chips">' +
          s.areas.map(function (area) {
            return '<button class="chip chip--sm" data-action="area" data-area="' + UI.esc(area) + '"' +
              ' aria-pressed="' + (area === state.area ? 'true' : 'false') + '">' + UI.esc(area) + '</button>';
          }).join('') + '</div></div>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Reserve a table', back: true }) +
          '<div class="scroll">' +

            noticeBanner(
              'Book at least ' + s.lockMinutes + ' minutes before you arrive — that is what unlocks ' +
              data.tiers.reserved.discountPercent + '% off when you pay your bill in the app.',
              'info',
              'margin-top:14px'
            ) +

            '<div class="section"><div class="subhead">Date</div>' +
              '<div class="chips" data-dates>' + dateChips() + '</div></div>' +

            '<div class="section"><div class="subhead">Time</div>' +
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
                '<input id="dine-name" type="text" value="' + UI.esc((Store.user && Store.user.name) || '') + '" placeholder="Your name"></div></div>' +

            '<div class="field"><label class="field__label" for="dine-phone">Phone</label>' +
              '<div class="field__control">' + UI.icon('phone', 19) +
                '<input id="dine-phone" type="tel" value="' + UI.esc((Store.user && Store.user.phone) || '') + '" placeholder="Contact number"></div></div>' +

            '<div class="field"><label class="field__label" for="dine-notes">Anything we should know? (optional)</label>' +
              '<div class="field__control">' +
                '<textarea id="dine-notes" placeholder="Birthday, high chair, seating preference..."></textarea></div></div>' +

            '<div class="section"><button class="btn" data-action="confirm">Reserve table</button></div>' +
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
          var fresh = await API.dineSlots(state.date);
          state.slots = fresh.slots;
          state.time = null;
          box.innerHTML = slotChips();
        } catch (err) {
          box.innerHTML = '<p style="padding:0 16px;margin:0;font-size:13px;color:var(--danger)">' +
            UI.esc(err.message) + '</p>';
        }
      }

      UI.actions(view, {
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
              date: state.date,
              time: state.time,
              partySize: state.partySize,
              area: state.area,
              guestName: name,
              guestPhone: view.querySelector('#dine-phone').value.trim(),
              notes: view.querySelector('#dine-notes').value.trim(),
            });
            UI.toast('Table reserved — billing unlocks at ' + res.reservation.lock.unlockLabel, 'success');
            App.navigate('/dine-in');
          } catch (err) {
            UI.toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Reserve table';
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
    render: async function () {
      var data = await API.dineIn();
      var s = data.settings;
      var reservation = data.reservation;

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

            '<div class="dine-amount">' +
              '<div class="dine-amount__label">Enter the total on your restaurant bill</div>' +
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

            /* Tier picker: only meaningful when the guest holds a reservation. */
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
              '<div class="actionbar__label">You pay</div>' +
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
              '<span class="option__title">Use my reservation</span>' +
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
            UI.toast('Your ' + reservedPct + '% reserved-table discount is now active', 'success');
          } else if (!released && modesEl) {
            var sub = modesEl.querySelector('[data-mode-sub]');
            if (sub) sub.textContent = 'Unlocks in ' + mmss(left / 1000);
          }
        });
      }

      renderModes();

      UI.actions(view, {
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
            await API.validateDineOffer({ code: code, billAmount: amount, mode: state.mode || undefined });
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

          btn.disabled = true;
          btn.textContent = 'Paying…';
          try {
            var res = await API.payDineBill({
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

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Bill paid', back: true }) +
          '<div class="scroll">' +

            '<div class="success-hero">' +
              '<div class="success-hero__ring">' + UI.icon('check', 34) + '</div>' +
              '<h2>' + (pending ? 'Show this at the counter' : 'Payment successful') + '</h2>' +
              '<p>You saved ' + UI.money(bill.amounts.discount) + ' on a ' +
                UI.money(bill.amounts.billAmount) + ' bill at ' + UI.esc(bill.restaurantName) + '.</p>' +
            '</div>' +

            '<div class="section">' +
              '<div class="card card__body">' +
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
     have settled in the app. Reached from Account rather than from the Dine-In
     tab, which is for the booking-and-paying flow itself. */
  window.Screens.restaurantBookings = {
    auth: true,
    backTo: '/account',
    render: async function () {
      var res = await Promise.all([API.dineReservations(), API.dineBills()]);
      var reservations = res[0].reservations || [];
      var bills = res[1].bills || [];
      var totalSaved = res[1].totalSaved || 0;

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
              '<p class="ticket__sub">' + UI.esc(partyLine(r)) + '</p>' +
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
              '<p class="ticket__sub">' + UI.esc(UI.shortDate(b.paidAt || b.createdAt)) +
                ' · ' + (b.mode === 'reserved' ? 'Reserved table' : 'Walk-in') +
                ' · ' + b.amounts.discountPercent + '% off</p>' +
              '<p class="ticket__seats">' + UI.esc(b.reference) +
                (b.amounts.discount ? ' · saved ' + UI.money(b.amounts.discount) : '') + '</p>' +
            '</div>' +
            '<span class="row__chevron">' + UI.icon('chevron-right', 20) + '</span>' +
          '</button>' +
        '</article>';
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

            (reservations.length
              ? '<div class="section">' + UI.sectionHead('Table reservations') +
                  '<div class="stack">' + reservations.map(reservationCard).join('') + '</div>' +
                '</div>'
              : '') +

            (bills.length
              ? '<div class="section">' + UI.sectionHead('Bills paid in the app') +
                  (totalSaved
                    ? noticeBanner('You have saved ' + UI.money(totalSaved) + ' on restaurant bills so far.')
                    : '') +
                  '<div class="stack" style="margin-top:12px">' + bills.map(billCard).join('') + '</div>' +
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
