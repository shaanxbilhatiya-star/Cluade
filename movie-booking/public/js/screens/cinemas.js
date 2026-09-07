/* Cinemas tab: nearby cinema list and a cinema's daily schedule. */
(function () {
  'use strict';

  function datePill(dateKey, selected) {
    var d = UI.toDate(dateKey);
    return '<button class="date-pill" data-date="' + UI.esc(dateKey) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<div class="date-pill__dow">' + UI.DOW[d.getDay()] + '</div>' +
      '<div class="date-pill__day">' + d.getDate() + '</div>' +
      '<div class="date-pill__mon">' + UI.MONTHS[d.getMonth()] + '</div>' +
      '</button>';
  }

  function cinemaCard(cinema) {
    var posters = (cinema.nowShowing || []).slice(0, 5);
    return '<div class="card cinema-card">' +
      '<button data-action="cinema" data-id="' + UI.esc(cinema.id) + '" style="width:100%;text-align:left">' +
        '<div class="cinema-card__top">' +
          '<div style="flex:1;min-width:0">' +
            '<h3 class="cinema-card__name">' + UI.esc(cinema.name) + '</h3>' +
            '<p class="cinema-card__area">' + UI.esc(cinema.area) + ', ' + UI.esc(cinema.city) + '</p>' +
          '</div>' +
          '<div style="text-align:right;flex:none">' +
            '<div class="cinema-card__dist">' + UI.esc(cinema.distanceKm) + ' km</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:3px;justify-content:flex-end">' +
              UI.icon('star', 12) + UI.esc(cinema.rating) +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="tag-row">' +
          '<span class="tag tag--accent">' + UI.esc(cinema.screenCount) + ' screens</span>' +
          (cinema.formats || []).slice(0, 2).map(function (f) { return '<span class="tag">' + UI.esc(f) + '</span>'; }).join('') +
          (cinema.facilities || []).slice(0, 2).map(function (f) { return '<span class="tag">' + UI.esc(f) + '</span>'; }).join('') +
        '</div>' +
      '</button>' +
      (posters.length
        ? '<div style="display:flex;gap:8px;overflow-x:auto;margin-top:14px;padding-bottom:2px;scrollbar-width:none">' +
          posters.map(function (m) {
            return '<button data-action="movie" data-id="' + UI.esc(m.id) + '" style="flex:none;width:46px" aria-label="' + UI.esc(m.title) + '">' +
              '<img src="' + UI.esc(m.posterUrl) + '" alt="' + UI.esc(m.title) + '" style="width:46px;height:64px;border-radius:7px;object-fit:cover" data-fallback="/img/posters/_placeholder.svg"></button>';
          }).join('') + '</div>'
        : '') +
      '</div>';
  }

  window.Screens.cinemas = {
    tab: 'cinemas',
    render: async function () {
      var data = await API.cinemas('city=' + encodeURIComponent(Store.city));
      var all = data.cinemas;

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Cinemas' }) +
          '<div class="search-field">' + UI.icon('search', 19) +
            '<input type="search" placeholder="Search by name or area" data-filter autocomplete="off">' +
          '</div>' +
          '<div class="scroll">' +
            '<p style="padding:14px 16px 4px;margin:0;font-size:13px;color:var(--muted)">' +
              UI.esc(all.length) + ' cinema' + (all.length === 1 ? '' : 's') + ' in ' + UI.esc(Store.city) +
              ' &middot; <button class="link-btn" data-action="city" style="font-size:13px">Change city</button>' +
            '</p>' +
            '<div class="stack" data-list style="margin-top:12px"></div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      var list = view.querySelector('[data-list]');

      function paint(query) {
        var needle = String(query || '').toLowerCase();
        var filtered = needle
          ? all.filter(function (c) {
              return (c.name + ' ' + c.area + ' ' + c.brand).toLowerCase().indexOf(needle) !== -1;
            })
          : all;
        list.innerHTML = filtered.length
          ? filtered.map(cinemaCard).join('')
          : UI.empty({ icon: 'building', title: 'No cinemas found', text: 'Try a different search or change your city.' });
      }

      view.querySelector('[data-filter]').addEventListener('input', function (e) { paint(e.target.value); });

      UI.actions(view, {
        cinema: function (el) { App.navigate('/cinema/' + el.getAttribute('data-id')); },
        movie: function (el) { App.navigate('/movie/' + el.getAttribute('data-id')); },
        city: function () { App.navigate('/home'); },
      });

      paint('');
      return view;
    },
  };

  window.Screens.cinemaDetail = {
    render: async function (params) {
      var info = await API.cinema(params.id);
      var selectedDate = null;

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: info.name, back: true, alignLeft: true, logo: false }) +
          '<div class="scroll">' +
            '<div style="padding:0 16px 4px">' +
              '<div style="display:flex;align-items:flex-start;gap:12px">' +
                '<span class="row__icon" style="color:var(--primary-600);margin-top:2px">' + UI.icon('map-pin', 20) + '</span>' +
                '<p style="margin:0;font-size:13.5px;color:var(--ink-soft);line-height:1.55;flex:1">' + UI.esc(info.address) + '</p>' +
              '</div>' +
              '<div class="tag-row">' +
                '<span class="tag tag--accent">' + UI.icon('star', 12) + ' ' + UI.esc(info.rating) + '</span>' +
                (info.facilities || []).map(function (f) { return '<span class="tag">' + UI.esc(f) + '</span>'; }).join('') +
              '</div>' +
              '<div class="tag-row">' +
                (info.screens || []).map(function (s) {
                  return '<span class="tag">' + UI.esc(s.name) + ' · ' + UI.esc(s.format) + ' · ' + UI.esc(s.capacity) + ' seats</span>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<div class="divider"></div>' +
            '<div class="datestrip" data-dates></div>' +
            '<div data-shows></div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      var dateStrip = view.querySelector('[data-dates]');
      var showsHost = view.querySelector('[data-shows]');

      async function load(dateKey) {
        showsHost.innerHTML = UI.spinnerBlock();
        var data;
        try {
          data = await API.cinemaShowtimes(info.id, dateKey);
        } catch (err) {
          showsHost.innerHTML = UI.empty({ icon: 'alert-circle', title: 'Could not load shows', text: err.message });
          return;
        }

        selectedDate = data.date;
        var today = new Date();
        var upcomingDates = data.dates.filter(function (d) {
          return UI.toDate(d) >= new Date(today.getFullYear(), today.getMonth(), today.getDate());
        });
        dateStrip.innerHTML = upcomingDates.map(function (d) { return datePill(d, d === selectedDate); }).join('');

        showsHost.innerHTML = data.movies.length
          ? data.movies.map(function (group) {
              return '<div class="card" style="margin:14px 16px 0">' +
                '<div style="display:flex;gap:13px;padding:14px">' +
                  '<button data-action="movie" data-id="' + UI.esc(group.movie.id) + '" style="flex:none">' +
                    '<img src="' + UI.esc(group.movie.posterUrl) + '" alt="' + UI.esc(group.movie.title) + '" style="width:56px;height:76px;border-radius:9px;object-fit:cover" data-fallback="/img/posters/_placeholder.svg">' +
                  '</button>' +
                  '<div style="flex:1;min-width:0">' +
                    '<h3 style="margin:0;font-size:16.5px;font-weight:700">' + UI.esc(group.movie.title) + '</h3>' +
                    '<p style="margin:4px 0 0;font-size:12.5px;color:var(--muted)">' +
                      UI.esc(group.movie.certificate) + ' · ' + UI.esc(UI.runtime(group.movie.runtime)) + ' · ' + UI.esc((group.movie.genres || []).slice(0, 2).join(', ')) +
                    '</p>' +
                    '<div class="showtimes">' +
                      group.shows.map(function (s) {
                        return '<button class="showtime" data-action="seats" data-id="' + UI.esc(s.id) + '"' + (s.isPast ? ' disabled' : '') + '>' +
                          '<div class="showtime__time">' + UI.esc(s.time) + '</div>' +
                          '<div class="showtime__meta">' + UI.esc(s.format) + ' · ' + UI.money(s.prices.regular) + '</div>' +
                          '</button>';
                      }).join('') +
                    '</div>' +
                  '</div>' +
                '</div></div>';
            }).join('')
          : UI.empty({ icon: 'projector', title: 'No shows on this date', text: 'Pick another date above.' });
      }

      dateStrip.addEventListener('click', function (event) {
        var pill = event.target.closest('[data-date]');
        if (!pill) return;
        load(pill.getAttribute('data-date'));
      });

      UI.actions(view, {
        movie: function (el) { App.navigate('/movie/' + el.getAttribute('data-id')); },
        seats: function (el) { App.navigate('/seats/' + el.getAttribute('data-id')); },
      });

      await load(null);
      return view;
    },
  };
})();
