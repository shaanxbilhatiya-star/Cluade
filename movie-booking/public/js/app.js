/* App shell: hash router, bottom navigation, theme and boot sequence. */
(function () {
  'use strict';

  var THEME_KEY = 'cineflex.theme';
  var appEl = document.getElementById('app');

  var TABS = [
    { id: 'home', label: 'Home', icon: 'home', path: '/home' },
    { id: 'cinemas', label: 'Cinemas', icon: 'grid', path: '/cinemas' },
    { id: 'food', label: 'Food Order', icon: 'food', path: '/food' },
    { id: 'tickets', label: 'My Tickets', icon: 'ticket', path: '/tickets' },
    { id: 'account', label: 'Account', icon: 'user', path: '/account' },
  ];

  /* Longest-first matching is not needed because patterns are checked in order. */
  var ROUTES = [
    ['/login', 'login'],
    ['/register', 'register'],
    ['/home', 'home'],
    ['/search', 'search'],
    ['/notifications', 'notifications'],
    ['/movies/:status', 'movieList'],
    ['/movie/:id/showtimes', 'showtimeSelect'],
    ['/movie/:id', 'movieDetail'],
    ['/cinemas', 'cinemas'],
    ['/cinema/:id', 'cinemaDetail'],
    ['/food/cart', 'cart'],
    ['/food/:id', 'foodItem'],
    ['/food', 'food'],
    ['/seats/:showtimeId', 'seatSelect'],
    ['/checkout', 'checkout'],
    ['/confirmed/:bookingId', 'confirmation'],
    ['/tickets', 'tickets'],
    ['/ticket/:id', 'ticketDetail'],
    ['/account/watchlist', 'watchlist'],
    ['/account/interests', 'interests'],
    ['/account/payments', 'payments'],
    ['/account/profile', 'personalInfo'],
    ['/account/notifications', 'notificationSettings'],
    ['/account/security', 'security'],
    ['/account/language', 'language'],
    ['/account/help', 'help'],
    ['/account/about', 'about'],
    ['/account', 'account'],
  ];

  window.Screens = window.Screens || {};

  // ── Theme ────────────────────────────────────────────────────────────────
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1A1626' : '#5B21B6');
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (_e) {}
  }

  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (_e) { return null; }
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  function currentPath() {
    var hash = window.location.hash.replace(/^#/, '');
    return hash || '/home';
  }

  function match(path) {
    var clean = path.split('?')[0];
    var parts = clean.split('/').filter(Boolean);

    for (var i = 0; i < ROUTES.length; i += 1) {
      var pattern = ROUTES[i][0].split('/').filter(Boolean);
      if (pattern.length !== parts.length) continue;
      var params = {};
      var ok = true;
      for (var j = 0; j < pattern.length; j += 1) {
        if (pattern[j].charAt(0) === ':') params[pattern[j].slice(1)] = decodeURIComponent(parts[j]);
        else if (pattern[j] !== parts[j]) { ok = false; break; }
      }
      if (ok) return { name: ROUTES[i][1], params: params, query: queryOf(path) };
    }
    return null;
  }

  function queryOf(path) {
    var idx = path.indexOf('?');
    var out = {};
    if (idx === -1) return out;
    new URLSearchParams(path.slice(idx + 1)).forEach(function (value, key) { out[key] = value; });
    return out;
  }

  function navigate(path, options) {
    var target = '#' + path;
    if (options && options.replace) window.location.replace(target);
    else window.location.hash = path;
  }

  function back(fallback) {
    if (window.history.length > 1) window.history.back();
    else navigate(fallback || '/home', { replace: true });
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  var renderToken = 0;

  function tabbar(activeId) {
    return UI.h(
      '<nav class="tabbar" aria-label="Main navigation">' +
        TABS.map(function (tab) {
          var active = tab.id === activeId;
          return '<button class="tabbar__item" data-tab="' + tab.id + '"' + (active ? ' aria-current="page"' : '') + '>' +
            UI.icon(tab.icon, 23, { solid: active }) +
            '<span>' + tab.label + '</span></button>';
        }).join('') +
      '</nav>'
    );
  }

  function fatal(message, retryPath) {
    var view = UI.h(
      '<div class="screen">' +
        UI.appbar({ title: 'Something went wrong' }) +
        '<div class="scroll">' +
          UI.empty({ icon: 'alert-circle', title: 'We hit a snag', text: message, action: 'retry', actionLabel: 'Try again' }) +
        '</div>' +
      '</div>'
    );
    UI.actions(view, {
      retry: function () { render(retryPath || currentPath()); },
    });
    return view;
  }

  async function render(path) {
    var token = ++renderToken;
    var route = match(path);

    if (!route || !window.Screens[route.name]) {
      navigate('/home', { replace: true });
      return;
    }

    var screen = window.Screens[route.name];

    if (screen.auth && !API.isSignedIn()) {
      sessionStorage.setItem('cineflex.returnTo', path);
      navigate('/login', { replace: true });
      return;
    }

    var view;
    try {
      view = await screen.render(route.params, route.query);
    } catch (err) {
      if (token !== renderToken) return;
      console.error('[render]', route.name, err);
      view = fatal(err.message || 'Unexpected error', path);
    }
    if (token !== renderToken) return;

    appEl.innerHTML = '';
    appEl.appendChild(view);

    var tabId = typeof screen.tab === 'function' ? screen.tab(route.params) : screen.tab;
    if (tabId) {
      var nav = tabbar(tabId);
      nav.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-tab]');
        if (!btn) return;
        var tab = TABS.find(function (t) { return t.id === btn.getAttribute('data-tab'); });
        if (tab) navigate(tab.path);
      });
      appEl.appendChild(nav);
    }

    // Shared behaviours available to every screen
    view.querySelectorAll('[data-action="back"]').forEach(function (btn) {
      btn.addEventListener('click', function () { back(screen.backTo); });
    });
    UI.initCarousels(view);

    var scroller = view.querySelector('.scroll');
    if (scroller && tabId) scroller.classList.add('scroll--nav');
    if (scroller) scroller.scrollTop = 0;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  /** Surface unexpected failures instead of leaving the user on a blank screen. */
  function installErrorHandlers() {
    window.addEventListener('error', function (event) {
      console.error('[uncaught]', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', function (event) {
      console.error('[unhandled rejection]', event.reason);
      var message = (event.reason && event.reason.message) || 'Something went wrong';
      if (window.UI) UI.toast(message, 'error');
    });
  }

  async function boot() {
    installErrorHandlers();
    applyTheme(storedTheme() === 'dark');

    if (API.isSignedIn()) {
      try {
        var res = await API.me();
        Store.user = res.user;
        Store.stats = res.stats;
        if (res.user.city) Store.setCity(res.user.city);
        if (res.user.settings && typeof res.user.settings.darkMode === 'boolean') {
          applyTheme(res.user.settings.darkMode);
        }
      } catch (err) {
        // An invalid/expired token is cleared by the API layer; carry on as guest.
        if (err.status !== 401) console.warn('[boot] profile load failed:', err.message);
      }
    }

    window.addEventListener('hashchange', function () { render(currentPath()); });

    window.addEventListener('cineflex:signed-out', function () {
      Store.user = null;
      UI.toast('Your session expired. Please sign in again.', 'error');
      navigate('/login', { replace: true });
    });

    if (!window.location.hash) navigate('/home', { replace: true });
    render(currentPath());
  }

  window.App = {
    navigate: navigate,
    back: back,
    render: function () { render(currentPath()); },
    applyTheme: applyTheme,
    isDark: isDark,
    tabbar: tabbar,
    TABS: TABS,

    /** Sign the current user out and return to the sign-in screen. */
    signOut: function () {
      API.setToken(null);
      Store.user = null;
      Store.flow = null;
      Store.clearCart();
      navigate('/login', { replace: true });
    },

    /** After a successful login/register, resume whatever the user was doing. */
    afterAuth: function (payload) {
      API.setToken(payload.token);
      Store.user = payload.user;
      if (payload.user.city) Store.setCity(payload.user.city);
      if (payload.user.settings && typeof payload.user.settings.darkMode === 'boolean') {
        applyTheme(payload.user.settings.darkMode);
      }
      var returnTo = sessionStorage.getItem('cineflex.returnTo');
      sessionStorage.removeItem('cineflex.returnTo');
      navigate(returnTo || '/home', { replace: true });
    },
  };

  boot();
})();
