/* Home tab, global search, "View All" movie lists and the notification inbox. */
(function () {
  'use strict';

  function heroSlide(movie) {
    return '<button class="carousel__slide hero-slide" data-action="movie" data-id="' + UI.esc(movie.id) + '" aria-label="' + UI.esc(movie.title) + '">' +
      '<img src="' + UI.esc(movie.backdropUrl) + '" alt="' + UI.esc(movie.title) + '" data-fallback="/img/posters/_placeholder.svg">' +
      (movie.isComingSoon ? '<span class="hero-slide__tag">Coming ' + UI.esc(UI.shortDate(movie.releaseDate)) + '</span>' : '') +
      '</button>';
  }

  function offerSlide(offer) {
    return '<button class="carousel__slide banner-slide" data-action="offer" data-code="' + UI.esc(offer.code) + '" aria-label="' + UI.esc(offer.title) + '">' +
      '<img src="' + UI.esc(offer.bannerUrl) + '" alt="' + UI.esc(offer.title) + '" data-fallback="/img/banners/best-ticket-offers.svg">' +
      '</button>';
  }

  function cinemaRow(cinema) {
    return '<button class="card cinema-card" data-action="cinema" data-id="' + UI.esc(cinema.id) + '" style="text-align:left">' +
      '<div class="cinema-card__top">' +
        '<div style="flex:1;min-width:0">' +
          '<h3 class="cinema-card__name">' + UI.esc(cinema.name) + '</h3>' +
          '<p class="cinema-card__area">' + UI.esc(cinema.area) + ', ' + UI.esc(cinema.city) + '</p>' +
        '</div>' +
        '<span class="cinema-card__dist">' + UI.esc(cinema.distanceKm) + ' km</span>' +
      '</div>' +
      '<div class="tag-row">' +
        (cinema.facilities || []).slice(0, 3).map(function (f) { return '<span class="tag">' + UI.esc(f) + '</span>'; }).join('') +
      '</div>' +
      '</button>';
  }

  function nextBookingCard(booking) {
    return '<div class="section"><div class="stack">' +
      '<button class="card" data-action="ticket" data-id="' + UI.esc(booking.id) + '" style="text-align:left">' +
        '<div style="display:flex;align-items:center;gap:14px;padding:14px">' +
          '<img src="' + UI.esc(booking.posterUrl) + '" alt="" style="width:52px;height:68px;border-radius:10px;object-fit:cover" data-fallback="/img/posters/_placeholder.svg">' +
          '<div style="flex:1;min-width:0">' +
            '<p style="margin:0;font-size:11px;color:var(--primary-600);font-weight:800;letter-spacing:.6px">YOUR NEXT SHOW</p>' +
            '<h3 style="margin:5px 0 0;font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + UI.esc(booking.title) + '</h3>' +
            '<p style="margin:4px 0 0;font-size:12.5px;color:var(--muted)">' + UI.esc(UI.relativeDay(booking.startsAt)) + ' · ' + UI.esc(UI.hhmm(booking.startsAt)) +
              (booking.seatLabel ? ' · Seats ' + UI.esc(booking.seatLabel) : '') + '</p>' +
          '</div>' +
          '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span>' +
        '</div>' +
      '</button>' +
      '</div></div>';
  }

  function cityPicker(cities, current) {
    var body = UI.h('<div>' +
      cities.map(function (city) {
        return '<button class="option" data-city="' + UI.esc(city) + '" aria-pressed="' + (city === current ? 'true' : 'false') + '" style="margin:0 16px 10px;width:calc(100% - 32px)">' +
          '<span class="option__icon">' + UI.icon('map-pin', 21) + '</span>' +
          '<span class="option__text"><span class="option__title">' + UI.esc(city) + '</span></span>' +
          '<span class="option__radio"></span>' +
          '</button>';
      }).join('') +
      '</div>');

    var sheet = UI.sheet({ title: 'Choose your city', body: body });
    body.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-city]');
      if (!btn) return;
      Store.setCity(btn.getAttribute('data-city'));
      sheet.close();
      App.render();
    });
  }

  window.Screens.home = {
    tab: 'home',
    render: async function () {
      var data = await API.home(Store.city);
      var user = data.user;

      var view = UI.h(
        '<div class="screen">' +
          '<header class="locbar">' +
            '<img class="locbar__avatar" src="' + UI.esc((user && user.avatarUrl) || '/img/avatars/guest.svg') + '" alt="" data-fallback="/img/avatars/guest.svg">' +
            '<div class="locbar__text">' +
              '<div class="locbar__label">Your location</div>' +
              '<button class="locbar__city" data-action="city">' + UI.esc(data.city) + UI.icon('chevron-down', 17) + '</button>' +
            '</div>' +
            '<button class="icon-btn icon-btn--ring icon-btn--badge" data-action="notifications" data-count="' + (data.unreadNotifications || 0) + '" aria-label="Notifications">' +
              UI.icon('bell', 21) +
            '</button>' +
          '</header>' +

          '<div class="scroll">' +
            '<div class="section" style="margin-top:16px">' +
              (data.hero.length ? UI.carousel(data.hero.map(heroSlide), { autoplay: 4500 }) : '') +
            '</div>' +

            (data.nextBooking ? nextBookingCard(data.nextBooking) : '') +

            '<div class="section">' +
              UI.sectionHead('Now Playing', 'all-now-playing') +
              (data.nowPlaying.length
                ? '<div class="rail">' + data.nowPlaying.map(function (m) { return UI.movieCard(m, { book: false }); }).join('') + '</div>'
                : UI.empty({ icon: 'projector', title: 'No shows in ' + data.city, text: 'Try picking another city from the header.' })) +
            '</div>' +

            (data.recommended.length
              ? '<div class="section">' + UI.sectionHead('Because you like ' + (Store.user && Store.user.interests[0] ? Store.user.interests[0] : 'movies')) +
                '<div class="rail">' + data.recommended.map(function (m) { return UI.movieCard(m, { book: false }); }).join('') + '</div></div>'
              : '') +

            '<div class="section">' +
              UI.sectionHead('Coming Soon', 'all-coming-soon') +
              '<div class="rail">' + data.comingSoon.map(function (m) { return UI.movieCard(m, { book: false }); }).join('') + '</div>' +
            '</div>' +

            (data.offers.length
              ? '<div class="section">' + UI.sectionHead('Offers for you') + UI.carousel(data.offers.map(offerSlide), { autoplay: 6000 }) + '</div>'
              : '') +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        city: function () { cityPicker(data.cities.length ? data.cities : [data.city], data.city); },
        notifications: function () { App.navigate('/notifications'); },
        search: function () { App.navigate('/search'); },
        movie: function (el) { App.navigate('/movie/' + el.getAttribute('data-id')); },
        book: function (el) { App.navigate('/movie/' + el.getAttribute('data-id') + '/showtimes'); },
        cinema: function (el) { App.navigate('/cinema/' + el.getAttribute('data-id')); },
        ticket: function (el) { App.navigate('/ticket/' + el.getAttribute('data-id')); },
        offer: function (el) {
          var code = el.getAttribute('data-code');
          navigator.clipboard && navigator.clipboard.writeText(code).catch(function () {});
          UI.toast('Code ' + code + ' copied — use it at checkout', 'success');
        },
        'all-now-playing': function () { App.navigate('/movies/now_playing'); },
        'all-coming-soon': function () { App.navigate('/movies/coming_soon'); },
        'all-cinemas': function () { App.navigate('/cinemas'); },
      });

      view.querySelector('.search-field').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.navigate('/search'); }
      });

      return view;
    },
  };

  // ── View All list ──────────────────────────────────────────────────────────
  window.Screens.movieList = {
    tab: 'home',
    render: async function (params) {
      var status = params.status === 'coming_soon' ? 'coming_soon' : 'now_playing';
      var title = status === 'coming_soon' ? 'Coming Soon' : 'Now Playing';
      var data = await API.movies('status=' + status);
      var all = data.movies;
      var activeGenre = 'All';

      var genres = ['All'].concat(
        Object.keys(all.reduce(function (acc, m) {
          (m.genres || []).forEach(function (g) { acc[g] = true; });
          return acc;
        }, {})).sort()
      );

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: title, back: true }) +
          '<div class="chips" data-genres>' +
            genres.map(function (g) {
              return '<button class="chip" data-genre="' + UI.esc(g) + '" aria-pressed="' + (g === 'All' ? 'true' : 'false') + '">' + UI.esc(g) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="scroll"><div class="spacer-16"></div><div class="grid-2" data-grid></div><div class="spacer-24"></div></div>' +
        '</div>'
      );

      var grid = view.querySelector('[data-grid]');

      function paint() {
        var list = activeGenre === 'All'
          ? all
          : all.filter(function (m) { return (m.genres || []).indexOf(activeGenre) !== -1; });
        grid.innerHTML = list.length
          ? list.map(function (m) { return UI.movieCard(m, { meta: (m.genres || []).slice(0, 2).join(', ') }); }).join('')
          : '';
        grid.style.display = list.length ? '' : 'none';
        var existing = view.querySelector('[data-empty]');
        if (existing) existing.remove();
        if (!list.length) {
          grid.insertAdjacentHTML('afterend', '<div data-empty>' + UI.empty({ icon: 'search', title: 'No ' + activeGenre + ' titles', text: 'Try a different genre.' }) + '</div>');
        }
      }

      view.querySelector('[data-genres]').addEventListener('click', function (event) {
        var chip = event.target.closest('[data-genre]');
        if (!chip) return;
        activeGenre = chip.getAttribute('data-genre');
        view.querySelectorAll('[data-genre]').forEach(function (c) {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        paint();
      });

      UI.actions(view, {
        movie: function (el) { App.navigate('/movie/' + el.getAttribute('data-id')); },
        book: function (el) { App.navigate('/movie/' + el.getAttribute('data-id') + '/showtimes'); },
      });

      // Movie cards render at a fixed rail width; let them fill the grid instead.
      grid.style.setProperty('--card-w', 'auto');
      paint();
      var style = document.createElement('style');
      style.textContent = '[data-grid] .movie-card{width:100%}';
      view.appendChild(style);

      return view;
    },
  };

  // ── Search ─────────────────────────────────────────────────────────────────
  window.Screens.search = {
    tab: 'home',
    render: async function () {
      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Search', back: true }) +
          '<div class="search-field">' + UI.icon('search', 19) +
            '<input type="search" placeholder="Movies, cinemas or snacks" autocomplete="off" data-input>' +
            '<button class="icon-btn" data-clear aria-label="Clear" style="width:26px;height:26px;display:none">' + UI.icon('close', 17) + '</button>' +
          '</div>' +
          '<div class="scroll" data-results>' +
            UI.empty({ icon: 'search', title: 'Search CineFlex', text: 'Find a movie, a cinema near you, or something to eat.' }) +
          '</div>' +
        '</div>'
      );

      var input = view.querySelector('[data-input]');
      var clear = view.querySelector('[data-clear]');
      var results = view.querySelector('[data-results]');
      var timer = null;
      var seq = 0;

      function paint(data) {
        if (!data.movies.length && !data.cinemas.length && !data.food.length) {
          results.innerHTML = UI.empty({ icon: 'search', title: 'No matches', text: 'Nothing found for “' + data.query + '”.' });
          return;
        }
        results.innerHTML =
          (data.movies.length
            ? '<div class="section" style="margin-top:14px">' + UI.sectionHead('Movies') +
              '<div class="rail">' + data.movies.map(function (m) { return UI.movieCard(m); }).join('') + '</div></div>'
            : '') +
          (data.cinemas.length
            ? '<div class="section">' + UI.sectionHead('Cinemas') + '<div class="stack">' +
              data.cinemas.map(function (c) {
                return '<button class="card cinema-card" data-action="cinema" data-id="' + UI.esc(c.id) + '" style="text-align:left">' +
                  '<div class="cinema-card__top"><div style="flex:1"><h3 class="cinema-card__name">' + UI.esc(c.name) + '</h3>' +
                  '<p class="cinema-card__area">' + UI.esc(c.area) + ', ' + UI.esc(c.city) + '</p></div>' +
                  '<span class="cinema-card__dist">' + UI.esc(c.distanceKm) + ' km</span></div></button>';
              }).join('') + '</div></div>'
            : '') +
          (data.food.length
            ? '<div class="section">' + UI.sectionHead('Food & drinks') +
              '<div class="rail">' + data.food.map(UI.foodCard).join('') + '</div></div>'
            : '') +
          '<div class="spacer-24"></div>';
      }

      input.addEventListener('input', function () {
        var query = input.value.trim();
        clear.style.display = query ? '' : 'none';
        window.clearTimeout(timer);
        if (!query) {
          results.innerHTML = UI.empty({ icon: 'search', title: 'Search CineFlex', text: 'Find a movie, a cinema near you, or something to eat.' });
          return;
        }
        timer = window.setTimeout(async function () {
          var token = ++seq;
          try {
            var data = await API.search(query);
            if (token === seq) paint(data);
          } catch (err) {
            if (token === seq) UI.toast(err.message, 'error');
          }
        }, 220);
      });

      clear.addEventListener('click', function () {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        input.focus();
      });

      UI.actions(view, {
        movie: function (el) { App.navigate('/movie/' + el.getAttribute('data-id')); },
        book: function (el) { App.navigate('/movie/' + el.getAttribute('data-id') + '/showtimes'); },
        cinema: function (el) { App.navigate('/cinema/' + el.getAttribute('data-id')); },
        'food-item': function (el) { App.navigate('/food/' + el.getAttribute('data-id')); },
      });

      setTimeout(function () { input.focus(); }, 60);
      return view;
    },
  };

  // ── Notification inbox ─────────────────────────────────────────────────────
  window.Screens.notifications = {
    auth: true,
    render: async function () {
      var data = await API.notifications();

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({
            title: 'Notifications',
            back: true,
            right: data.unread
              ? '<button class="icon-btn" data-action="read-all" aria-label="Mark all read">' + UI.icon('check', 22) + '</button>'
              : '<span class="appbar__spacer"></span>',
          }) +
          '<div class="scroll">' +
            (data.notifications.length
              ? '<div class="list">' + data.notifications.map(function (n) {
                  return '<div class="notif">' +
                    '<span class="notif__dot' + (n.read ? ' notif__dot--read' : '') + '"></span>' +
                    '<div style="flex:1">' +
                      '<div class="notif__title">' + UI.esc(n.title) + '</div>' +
                      '<div class="notif__body">' + UI.esc(n.body) + '</div>' +
                      '<div class="notif__time">' + UI.esc(UI.timeAgo(n.createdAt)) + '</div>' +
                    '</div></div>';
                }).join('') + '</div>'
              : UI.empty({ icon: 'bell', title: 'No notifications', text: 'Booking updates and offers will show up here.' })) +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        'read-all': async function () {
          try {
            await API.markNotificationsRead();
            UI.toast('All caught up', 'success');
            App.render();
          } catch (err) { UI.toast(err.message, 'error'); }
        },
      });

      return view;
    },
  };
})();
