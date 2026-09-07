/* Admin Panel Improvements - Tab-based movies and movie-first showtimes */

// This file contains ONLY the improved pageMovies and pageShowtimes functions
// Copy these functions into admin.js to replace the existing ones

// ═══════════════════════════════════════════════════════════════════════════
// IMPROVED MOVIES PAGE - with Now Playing / Coming Soon / Archived tabs
// ═══════════════════════════════════════════════════════════════════════════

async function pageMovies_IMPROVED(content, topActions) {
  topActions.innerHTML = '<button class="btn" data-action="new-movie">' + icon('plus', 17) + ' Add movie</button>';
  content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
  var data = await API.movies('');

  var nowPlaying = data.movies.filter(function (m) { return m.status === 'now_playing'; });
  var comingSoon = data.movies.filter(function (m) { return m.status === 'coming_soon'; });
  var archived = data.movies.filter(function (m) { return m.status === 'archived'; });

  content.innerHTML =
    '<div style="border-bottom:1px solid var(--line);background:var(--panel);padding:0 26px;margin:-24px -26px 24px;position:sticky;top:61px;z-index:4">' +
      '<div style="display:flex;gap:4px">' +
        '<button class="tab-btn active" data-tab="now_playing" style="padding:14px 18px;border:0;background:transparent;color:var(--primary);font-weight:600;font-size:14px;cursor:pointer;border-bottom:3px solid var(--primary)">' +
          'Now Playing <span style="background:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:999px;font-size:11px;margin-left:5px">' + nowPlaying.length + '</span></button>' +
        '<button class="tab-btn" data-tab="coming_soon" style="padding:14px 18px;border:0;background:transparent;color:var(--muted);font-weight:600;font-size:14px;cursor:pointer;border-bottom:3px solid transparent">' +
          'Coming Soon <span style="background:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:999px;font-size:11px;margin-left:5px">' + comingSoon.length + '</span></button>' +
        '<button class="tab-btn" data-tab="archived" style="padding:14px 18px;border:0;background:transparent;color:var(--muted);font-weight:600;font-size:14px;cursor:pointer;border-bottom:3px solid transparent">' +
          'Archived <span style="background:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:999px;font-size:11px;margin-left:5px">' + archived.length + '</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="panel" style="margin-top:0"><div class="panel__head">' +
      '<h2 class="panel__title" data-count-label>' + nowPlaying.length + ' Now Playing movies</h2>' +
      '<input class="input" data-search placeholder="Filter by title…" style="width:auto;min-width:200px">' +
    '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
      '<thead><tr><th>Movie</th><th>Genres</th><th>Languages</th><th class="num">Runtime</th><th class="num">Rating</th><th class="num">Shows</th><th></th></tr></thead>' +
      '<tbody data-rows></tbody></table></div></div></div>';

  var tbody = content.querySelector('[data-rows]');
  var countLabel = content.querySelector('[data-count-label]');
  var activeTab = 'now_playing';

  function paint(filter) {
    var needle = String(filter || '').toLowerCase();
    var baseList = activeTab === 'now_playing' ? nowPlaying : activeTab === 'coming_soon' ? comingSoon : archived;
    var list = needle ? baseList.filter(function (m) { return m.title.toLowerCase().indexOf(needle) !== -1; }) : baseList;
    
    var statusLabel = activeTab === 'now_playing' ? 'Now Playing' : activeTab === 'coming_soon' ? 'Coming Soon' : 'Archived';
    countLabel.textContent = list.length + ' ' + statusLabel + ' movie' + (list.length !== 1 ? 's' : '');

    tbody.innerHTML = list.length
      ? list.map(function (m) {
          return '<tr>' +
            '<td><div style="display:flex;align-items:center;gap:11px">' +
              '<img src="' + esc(m.posterUrl) + '" alt="" style="width:34px;height:48px;border-radius:5px;object-fit:cover">' +
              '<div><div class="cell-strong">' + esc(m.title) + '</div>' +
              '<div class="cell-sub">' + esc(m.certificate) + ' · ' + esc(shortDate(m.releaseDate)) + '</div></div></div></td>' +
            '<td>' + esc((m.genres || []).join(', ')) + '</td>' +
            '<td>' + esc((m.languages || []).join(', ')) + '</td>' +
            '<td class="num">' + esc(m.runtime) + 'm</td>' +
            '<td class="num">' + esc(m.rating || '—') + '</td>' +
            '<td class="num">' + esc(m.showtimeCount) + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(m.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(m.id) + '">Delete</button>' +
            '</td></tr>';
        }).join('')
      : '<tr><td colspan="7" class="empty-state">No movies in this category.</td></tr>';
  }

  content.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      content.querySelectorAll('.tab-btn').forEach(function(b) {
        b.classList.remove('active');
        b.style.color = 'var(--muted)';
        b.style.borderBottomColor = 'transparent';
      });
      btn.classList.add('active');
      btn.style.color = 'var(--primary)';
      btn.style.borderBottomColor = 'var(--primary)';
      activeTab = btn.getAttribute('data-tab');
      content.querySelector('[data-search]').value = '';
      paint('');
    });
  });

  content.querySelector('[data-search]').addEventListener('input', function (e) { paint(e.target.value); });

  // Rest of the function is the same as before (form handlers, etc)
  // ... [keep existing code for edit/delete/add movie functionality]
  
  paint('');
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPROVED SHOWTIMES PAGE - Movie list first, then showtime details
// ═══════════════════════════════════════════════════════════════════════════

async function pageShowtimes_IMPROVED(content, topActions) {
  topActions.innerHTML =
    '<button class="btn btn--ghost" data-action="generate">' + icon('refresh', 17) + ' Auto-schedule</button>';
  content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';

  var results = await Promise.all([API.movies(''), API.cinemas(''), API.get('/admin/screens')]);
  var movies = results[0].movies.filter(function(m) { return m.status === 'now_playing'; });
  var cinemas = results[1].cinemas;
  var screens = results[2].screens;

  function showMovieList() {
    topActions.innerHTML = '<button class="btn btn--ghost" data-action="generate">' + icon('refresh', 17) + ' Auto-schedule</button>';
    
    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head">' +
        '<h2 class="panel__title">Schedule — Select a movie</h2>' +
        '<input class="input" data-search placeholder="Search movies…" style="width:auto;min-width:200px">' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Movie</th><th>Languages</th><th class="num">Total Shows</th><th></th></tr></thead>' +
        '<tbody data-movie-rows></tbody></table></div></div></div>';

    var tbody = content.querySelector('[data-movie-rows]');
    var searchInput = content.querySelector('[data-search]');

    function paintMovies(filter) {
      var needle = String(filter || '').toLowerCase();
      var list = needle ? movies.filter(function (m) { return m.title.toLowerCase().indexOf(needle) !== -1; }) : movies;
      
      tbody.innerHTML = list.length
        ? list.map(function (m) {
            return '<tr style="cursor:pointer" data-movie-id="' + esc(m.id) + '" class="movie-row">' +
              '<td><div style="display:flex;align-items:center;gap:11px">' +
                '<img src="' + esc(m.posterUrl) + '" alt="" style="width:34px;height:48px;border-radius:5px;object-fit:cover">' +
                '<div><div class="cell-strong">' + esc(m.title) + '</div>' +
                '<div class="cell-sub">' + esc(m.certificate) + ' · ' + esc((m.genres || []).slice(0, 2).join(', ')) + '</div></div></div></td>' +
              '<td>' + esc((m.languages || []).join(', ')) + '</td>' +
              '<td class="num">' + esc(m.showtimeCount || 0) + '</td>' +
              '<td style="white-space:nowrap">' +
                '<button class="btn btn--ghost btn--sm" data-view-movie="' + esc(m.id) + '">View Showtimes ' + icon('arrow-right', 16) + '</button>' +
              '</td></tr>';
          }).join('')
        : '<tr><td colspan="4" class="empty-state">No movies found.</td></tr>';
    }

    paintMovies('');
    searchInput.addEventListener('input', function(e) { paintMovies(e.target.value); });

    tbody.addEventListener('click', function(event) {
      var row = event.target.closest('[data-movie-id]');
      var btn = event.target.closest('[data-view-movie]');
      if (row || btn) {
        var movieId = (row || btn).getAttribute(row ? 'data-movie-id' : 'data-view-movie');
        var movie = movies.find(function(m) { return m.id === movieId; });
        if (movie) showMovieShowtimes(movie);
      }
    });

    topActions.querySelector('[data-action="generate"]').addEventListener('click', async function (btn) {
      btn.disabled = true;
      var oldText = btn.textContent;
      btn.textContent = 'Scheduling…';
      try {
        var res = await API.post('/admin/showtimes/generate');
        toast(res.created ? 'Scheduled ' + res.created + ' new showtimes' : 'Schedule already complete', 'success');
        showMovieList(); // Refresh
      } catch (err) { 
        toast(err.message, 'error'); 
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  }

  async function showMovieShowtimes(movie) {
    topActions.innerHTML =
      '<button class="btn btn--line" data-action="back">' + icon('arrow-left', 17) + ' Back to movies</button> ' +
      '<button class="btn" data-action="add-showtime">' + icon('plus', 17) + ' Add showtime</button>';
    
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    
    var today = new Date().toISOString().slice(0, 10);
    var showDate = today;

    async function loadShowtimes() {
      content.innerHTML =
        '<div class="panel" style="margin-top:0"><div class="panel__head">' +
          '<div style="display:flex;align-items:center;gap:12px;flex:1">' +
            '<img src="' + esc(movie.posterUrl) + '" alt="" style="width:40px;height:56px;border-radius:6px;object-fit:cover">' +
            '<div>' +
              '<h2 class="panel__title" style="margin:0">' + esc(movie.title) + '</h2>' +
              '<div class="cell-sub">' + esc((movie.languages || []).join(', ')) + ' · ' + esc((movie.genres || []).slice(0, 2).join(', ')) + '</div>' +
            '</div>' +
          '</div>' +
          '<input class="input" type="date" data-date value="' + showDate + '" style="width:auto">' +
          '<select class="input" data-cinema style="width:auto;min-width:200px">' +
            '<option value="">All cinemas</option>' +
            cinemas.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
        '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
          '<thead><tr><th>Time</th><th>Cinema</th><th>Screen</th><th>Format</th><th>Language</th><th class="num">Price</th><th class="num">Seats</th><th></th></tr></thead>' +
          '<tbody data-showtime-rows><tr><td colspan="8" class="empty-state">Loading…</td></tr></tbody>' +
        '</table></div></div></div>';

      var tbody = content.querySelector('[data-showtime-rows]');
      var dateInput = content.querySelector('[data-date]');
      var cinemaSelect = content.querySelector('[data-cinema]');

      async function load() {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Loading…</td></tr>';
        var qs = 'movieId=' + movie.id + '&date=' + dateInput.value + 
                 (cinemaSelect.value ? '&cinemaId=' + cinemaSelect.value : '') + '&limit=400';
        var data = await API.get('/showtimes?' + qs);
        
        tbody.innerHTML = data.showtimes.length
          ? data.showtimes.map(function (s) {
              var pct = s.capacity ? Math.round((s.seatsBooked / s.capacity) * 100) : 0;
              return '<tr>' +
                '<td class="cell-strong">' + esc(s.time) + '</td>' +
                '<td>' + esc(s.cinema ? s.cinema.name : '—') + '</td>' +
                '<td>' + esc(s.screen ? s.screen.name : '—') + '</td>' +
                '<td>' + esc(s.format) + '</td><td>' + esc(s.language) + '</td>' +
                '<td class="num">' + money(s.prices.regular) + '</td>' +
                '<td class="num">' + s.seatsBooked + '/' + s.capacity + ' <span class="cell-sub">(' + pct + '%)</span></td>' +
                '<td style="white-space:nowrap">' +
                  (s.status === 'cancelled' ? '<span class="pill pill--red">cancelled</span> ' : '') +
                  '<button class="btn btn--ghost btn--sm" data-edit-show="' + esc(s.id) + '">Edit</button> ' +
                  '<button class="btn btn--line btn--sm" data-del-show="' + esc(s.id) + '">Delete</button></td>' +
                '</tr>';
            }).join('')
          : '<tr><td colspan="8" class="empty-state">No showtimes for this date. Use "Add showtime" to schedule shows.</td></tr>';
      }

      dateInput.addEventListener('change', function() {
        showDate = dateInput.value;
        load();
      });
      cinemaSelect.addEventListener('change', load);

      tbody.addEventListener('click', async function (event) {
        var editBtn = event.target.closest('[data-edit-show]');
        var delBtn = event.target.closest('[data-del-show]');
        
        if (editBtn) {
          var showtimeId = editBtn.getAttribute('data-edit-show');
          var qs = 'movieId=' + movie.id + '&date=' + dateInput.value + 
                   (cinemaSelect.value ? '&cinemaId=' + cinemaSelect.value : '') + '&limit=400';
          var data = await API.get('/showtimes?' + qs);
          var showtime = data.showtimes.find(function(s) { return s.id === showtimeId; });
          
          if (showtime) {
            var body = h('<div class="form-grid">' +
              field('Screen', 'screenId', showtime.screenId, { span: true, options: screens.map(function (s) { return { value: s.id, label: s.cinemaName + ' — ' + s.name + ' (' + s.format + ')' }; }) }) +
              field('Date', 'date', showtime.date, { type: 'date' }) +
              field('Time (HH:MM)', 'time', showtime.time, { placeholder: '19:00' }) +
              field('Base ticket price', 'basePrice', showtime.prices.regular, { type: 'number', hint: 'Premium = 1.5×, VIP = 2.2×' }) +
              field('Language', 'language', showtime.language, { placeholder: 'Defaults to the movie's first language' }) +
              '</div>');
            var m = modal({ title: 'Edit showtime', body: body, confirmLabel: 'Save changes' });
            m.confirmBtn.addEventListener('click', function () {
              submitModal(m, async function () {
                var raw = readForm(m.body);
                await API.put('/admin/showtimes/' + showtimeId, {
                  screenId: raw.screenId, date: raw.date, time: raw.time,
                  basePrice: Number(raw.basePrice), language: raw.language || undefined,
                });
                toast('Showtime updated', 'success');
                load();
              });
            });
          }
        }
        
        if (delBtn) {
          var ok = await confirmDialog('Delete this showtime?', 'Showtimes with confirmed bookings are marked cancelled instead of deleted.', 'Delete');
          if (!ok) return;
          try {
            var res = await API.del('/admin/showtimes/' + delBtn.getAttribute('data-del-show'));
            toast(res.cancelled ? res.reason : 'Showtime deleted', res.cancelled ? undefined : 'success');
            load();
          } catch (err) { toast(err.message, 'error'); }
        }
      });

      await load();
    }

    topActions.querySelector('[data-action="back"]').addEventListener('click', showMovieList);
    
    topActions.querySelector('[data-action="add-showtime"]').addEventListener('click', function () {
      var body = h('<div class="form-grid">' +
        '<div class="form-row col-span" style="background:var(--primary-soft);padding:12px;border-radius:8px;margin-bottom:8px">' +
          '<div class="cell-strong" style="color:var(--primary-dark)">' + esc(movie.title) + '</div>' +
          '<div class="cell-sub">' + esc((movie.languages || []).join(', ')) + '</div>' +
        '</div>' +
        field('Screen', 'screenId', '', { span: true, options: screens.map(function (s) { return { value: s.id, label: s.cinemaName + ' — ' + s.name + ' (' + s.format + ')' }; }) }) +
        field('Date', 'date', showDate, { type: 'date' }) +
        field('Time (HH:MM)', 'time', '19:00', { placeholder: '19:00' }) +
        field('Base ticket price', 'basePrice', 240, { type: 'number', hint: 'Premium = 1.5×, VIP = 2.2×' }) +
        field('Language', 'language', (movie.languages && movie.languages[0]) || '', { placeholder: 'Defaults to the movie's first language' }) +
        '</div>');
      var m = modal({ title: 'Add showtime for ' + movie.title, body: body, confirmLabel: 'Create showtime' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          await API.post('/admin/showtimes', {
            movieId: movie.id, screenId: raw.screenId, date: raw.date, time: raw.time,
            basePrice: Number(raw.basePrice), language: raw.language || undefined,
          });
          toast('Showtime created', 'success');
          loadShowtimes();
        });
      });
    });

    await loadShowtimes();
  }

  showMovieList();
}
