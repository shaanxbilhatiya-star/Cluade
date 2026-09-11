/* API client + auth token storage + tiny app store. */
(function () {
  'use strict';

  var TOKEN_KEY = 'cineflex.token';
  var CITY_KEY = 'cineflex.city';
  var CART_KEY = 'cineflex.cart';

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_e) { return null; }
  }
  function writeToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_e) { /* private browsing */ }
  }

  var token = readToken();

  /** Error carrying the HTTP status and any server-provided details. */
  function ApiError(message, status, details) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.status = status;
    err.details = details;
    return err;
  }

  async function request(method, path, body) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;

    var res;
    try {
      res = await fetch('/api' + path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_e) {
      throw ApiError('Cannot reach the server. Check your connection.', 0);
    }

    if (res.status === 204) return null;

    var payload = null;
    var text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch (_e) { payload = { raw: text }; }
    }

    if (!res.ok) {
      if (res.status === 401 && token) {
        // Token expired or revoked — drop it and let the shell show sign-in.
        writeToken(null);
        token = null;
        window.dispatchEvent(new CustomEvent('cineflex:signed-out'));
      }
      throw ApiError((payload && payload.error) || 'Request failed (' + res.status + ')', res.status, payload && payload.details);
    }
    return payload;
  }

  var API = {
    get: function (p) { return request('GET', p); },
    post: function (p, b) { return request('POST', p, b === undefined ? {} : b); },
    put: function (p, b) { return request('PUT', p, b === undefined ? {} : b); },
    patch: function (p, b) { return request('PATCH', p, b === undefined ? {} : b); },
    del: function (p) { return request('DELETE', p); },

    get token() { return token; },
    setToken: function (value) { token = value; writeToken(value); },
    isSignedIn: function () { return Boolean(token); },

    // ── Auth ──
    login: function (email, password) { return request('POST', '/auth/login', { email: email, password: password }); },
    register: function (payload) { return request('POST', '/auth/register', payload); },
    me: function () { return request('GET', '/me'); },

    // ── Discovery ──
    home: function (city) { return request('GET', '/home' + (city ? '?city=' + encodeURIComponent(city) : '')); },
    search: function (q) { return request('GET', '/search?q=' + encodeURIComponent(q)); },
    movies: function (query) { return request('GET', '/movies' + (query ? '?' + query : '')); },
    movieProperty: function () { return request('GET', '/movies/property'); },
    movie: function (id) { return request('GET', '/movies/' + id); },
    movieShowtimes: function (id, params) {
      var qs = new URLSearchParams(params || {}).toString();
      return request('GET', '/movies/' + id + '/showtimes' + (qs ? '?' + qs : ''));
    },
    cinemas: function (query) { return request('GET', '/cinemas' + (query ? '?' + query : '')); },
    cinema: function (id) { return request('GET', '/cinemas/' + id); },
    cinemaShowtimes: function (id, date) { return request('GET', '/cinemas/' + id + '/showtimes' + (date ? '?date=' + date : '')); },
    showtime: function (id) { return request('GET', '/showtimes/' + id); },
    seats: function (id, holdId) { return request('GET', '/showtimes/' + id + '/seats' + (holdId ? '?holdId=' + holdId : '')); },

    // ── Booking ──
    hold: function (showtimeId, seats) { return request('POST', '/showtimes/' + showtimeId + '/hold', { seats: seats }); },
    releaseHold: function (holdId) { return request('DELETE', '/holds/' + holdId); },
    quote: function (payload) { return request('POST', '/bookings/quote', payload); },
    validateOffer: function (payload) { return request('POST', '/offers/validate', payload); },
    book: function (payload) { return request('POST', '/bookings', payload); },
    orderFood: function (payload) { return request('POST', '/bookings/food', payload); },
    bookings: function (query) { return request('GET', '/bookings' + (query ? '?' + query : '')); },
    booking: function (id) { return request('GET', '/bookings/' + id); },
    cancelBooking: function (id) { return request('POST', '/bookings/' + id + '/cancel', {}); },
    setReminder: function (id, enabled) { return request('PATCH', '/bookings/' + id + '/reminder', { enabled: enabled }); },

    // ── Food ──
    foodHome: function () { return request('GET', '/food/home'); },
    food: function (query) { return request('GET', '/food' + (query ? '?' + query : '')); },
    foodItem: function (id) { return request('GET', '/food/' + id); },
    offers: function (appliesTo) { return request('GET', '/offers' + (appliesTo ? '?appliesTo=' + appliesTo : '')); },
    experiences: function () { return request('GET', '/experiences'); },

    // ── Hotel / stays ──
    /** @param {{checkIn?:string, checkOut?:string, rooms?:number}} [params] */
    hotels: function (params) {
      var qs = new URLSearchParams(params || {}).toString();
      return request('GET', '/hotels' + (qs ? '?' + qs : ''));
    },
    hotelRoom: function (id, params) {
      var qs = new URLSearchParams(params || {}).toString();
      return request('GET', '/hotels/rooms/' + id + (qs ? '?' + qs : ''));
    },
    hotelQuote: function (payload) { return request('POST', '/hotels/quote', payload); },
    validateHotelOffer: function (payload) { return request('POST', '/hotels/offers/validate', payload); },
    bookHotel: function (payload) { return request('POST', '/hotels/bookings', payload); },

    // ── Dine-In ──
    /** Both outlets (Rangoli veg / Dolphin non-veg), for the venue picker. */
    dineVenues: function () { return request('GET', '/dine-in/venues'); },
    /** Tab payload for one outlet: live discount tiers, my reservation + its billing lock. */
    dineIn: function (venueId) { return request('GET', '/dine-in/' + venueId); },
    dineSlots: function (venueId, date) { return request('GET', '/dine-in/' + venueId + '/slots' + (date ? '?date=' + encodeURIComponent(date) : '')); },
    dineReservations: function (venueId) { return request('GET', '/dine-in/' + venueId + '/reservations'); },
    reserveTable: function (venueId, payload) { return request('POST', '/dine-in/' + venueId + '/reservations', payload); },
    cancelReservation: function (id) { return request('POST', '/dine-in/reservations/' + id + '/cancel', {}); },
    /** Server decides the tier, the lock state and the notice wording. */
    dineQuote: function (venueId, payload) { return request('POST', '/dine-in/' + venueId + '/quote', payload); },
    validateDineOffer: function (venueId, payload) { return request('POST', '/dine-in/' + venueId + '/offers/validate', payload); },
    payDineBill: function (venueId, payload) { return request('POST', '/dine-in/' + venueId + '/bills', payload); },
    dineBills: function (venueId) { return request('GET', '/dine-in/' + venueId + '/bills'); },
    dineBill: function (id) { return request('GET', '/dine-in/bills/' + id); },

    // ── Water park ──
    /** Tab payload: packages with their computed value breakup, rate card, add-ons. */
    waterpark: function (date) { return request('GET', '/waterpark' + (date ? '?date=' + encodeURIComponent(date) : '')); },
    waterparkSlots: function (date) { return request('GET', '/waterpark/slots' + (date ? '?date=' + encodeURIComponent(date) : '')); },
    /** The server prices the order — a package or a per-person build — and renders the notice. */
    waterparkQuote: function (payload) { return request('POST', '/waterpark/quote', payload); },
    validateWaterparkOffer: function (payload) { return request('POST', '/waterpark/offers/validate', payload); },
    bookWaterpark: function (payload) { return request('POST', '/waterpark/bookings', payload); },
    waterparkBookings: function () { return request('GET', '/waterpark/bookings'); },
    waterparkBooking: function (id) { return request('GET', '/waterpark/bookings/' + id); },
    cancelWaterparkBooking: function (id) { return request('POST', '/waterpark/bookings/' + id + '/cancel', {}); },

    // ── Account ──
    updateProfile: function (patch) { return request('PATCH', '/me', patch); },
    updateSettings: function (patch) { return request('PATCH', '/me/settings', patch); },
    notifications: function () { return request('GET', '/me/notifications'); },
    markNotificationsRead: function (ids) { return request('POST', '/me/notifications/read', ids ? { ids: ids } : {}); },
    changePassword: function (currentPassword, newPassword) {
      return request('POST', '/auth/change-password', { currentPassword: currentPassword, newPassword: newPassword });
    },
  };

  /* ── App store: signed-in user, chosen city, food cart, transient flow state ── */
  var Store = {
    user: null,
    city: 'Mandla',
    cart: (function () {
      try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (_e) { return []; }
    })(),
    // Seat-selection flow state, kept in memory only (never resumed after reload).
    flow: null,

    setCity: function () { Store.city = 'Mandla'; },

    saveCart: function () {
      try { localStorage.setItem(CART_KEY, JSON.stringify(Store.cart)); } catch (_e) {}
      window.dispatchEvent(new CustomEvent('cineflex:cart'));
    },

    cartCount: function () {
      return Store.cart.reduce(function (n, line) { return n + line.qty; }, 0);
    },

    cartTotal: function () {
      return Store.cart.reduce(function (n, line) { return n + line.qty * line.price; }, 0);
    },

    cartQty: function (itemId) {
      var line = Store.cart.find(function (l) { return l.itemId === itemId; });
      return line ? line.qty : 0;
    },

    addToCart: function (item, delta) {
      var idx = Store.cart.findIndex(function (l) { return l.itemId === item.id; });
      if (idx === -1) {
        if (delta > 0) {
          Store.cart.push({ itemId: item.id, name: item.name, price: item.price, imageUrl: item.imageUrl, qty: delta });
        }
      } else {
        Store.cart[idx].qty += delta;
        if (Store.cart[idx].qty <= 0) Store.cart.splice(idx, 1);
      }
      Store.saveCart();
    },

    clearCart: function () {
      Store.cart = [];
      Store.saveCart();
    },
  };

  window.API = API;
  window.Store = Store;
})();
