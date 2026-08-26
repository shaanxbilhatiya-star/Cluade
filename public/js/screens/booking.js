/* The booking journey: movie detail → showtime → seat map → payment → ticket. */
(function () {
  'use strict';

  var TIER_LABEL = { regular: 'Regular', premium: 'Premium', vip: 'VIP Recliner' };

  function datePill(dateKey, selected) {
    var d = UI.toDate(dateKey);
    return '<button class="date-pill" data-date="' + UI.esc(dateKey) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<div class="date-pill__dow">' + UI.DOW[d.getDay()] + '</div>' +
      '<div class="date-pill__day">' + d.getDate() + '</div>' +
      '<div class="date-pill__mon">' + UI.MONTHS[d.getMonth()] + '</div>' +
      '</button>';
  }

  // ── Movie detail ───────────────────────────────────────────────────────────
  window.Screens.movieDetail = {
    render: async function (params) {
      var movie = await API.movie(params.id);
      var inWatchlist = Boolean(Store.user && (Store.user.watchlist || []).indexOf(movie.id) !== -1);
      var isComingSoon = movie.status === 'coming_soon';

      var view = UI.h(
        '<div class="screen">' +
          '<div class="scroll" style="padding-bottom:0">' +
            '<div class="detail-hero">' +
              '<img src="' + UI.esc(movie.backdropUrl) + '" alt="" data-fallback="/img/posters/_placeholder.svg">' +
              '<div class="detail-hero__scrim"></div>' +
              '<div class="detail-hero__bar">' +
                '<button class="icon-btn" data-action="back" aria-label="Go back">' + UI.icon('arrow-left', 23) + '</button>' +
                '<div style="display:flex;gap:8px">' +
                  '<button class="icon-btn" data-action="watchlist" aria-pressed="' + inWatchlist + '" aria-label="Add to watchlist">' +
                    UI.icon('heart', 21, { solid: false }) + '</button>' +
                  '<button class="icon-btn" data-action="share" aria-label="Share">' + UI.icon('share', 20) + '</button>' +
                '</div>' +
              '</div>' +
              (movie.trailerUrl ? '<button class="detail-hero__play" data-action="trailer" aria-label="Watch trailer">' + UI.icon('play', 26, { solid: true }) + '</button>' : '') +
            '</div>' +

            '<div class="detail-head">' +
              '<h1 class="detail-head__title">' + UI.esc(movie.title) + '</h1>' +
              (movie.tagline ? '<p class="detail-head__tagline">' + UI.esc(movie.tagline) + '</p>' : '') +
              '<div class="tag-row" style="margin-top:12px">' +
                (movie.genres || []).map(function (g) { return '<span class="tag tag--accent">' + UI.esc(g) + '</span>'; }).join('') +
              '</div>' +
            '</div>' +

            '<div class="metrics">' +
              (movie.rating
                ? '<div class="metric"><div class="metric__value" style="color:var(--primary-600)">' + UI.icon('star', 16) + Number(movie.rating).toFixed(1) + '</div>' +
                  '<div class="metric__label">' + (movie.votes ? (movie.votes / 1000).toFixed(0) + 'K votes' : 'Rating') + '</div></div>'
                : '') +
              '<div class="metric"><div class="metric__value">' + UI.esc(UI.runtime(movie.runtime)) + '</div><div class="metric__label">Runtime</div></div>' +
              '<div class="metric"><div class="metric__value">' + UI.esc(movie.certificate) + '</div><div class="metric__label">Rated</div></div>' +
              '<div class="metric"><div class="metric__value">' + UI.esc((movie.languages || [])[0] || '—') + '</div><div class="metric__label">Language</div></div>' +
            '</div>' +

            '<h2 class="subhead">Synopsis</h2>' +
            '<p class="prose">' + UI.esc(movie.synopsis) + '</p>' +

            '<h2 class="subhead">Details</h2>' +
            '<div style="padding:0 16px">' +
              '<div class="kv"><span class="kv__key">Director</span><span class="kv__val">' + UI.esc(movie.director || '—') + '</span></div>' +
              '<div class="kv"><span class="kv__key">Release date</span><span class="kv__val">' + UI.esc(UI.shortDate(movie.releaseDate)) + '</span></div>' +
              '<div class="kv"><span class="kv__key">Languages</span><span class="kv__val">' + UI.esc((movie.languages || []).join(', ')) + '</span></div>' +
              '<div class="kv"><span class="kv__key">Formats</span><span class="kv__val">' + UI.esc((movie.formats || []).join(', ')) + '</span></div>' +
            '</div>' +

            (movie.cast && movie.cast.length
              ? '<h2 class="subhead">Cast</h2><div class="cast-rail">' +
                movie.cast.map(function (name) {
                  return '<div class="cast"><div class="cast__avatar">' + UI.esc(UI.initials(name)) + '</div>' +
                    '<div class="cast__name">' + UI.esc(name) + '</div></div>';
                }).join('') + '</div>'
              : '') +

            (movie.playingAt && movie.playingAt.length
              ? '<h2 class="subhead">Playing at</h2><div class="tag-row" style="padding:0 16px">' +
                movie.playingAt.map(function (c) { return '<span class="tag">' + UI.esc(c.name) + '</span>'; }).join('') + '</div>'
              : '') +

            '<h2 class="subhead">Reviews' + (movie.reviews.count ? ' (' + movie.reviews.count + ')' : '') + '</h2>' +
            '<div class="list">' +
              (movie.reviewList.length
                ? movie.reviewList.slice(0, 5).map(function (r) {
                    return '<div class="review">' +
                      '<div class="review__head">' +
                        '<img class="review__avatar" src="' + UI.esc(r.author.avatarUrl) + '" alt="" data-fallback="/img/avatars/guest.svg">' +
                        '<span class="review__name">' + UI.esc(r.author.name) + '</span>' +
                        '<span class="review__score">' + r.rating + '/10</span>' +
                      '</div>' +
                      (r.text ? '<p class="review__text">' + UI.esc(r.text) + '</p>' : '') +
                      '</div>';
                  }).join('')
                : '<p class="prose" style="padding:0;color:var(--muted);font-size:13.5px">No reviews yet — be the first.</p>') +
            '</div>' +
            (movie.reviewList.length > 5
              ? '<div style="padding:8px 16px 0"><button class="btn-outline btn-outline--lg" data-action="view-all-reviews">View All ' + movie.reviewList.length + ' Reviews</button></div>'
              : '') +
            '<div style="padding:14px 16px 0"><button class="btn-outline btn-outline--lg" data-action="review">' + UI.icon('edit', 16) + ' Write a review</button></div>' +

            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar">' +
            (isComingSoon
              ? '<button class="btn" data-action="watchlist-cta">' + (inWatchlist ? 'In your watchlist' : 'Notify me on release') + '</button>'
              : '<div class="actionbar__price"><div class="actionbar__label">Now playing</div>' +
                '<div class="actionbar__value" style="font-size:15px">' + UI.esc(movie.showtimeCount) + ' shows</div></div>' +
                '<button class="btn" data-action="book">Book tickets</button>') +
          '</div>' +
        '</div>'
      );

      function paintHeart(on) {
        var btn = view.querySelector('[data-action="watchlist"]');
        btn.setAttribute('aria-pressed', String(on));
        btn.innerHTML = UI.icon('heart', 21, { solid: on });
        btn.style.color = on ? '#FB7185' : '#fff';
        var cta = view.querySelector('[data-action="watchlist-cta"]');
        if (cta) cta.textContent = on ? 'In your watchlist' : 'Notify me on release';
      }

      async function toggleWatchlist() {
        if (!API.isSignedIn()) {
          sessionStorage.setItem('cineflex.returnTo', '/movie/' + movie.id);
          App.navigate('/login');
          return;
        }
        try {
          var res = await API.toggleWatchlist(movie.id);
          inWatchlist = res.inWatchlist;
          if (Store.user) Store.user.watchlist = res.watchlist;
          paintHeart(inWatchlist);
          UI.toast(inWatchlist ? 'Added to your watchlist' : 'Removed from your watchlist', 'success');
        } catch (err) { UI.toast(err.message, 'error'); }
      }

      UI.actions(view, {
        watchlist: toggleWatchlist,
        'watchlist-cta': toggleWatchlist,
        book: function () { App.navigate('/movie/' + movie.id + '/showtimes'); },
        trailer: function () {
          // Extract YouTube video ID from embed URL and show inline iframe
          var url = movie.trailerUrl || '';
          var videoId = '';
          var m = url.match(/\/embed\/([^?/]+)/);
          if (m) videoId = m[1];
          else {
            m = url.match(/[?&]v=([^&]+)/);
            if (m) videoId = m[1];
          }
          if (!videoId) { UI.toast('Trailer not available', 'error'); return; }

          var body = UI.h(
            '<div style="padding:0 16px 16px">' +
              '<div style="position:relative;width:100%;padding-bottom:56.25%;border-radius:14px;overflow:hidden;background:#000">' +
                '<iframe src="https://www.youtube.com/embed/' + UI.esc(videoId) + '?autoplay=1&rel=0&modestbranding=1&fs=0" ' +
                  'style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ' +
                  'allow="autoplay; encrypted-media" allowfullscreen="false" ' +
                  'sandbox="allow-scripts allow-same-origin" ' +
                  'title="' + UI.esc(movie.title) + ' trailer"></iframe>' +
              '</div>' +
              '<p style="margin:14px 0 0;font-size:12.5px;color:var(--muted);text-align:center">' + UI.esc(movie.title) + ' — Official Trailer</p>' +
            '</div>'
          );
          UI.sheet({ title: 'Trailer', body: body });
        },
        'view-all-reviews': function () {
          var body = UI.h(
            '<div style="padding:0 16px 16px">' +
              movie.reviewList.map(function (r) {
                return '<div class="review">' +
                  '<div class="review__head">' +
                    '<img class="review__avatar" src="' + UI.esc(r.author.avatarUrl) + '" alt="" data-fallback="/img/avatars/guest.svg">' +
                    '<span class="review__name">' + UI.esc(r.author.name) + '</span>' +
                    '<span class="review__score">' + r.rating + '/10</span>' +
                  '</div>' +
                  (r.text ? '<p class="review__text">' + UI.esc(r.text) + '</p>' : '') +
                  '</div>';
              }).join('') +
            '</div>'
          );
          UI.sheet({ title: 'All Reviews (' + movie.reviewList.length + ')', body: body });
        },
        share: async function () {
          var text = movie.title + ' — ' + (movie.tagline || 'now on CineFlex');
          if (navigator.share) {
            try { await navigator.share({ title: movie.title, text: text, url: window.location.href }); return; } catch (_e) {}
          }
          if (navigator.clipboard) {
            try { await navigator.clipboard.writeText(window.location.href); UI.toast('Link copied', 'success'); return; } catch (_e) {}
          }
        },
        review: function () {
          if (!API.isSignedIn()) {
            sessionStorage.setItem('cineflex.returnTo', '/movie/' + movie.id);
            App.navigate('/login');
            return;
          }
          var chosen = 8;
          var form = UI.h(
            '<form style="padding:0 0 10px">' +
              '<div style="display:flex;justify-content:center;gap:6px;padding:4px 16px 18px" data-stars></div>' +
              '<div class="field"><label class="field__label" for="rtext">Your review (optional)</label>' +
                '<div class="field__control"><textarea id="rtext" name="text" placeholder="What did you think?" maxlength="600"></textarea></div></div>' +
              '<div style="padding:0 16px"><button class="btn" type="submit">Post review</button></div>' +
            '</form>'
          );
          var stars = form.querySelector('[data-stars]');

          function paintStars() {
            stars.innerHTML = Array.from({ length: 10 }, function (_x, i) {
              var n = i + 1;
              return '<button type="button" data-star="' + n + '" aria-label="' + n + ' out of 10" ' +
                'style="color:' + (n <= chosen ? 'var(--primary-600)' : 'var(--line-strong)') + '">' + UI.icon('star', 20, { solid: n <= chosen }) + '</button>';
            }).join('');
          }
          stars.addEventListener('click', function (e) {
            var b = e.target.closest('[data-star]');
            if (!b) return;
            chosen = Number(b.getAttribute('data-star'));
            paintStars();
          });
          paintStars();

          var sheet = UI.sheet({ title: 'Rate ' + movie.title, body: form });
          form.addEventListener('submit', async function (e) {
            e.preventDefault();
            try {
              await API.review(movie.id, { rating: chosen, text: form.text.value.trim() });
              sheet.close();
              UI.toast('Thanks for your review!', 'success');
              App.render();
            } catch (err) { UI.toast(err.message, 'error'); }
          });
        },
      });

      paintHeart(inWatchlist);
      return view;
    },
  };

  // ── Showtime selection ─────────────────────────────────────────────────────
  window.Screens.showtimeSelect = {
    render: async function (params) {
      var initial = await API.movieShowtimes(params.id, { city: Store.city });
      var movie = initial.movie;

      var today = new Date();
      var todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      var dates = initial.dates.filter(function (d) { return d >= todayKey; });
      var selected = dates[0] || todayKey;

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: movie.title, back: true, alignLeft: true, logo: false }) +
          '<div class="datestrip" data-dates>' + dates.map(function (d) { return datePill(d, d === selected); }).join('') + '</div>' +
          '<div class="scroll"><div data-list></div><div class="spacer-24"></div></div>' +
        '</div>'
      );

      var list = view.querySelector('[data-list]');

      async function load(dateKey) {
        selected = dateKey;
        view.querySelectorAll('[data-date]').forEach(function (p) {
          p.setAttribute('aria-pressed', p.getAttribute('data-date') === dateKey ? 'true' : 'false');
        });
        list.innerHTML = UI.spinnerBlock();

        var data;
        try {
          data = await API.movieShowtimes(params.id, { city: Store.city, date: dateKey });
        } catch (err) {
          list.innerHTML = UI.empty({ icon: 'alert-circle', title: 'Could not load showtimes', text: err.message });
          return;
        }

        var groups = data.cinemas.filter(function (g) { return g.shows.some(function (s) { return !s.isPast; }); });

        list.innerHTML = groups.length
          ? groups.map(function (group) {
              return '<div class="card" style="margin:14px 16px 0">' +
                '<div style="padding:15px">' +
                  '<div style="display:flex;align-items:flex-start;gap:12px">' +
                    '<div style="flex:1;min-width:0">' +
                      '<h3 class="cinema-card__name">' + UI.esc(group.cinema.name) + '</h3>' +
                      '<p class="cinema-card__area">' + UI.esc(group.cinema.area) + ' · ' + UI.esc(group.cinema.distanceKm) + ' km</p>' +
                    '</div>' +
                    '<button class="icon-btn" data-action="cinema" data-id="' + UI.esc(group.cinema.id) + '" aria-label="Cinema details" style="width:32px;height:32px;color:var(--muted)">' +
                      UI.icon('info', 19) + '</button>' +
                  '</div>' +
                  '<div class="showtimes">' +
                    group.shows.map(function (s) {
                      return '<button class="showtime" data-action="seats" data-id="' + UI.esc(s.id) + '"' + (s.isPast ? ' disabled' : '') + '>' +
                        '<div class="showtime__time">' + UI.esc(s.time) + '</div>' +
                        '<div class="showtime__meta">' + UI.esc(s.screenName) + ' · ' + UI.money(s.prices.regular) + '</div>' +
                        '</button>';
                    }).join('') +
                  '</div>' +
                  '<div class="tag-row">' +
                    (group.cinema.facilities || []).slice(0, 3).map(function (f) { return '<span class="tag">' + UI.esc(f) + '</span>'; }).join('') +
                  '</div>' +
                '</div></div>';
            }).join('')
          : UI.empty({
              icon: 'projector', title: 'No shows on ' + UI.relativeDay(dateKey),
              text: 'Try another date, or change your city from the Home screen.',
            });
      }

      view.querySelector('[data-dates]').addEventListener('click', function (event) {
        var pill = event.target.closest('[data-date]');
        if (pill) load(pill.getAttribute('data-date'));
      });

      UI.actions(view, {
        seats: function (el) { App.navigate('/seats/' + el.getAttribute('data-id')); },
        cinema: function (el) { App.navigate('/cinema/' + el.getAttribute('data-id')); },
      });

      await load(selected);
      return view;
    },
  };

  // ── Seat selection ─────────────────────────────────────────────────────────
  window.Screens.seatSelect = {
    auth: true,
    render: async function (params) {
      var data = await API.seats(params.showtimeId);
      var show = data.showtime;
      var chosen = [];
      var MAX = 10;

      var priceOf = {};
      data.rows.forEach(function (row) {
        row.seats.forEach(function (seat) { priceOf[seat.id] = seat.price; });
      });

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: show.movie.title, back: true, alignLeft: true, logo: false }) +
          '<div style="padding:0 16px 12px;margin-top:-4px">' +
            '<p style="margin:0;font-size:13px;color:var(--muted)">' +
              UI.esc(show.cinema.name) + ' · ' + UI.esc(show.screen.name) + '<br>' +
              UI.esc(UI.relativeDay(show.date)) + ', ' + UI.esc(show.time) + ' · ' + UI.esc(show.format) + ' · ' + UI.esc(show.language) +
            '</p>' +
          '</div>' +

          '<div class="scroll">' +
            '<div class="screen-curve">' +
              '<svg viewBox="0 0 300 34" preserveAspectRatio="none" aria-hidden="true">' +
                '<path d="M4 30 Q150 0 296 30" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>' +
              '</svg>' +
              '<span>Screen this way</span>' +
            '</div>' +

            '<div class="seat-scroll"><div class="seat-rows" data-rows>' +
              data.rows.map(function (row) {
                return '<div class="seat-row">' +
                  '<span class="seat-row__label">' + UI.esc(row.row) + '</span>' +
                  row.seats.map(function (seat) {
                    return '<button class="seat' + (seat.gapAfter ? ' seat--gap' : '') + '" ' +
                      'data-seat="' + UI.esc(seat.id) + '" data-tier="' + UI.esc(seat.tier) + '" data-status="' + UI.esc(seat.status) + '" ' +
                      'aria-pressed="false" aria-label="Seat ' + UI.esc(seat.id) + ', ' + UI.esc(TIER_LABEL[seat.tier] || seat.tier) + ', ' + UI.money(seat.price) + '"' +
                      (seat.status !== 'available' ? ' disabled' : '') + '>' + seat.number + '</button>';
                  }).join('') +
                  '<span class="seat-row__label">' + UI.esc(row.row) + '</span>' +
                  '</div>';
              }).join('') +
            '</div></div>' +

            '<div class="legend">' +
              data.tiers.map(function (t) {
                return '<span class="legend__item"><span class="legend__swatch" style="background:' +
                  (t.tier === 'premium' ? 'color-mix(in srgb, var(--primary-600) 16%, var(--seat-available))'
                    : t.tier === 'vip' ? 'color-mix(in srgb, #D97706 22%, var(--seat-available))'
                    : 'var(--seat-available)') + '"></span>' +
                  UI.esc(TIER_LABEL[t.tier] || t.tier) + ' ' + UI.money(t.price) + '</span>';
              }).join('') +
              '<span class="legend__item"><span class="legend__swatch" style="background:var(--primary-600)"></span>Selected</span>' +
              '<span class="legend__item"><span class="legend__swatch" style="background:var(--line-strong);opacity:.55"></span>Taken</span>' +
            '</div>' +

            '<p class="text-center text-muted" style="font-size:12px;margin:4px 0 0">' +
              UI.esc(data.stats.available) + ' of ' + UI.esc(data.stats.total) + ' seats available · up to ' + MAX + ' per booking</p>' +
            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label" data-count>No seats selected</div>' +
              '<div class="actionbar__value" data-total>' + UI.money(0) + '</div>' +
            '</div>' +
            '<button class="btn" data-action="proceed" disabled>Proceed</button>' +
          '</div>' +
        '</div>'
      );

      var countEl = view.querySelector('[data-count]');
      var totalEl = view.querySelector('[data-total]');
      var proceedBtn = view.querySelector('[data-action="proceed"]');

      function sync() {
        var total = chosen.reduce(function (sum, id) { return sum + priceOf[id]; }, 0);
        countEl.textContent = chosen.length ? chosen.join(', ') : 'No seats selected';
        totalEl.textContent = UI.money(total);
        proceedBtn.disabled = chosen.length === 0;
        proceedBtn.textContent = chosen.length ? 'Proceed (' + chosen.length + ')' : 'Proceed';
      }

      view.querySelector('[data-rows]').addEventListener('click', function (event) {
        var btn = event.target.closest('[data-seat]');
        if (!btn || btn.disabled) return;
        var id = btn.getAttribute('data-seat');
        var idx = chosen.indexOf(id);
        if (idx === -1) {
          if (chosen.length >= MAX) { UI.toast('You can book up to ' + MAX + ' seats at once', 'error'); return; }
          chosen.push(id);
          btn.setAttribute('aria-pressed', 'true');
        } else {
          chosen.splice(idx, 1);
          btn.setAttribute('aria-pressed', 'false');
        }
        sync();
      });

      UI.actions(view, {
        proceed: async function (el) {
          el.disabled = true;
          el.textContent = 'Holding seats…';
          try {
            var res = await API.hold(show.id, chosen);
            Store.flow = {
              holdId: res.hold.id,
              showtimeId: show.id,
              show: show,
              seats: res.hold.seats,
              expiresAt: res.hold.expiresAt,
            };
            App.navigate('/checkout');
          } catch (err) {
            UI.toast(err.message, 'error');
            el.disabled = false;
            sync();
            if (err.status === 409) App.render(); // somebody else took them — reload the map
          }
        },
      });

      sync();
      return view;
    },
  };

  // ── Checkout ───────────────────────────────────────────────────────────────
  window.Screens.checkout = {
    auth: true,
    render: async function () {
      var flow = Store.flow;
      if (!flow || new Date(flow.expiresAt).getTime() <= Date.now()) {
        UI.toast('Your seat hold expired — please choose seats again', 'error');
        App.navigate(flow ? '/seats/' + flow.showtimeId : '/home', { replace: true });
        return UI.h('<div class="screen"><div class="scroll">' + UI.spinnerBlock() + '</div></div>');
      }

      var results = await Promise.all([API.me(), API.offers(), API.food('popular=true&limit=8')]);
      var profile = results[0];
      var offers = results[1].offers;
      var snacks = results[2].items;

      var state = {
        offerCode: null,
        payment: (profile.user.paymentMethods || []).find(function (m) { return m.isDefault; }) || null,
        food: {},
        totals: null,
      };

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Checkout', back: true }) +
          '<div class="hold-timer" data-timer>' + UI.icon('clock', 16) + '<span>Holding your seats…</span></div>' +
          '<div class="scroll" data-body></div>' +
          '<div class="actionbar">' +
            '<div class="actionbar__price">' +
              '<div class="actionbar__label">Total payable</div>' +
              '<div class="actionbar__value" data-total>—</div>' +
            '</div>' +
            '<button class="btn" data-action="pay">Pay now</button>' +
          '</div>' +
        '</div>'
      );

      var body = view.querySelector('[data-body]');
      var totalEl = view.querySelector('[data-total]');
      var timerEl = view.querySelector('[data-timer]');

      // ── hold countdown ──
      var timer = setInterval(function () {
        if (!document.body.contains(view)) { clearInterval(timer); return; }
        var msLeft = new Date(flow.expiresAt).getTime() - Date.now();
        if (msLeft <= 0) {
          clearInterval(timer);
          Store.flow = null;
          UI.toast('Seat hold expired — please select seats again', 'error');
          App.navigate('/seats/' + flow.showtimeId, { replace: true });
          return;
        }
        var secs = Math.round(msLeft / 1000);
        timerEl.classList.toggle('hold-timer--warn', secs <= 120);
        timerEl.innerHTML = UI.icon('clock', 16) +
          '<span>Seats held for ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') + '</span>';
      }, 1000);

      function foodLines() {
        return Object.keys(state.food)
          .filter(function (id) { return state.food[id] > 0; })
          .map(function (id) { return { itemId: id, qty: state.food[id] }; });
      }

      async function refreshTotals() {
        try {
          var quote = await API.quote({
            showtimeId: flow.showtimeId,
            seats: flow.seats.map(function (s) { return s.id; }),
            food: foodLines(),
            offerCode: state.offerCode,
          });
          state.totals = quote.totals;
          if (state.offerCode && !quote.offerApplied) state.offerCode = null;
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      }

      function paint() {
        var t = state.totals || { tickets: 0, food: 0, convenienceFee: 0, gst: 0, discount: 0, total: 0 };
        totalEl.textContent = UI.money(t.total);
        var show = flow.show;

        body.innerHTML =
          '<div style="padding:14px 16px 0">' +
            '<div class="card"><div style="display:flex;gap:13px;padding:14px">' +
              '<img src="' + UI.esc(show.movie.posterUrl) + '" alt="" style="width:58px;height:78px;border-radius:9px;object-fit:cover" data-fallback="/img/posters/_placeholder.svg">' +
              '<div style="flex:1;min-width:0">' +
                '<h3 style="margin:0;font-size:17px;font-weight:700">' + UI.esc(show.movie.title) + '</h3>' +
                '<p style="margin:5px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5">' +
                  UI.esc(show.cinema.name) + '<br>' +
                  UI.esc(UI.relativeDay(show.date)) + ', ' + UI.esc(show.time) + ' · ' + UI.esc(show.screen.name) +
                '</p>' +
                '<p style="margin:6px 0 0;font-size:12.5px;font-weight:700;color:var(--primary-600)">Seats ' +
                  UI.esc(flow.seats.map(function (s) { return s.id; }).join(', ')) + '</p>' +
              '</div>' +
            '</div></div>' +
          '</div>' +

          '<h2 class="subhead">Add snacks <span style="font-weight:500;color:var(--muted);font-size:13px">(optional)</span></h2>' +
          '<div class="rail">' +
            snacks.map(function (item) {
              var qty = state.food[item.id] || 0;
              return '<article class="food-card" style="width:132px">' +
                '<img class="food-card__img" src="' + UI.esc(item.imageUrl) + '" alt="" data-fallback="/img/food/_placeholder.svg">' +
                '<h3 class="food-card__name">' + UI.esc(item.name) + '</h3>' +
                '<p class="food-card__price">' + UI.money(item.price) + '</p>' +
                (qty
                  ? '<div class="stepper" style="margin-top:8px;justify-content:center">' +
                      '<button data-action="food-dec" data-id="' + UI.esc(item.id) + '" aria-label="Remove one">' + UI.icon('minus', 14) + '</button>' +
                      '<span>' + qty + '</span>' +
                      '<button data-action="food-inc" data-id="' + UI.esc(item.id) + '" aria-label="Add one">' + UI.icon('plus', 14) + '</button>' +
                    '</div>'
                  : '<button class="btn-outline" style="margin-top:8px" data-action="food-inc" data-id="' + UI.esc(item.id) + '">Add</button>') +
                '</article>';
            }).join('') +
          '</div>' +

          '<h2 class="subhead">Offer</h2>' +
          '<div style="padding:0 16px">' +
            (state.offerCode
              ? '<div class="option" aria-pressed="true">' +
                  '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
                  '<span class="option__text"><span class="option__title">' + UI.esc(state.offerCode) + ' applied</span>' +
                  '<span class="option__sub">You saved ' + UI.money(t.discount) + '</span></span>' +
                  '<button class="link-btn" data-action="clear-offer">Remove</button></div>'
              : '<button class="option" data-action="pick-offer">' +
                  '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
                  '<span class="option__text"><span class="option__title">Apply an offer</span>' +
                  '<span class="option__sub">' + offers.length + ' codes available</span></span>' +
                  '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span></button>') +
          '</div>' +

          '<h2 class="subhead">Pay with</h2>' +
          '<div style="padding:0 16px">' +
            '<button class="option" data-action="pick-payment">' +
              '<span class="option__icon">' + UI.icon(state.payment ? (state.payment.type === 'upi' ? 'phone' : state.payment.type === 'wallet' ? 'wallet' : state.payment.type === 'netbanking' ? 'bank' : 'card') : 'cash', 21) + '</span>' +
              '<span class="option__text">' +
                '<span class="option__title">' + UI.esc(state.payment ? state.payment.label : 'Pay at counter') + '</span>' +
                '<span class="option__sub">' + UI.esc(state.payment ? (state.payment.last4 ? '•••• ' + state.payment.last4 : state.payment.handle || state.payment.type.toUpperCase()) : 'Settle at the box office') + '</span>' +
              '</span>' +
              '<span class="row__chevron">' + UI.icon('chevron-right', 19) + '</span></button>' +
          '</div>' +

          '<h2 class="subhead">Bill summary</h2>' +
          '<div style="padding:0 16px">' +
            '<div class="kv"><span class="kv__key">Tickets (' + flow.seats.length + ')</span><span class="kv__val">' + UI.money(t.tickets) + '</span></div>' +
            (t.food ? '<div class="kv"><span class="kv__key">Food & beverages</span><span class="kv__val">' + UI.money(t.food) + '</span></div>' : '') +
            '<div class="kv"><span class="kv__key">Convenience fee</span><span class="kv__val">' + UI.money(t.convenienceFee) + '</span></div>' +
            '<div class="kv"><span class="kv__key">GST (18% on fee)</span><span class="kv__val">' + UI.money(t.gst) + '</span></div>' +
            (t.discount ? '<div class="kv kv--discount"><span class="kv__key">Offer discount</span><span class="kv__val">- ' + UI.money(t.discount) + '</span></div>' : '') +
            '<div class="kv kv--total"><span class="kv__key">Total payable</span><span class="kv__val">' + UI.money(t.total) + '</span></div>' +
          '</div>' +
          '<p class="prose" style="font-size:11.5px;padding-top:14px">This is a demo — no real payment is processed. Tickets can be cancelled up to 2 hours before showtime for a 75% refund.</p>' +
          '<div class="spacer-24"></div>';
      }

      async function repaint() {
        await refreshTotals();
        paint();
      }

      UI.actions(view, {
        'food-inc': async function (el) {
          var id = el.getAttribute('data-id');
          state.food[id] = (state.food[id] || 0) + 1;
          await repaint();
        },
        'food-dec': async function (el) {
          var id = el.getAttribute('data-id');
          state.food[id] = Math.max(0, (state.food[id] || 0) - 1);
          await repaint();
        },
        'clear-offer': async function () { state.offerCode = null; await repaint(); },

        'pick-offer': function () {
          var list = UI.h('<div style="padding:0 16px 8px">' +
            offers.map(function (o) {
              return '<button class="option" data-pick="' + UI.esc(o.code) + '">' +
                '<span class="option__icon">' + UI.icon('tag', 21) + '</span>' +
                '<span class="option__text"><span class="option__title">' + UI.esc(o.title) + '</span>' +
                '<span class="option__sub">' + UI.esc(o.subtitle) + ' · ' + UI.esc(o.code) + '</span></span>' +
                '<span class="row__chevron">' + UI.icon('chevron-right', 18) + '</span></button>';
            }).join('') + '</div>');
          var sheet = UI.sheet({ title: 'Available offers', body: list });
          list.addEventListener('click', async function (e) {
            var btn = e.target.closest('[data-pick]');
            if (!btn) return;
            sheet.close();
            try {
              await API.validateOffer({
                code: btn.getAttribute('data-pick'),
                showtimeId: flow.showtimeId,
                seats: flow.seats.map(function (s) { return s.id; }),
                food: foodLines(),
              });
              state.offerCode = btn.getAttribute('data-pick');
              UI.toast('Offer applied', 'success');
            } catch (err) { UI.toast(err.message, 'error'); }
            await repaint();
          });
        },

        'pick-payment': function () {
          var methods = profile.user.paymentMethods || [];
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
              '<span class="option__sub">Settle at the box office</span></span>' +
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

        pay: async function (el) {
          el.disabled = true;
          el.innerHTML = '<span class="spinner" style="width:19px;height:19px;border-width:2.5px;border-top-color:#fff"></span>';
          try {
            var res = await API.book({
              holdId: flow.holdId,
              food: foodLines(),
              offerCode: state.offerCode,
              payment: state.payment ? { method: state.payment.type, methodId: state.payment.id } : { method: 'cash' },
              reminder: true,
            });
            clearInterval(timer);
            Store.flow = null;
            App.navigate('/confirmed/' + res.booking.id, { replace: true });
          } catch (err) {
            UI.toast(err.message, 'error');
            el.disabled = false;
            el.textContent = 'Pay now';
            if (err.status === 410 || err.status === 409) {
              clearInterval(timer);
              Store.flow = null;
              setTimeout(function () { App.navigate('/seats/' + flow.showtimeId, { replace: true }); }, 1200);
            }
          }
        },
      });

      await repaint();
      return view;
    },
  };

  // ── Confirmation ───────────────────────────────────────────────────────────
  window.Screens.confirmation = {
    auth: true,
    render: async function (params) {
      var res = await API.booking(params.bookingId);
      var b = res.booking;
      var isMovie = b.type === 'movie';

      var view = UI.h(
        '<div class="screen">' +
          '<div class="scroll">' +
            '<div class="success-hero">' +
              '<div class="success-hero__ring">' + UI.icon('check', 42) + '</div>' +
              '<h2>' + (isMovie ? 'Booking confirmed!' : 'Order placed!') + '</h2>' +
              '<p>' + (isMovie
                ? 'Your seats are locked in. Show the barcode at the entry gate.'
                : 'Collect your order from ' + UI.esc(b.pickup ? b.pickup.counter : 'the counter') + ' at your chosen time.') + '</p>' +
            '</div>' +

            '<div style="padding:24px 16px 0">' +
              '<div class="stub">' +
                '<div class="stub__top">' +
                  '<img class="stub__poster" src="' + UI.esc(b.posterUrl) + '" alt="" data-fallback="/img/posters/_placeholder.svg">' +
                  '<div style="flex:1;min-width:0">' +
                    '<h3 style="margin:0;font-size:18px;font-weight:800">' + UI.esc(b.title) + '</h3>' +
                    '<p style="margin:6px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5">' +
                      UI.esc(b.cinema ? b.cinema.name : (b.pickup ? b.pickup.cinemaName : '')) + '</p>' +
                    '<p style="margin:8px 0 0;font-size:13px;font-weight:700">' + UI.money(b.amounts.total) + ' paid</p>' +
                  '</div>' +
                '</div>' +
                '<div class="stub__grid">' +
                  (isMovie
                    ? '<div><div class="stub__cell-label">Date</div><div class="stub__cell-value">' + UI.esc(UI.shortDate(b.startsAt)) + '</div></div>' +
                      '<div><div class="stub__cell-label">Time</div><div class="stub__cell-value">' + UI.esc(UI.hhmm(b.startsAt)) + '</div></div>' +
                      '<div><div class="stub__cell-label">Seats</div><div class="stub__cell-value">' + UI.esc(b.seatLabel) + '</div></div>' +
                      '<div><div class="stub__cell-label">Screen</div><div class="stub__cell-value">' + UI.esc(b.screenName || '—') + '</div></div>'
                    : '<div><div class="stub__cell-label">Pickup</div><div class="stub__cell-value">' + UI.esc(b.pickup ? b.pickup.slot : '—') + '</div></div>' +
                      '<div><div class="stub__cell-label">Counter</div><div class="stub__cell-value">' + UI.esc(b.pickup ? b.pickup.counter : '—') + '</div></div>') +
                '</div>' +
                '<div class="stub__perf"><div class="stub__perf-line"></div></div>' +
                '<div class="stub__code">' +
                  '<img src="' + UI.esc(b.barcodeUrl) + '" alt="Barcode ' + UI.esc(b.reference) + '">' +
                  '<p class="stub__code-hint">Booking ' + UI.esc(b.reference) + '</p>' +
                '</div>' +
              '</div>' +
            '</div>' +

            (res.pointsEarned ? '<p class="text-center" style="margin:18px 0 0;font-size:13px;color:var(--primary-600);font-weight:700">+' + res.pointsEarned + ' reward points earned</p>' : '') +
            '<div class="spacer-24"></div>' +
          '</div>' +

          '<div class="actionbar" style="flex-direction:column;gap:10px">' +
            '<button class="btn btn--block" data-action="ticket">View full ticket</button>' +
            '<button class="btn-outline btn-outline--lg" data-action="home">Back to home</button>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        ticket: function () { App.navigate('/ticket/' + b.id, { replace: true }); },
        home: function () { App.navigate('/home', { replace: true }); },
      });

      return view;
    },
  };
})();
