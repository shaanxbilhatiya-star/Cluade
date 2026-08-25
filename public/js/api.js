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

    // ── Account ──
    updateProfile: function (patch) { return request('PATCH', '/me', patch); },
    updateSettings: function (patch) { return request('PATCH', '/me/settings', patch); },
    watchlist: function () { return request('GET', '/me/watchlist'); },
    toggleWatchlist: function (movieId) { return request('POST', '/me/watchlist', { movieId: movieId }); },
    interests: function () { return request('GET', '/me/interests'); },
    saveInterests: function (payload) { return request('PUT', '/me/interests', payload); },
    paymentMethods: function () { return request('GET', '/me/payment-methods'); },
    addPaymentMethod: function (payload) { return request('POST', '/me/payment-methods', payload); },
    makeDefaultPaymentMethod: function (id) { return request('POST', '/me/payment-methods/' + id + '/default', {}); },
    deletePaymentMethod: function (id) { return request('DELETE', '/me/payment-methods/' + id); },
    notifications: function () { return request('GET', '/me/notifications'); },
    markNotificationsRead: function (ids) { return request('POST', '/me/notifications/read', ids ? { ids: ids } : {}); },
    changePassword: function (currentPassword, newPassword) {
      return request('POST', '/auth/change-password', { currentPassword: currentPassword, newPassword: newPassword });
    },
    review: function (movieId, payload) { return request('POST', '/movies/' + movieId + '/reviews', payload); },
  };

  /* ── App store: signed-in user, chosen city, food cart, transient flow state ── */
  var Store = {
    user: null,
    city: (function () { try { return localStorage.getItem(CITY_KEY) || 'Ahmedabad'; } catch (_e) { return 'Ahmedabad'; } })(),
    cart: (function () {
      try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (_e) { return []; }
    })(),
    // Seat-selection flow state, kept in memory only (never resumed after reload).
    flow: null,

    setCity: function (city) {
      Store.city = city;
      try { localStorage.setItem(CITY_KEY, city); } catch (_e) {}
    },

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
