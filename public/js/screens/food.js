/* Food Order tab: offer banners, category rails, item detail, cart & checkout. */
(function () {
  'use strict';

  function cartBar() {
    var count = Store.cartCount();
    if (!count) return '';
    return '<button class="card" data-action="cart" style="position:sticky;bottom:8px;margin:16px;width:calc(100% - 32px);' +
      'background:var(--primary-600);border-color:var(--primary-600);display:flex;align-items:center;gap:12px;padding:14px 16px;color:#fff;text-align:left">' +
      UI.icon('food', 22) +
      '<span style="flex:1;font-size:15px;font-weight:700">' + count + ' item' + (count === 1 ? '' : 's') + ' · ' + UI.money(Store.cartTotal()) + '</span>' +
      '<span style="font-size:14px;font-weight:800;display:flex;align-items:center;gap:4px">View cart ' + UI.icon('arrow-right', 16) + '</span>' +
      '</button>';
  }

  function stepperMarkup(item) {
    var qty = Store.cartQty(item.id);
    if (!qty) {
      return '<button class="btn-outline" style="width:auto;padding:0 16px" data-action="add" data-id="' + UI.esc(item.id) + '">Add</button>';
    }
    return '<div class="stepper">' +
      '<button data-action="dec" data-id="' + UI.esc(item.id) + '" aria-label="Remove one">' + UI.icon('minus', 15) + '</button>' +
      '<span>' + qty + '</span>' +
      '<button data-action="inc" data-id="' + UI.esc(item.id) + '" aria-label="Add one">' + UI.icon('plus', 15) + '</button>' +
      '</div>';
  }

  function foodRow(item) {
    return '<div class="food-row" data-row="' + UI.esc(item.id) + '">' +
      '<img class="food-row__img" src="' + UI.esc(item.imageUrl) + '" alt="" data-fallback="/img/food/_placeholder.svg">' +
      '<button class="food-row__text" data-action="food-item" data-id="' + UI.esc(item.id) + '" style="text-align:left">' +
        '<div class="food-row__name">' + UI.esc(item.name) + '</div>' +
        '<div class="food-row__meta">' + UI.esc(item.size || item.category) + (item.veg ? ' · Veg' : ' · Non-veg') + '</div>' +
        '<div class="food-row__price">' + UI.money(item.price) + '</div>' +
      '</button>' +
      '<div data-stepper="' + UI.esc(item.id) + '">' + stepperMarkup(item) + '</div>' +
      '</div>';
  }

  /** Re-render just the steppers, so tapping +/- never rebuilds the screen. */
  function refreshSteppers(root, itemsById) {
    root.querySelectorAll('[data-stepper]').forEach(function (host) {
      var item = itemsById[host.getAttribute('data-stepper')];
      if (item) host.innerHTML = stepperMarkup(item);
    });
    var bar = root.querySelector('[data-cartbar]');
    if (bar) bar.innerHTML = cartBar();
  }

  function indexItems(list) {
    return list.reduce(function (acc, item) { acc[item.id] = item; return acc; }, {});
  }

  // ── Food home ──────────────────────────────────────────────────────────────
  window.Screens.food = {
    tab: 'food',
    render: async function () {
      var data = await API.foodHome();
      var allItems = data.rails.reduce(function (acc, rail) { return acc.concat(rail.items); }, []);
      var byId = indexItems(allItems);

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({
            title: 'Food Order',
            right: '<button class="icon-btn" data-action="search" aria-label="Search food">' + UI.icon('search', 22) + '</button>',
          }) +
          '<div class="scroll">' +
            '<div style="margin-top:14px">' +
              (data.banners.length ? UI.carousel(data.banners.map(function (b) {
                return '<button class="carousel__slide banner-slide" data-action="offer" data-code="' + UI.esc(b.code) + '" aria-label="' + UI.esc(b.title) + '">' +
                  '<img src="' + UI.esc(b.bannerUrl) + '" alt="' + UI.esc(b.title) + '" data-fallback="/img/banners/best-ticket-offers.svg"></button>';
              }), { autoplay: 5000 }) : '') +
            '</div>' +
            data.rails.map(function (rail) {
              return '<div class="section">' +
                UI.sectionHead(rail.title, 'rail:' + rail.key) +
                '<div class="rail">' + rail.items.map(UI.foodCard).join('') + '</div>' +
                '</div>';
            }).join('') +
            '<div data-cartbar>' + cartBar() + '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      function openRail(key) {
        var rail = data.rails.find(function (r) { return r.key === key; });
        if (!rail) return;
        var body = UI.h('<div class="list">' + rail.items.map(foodRow).join('') + '</div>');
        var sheet = UI.sheet({ title: rail.title, body: body });
        UI.actions(body, {
          add: function (el) { Store.addToCart(byId[el.getAttribute('data-id')], 1); refreshSteppers(body, byId); refreshSteppers(view, byId); },
          inc: function (el) { Store.addToCart(byId[el.getAttribute('data-id')], 1); refreshSteppers(body, byId); refreshSteppers(view, byId); },
          dec: function (el) { Store.addToCart(byId[el.getAttribute('data-id')], -1); refreshSteppers(body, byId); refreshSteppers(view, byId); },
          'food-item': function (el) { sheet.close(); App.navigate('/food/' + el.getAttribute('data-id')); },
        });
      }

      UI.actions(view, {
        search: function () { App.navigate('/search'); },
        'food-item': function (el) { App.navigate('/food/' + el.getAttribute('data-id')); },
        cart: function () { App.navigate('/food/cart'); },
        offer: function (el) {
          var code = el.getAttribute('data-code');
          navigator.clipboard && navigator.clipboard.writeText(code).catch(function () {});
          UI.toast('Code ' + code + ' copied — apply it at checkout', 'success');
        },
      });

      // "View All" actions are dynamic (rail:<key>), so handle them separately.
      view.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-action^="rail:"]');
        if (!btn) return;
        openRail(btn.getAttribute('data-action').slice(5));
      });

      return view;
    },
  };

  // ── Item detail ────────────────────────────────────────────────────────────
  window.Screens.foodItem = {
    render: async function (params) {
      var item = await API.foodItem(params.id);
      var byId = indexItems([item].concat(item.related || []));

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: '', back: true, plain: true, logo: false }) +
          '<div class="scroll">' +
            '<div style="padding:0 16px">' +
              '<img src="' + UI.esc(item.imageUrl) + '" alt="' + UI.esc(item.name) + '" style="width:100%;aspect-ratio:1;border-radius:var(--radius-lg);object-fit:cover" data-fallback="/img/food/_placeholder.svg">' +
              '<div class="tag-row" style="margin-top:16px">' +
                '<span class="tag tag--accent">' + UI.esc(item.category) + '</span>' +
                '<span class="tag">' + UI.esc(item.veg ? 'Veg' : 'Non-veg') + '</span>' +
                (item.size ? '<span class="tag">' + UI.esc(item.size) + '</span>' : '') +
                (item.popular ? '<span class="tag">Bestseller</span>' : '') +
              '</div>' +
              '<h1 style="margin:12px 0 0;font-size:24px;font-weight:800;letter-spacing:-.4px;line-height:1.25">' + UI.esc(item.name) + '</h1>' +
              '<p style="margin:10px 0 0;font-size:14.5px;line-height:1.6;color:var(--ink-soft)">' + UI.esc(item.description) + '</p>' +
            '</div>' +
            (item.related && item.related.length
              ? '<div class="section">' + UI.sectionHead('Goes well with') + '<div class="rail">' + item.related.map(UI.foodCard).join('') + '</div></div>'
              : '') +
            '<div class="spacer-24"></div>' +
          '</div>' +
          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label">Price</div>' +
              '<div class="actionbar__value">' + UI.money(item.price) + '</div>' +
            '</div>' +
            '<div data-cta style="flex:1;display:flex;gap:12px;align-items:center"></div>' +
          '</div>' +
        '</div>'
      );

      var cta = view.querySelector('[data-cta]');

      function paintCta() {
        var qty = Store.cartQty(item.id);
        cta.innerHTML = qty
          ? '<div class="stepper" style="padding:8px 10px">' +
              '<button data-action="dec" aria-label="Remove one">' + UI.icon('minus', 17) + '</button>' +
              '<span style="min-width:26px;font-size:17px">' + qty + '</span>' +
              '<button data-action="inc" aria-label="Add one">' + UI.icon('plus', 17) + '</button>' +
            '</div>' +
            '<button class="btn" style="flex:1" data-action="cart">Go to cart</button>'
          : '<button class="btn" data-action="add">Add to cart</button>';
      }

      UI.actions(view, {
        add: function () { Store.addToCart(item, 1); paintCta(); UI.toast(item.name + ' added', 'success'); },
        inc: function () { Store.addToCart(item, 1); paintCta(); },
        dec: function () { Store.addToCart(item, -1); paintCta(); },
        cart: function () { App.navigate('/food/cart'); },
        'food-item': function (el) { App.navigate('/food/' + el.getAttribute('data-id')); },
      });

      paintCta();
      return view;
    },
  };

  // ── Cart & checkout ────────────────────────────────────────────────────────
  window.Screens.cart = {
    auth: true,
    render: async function () {
      var results = await Promise.all([API.cinemas('city=' + encodeURIComponent(Store.city)), API.offers('food'), API.me()]);
      var cinemas = results[0].cinemas;
      var offers = results[1].offers;
      var profile = results[2];

      var state = {
        cinemaId: cinemas.length ? cinemas[0].id : null,
        slot: '19:00',
        offerCode: null,
        payment: (profile.user.paymentMethods || []).find(function (m) { return m.isDefault; }) || null,
        totals: null,
      };

      var SLOTS = ['12:30', '15:45', '17:30', '19:00', '20:30', '22:15'];

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Your cart', back: true }) +
          '<div class="scroll" data-body></div>' +
          '<div class="actionbar" data-bar hidden>' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label">Total</div>' +
              '<div class="actionbar__value" data-total>—</div>' +
            '</div>' +
            '<button class="btn" data-action="place">Place order</button>' +
          '</div>' +
        '</div>'
      );

      var body = view.querySelector('[data-body]');
      var bar = view.querySelector('[data-bar]');
      var totalEl = view.querySelector('[data-total]');

      async function refreshTotals() {
        if (!Store.cart.length) { state.totals = null; return; }
        try {
          var quote = await API.quote({
            food: Store.cart.map(function (l) { return { itemId: l.itemId, qty: l.qty }; }),
            offerCode: state.offerCode,
          });
          state.totals = quote.totals;
        } catch (err) {
          state.totals = null;
          UI.toast(err.message, 'error');
        }
      }

      function paint() {
        if (!Store.cart.length) {
          bar.hidden = true;
          body.innerHTML = UI.empty({
            icon: 'food', title: 'Your cart is empty',
            text: 'Add popcorn, drinks or a combo and pick it up at the counter.',
            action: 'browse', actionLabel: 'Browse food',
          });
          return;
        }

        bar.hidden = false;
        totalEl.textContent = state.totals ? UI.money(state.totals.total) : UI.money(Store.cartTotal());

        var cinema = cinemas.find(function (c) { return c.id === state.cinemaId; });

        body.innerHTML =
          '<div class="list" style="padding-top:6px">' +
            Store.cart.map(function (line) {
              return '<div class="food-row">' +
                '<img class="food-row__img" src="' + UI.esc(line.imageUrl) + '" alt="" data-fallback="/img/food/_placeholder.svg">' +
                '<div class="food-row__text">' +
                  '<div class="food-row__name">' + UI.esc(line.name) + '</div>' +
                  '<div class="food-row__meta">' + UI.money(line.price) + ' each</div>' +
                  '<div class="food-row__price">' + UI.money(line.price * line.qty) + '</div>' +
                '</div>' +
                '<div class="stepper">' +
                  '<button data-action="dec" data-id="' + UI.esc(line.itemId) + '" aria-label="Remove one">' + UI.icon('minus', 15) + '</button>' +
                  '<span>' + line.qty + '</span>' +
                  '<button data-action="inc" data-id="' + UI.esc(line.itemId) + '" aria-label="Add one">' + UI.icon('plus', 15) + '</button>' +
                '</div></div>';
            }).join('') +
          '</div>' +

          '<h2 class="subhead">Pick up at</h2>' +
          '<div style="padding:0 16px">' +
            '<button class="option" data-action="pick-cinema">' +
              '<span class="option__icon">' + UI.icon('building', 21) + '</span>' +
              '<span class="option__text">' +
                '<span class="option__title">' + UI.esc(cinema ? cinema.name : 'Choose a cinema') + '</span>' +
                '<span class="option__sub">' + UI.esc(cinema ? cinema.area + ', ' + cinema.city : 'Required') + '</span>' +
              '</span>' +
              '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
            '</button>' +
          '</div>' +

          '<h2 class="subhead">Pickup time</h2>' +
          '<div class="pickers">' +
            SLOTS.map(function (slot) {
              return '<button class="chip chip--sm" data-action="slot" data-slot="' + slot + '" aria-pressed="' + (slot === state.slot ? 'true' : 'false') + '">' + slot + '</button>';
            }).join('') +
          '</div>' +

          '<h2 class="subhead">Offer</h2>' +
          '<div style="padding:0 16px">' +
            (state.offerCode
              ? '<div class="option" aria-pressed="true">' +
                  '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
                  '<span class="option__text"><span class="option__title">' + UI.esc(state.offerCode) + ' applied</span>' +
                  '<span class="option__sub">You saved ' + UI.money(state.totals ? state.totals.discount : 0) + '</span></span>' +
                  '<button class="link-btn" data-action="clear-offer">Remove</button>' +
                '</div>'
              : '<button class="option" data-action="pick-offer">' +
                  '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
                  '<span class="option__text"><span class="option__title">Apply an offer</span>' +
                  '<span class="option__sub">' + offers.length + ' available for food</span></span>' +
                  '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
                '</button>') +
          '</div>' +

          '<h2 class="subhead">Pay with</h2>' +
          '<div style="padding:0 16px">' +
            '<button class="option" data-action="pick-payment">' +
              '<span class="option__icon">' + UI.icon(state.payment ? (state.payment.type === 'upi' ? 'phone' : state.payment.type === 'wallet' ? 'wallet' : 'card') : 'card', 21) + '</span>' +
              '<span class="option__text">' +
                '<span class="option__title">' + UI.esc(state.payment ? state.payment.label : 'Pay at counter') + '</span>' +
                '<span class="option__sub">' + UI.esc(state.payment ? (state.payment.last4 ? '•••• ' + state.payment.last4 : state.payment.handle || state.payment.type.toUpperCase()) : 'Cash / card at the cinema') + '</span>' +
              '</span>' +
              '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
            '</button>' +
          '</div>' +

          (state.totals
            ? '<h2 class="subhead">Bill summary</h2>' +
              '<div style="padding:0 16px">' +
                '<div class="kv"><span class="kv__key">Item total</span><span class="kv__val">' + UI.money(state.totals.food) + '</span></div>' +
                (state.totals.discount ? '<div class="kv kv--discount"><span class="kv__key">Offer discount</span><span class="kv__val">- ' + UI.money(state.totals.discount) + '</span></div>' : '') +
                '<div class="kv kv--total"><span class="kv__key">To pay</span><span class="kv__val">' + UI.money(state.totals.total) + '</span></div>' +
              '</div>'
            : '') +
          '<div class="spacer-24"></div>';
      }

      async function repaint() {
        await refreshTotals();
        paint();
      }

      UI.actions(view, {
        browse: function () { App.navigate('/food'); },
        inc: async function (el) {
          var line = Store.cart.find(function (l) { return l.itemId === el.getAttribute('data-id'); });
          Store.addToCart({ id: line.itemId, name: line.name, price: line.price, imageUrl: line.imageUrl }, 1);
          await repaint();
        },
        dec: async function (el) {
          var line = Store.cart.find(function (l) { return l.itemId === el.getAttribute('data-id'); });
          Store.addToCart({ id: line.itemId, name: line.name, price: line.price, imageUrl: line.imageUrl }, -1);
          await repaint();
        },
        slot: async function (el) { state.slot = el.getAttribute('data-slot'); paint(); },
        'clear-offer': async function () { state.offerCode = null; await repaint(); },

        'pick-cinema': function () {
          var list = UI.h('<div style="padding:0 16px 8px">' +
            cinemas.map(function (c) {
              return '<button class="option" data-pick="' + UI.esc(c.id) + '" aria-pressed="' + (c.id === state.cinemaId ? 'true' : 'false') + '">' +
                '<span class="option__icon">' + UI.icon('building', 21) + '</span>' +
                '<span class="option__text"><span class="option__title">' + UI.esc(c.name) + '</span>' +
                '<span class="option__sub">' + UI.esc(c.area) + ' · ' + UI.esc(c.distanceKm) + ' km</span></span>' +
                '<span class="option__radio"></span></button>';
            }).join('') + '</div>');
          var sheet = UI.sheet({ title: 'Pick up at', body: list });
          list.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-pick]');
            if (!btn) return;
            state.cinemaId = btn.getAttribute('data-pick');
            sheet.close();
            paint();
          });
        },

        'pick-offer': function () {
          var list = UI.h('<div style="padding:0 16px 8px">' +
            offers.map(function (o) {
              return '<button class="option" data-pick="' + UI.esc(o.code) + '">' +
                '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
                '<span class="option__text"><span class="option__title">' + UI.esc(o.title) + '</span>' +
                '<span class="option__sub">' + UI.esc(o.subtitle) + ' · Code ' + UI.esc(o.code) + '</span></span>' +
                '<span class="row__chevron">' + UI.icon('chevron-right', 18) + '</span></button>';
            }).join('') + '</div>');
          var sheet = UI.sheet({ title: 'Available offers', body: list });
          list.addEventListener('click', async function (e) {
            var btn = e.target.closest('[data-pick]');
            if (!btn) return;
            var code = btn.getAttribute('data-pick');
            sheet.close();
            try {
              await API.validateOffer({ code: code, food: Store.cart.map(function (l) { return { itemId: l.itemId, qty: l.qty }; }) });
              state.offerCode = code;
              UI.toast('Offer applied', 'success');
            } catch (err) {
              UI.toast(err.message, 'error');
            }
            await repaint();
          });
        },

        'pick-payment': function () {
          var methods = (profile.user.paymentMethods || []);
          var list = UI.h('<div style="padding:0 16px 8px">' +
            methods.map(function (m) {
              return '<button class="option" data-pick="' + UI.esc(m.id) + '" aria-pressed="' + (state.payment && state.payment.id === m.id ? 'true' : 'false') + '">' +
                '<span class="option__icon">' + UI.icon(m.type === 'upi' ? 'phone' : m.type === 'wallet' ? 'wallet' : m.type === 'netbanking' ? 'bank' : 'card', 21) + '</span>' +
                '<span class="option__text"><span class="option__title">' + UI.esc(m.label) + '</span>' +
                '<span class="option__sub">' + UI.esc(m.last4 ? '•••• ' + m.last4 : m.handle || m.type.toUpperCase()) + '</span></span>' +
                '<span class="option__radio"></span></button>';
            }).join('') +
            '<button class="option" data-pick="counter" aria-pressed="' + (state.payment ? 'false' : 'true') + '">' +
              '<span class="option__icon">' + UI.icon('cash', 21) + '</span>' +
              '<span class="option__text"><span class="option__title">Pay at counter</span>' +
              '<span class="option__sub">Settle when you collect</span></span>' +
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

        place: async function (el) {
          if (!Store.cart.length) return;
          if (!state.cinemaId) { UI.toast('Choose a cinema for pickup', 'error'); return; }
          el.disabled = true;
          el.textContent = 'Placing…';
          try {
            var res = await API.orderFood({
              cinemaId: state.cinemaId,
              items: Store.cart.map(function (l) { return { itemId: l.itemId, qty: l.qty }; }),
              slot: state.slot,
              offerCode: state.offerCode,
              payment: state.payment ? { method: state.payment.type, methodId: state.payment.id } : { method: 'cash' },
            });
            Store.clearCart();
            App.navigate('/confirmed/' + res.booking.id, { replace: true });
          } catch (err) {
            UI.toast(err.message, 'error');
            el.disabled = false;
            el.textContent = 'Place order';
          }
        },
      });

      await repaint();
      return view;
    },
  };
})();
