/* My Tickets tab (Upcoming / Passed / Canceled × Movie / Food / Event) and the
   full ticket view with its scannable barcode. */
(function () {
  'use strict';

  var BUCKETS = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'passed', label: 'Passed' },
    { id: 'cancelled', label: 'Canceled' },
  ];
  var TYPES = [
    { id: 'movie', label: 'Movie' },
    { id: 'food', label: 'Food' },
    { id: 'event', label: 'Event' },
  ];

  function ticketCard(booking) {
    var subtitle = booking.type === 'food'
      ? (booking.pickup ? UI.shortDate(booking.pickup.date) + ' · Pickup ' + booking.pickup.slot : UI.showLine(booking.startsAt))
      : UI.showLine(booking.startsAt, booking.endsAt);

    var showReminder = booking.bucket === 'upcoming' && booking.status === 'confirmed';

    return '<article class="card">' +
      '<button class="ticket__main" data-action="open" data-id="' + UI.esc(booking.id) + '">' +
        '<img class="ticket__poster" src="' + UI.esc(booking.posterUrl) + '" alt="" data-fallback="/img/posters/_placeholder.svg">' +
        '<div class="ticket__text">' +
          '<h3 class="ticket__title">' + UI.esc(booking.title) + '</h3>' +
          '<p class="ticket__sub">' + UI.esc(subtitle) + '</p>' +
          (booking.seatLabel
            ? '<p class="ticket__seats">Seats ' + UI.esc(booking.seatLabel) + '</p>'
            : booking.food && booking.food.length
              ? '<p class="ticket__seats">' + UI.esc(booking.food.length) + ' item' + (booking.food.length === 1 ? '' : 's') + ' · ' + UI.money(booking.amounts.total) + '</p>'
              : '') +
          (booking.bucket !== 'upcoming' ? '<div style="margin-top:7px">' + UI.statusPill(booking) + '</div>' : '') +
        '</div>' +
        '<span class="row__chevron">' + UI.icon('chevron-right', 20) + '</span>' +
      '</button>' +
      (showReminder
        ? '<div class="card__divider"></div>' +
          '<div class="ticket__reminder">' +
            '<span>Remind me 30 minutes earlier</span>' +
            '<button class="switch" role="switch" aria-checked="' + (booking.reminder && booking.reminder.enabled ? 'true' : 'false') + '" ' +
              'data-action="reminder" data-id="' + UI.esc(booking.id) + '" aria-label="Reminder for ' + UI.esc(booking.title) + '"></button>' +
          '</div>'
        : '') +
      '</article>';
  }

  window.Screens.tickets = {
    tab: 'tickets',
    auth: true,
    render: async function (_params, query) {
      var state = {
        bucket: BUCKETS.some(function (b) { return b.id === query.bucket; }) ? query.bucket : 'upcoming',
        type: 'movie',
        search: '',
      };

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({
            title: 'My Ticket',
            right: '<button class="icon-btn" data-action="toggle-search" aria-label="Search tickets">' + UI.icon('search', 22) + '</button>',
          }) +
          '<div class="tabs" role="tablist" data-tabs>' +
            BUCKETS.map(function (b) {
              return '<button class="tabs__tab" role="tab" data-bucket="' + b.id + '" aria-selected="' + (b.id === state.bucket ? 'true' : 'false') + '">' + b.label + '</button>';
            }).join('') +
          '</div>' +
          '<div data-searchbox hidden>' +
            '<div class="search-field">' + UI.icon('search', 19) +
              '<input type="search" placeholder="Search by title or reference" data-search autocomplete="off">' +
            '</div>' +
          '</div>' +
          '<div class="chips" data-types>' +
            TYPES.map(function (t) {
              return '<button class="chip" data-type="' + t.id + '" aria-pressed="' + (t.id === state.type ? 'true' : 'false') + '">' + t.label + '</button>';
            }).join('') +
          '</div>' +
          '<div class="scroll"><div class="stack" data-list style="margin-top:14px"></div><div class="spacer-24"></div></div>' +
        '</div>'
      );

      var list = view.querySelector('[data-list]');
      var cache = {};

      function emptyFor() {
        if (state.type === 'event') {
          return UI.empty({ icon: 'sparkle', title: 'No event tickets', text: 'Fan shows, premieres and live events will appear here once you book one.' });
        }
        if (state.bucket === 'cancelled') {
          return UI.empty({ icon: 'ticket-check', title: 'Nothing cancelled', text: 'Cancelled bookings and their refunds show up here.' });
        }
        if (state.bucket === 'passed') {
          return UI.empty({ icon: 'clock', title: 'No history yet', text: 'Shows you have already watched will be listed here.' });
        }
        return state.type === 'food'
          ? UI.empty({ icon: 'food', title: 'No food orders', text: 'Pre-order snacks and skip the queue at the counter.', action: 'browse-food', actionLabel: 'Order food' })
          : UI.empty({ icon: 'ticket', title: 'No upcoming tickets', text: 'Book a show and your tickets will live here.', action: 'browse', actionLabel: 'Browse movies' });
      }

      async function load() {
        var key = state.bucket + '|' + state.type;
        list.innerHTML = UI.spinnerBlock();

        if (!cache[key]) {
          try {
            cache[key] = await API.bookings('bucket=' + state.bucket + '&type=' + state.type);
          } catch (err) {
            list.innerHTML = UI.empty({ icon: 'alert-circle', title: 'Could not load tickets', text: err.message });
            return;
          }
        }

        var items = cache[key].bookings;
        if (state.search) {
          var needle = state.search.toLowerCase();
          items = items.filter(function (b) {
            return (b.title + ' ' + b.reference).toLowerCase().indexOf(needle) !== -1;
          });
        }

        list.innerHTML = items.length ? items.map(ticketCard).join('') : emptyFor();
      }

      view.querySelector('[data-tabs]').addEventListener('click', function (event) {
        var tab = event.target.closest('[data-bucket]');
        if (!tab) return;
        state.bucket = tab.getAttribute('data-bucket');
        view.querySelectorAll('[data-bucket]').forEach(function (t) {
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        load();
      });

      view.querySelector('[data-types]').addEventListener('click', function (event) {
        var chip = event.target.closest('[data-type]');
        if (!chip) return;
        state.type = chip.getAttribute('data-type');
        view.querySelectorAll('[data-type]').forEach(function (c) {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        load();
      });

      var searchBox = view.querySelector('[data-searchbox]');
      var searchInput = view.querySelector('[data-search]');
      searchInput.addEventListener('input', function () {
        state.search = searchInput.value.trim();
        load();
      });

      UI.actions(view, {
        'toggle-search': function () {
          searchBox.hidden = !searchBox.hidden;
          if (!searchBox.hidden) searchInput.focus();
          else if (state.search) { state.search = ''; searchInput.value = ''; load(); }
        },
        open: function (el) { App.navigate('/ticket/' + el.getAttribute('data-id')); },
        browse: function () { App.navigate('/home'); },
        'browse-food': function () { App.navigate('/food'); },
        reminder: async function (el) {
          var next = el.getAttribute('aria-checked') !== 'true';
          el.setAttribute('aria-checked', next ? 'true' : 'false');
          try {
            await API.setReminder(el.getAttribute('data-id'), next);
            UI.toast(next ? 'Reminder on — 30 minutes before' : 'Reminder off');
            cache = {};
          } catch (err) {
            el.setAttribute('aria-checked', next ? 'false' : 'true');
            UI.toast(err.message, 'error');
          }
        },
      });

      await load();
      return view;
    },
  };

  // ── Ticket detail ──────────────────────────────────────────────────────────
  window.Screens.ticketDetail = {
    auth: true,
    render: async function (params) {
      var res = await API.booking(params.id);
      var b = res.booking;
      var isMovie = b.type === 'movie';

      function cell(label, value) {
        return '<div><div class="stub__cell-label">' + UI.esc(label) + '</div>' +
          '<div class="stub__cell-value">' + UI.esc(value) + '</div></div>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({
            title: isMovie ? 'Your ticket' : 'Your order',
            back: true,
            right: '<button class="icon-btn" data-action="share" aria-label="Share">' + UI.icon('share', 21) + '</button>',
          }) +
          '<div class="scroll">' +
            '<div style="padding:6px 16px 0">' +
              '<div class="stub">' +
                '<div class="stub__top">' +
                  '<img class="stub__poster" src="' + UI.esc(b.posterUrl) + '" alt="" data-fallback="/img/posters/_placeholder.svg">' +
                  '<div style="flex:1;min-width:0">' +
                    '<h2 style="margin:0;font-size:19px;font-weight:800;line-height:1.25">' + UI.esc(b.title) + '</h2>' +
                    '<p style="margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.45">' +
                      UI.esc(b.cinema ? b.cinema.name : (b.pickup ? b.pickup.cinemaName : '')) +
                      (b.screenName ? '<br>' + UI.esc(b.screenName) + (b.format ? ' · ' + UI.esc(b.format) : '') : '') +
                    '</p>' +
                    '<div style="margin-top:9px">' + UI.statusPill(b) + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="stub__grid">' +
                  (isMovie
                    ? cell('Date', UI.shortDate(b.startsAt)) +
                      cell('Time', UI.hhmm(b.startsAt) + ' - ' + UI.hhmm(b.endsAt)) +
                      cell('Seats', b.seatLabel || '—') +
                      cell('Language', b.language || '—')
                    : cell('Pickup date', b.pickup ? UI.shortDate(b.pickup.date) : '—') +
                      cell('Pickup time', b.pickup ? b.pickup.slot : '—') +
                      cell('Counter', b.pickup ? b.pickup.counter : '—') +
                      cell('Items', String((b.food || []).reduce(function (n, f) { return n + f.qty; }, 0)))) +
                '</div>' +
                '<div class="stub__perf"><div class="stub__perf-line"></div></div>' +
                '<div class="stub__code">' +
                  '<img src="' + UI.esc(b.barcodeUrl) + '" alt="Barcode for booking ' + UI.esc(b.reference) + '">' +
                  '<p class="stub__code-hint">Show this at the ' + (isMovie ? 'entry gate' : 'food counter') + ' · Booking ' + UI.esc(b.reference) + '</p>' +
                '</div>' +
              '</div>' +
            '</div>' +

            (b.food && b.food.length
              ? '<h2 class="subhead">Food & beverages</h2><div class="list">' +
                b.food.map(function (f) {
                  return '<div class="row"><span class="row__label" style="font-weight:600">' + UI.esc(f.name) + ' × ' + f.qty + '</span>' +
                    '<span class="row__value" style="font-weight:700;color:var(--ink)">' + UI.money(f.price * f.qty) + '</span></div>';
                }).join('') + '</div>'
              : '') +

            '<h2 class="subhead">Payment</h2>' +
            '<div style="padding:0 16px">' +
              (isMovie ? '<div class="kv"><span class="kv__key">Tickets (' + (b.seats || []).length + ')</span><span class="kv__val">' + UI.money(b.amounts.tickets) + '</span></div>' : '') +
              (b.amounts.food ? '<div class="kv"><span class="kv__key">Food & beverages</span><span class="kv__val">' + UI.money(b.amounts.food) + '</span></div>' : '') +
              (b.amounts.convenienceFee ? '<div class="kv"><span class="kv__key">Convenience fee</span><span class="kv__val">' + UI.money(b.amounts.convenienceFee) + '</span></div>' : '') +
              (b.amounts.gst ? '<div class="kv"><span class="kv__key">GST</span><span class="kv__val">' + UI.money(b.amounts.gst) + '</span></div>' : '') +
              (b.amounts.discount ? '<div class="kv kv--discount"><span class="kv__key">Offer ' + UI.esc(b.offerCode || '') + '</span><span class="kv__val">- ' + UI.money(b.amounts.discount) + '</span></div>' : '') +
              '<div class="kv kv--total"><span class="kv__key">Paid via ' + UI.esc(b.payment.methodLabel) + '</span><span class="kv__val">' + UI.money(b.amounts.total) + '</span></div>' +
              (b.status === 'cancelled' && b.refundAmount
                ? '<div class="kv"><span class="kv__key">Refund in progress</span><span class="kv__val" style="color:var(--success)">' + UI.money(b.refundAmount) + '</span></div>'
                : '') +
              '<p style="margin:10px 0 0;font-size:11.5px;color:var(--muted)">Transaction ' + UI.esc(b.payment.transactionId) + '</p>' +
            '</div>' +

            (b.canCancel
              ? '<div style="padding:24px 16px 0"><button class="btn-outline btn-outline--lg" data-action="cancel" style="border-color:var(--danger);color:var(--danger)">Cancel booking</button>' +
                '<p style="margin:10px 0 0;font-size:11.5px;color:var(--muted);text-align:center">75% of the amount is refunded when you cancel more than 2 hours before showtime.</p></div>'
              : b.bucket === 'upcoming' && b.status === 'confirmed' && isMovie
                ? '<div class="notice notice--warn" style="margin-top:24px">Cancellation window has closed — tickets can only be cancelled up to 2 hours before showtime.</div>'
                : '') +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        share: async function () {
          var text = b.title + ' — ' + (isMovie ? UI.showLine(b.startsAt, b.endsAt) + ', seats ' + b.seatLabel : 'pickup ' + (b.pickup ? b.pickup.slot : '')) +
            ' (booking ' + b.reference + ')';
          if (navigator.share) {
            try { await navigator.share({ title: 'CineFlex booking', text: text }); return; } catch (_e) { /* cancelled */ }
          }
          if (navigator.clipboard) {
            try { await navigator.clipboard.writeText(text); UI.toast('Ticket details copied', 'success'); return; } catch (_e) {}
          }
          UI.toast('Booking reference: ' + b.reference);
        },

        cancel: async function () {
          var ok = await UI.confirm({
            title: 'Cancel this booking?',
            message: 'Seats ' + b.seatLabel + ' for ' + b.title + ' will be released. ' +
              UI.money(Math.round(b.amounts.total * 0.75)) + ' of ' + UI.money(b.amounts.total) + ' will be refunded to ' + b.payment.methodLabel + '.',
            confirmLabel: 'Yes, cancel booking',
            cancelLabel: 'Keep my seats',
            danger: true,
          });
          if (!ok) return;
          try {
            var result = await API.cancelBooking(b.id);
            UI.toast('Booking cancelled · ' + UI.money(result.refundAmount) + ' refund initiated', 'success');
            App.navigate('/tickets?bucket=cancelled', { replace: true });
          } catch (err) {
            UI.toast(err.message, 'error');
          }
        },
      });

      return view;
    },
  };
})();
