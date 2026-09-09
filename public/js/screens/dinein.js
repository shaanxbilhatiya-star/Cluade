/* Dine-In tab — restaurant billing with two discount tiers.

   Reserve a table and your bill earns the higher discount, but only once the
   table has been booked for the configured waiting period; until then billing
   is locked and a live countdown is shown. Walk in without a reservation and
   you can pay straight away at the lower rate, with a notice nudging you to
   reserve ahead next time.

   Every number and every line of notice copy comes from the server
   (/api/dinein), which renders it from the admin's current settings — this
   screen never hard-codes a percentage. */
(function () {
  'use strict';

  var DAYS_AHEAD = 7;

  function telHref(phone) { return 'tel:' + String(phone).replace(/\s+/g, ''); }

  /** "mm:ss" for the live lock countdown. */
  function mmss(totalSeconds) {
    var s = Math.max(0, Math.round(totalSeconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /** 'YYYY-MM-DD' key for today + n days. */
  function dayKey(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** A notice block, coloured by kind: a locked notice is a warning. */
  function noticeBlock(text, kind) {
    if (!text) return '';
    return '<div class="notice' + (kind === 'locked' ? ' notice--warn' : '') + '" data-notice>' + UI.esc(text) + '</div>';
  }

  function discountBadge(percent) {
    return '<span class="dine-badge">' + UI.esc(percent) + '% OFF</span>';
  }

  /**
   * Registers a ticking countdown that re-enables the UI the moment the lock
   * expires. Stops itself once the view leaves the DOM.
   */
  function startCountdown(view, secondsLeft, onTick, onDone) {
    var remaining = secondsLeft;
    var timer = setInterval(function () {
      if (!document.body.contains(view)) { clearInterval(timer); return; }
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        onDone();
        return;
      }
      onTick(remaining);
    }, 1000);
    return timer;
  }

  // ── Overview ───────────────────────────────────────────────────────────────
  window.Screens.dinein = {
    tab: 'dinein',
    render: async function () {
      var data = await API.dineIn();
      var cfg = data.settings;
      var reservation = data.reservation;
      var signedIn = API.isSignedIn();

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({
            title: 'Dine-In',
            right: cfg.phone
              ? '<a class="icon-btn" href="' + telHref(cfg.phone) + '" aria-label="Call the restaurant">' + UI.icon('phone', 21) + '</a>'
              : '',
          }) +
          '<div class="scroll" data-body></div>' +
        '</div>'
      );
      var body = view.querySelector('[data-body]');

      function tiersCard() {
        return '<div class="card dine-hero">' +
          '<h2 class="dine-hero__title">' + UI.esc(cfg.restaurantName) + '</h2>' +
          '<p class="dine-hero__sub">Pay your restaurant bill from the app and save on every visit.</p>' +
          '<div class="dine-tiers">' +
            '<div class="dine-tier">' +
              '<div class="dine-tier__pct">' + UI.esc(cfg.reservedDiscountPercent) + '%</div>' +
              '<div class="dine-tier__label">With a reservation</div>' +
              '<div class="dine-tier__note">Book ' + UI.esc(cfg.unlockMinutes) + ' min ahead</div>' +
            '</div>' +
            '<div class="dine-tier">' +
              '<div class="dine-tier__pct">' + UI.esc(cfg.walkInDiscountPercent) + '%</div>' +
              '<div class="dine-tier__label">Walk-in</div>' +
              '<div class="dine-tier__note">Pay instantly</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      /** The reserved-tier action, which changes shape with the lock state. */
      function reservedCard() {
        if (!reservation) {
          return '<button class="option dine-action" data-action="reserve">' +
            '<span class="option__icon">' + UI.icon('calendar', 21) + '</span>' +
            '<span class="option__text">' +
              '<span class="option__title">Reserve a table ' + discountBadge(cfg.reservedDiscountPercent) + '</span>' +
              '<span class="option__sub">Book now, then pay your bill here after ' + UI.esc(cfg.unlockMinutes) + ' minutes</span>' +
            '</span>' +
            '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
          '</button>';
        }

        var locked = reservation.locked;
        return '<div class="card dine-res">' +
          '<div class="dine-res__head">' +
            '<div>' +
              '<div class="dine-res__ref">' + UI.esc(reservation.reference) + '</div>' +
              '<div class="dine-res__meta">' +
                UI.esc(reservation.tableLabel) + ' · ' + UI.esc(reservation.partySize) + ' guest' + (reservation.partySize === 1 ? '' : 's') +
              '</div>' +
              '<div class="dine-res__meta">' +
                UI.esc(UI.relativeDay(reservation.date)) + ' at ' + UI.esc(reservation.slot) +
              '</div>' +
            '</div>' +
            discountBadge(reservation.discountPercent) +
          '</div>' +
          (locked
            ? '<div class="hold-timer hold-timer--warn dine-lock" data-lock>' + UI.icon('lock', 15) +
                '<span>Billing unlocks in <strong data-countdown>' + mmss(reservation.secondsLeft) + '</strong></span></div>'
            : '<div class="hold-timer dine-lock" data-lock>' + UI.icon('check', 15) +
                '<span>Billing unlocked — ' + UI.esc(reservation.discountPercent) + '% off ready</span></div>') +
          '<div class="dine-res__foot">' +
            '<button class="btn" data-action="pay-reserved" data-locked="' + (locked ? '1' : '0') + '"' + (locked ? ' disabled' : '') + '>' +
              'Pay bill · save ' + UI.esc(reservation.discountPercent) + '%' +
            '</button>' +
            '<button class="link-btn" data-action="cancel-res">Cancel reservation</button>' +
          '</div>' +
        '</div>';
      }

      function walkInCard() {
        return '<button class="option dine-action" data-action="pay-walkin">' +
          '<span class="option__icon">' + UI.icon('cash', 21) + '</span>' +
          '<span class="option__text">' +
            '<span class="option__title">Pay at the table now ' + discountBadge(cfg.walkInDiscountPercent) + '</span>' +
            '<span class="option__sub">No reservation needed — settle your bill instantly</span>' +
          '</span>' +
          '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
        '</button>';
      }

      function billRow(bill) {
        var dine = bill.dine || {};
        return '<button class="option dine-bill" data-action="open-bill" data-id="' + UI.esc(bill.id) + '">' +
          '<span class="option__icon">' + UI.icon('ticket', 20) + '</span>' +
          '<span class="option__text">' +
            '<span class="option__title">' + UI.money(bill.amounts.total) + ' paid' +
              ' <span class="tag tag--accent">saved ' + UI.money(bill.amounts.discount) + '</span></span>' +
            '<span class="option__sub">' + UI.esc(bill.reference) + ' · ' +
              UI.esc(dine.mode === 'reserved' ? 'Reserved table' : 'Walk-in') + ' · ' + UI.esc(UI.timeAgo(bill.createdAt)) + '</span>' +
          '</span>' +
          '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
        '</button>';
      }

      function paint() {
        if (!cfg.active) {
          body.innerHTML = UI.empty({
            icon: 'food',
            title: 'Dine-In is closed',
            text: 'Restaurant billing is unavailable right now. Please settle your bill at the counter.',
          });
          return;
        }

        if (!signedIn) {
          body.innerHTML =
            '<div style="padding:14px 16px 0">' + tiersCard() + '</div>' +
            noticeBlock(cfg.notices.walkin, 'walkin') +
            '<div style="padding:18px 16px 0"><button class="btn" data-action="signin">Sign in to pay your bill</button></div>' +
            '<div class="spacer-24"></div>';
          return;
        }

        body.innerHTML =
          '<div style="padding:14px 16px 0">' + tiersCard() + '</div>' +

          '<h2 class="subhead">Pay your bill</h2>' +
          '<div class="stack">' + reservedCard() + '</div>' +
          // Whichever tier the guest is in, the matching notice explains the
          // discount they are getting right now.
          (reservation ? noticeBlock(reservation.notice, reservation.noticeKind) : '') +

          '<div class="dine-or"><span>or</span></div>' +
          '<div class="stack">' + walkInCard() + '</div>' +
          noticeBlock(cfg.notices.walkin, 'walkin') +

          (data.bills.length
            ? '<h2 class="subhead">Recent bills</h2><div class="stack">' + data.bills.map(billRow).join('') + '</div>'
            : '') +

          (cfg.phone
            ? '<div style="padding:22px 16px 0"><a class="btn-outline btn-outline--lg" href="' + telHref(cfg.phone) + '">' +
              'Call ' + UI.esc(cfg.restaurantName) + '</a></div>'
            : '') +
          '<div class="spacer-24"></div>';

        wireCountdown();
      }

      /** Keeps the lock badge ticking and flips the pay button on when it ends. */
      function wireCountdown() {
        if (!reservation || !reservation.locked) return;
        var countdownEl = body.querySelector('[data-countdown]');
        if (!countdownEl) return;

        startCountdown(
          view,
          reservation.secondsLeft,
          function (left) { countdownEl.textContent = mmss(left); },
          function () {
            // Re-read from the server rather than trusting the clock, so the
            // button only enables if the server agrees the lock has expired.
            API.dineIn().then(function (fresh) {
              reservation = fresh.reservation;
              data.bills = fresh.bills;
              paint();
              UI.toast('Billing unlocked — you can pay now', 'success');
            }).catch(function () { /* leave the UI as-is; user can pull to retry */ });
          }
        );
      }

      UI.actions(view, {
        signin: function () {
          sessionStorage.setItem('cineflex.returnTo', '/dinein');
          App.navigate('/login');
        },
        reserve: function () { App.navigate('/dinein/reserve'); },
        'pay-walkin': function () { App.navigate('/dinein/bill?mode=walkin'); },
        'pay-reserved': function (el) {
          if (el.getAttribute('data-locked') === '1') {
            UI.toast('Billing unlocks ' + cfg.unlockMinutes + ' minutes after you reserve', 'error');
            return;
          }
          App.navigate('/dinein/bill?mode=reserved');
        },
        'open-bill': function (el) { App.navigate('/ticket/' + el.getAttribute('data-id')); },
        'cancel-res': async function () {
          var yes = await UI.confirm({
            title: 'Cancel this reservation?',
            message: 'You will lose the ' + reservation.discountPercent + '% dine-in discount tied to it. You can always reserve again.',
            confirmLabel: 'Cancel reservation',
            cancelLabel: 'Keep it',
            danger: true,
          });
          if (!yes) return;
          try {
            await API.cancelReservation(reservation.id);
            UI.toast('Reservation cancelled', 'success');
            var fresh = await API.dineIn();
            reservation = fresh.reservation;
            data.bills = fresh.bills;
            paint();
          } catch (err) {
            UI.toast(err.message, 'error');
          }
        },
      });

      paint();
      return view;
    },
  };

  // ── Reserve a table ────────────────────────────────────────────────────────
  /** Placeholder returned when a screen decides to redirect instead of render. */
  function redirecting() {
    return UI.h('<div class="screen"><div class="scroll">' + UI.spinnerBlock() + '</div></div>');
  }

  window.Screens.dineinReserve = {
    auth: true,
    backTo: '/dinein',
    render: async function () {
      var data = await API.dineIn();
      var cfg = data.settings;

      if (data.reservation) {
        // Only one open reservation is allowed, so send them back rather than
        // letting them submit a request the server will reject.
        UI.toast('You already have an open reservation', 'error');
        App.navigate('/dinein', { replace: true });
        return redirecting();
      }

      var state = {
        date: data.today,
        slot: cfg.slots[0] || '19:00',
        partySize: 2,
        name: (Store.user && Store.user.name) || '',
        phone: (Store.user && Store.user.phone) || cfg.phone || '',
        notes: '',
      };

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Reserve a table', back: true }) +
          '<div class="scroll" data-body></div>' +
          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label">Discount</div>' +
              '<div class="actionbar__value">' + UI.esc(cfg.reservedDiscountPercent) + '%</div>' +
            '</div>' +
            '<button class="btn" data-action="submit">Reserve table</button>' +
          '</div>' +
        '</div>'
      );
      var body = view.querySelector('[data-body]');

      function paint() {
        body.innerHTML =
          noticeBlock(cfg.notices.reserve, 'reserve') +

          '<h2 class="subhead">Date</h2>' +
          '<div class="pickers">' +
            Array.from({ length: DAYS_AHEAD }, function (_x, i) { return dayKey(i); }).map(function (key) {
              return '<button class="chip chip--sm" data-action="date" data-date="' + key + '" aria-pressed="' +
                (key === state.date ? 'true' : 'false') + '">' + UI.esc(UI.relativeDay(key)) + '</button>';
            }).join('') +
          '</div>' +

          '<h2 class="subhead">Time</h2>' +
          '<div class="pickers">' +
            cfg.slots.map(function (slot) {
              return '<button class="chip chip--sm" data-action="slot" data-slot="' + UI.esc(slot) + '" aria-pressed="' +
                (slot === state.slot ? 'true' : 'false') + '">' + UI.esc(slot) + '</button>';
            }).join('') +
          '</div>' +

          '<h2 class="subhead">Guests</h2>' +
          '<div style="padding:0 16px">' +
            '<div class="stepper-row">' +
              '<div>' +
                '<div class="stepper-row__label">How many people?</div>' +
                '<div class="stepper-row__hint">Up to ' + UI.esc(cfg.maxPartySize) + ' — call us for larger parties</div>' +
              '</div>' +
              '<div class="stepper">' +
                '<button data-action="fewer" aria-label="Fewer guests"' + (state.partySize <= 1 ? ' disabled' : '') + '>' + UI.icon('minus', 15) + '</button>' +
                '<span>' + state.partySize + '</span>' +
                '<button data-action="more" aria-label="More guests"' + (state.partySize >= cfg.maxPartySize ? ' disabled' : '') + '>' + UI.icon('plus', 15) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<h2 class="subhead">Your details</h2>' +
          '<div class="field">' +
            '<label class="field__label" for="dine-name">Name</label>' +
            '<div class="field__control"><input id="dine-name" type="text" data-name value="' + UI.esc(state.name) + '" placeholder="Who is the table for?"></div>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="dine-phone">Phone</label>' +
            '<div class="field__control"><input id="dine-phone" type="tel" data-phone value="' + UI.esc(state.phone) + '" placeholder="10-digit mobile number"></div>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="dine-notes">Requests (optional)</label>' +
            '<div class="field__control"><input id="dine-notes" type="text" data-notes value="' + UI.esc(state.notes) + '" placeholder="Highchair, birthday cake, window table…"></div>' +
          '</div>' +
          '<div class="spacer-24"></div>';
      }

      /** Pulls the free-text inputs into state before a repaint or submit. */
      function readInputs() {
        var name = body.querySelector('[data-name]');
        var phone = body.querySelector('[data-phone]');
        var notes = body.querySelector('[data-notes]');
        if (name) state.name = name.value;
        if (phone) state.phone = phone.value;
        if (notes) state.notes = notes.value;
      }

      UI.actions(view, {
        date: function (el) { readInputs(); state.date = el.getAttribute('data-date'); paint(); },
        slot: function (el) { readInputs(); state.slot = el.getAttribute('data-slot'); paint(); },
        more: function () { readInputs(); state.partySize = Math.min(cfg.maxPartySize, state.partySize + 1); paint(); },
        fewer: function () { readInputs(); state.partySize = Math.max(1, state.partySize - 1); paint(); },
        submit: async function (el) {
          readInputs();
          el.disabled = true;
          el.textContent = 'Reserving…';
          try {
            var res = await API.reserveTable({
              date: state.date,
              slot: state.slot,
              partySize: state.partySize,
              guestName: state.name,
              phone: state.phone,
              notes: state.notes,
            });
            UI.toast('Table reserved · ' + res.reservation.reference, 'success');
            App.navigate('/dinein', { replace: true });
          } catch (err) {
            UI.toast(err.message, 'error');
            el.disabled = false;
            el.textContent = 'Reserve table';
          }
        },
      });

      paint();
      return view;
    },
  };

  // ── Pay a bill ─────────────────────────────────────────────────────────────
  window.Screens.dineinBill = {
    auth: true,
    backTo: '/dinein',
    render: async function (_params, query) {
      var mode = query.mode === 'reserved' ? 'reserved' : 'walkin';
      var results = await Promise.all([API.dineIn(), API.me()]);
      var data = results[0];
      var profile = results[1];
      var cfg = data.settings;
      var reservation = data.reservation;

      if (mode === 'reserved' && !reservation) {
        UI.toast('Reserve a table first to get ' + cfg.reservedDiscountPercent + '% off', 'error');
        App.navigate('/dinein/reserve', { replace: true });
        return redirecting();
      }

      var state = {
        billAmount: '',
        quote: null,
        error: '',
        // Locked until the server says otherwise; only the reserved tier locks.
        locked: mode === 'reserved' && Boolean(reservation && reservation.locked),
        secondsLeft: reservation ? reservation.secondsLeft : 0,
        payment: (profile.user.paymentMethods || []).find(function (m) { return m.isDefault; }) || null,
        busy: false,
      };

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: mode === 'reserved' ? 'Reserved bill' : 'Walk-in bill', back: true }) +
          '<div class="scroll" data-body></div>' +
          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label">To pay</div>' +
              '<div class="actionbar__value" data-total>—</div>' +
            '</div>' +
            '<button class="btn" data-action="pay" disabled>Pay bill</button>' +
          '</div>' +
        '</div>'
      );
      var body = view.querySelector('[data-body]');
      var totalEl = view.querySelector('[data-total]');
      var payBtn = view.querySelector('[data-action="pay"]');

      var quoteTimer = null;

      /** Asks the server to price the bill. The server is the only authority. */
      async function refreshQuote() {
        var amount = Number(state.billAmount);
        if (!state.billAmount || !Number.isFinite(amount) || amount <= 0) {
          state.quote = null;
          state.error = '';
          paintSummary();
          return;
        }
        try {
          state.quote = await API.dineInQuote({
            mode: mode,
            billAmount: amount,
            reservationId: reservation ? reservation.id : undefined,
          });
          state.locked = Boolean(state.quote.locked);
          if (state.quote.lock) state.secondsLeft = state.quote.lock.secondsLeft;
          state.error = '';
        } catch (err) {
          state.quote = null;
          state.error = err.message;
        }
        paintSummary();
      }

      function paymentIcon(m) {
        if (!m) return 'cash';
        return m.type === 'upi' ? 'phone' : m.type === 'wallet' ? 'wallet' : m.type === 'netbanking' ? 'bank' : 'card';
      }

      /** Static chrome: the amount field, notice, payment picker, summary slot. */
      function paint() {
        body.innerHTML =
          '<h2 class="subhead">Your restaurant bill</h2>' +
          '<div class="field">' +
            '<label class="field__label" for="dine-amount">Bill total printed on your bill</label>' +
            '<div class="field__control">' +
              '<span style="font-size:17px;font-weight:700;color:var(--muted)">' + UI.CURRENCY + '</span>' +
              '<input id="dine-amount" type="number" inputmode="decimal" min="1" step="1" data-amount placeholder="0" value="' + UI.esc(state.billAmount) + '">' +
            '</div>' +
            '<div class="field__hint">Enter the amount before discount. Your ' +
              UI.esc(mode === 'reserved' ? cfg.reservedDiscountPercent : cfg.walkInDiscountPercent) +
              '% discount is applied automatically.</div>' +
            '<div class="field__error" data-error hidden></div>' +
          '</div>' +

          (mode === 'reserved' && reservation
            ? '<div style="padding:0 16px 4px">' +
                '<div class="option" style="pointer-events:none">' +
                  '<span class="option__icon">' + UI.icon('calendar', 21) + '</span>' +
                  '<span class="option__text">' +
                    '<span class="option__title">' + UI.esc(reservation.reference) + ' · ' + UI.esc(reservation.tableLabel) + '</span>' +
                    '<span class="option__sub">' + UI.esc(reservation.partySize) + ' guest' + (reservation.partySize === 1 ? '' : 's') +
                      ' · ' + UI.esc(UI.relativeDay(reservation.date)) + ' at ' + UI.esc(reservation.slot) + '</span>' +
                  '</span>' +
                '</div>' +
              '</div>'
            : '') +

          '<div data-lockbar></div>' +
          '<div data-noticeslot></div>' +

          '<h2 class="subhead">Pay with</h2>' +
          '<div style="padding:0 16px">' +
            '<button class="option" data-action="pick-payment">' +
              '<span class="option__icon">' + UI.icon(paymentIcon(state.payment), 21) + '</span>' +
              '<span class="option__text">' +
                '<span class="option__title">' + UI.esc(state.payment ? state.payment.label : 'Pay at the counter') + '</span>' +
                '<span class="option__sub">' + UI.esc(state.payment
                  ? (state.payment.last4 ? '•••• ' + state.payment.last4 : state.payment.handle || state.payment.type.toUpperCase())
                  : 'Cash or card with the steward') + '</span>' +
              '</span>' +
              '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
            '</button>' +
          '</div>' +

          '<div data-summary></div>' +
          '<div class="spacer-24"></div>';

        paintSummary();
      }

      /** Everything that depends on the current quote / lock state. */
      function paintSummary() {
        var errEl = body.querySelector('[data-error]');
        if (errEl) {
          errEl.hidden = !state.error;
          errEl.textContent = state.error || '';
        }

        var lockBar = body.querySelector('[data-lockbar]');
        if (lockBar) {
          lockBar.innerHTML = state.locked
            ? '<div class="hold-timer hold-timer--warn" style="margin:4px 16px;border-radius:var(--radius)">' + UI.icon('lock', 15) +
              '<span>Billing unlocks in <strong data-countdown>' + mmss(state.secondsLeft) + '</strong></span></div>'
            : '';
        }

        var noticeSlot = body.querySelector('[data-noticeslot]');
        if (noticeSlot) {
          // Prefer the notice the server returned for this exact quote; before
          // any amount is typed, fall back to the generic one for this tier.
          var text = state.quote
            ? state.quote.notice
            : state.locked
              ? cfg.notices.locked
              : mode === 'reserved' ? cfg.notices.reserved : cfg.notices.walkin;
          var kind = state.quote ? state.quote.noticeKind : (state.locked ? 'locked' : mode);
          noticeSlot.innerHTML = noticeBlock(text, kind);
        }

        var summary = body.querySelector('[data-summary]');
        if (summary) {
          summary.innerHTML = state.quote
            ? '<h2 class="subhead">Bill summary</h2>' +
              '<div style="padding:0 16px">' +
                '<div class="kv"><span class="kv__key">Restaurant bill</span><span class="kv__val">' + UI.money(state.quote.amounts.billAmount) + '</span></div>' +
                '<div class="kv kv--discount"><span class="kv__key">Dine-In discount (' + UI.esc(state.quote.discountPercent) + '%)</span>' +
                  '<span class="kv__val">- ' + UI.money(state.quote.amounts.discount) + '</span></div>' +
                '<div class="kv kv--total"><span class="kv__key">To pay</span><span class="kv__val">' + UI.money(state.quote.amounts.total) + '</span></div>' +
              '</div>'
            : '';
        }

        totalEl.textContent = state.quote ? UI.money(state.quote.amounts.total) : '—';
        payBtn.disabled = state.busy || !state.quote || !state.quote.payable;
        payBtn.textContent = state.busy
          ? 'Paying…'
          : state.locked
            ? 'Locked'
            : state.quote
              ? 'Pay ' + UI.money(state.quote.amounts.total)
              : 'Pay bill';

        wireCountdown();
      }

      var countdownStarted = false;
      function wireCountdown() {
        if (!state.locked || countdownStarted) return;
        var el = body.querySelector('[data-countdown]');
        if (!el) return;
        countdownStarted = true;

        startCountdown(
          view,
          state.secondsLeft,
          function (left) {
            state.secondsLeft = left;
            var node = body.querySelector('[data-countdown]');
            if (node) node.textContent = mmss(left);
          },
          function () {
            countdownStarted = false;
            state.locked = false;
            // Re-quote so the server confirms the unlock before we enable pay.
            refreshQuote().then(function () {
              if (!state.locked) UI.toast('Billing unlocked — you can pay now', 'success');
            });
          }
        );
      }

      UI.actions(view, {
        'pick-payment': function () {
          var methods = profile.user.paymentMethods || [];
          var list = UI.h('<div style="padding:0 16px 8px">' +
            methods.map(function (m) {
              return '<button class="option" data-pick="' + UI.esc(m.id) + '" aria-pressed="' + (state.payment && state.payment.id === m.id ? 'true' : 'false') + '">' +
                '<span class="option__icon">' + UI.icon(paymentIcon(m), 21) + '</span>' +
                '<span class="option__text"><span class="option__title">' + UI.esc(m.label) + '</span>' +
                '<span class="option__sub">' + UI.esc(m.last4 ? '•••• ' + m.last4 : m.handle || m.type.toUpperCase()) + '</span></span>' +
                '<span class="option__radio"></span></button>';
            }).join('') +
            '<button class="option" data-pick="counter" aria-pressed="' + (state.payment ? 'false' : 'true') + '">' +
              '<span class="option__icon">' + UI.icon('cash', 21) + '</span>' +
              '<span class="option__text"><span class="option__title">Pay at the counter</span>' +
              '<span class="option__sub">Settle with the steward</span></span>' +
              '<span class="option__radio"></span></button>' +
            '<div style="height:10px"></div>' +
            '<button class="btn-outline btn-outline--lg" data-pick="manage">Manage payment methods</button>' +
            '</div>');
          var sheet = UI.sheet({ title: 'Pay with', body: list });
          list.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-pick]');
            if (!btn) return;
            var value = btn.getAttribute('data-pick');
            sheet.close();
            if (value === 'manage') { App.navigate('/account/payments'); return; }
            state.payment = value === 'counter' ? null : methods.find(function (m) { return m.id === value; });
            paint();
          });
        },

        pay: async function () {
          if (!state.quote || !state.quote.payable) return;
          state.busy = true;
          paintSummary();
          try {
            var res = await API.payDineInBill({
              mode: mode,
              billAmount: Number(state.billAmount),
              reservationId: reservation ? reservation.id : undefined,
              payment: state.payment ? { method: state.payment.type, methodId: state.payment.id } : { method: 'cash' },
            });
            App.navigate('/dinein/paid/' + res.booking.id, { replace: true });
          } catch (err) {
            UI.toast(err.message, 'error');
            state.busy = false;
            // A 423 means the lock is still on: re-quote to resync the timer.
            if (err.status === 423) await refreshQuote();
            else paintSummary();
          }
        },
      });

      // Debounced so we are not quoting on every keystroke.
      body.addEventListener('input', function (event) {
        if (!event.target.matches('[data-amount]')) return;
        state.billAmount = event.target.value;
        clearTimeout(quoteTimer);
        quoteTimer = setTimeout(refreshQuote, 300);
      });

      paint();
      return view;
    },
  };

  // ── Paid confirmation ──────────────────────────────────────────────────────
  window.Screens.dineinPaid = {
    auth: true,
    backTo: '/dinein',
    render: async function (params) {
      var res = await API.booking(params.bookingId);
      var b = res.booking;
      var dine = b.dine || {};

      var view = UI.h(
        '<div class="screen">' +
          '<div class="scroll">' +
            '<div class="success-hero">' +
              '<div class="success-hero__ring">' + UI.icon('check', 42) + '</div>' +
              '<h2>Bill paid!</h2>' +
              '<p>You saved ' + UI.money(b.amounts.discount) + ' with your ' +
                UI.esc(dine.discountPercent) + '% ' +
                UI.esc(dine.mode === 'reserved' ? 'reservation' : 'walk-in') + ' discount.</p>' +
            '</div>' +

            '<div style="padding:24px 16px 0">' +
              '<div class="stub">' +
                '<div class="stub__top">' +
                  '<div style="flex:1;min-width:0">' +
                    '<h3 style="margin:0;font-size:18px;font-weight:800">' + UI.esc(dine.restaurantName || 'Dine-In') + '</h3>' +
                    '<p style="margin:6px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5">' +
                      UI.esc(dine.mode === 'reserved' ? 'Reserved table' : 'Walk-in') +
                      (dine.tableLabel ? ' · ' + UI.esc(dine.tableLabel) : '') + '</p>' +
                    '<p style="margin:8px 0 0;font-size:13px;font-weight:700">' + UI.money(b.amounts.total) + ' paid</p>' +
                  '</div>' +
                '</div>' +
                '<div class="stub__grid">' +
                  '<div><div class="stub__cell-label">Bill</div><div class="stub__cell-value">' + UI.money(b.amounts.billAmount) + '</div></div>' +
                  '<div><div class="stub__cell-label">Discount</div><div class="stub__cell-value">' + UI.esc(dine.discountPercent) + '%</div></div>' +
                  '<div><div class="stub__cell-label">You saved</div><div class="stub__cell-value">' + UI.money(b.amounts.discount) + '</div></div>' +
                  '<div><div class="stub__cell-label">Paid via</div><div class="stub__cell-value">' + UI.esc(b.payment.methodLabel) + '</div></div>' +
                '</div>' +
                '<div class="stub__perf"><div class="stub__perf-line"></div></div>' +
                '<div class="stub__code">' +
                  '<img src="' + UI.esc(b.barcodeUrl) + '" alt="Barcode ' + UI.esc(b.reference) + '">' +
                  '<p class="stub__code-hint">Bill ' + UI.esc(b.reference) + '</p>' +
                '</div>' +
              '</div>' +
            '</div>' +

            // The notice is the one stored at payment time, so a receipt always
            // shows the terms that actually applied to this bill.
            noticeBlock(dine.notice, dine.noticeKind) +
            (res.pointsEarned
              ? '<p class="text-center" style="margin:18px 0 0;font-size:13px;color:var(--primary-600);font-weight:700">+' + res.pointsEarned + ' reward points earned</p>'
              : '') +
            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar" style="flex-direction:column;gap:10px">' +
            '<button class="btn btn--block" data-action="receipt">View full receipt</button>' +
            '<button class="btn-outline btn-outline--lg" data-action="done">Back to Dine-In</button>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        receipt: function () { App.navigate('/ticket/' + b.id, { replace: true }); },
        done: function () { App.navigate('/dinein', { replace: true }); },
      });

      return view;
    },
  };
})();
