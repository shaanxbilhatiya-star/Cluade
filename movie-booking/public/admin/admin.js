/* CineFlex admin panel. Reuses /js/api.js for auth + requests. */
(function () {
  'use strict';

  var root = document.getElementById('root');
  var money = function (n) { return '\u20B9' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); };
  var icon = function (name, size) { return window.Icons.svg(name, size || 19); };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function toast(message, type) {
    var host = document.getElementById('toast-host');
    var node = h('<div class="toast' + (type ? ' toast--' + type : '') + '">' + esc(message) + '</div>');
    host.appendChild(node);
    setTimeout(function () { node.remove(); }, type === 'error' ? 4500 : 2800);
  }

  function shortDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function dateTime(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  function modal(options) {
    var host = document.getElementById('modal-host');
    host.hidden = false;
    host.innerHTML =
      '<div class="modal-host__backdrop" data-close></div>' +
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal__head"><h2 class="modal__title">' + esc(options.title) + '</h2>' +
          '<button class="btn btn--line btn--sm" data-close>Close</button></div>' +
        '<div class="modal__body"></div>' +
        (options.footer === false ? '' : '<div class="modal__foot">' +
          '<button class="btn btn--line" data-close>Cancel</button>' +
          '<button class="btn" data-confirm>' + esc(options.confirmLabel || 'Save') + '</button></div>') +
      '</div>';

    var body = host.querySelector('.modal__body');
    if (typeof options.body === 'string') body.innerHTML = options.body;
    else if (options.body) body.appendChild(options.body);

    function close() {
      host.hidden = true;
      host.innerHTML = '';
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    host.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });

    var confirmBtn = host.querySelector('[data-confirm]');
    if (confirmBtn && options.onConfirm) {
      confirmBtn.addEventListener('click', function () { options.onConfirm(body, close, confirmBtn); });
    }
    return { close: close, body: body, confirmBtn: confirmBtn };
  }

  async function confirmDialog(title, message, confirmLabel) {
    return new Promise(function (resolve) {
      var m = modal({
        title: title,
        body: '<p style="margin:0;font-size:14.5px;line-height:1.6;color:var(--ink-soft)">' + esc(message) + '</p>',
        confirmLabel: confirmLabel || 'Confirm',
        onConfirm: function (_b, close) { resolve(true); close(); },
      });
      m.confirmBtn.classList.add('btn--danger');
      document.getElementById('modal-host').querySelectorAll('[data-close]').forEach(function (b) {
        b.addEventListener('click', function () { resolve(false); });
      });
    });
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  var NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: 'chart' },
    { id: 'movies', label: 'Movies', icon: 'play' },
    { id: 'cinemas', label: 'Cinemas', icon: 'building' },
    { id: 'screens', label: 'Screens', icon: 'projector' },
    { id: 'showtimes', label: 'Showtimes', icon: 'clock' },
    { id: 'bookings', label: 'Bookings', icon: 'ticket' },
    { id: 'verify', label: 'Verify Ticket', icon: 'qr' },
    { id: 'food', label: 'Food & Drinks', icon: 'food' },
    { id: 'offers', label: 'Offers', icon: 'tag' },
    { id: 'customers', label: 'Customers', icon: 'users' },
  ];

  var state = { page: 'dashboard', user: null, cache: {} };

  function shell() {
    return h(
      '<div class="shell">' +
        '<aside class="side">' +
          '<div class="side__brand">' +
            '<img src="/img/logo.svg" alt="">' +
            '<div><strong>CineFlex</strong><span>Admin console</span></div>' +
          '</div>' +
          NAV.map(function (item) {
            return '<button class="side__link" data-page="' + item.id + '">' + icon(item.icon, 18) + item.label + '</button>';
          }).join('') +
          '<div class="side__sep"></div>' +
          '<button class="side__link" data-action="customer-app">' + icon('arrow-right', 18) + 'Customer app</button>' +
          '<button class="side__link" data-action="logout">' + icon('logout', 18) + 'Sign out</button>' +
          '<div class="side__foot">Signed in as<br><strong data-whoami></strong></div>' +
        '</aside>' +
        '<div class="main">' +
          '<div class="topbar"><h1 data-title>Dashboard</h1><div data-topactions></div></div>' +
          '<div class="content" data-content></div>' +
        '</div>' +
      '</div>'
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  async function pageDashboard(content) {
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var stats = await API.get('/admin/stats');
    var t = stats.totals;
    var maxRevenue = Math.max.apply(null, stats.trend.map(function (d) { return d.revenue; }).concat([1]));

    content.innerHTML =
      '<div class="cards">' +
        card('Total revenue', money(t.revenue), t.bookings + ' bookings all time') +
        card("Today's revenue", money(stats.today.revenue), stats.today.bookings + ' bookings today') +
        card('Seats sold', String(t.seatsSold), t.occupancyPercent + '% occupancy across ' + t.showsCompleted + ' completed shows') +
        card('Customers', String(t.users), t.cancelled + ' cancelled bookings') +
        card('Now playing', String(t.nowPlaying), t.comingSoon + ' coming soon') +
        card('Showtimes', String(t.showtimes), t.cinemas + ' cinemas · ' + t.screens + ' screens') +
      '</div>' +

      '<div class="grid-2" style="margin-top:22px">' +
        '<div class="panel" style="margin:0">' +
          '<div class="panel__head"><h2 class="panel__title">Revenue, last 7 days</h2></div>' +
          '<div class="panel__body">' +
            '<div class="bars">' +
              stats.trend.map(function (d) {
                var pct = Math.round((d.revenue / maxRevenue) * 100);
                return '<div class="bar" title="' + esc(d.date) + ': ' + money(d.revenue) + '">' +
                  '<span class="bar__value">' + (d.revenue ? money(d.revenue) : '') + '</span>' +
                  '<div class="bar__fill" style="height:' + pct + '%"></div>' +
                  '<span class="bar__label">' + esc(d.date.slice(5)) + '</span>' +
                  '</div>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="panel" style="margin:0">' +
          '<div class="panel__head"><h2 class="panel__title">Top performing movies</h2></div>' +
          '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
            '<thead><tr><th>Movie</th><th class="num">Bookings</th><th class="num">Seats</th><th class="num">Revenue</th></tr></thead>' +
            '<tbody>' +
              (stats.topMovies.length
                ? stats.topMovies.map(function (m) {
                    return '<tr><td class="cell-strong">' + esc(m.title) + '</td>' +
                      '<td class="num">' + m.bookings + '</td><td class="num">' + m.seats + '</td>' +
                      '<td class="num cell-strong">' + money(m.revenue) + '</td></tr>';
                  }).join('')
                : '<tr><td colspan="4" class="empty-state">No bookings yet.</td></tr>') +
            '</tbody></table></div></div>' +
        '</div>' +
      '</div>';
  }

  function card(label, value, hint) {
    return '<div class="stat-card"><div class="stat-card__label">' + esc(label) + '</div>' +
      '<div class="stat-card__value">' + esc(value) + '</div>' +
      (hint ? '<div class="stat-card__hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function field(label, name, value, opts) {
    var o = opts || {};
    var input = o.type === 'textarea'
      ? '<textarea class="input" name="' + name + '" placeholder="' + esc(o.placeholder || '') + '">' + esc(value || '') + '</textarea>'
      : o.options
        ? '<select class="input" name="' + name + '">' +
          o.options.map(function (opt) {
            var v = typeof opt === 'string' ? opt : opt.value;
            var l = typeof opt === 'string' ? opt : opt.label;
            return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
          }).join('') + '</select>'
        : '<input class="input" name="' + name + '" type="' + (o.type || 'text') + '" value="' + esc(value === undefined || value === null ? '' : value) + '" placeholder="' + esc(o.placeholder || '') + '">';

    return '<div class="form-row' + (o.span ? ' col-span' : '') + '">' +
      '<label class="label" for="' + name + '">' + esc(label) + '</label>' + input +
      (o.hint ? '<div class="hint">' + esc(o.hint) + '</div>' : '') + '</div>';
  }

  function readForm(body) {
    var out = {};
    body.querySelectorAll('[name]').forEach(function (el) {
      out[el.getAttribute('name')] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
  }

  function csvList(value) {
    return String(value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  async function submitModal(m, work) {
    m.confirmBtn.disabled = true;
    var old = m.confirmBtn.textContent;
    m.confirmBtn.textContent = 'Saving…';
    try {
      await work();
      m.close();
    } catch (err) {
      var box = m.body.querySelector('.error') || h('<div class="error"></div>');
      box.textContent = err.message;
      m.body.appendChild(box);
      m.confirmBtn.disabled = false;
      m.confirmBtn.textContent = old;
    }
  }

  // ── Movies ───────────────────────────────────────────────────────────────
  async function pageMovies(content, topActions) {
    topActions.innerHTML = '<button class="btn" data-action="new-movie">' + icon('plus', 17) + ' Add movie</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.movies('');

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head">' +
        '<h2 class="panel__title">' + data.movies.length + ' movies</h2>' +
        '<input class="input" data-search placeholder="Filter by title…" style="width:auto;min-width:200px">' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Movie</th><th>Status</th><th>Genres</th><th>Languages</th><th class="num">Runtime</th><th class="num">Rating</th><th class="num">Shows</th><th></th></tr></thead>' +
        '<tbody data-rows></tbody></table></div></div></div>';

    var tbody = content.querySelector('[data-rows]');

    function paint(filter) {
      var needle = String(filter || '').toLowerCase();
      var list = needle ? data.movies.filter(function (m) { return m.title.toLowerCase().indexOf(needle) !== -1; }) : data.movies;
      tbody.innerHTML = list.length
        ? list.map(function (m) {
            var pill = m.status === 'now_playing' ? 'pill--green' : m.status === 'coming_soon' ? 'pill--purple' : 'pill--grey';
            return '<tr>' +
              '<td><div style="display:flex;align-items:center;gap:11px">' +
                '<img src="' + esc(m.posterUrl) + '" alt="" style="width:34px;height:48px;border-radius:5px;object-fit:cover">' +
                '<div><div class="cell-strong">' + esc(m.title) + '</div>' +
                '<div class="cell-sub">' + esc(m.certificate) + ' · ' + esc(shortDate(m.releaseDate)) + '</div></div></div></td>' +
              '<td><span class="pill ' + pill + '">' + esc(String(m.status).replace('_', ' ')) + '</span>' +
                (m.active === false ? ' <span class="pill pill--grey">inactive</span>' : '') + '</td>' +
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
        : '<tr><td colspan="8" class="empty-state">No movies match that filter.</td></tr>';
    }

    function form(movie) {
      var m = movie || {};
      return h('<div class="form-grid">' +
        field('Title', 'title', m.title, { span: true }) +
        field('Tagline', 'tagline', m.tagline, { span: true }) +
        field('Status', 'status', m.status || 'now_playing', { options: [
          { value: 'now_playing', label: 'Now playing' },
          { value: 'coming_soon', label: 'Coming soon' },
          { value: 'archived', label: 'Archived' },
        ] }) +
        field('Certificate', 'certificate', m.certificate || 'UA', { options: ['U', 'UA', 'A', 'S'] }) +
        field('Runtime (minutes)', 'runtime', m.runtime || 120, { type: 'number' }) +
        field('Release date', 'releaseDate', m.releaseDate, { type: 'date' }) +
        field('Rating (0-10)', 'rating', m.rating || 0, { type: 'number' }) +
        field('Director', 'director', m.director) +
        field('Genres', 'genres', (m.genres || []).join(', '), { span: true, hint: 'Comma separated, e.g. Action, Thriller' }) +
        field('Languages', 'languages', (m.languages || []).join(', '), { span: true, hint: 'Comma separated' }) +
        '<div class="form-row col-span">' +
          '<label class="label">Formats <span style="color:#f59e0b;font-size:11px;font-weight:600;margin-left:6px">Confirm with theatre for Mandla</span></label>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px" id="format-pills">' +
            ['2D','3D','IMAX 2D','4DX'].map(function(fmt) {
              var sel = (m.formats || ['2D']).indexOf(fmt) !== -1;
              return '<button type="button" class="' + (sel ? 'pill-on' : '') + '" data-fmt="' + esc(fmt) + '" ' +
                'style="padding:7px 14px;border-radius:20px;border:1.5px solid ' + (sel ? '#7c3aed' : '#555') + ';' +
                'background:' + (sel ? '#7c3aed22' : 'transparent') + ';color:' + (sel ? '#7c3aed' : 'var(--muted)') + ';' +
                'font-size:13px;font-weight:600;cursor:pointer">' + esc(fmt) + '</button>';
            }).join('') +
          '</div>' +
          '<input type="hidden" name="formats" value="' + esc((m.formats || ['2D']).join(', ')) + '">' +
          '<p style="font-size:11.5px;color:var(--muted);margin:0">Most shows in Mandla run in 2D. Confirm 3D/IMAX with the theatre.</p>' +
        '</div>' +
        field('Cast', 'cast', (m.cast || []).join(', '), { span: true, hint: 'Comma separated' }) +
        field('Poster URL', 'posterUrl', m.posterUrl || '/img/posters/_placeholder.svg', { span: true }) +
        field('Backdrop URL', 'backdropUrl', m.backdropUrl || '/img/posters/_placeholder.svg', { span: true }) +
        field('Trailer URL', 'trailerUrl', m.trailerUrl, { span: true }) +
        field('Synopsis', 'synopsis', m.synopsis, { type: 'textarea', span: true }) +
        '<input type="hidden" name="tmdbId" value="' + esc(String(m.tmdbId || '')) + '">' +
        '<input type="hidden" name="castPhotos" value=\'' + esc(JSON.stringify(m.castPhotos || {})) + '\'>' +
        '<div class="form-row col-span" style="position:relative;background:#f5f0ff;border:1.5px solid #7c3aed44;border-radius:10px;padding:14px 14px 10px;margin-bottom:4px">' +
          '<label class="label" for="tmdb-search" style="font-weight:600;color:#6d28d9;margin-bottom:6px;display:block">' + (movie ? 'Re-fetch from TMDB - updates cast photos, reviews & all fields' : 'Find on TMDB - autofills all fields below') + '</label>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<input class="input" id="tmdb-search" autocomplete="off" placeholder="Type a movie name..." style="flex:1" value="' + esc(movie ? (m.title || '') : '') + '">' +
            (movie && m.tmdbId
              ? '<button type="button" class="btn btn--primary btn--sm" id="tmdb-refetch-btn" data-tmdb-id="' + esc(String(m.tmdbId)) + '" style="white-space:nowrap;flex-shrink:0">Refetch TMDB</button>'
              : '<button type="button" class="btn btn--primary btn--sm" id="tmdb-search-btn" style="white-space:nowrap;flex-shrink:0">Search TMDB</button>') +
          '</div>' +
          '<div class="tmdb-results" id="tmdb-results" hidden></div>' +
        '</div>' +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      var castPhotos = {};
      try { castPhotos = JSON.parse(raw.castPhotos || '{}'); } catch(_e) { castPhotos = {}; }
      return {
        title: raw.title, tagline: raw.tagline, status: raw.status, certificate: raw.certificate,
        runtime: Number(raw.runtime), releaseDate: raw.releaseDate, rating: Number(raw.rating),
        director: raw.director, genres: csvList(raw.genres), languages: csvList(raw.languages),
        formats: csvList(raw.formats), cast: csvList(raw.cast),
        posterUrl: raw.posterUrl, backdropUrl: raw.backdropUrl, trailerUrl: raw.trailerUrl, synopsis: raw.synopsis,
        castPhotos: castPhotos, tmdbId: raw.tmdbId || null, votes: Number(raw.votes) || 0,
      };
    }

    content.querySelector('[data-search]').addEventListener('input', function (e) { paint(e.target.value); });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');

      if (edit) {
        var movie = data.movies.find(function (m) { return m.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + movie.title, body: form(movie), confirmLabel: 'Save changes' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/movies/' + movie.id, payloadFrom(m.body));
            toast('Movie updated', 'success');
            navigate('movies');
          });
        });
        wireTmdbSearch(m.body);
        wireFormatPills(m.body);
      }

      if (del) {
        var target = data.movies.find(function (x) { return x.id === del.getAttribute('data-del'); });
        var ok = await confirmDialog('Delete ' + target.title + '?', 'If any confirmed bookings reference this movie it will be archived instead of deleted.', 'Delete movie');
        if (!ok) return;
        try {
          var res = await API.del('/admin/movies/' + target.id);
          toast(res.archived ? 'Archived: ' + res.reason : 'Movie deleted', res.archived ? undefined : 'success');
          navigate('movies');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    topActions.querySelector('[data-action="new-movie"]').addEventListener('click', function () {
      var m = modal({ title: 'Add movie', body: form(null), confirmLabel: 'Create movie' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/movies', payloadFrom(m.body));
          toast('Movie created', 'success');
          navigate('movies');
        });
      });
      wireTmdbSearch(m.body);
      wireFormatPills(m.body);
    });

    function wireFormatPills(body) {
      var container = body.querySelector('#format-pills');
      if (!container) return;
      var hiddenInput = body.querySelector('[name="formats"]');
      container.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-fmt]');
        if (!btn) return;
        var isOn = btn.classList.contains('pill-on');
        btn.classList.toggle('pill-on', !isOn);
        btn.style.borderColor = !isOn ? '#7c3aed' : '#555';
        btn.style.background = !isOn ? '#7c3aed22' : 'transparent';
        btn.style.color = !isOn ? '#7c3aed' : 'var(--muted)';
        var selected = Array.from(container.querySelectorAll('.pill-on')).map(function(b){ return b.getAttribute('data-fmt'); });
        if (!selected.length) {
          var twod = container.querySelector('[data-fmt="2D"]');
          if (twod) { twod.classList.add('pill-on'); twod.style.borderColor='#7c3aed'; twod.style.background='#7c3aed22'; twod.style.color='#7c3aed'; selected=['2D']; }
        }
        hiddenInput.value = selected.join(', ');
      });
    }

    function wireTmdbSearch(body) {
      var input = body.querySelector('#tmdb-search');
      var results = body.querySelector('#tmdb-results');
      if (!input || !results) return;
      var timer = null;

      function hide() { results.hidden = true; results.innerHTML = ''; }

      function renderResults(list) {
        if (!list.length) {
          results.innerHTML = '<div style="padding:12px 14px;color:var(--muted);font-size:13px">No results found on TMDB</div>';
        } else {
          results.innerHTML = list.map(function(r) {
            return '<button type="button" class="tmdb-result" data-tmdb-id="' + esc(String(r.id)) + '">' +
              (r.posterUrl ? '<img src="' + esc(r.posterUrl) + '" alt="" style="width:36px;height:52px;object-fit:cover;border-radius:4px;flex-shrink:0">' : '<div style="width:36px;height:52px;background:#333;border-radius:4px;flex-shrink:0"></div>') +
              '<span style="display:flex;flex-direction:column;gap:2px"><strong>' + esc(r.title) + '</strong>' + (r.year ? '<span style="font-size:11px;color:var(--muted)">' + esc(r.year) + '</span>' : '') + '</span>' +
              '</button>';
          }).join('');
        }
        results.hidden = false;
      }

      async function doSearch(q) {
        if (!q) { hide(); return; }
        try {
          var data = await API.get('/admin/tmdb/search?q=' + encodeURIComponent(q));
          renderResults(data.results || []);
        } catch(e) { hide(); }
      }

      input.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(function() { doSearch(input.value.trim()); }, 300);
      });

      // "Search TMDB" button (no tmdbId yet)
      var searchBtn = body.querySelector('#tmdb-search-btn');
      if (searchBtn) {
        searchBtn.addEventListener('click', function() {
          var q = input.value.trim();
          if (!q) { input.focus(); return; }
          clearTimeout(timer);
          searchBtn.disabled = true; searchBtn.textContent = 'Searching...';
          doSearch(q).then(function() { searchBtn.disabled=false; searchBtn.textContent='Search TMDB'; });
        });
      }

      // "Refetch TMDB" button (has tmdbId)
      var refetchBtn = body.querySelector('#tmdb-refetch-btn');
      if (refetchBtn) {
        refetchBtn.addEventListener('click', async function() {
          refetchBtn.disabled = true; refetchBtn.textContent = 'Fetching...';
          try {
            var data = await API.get('/admin/tmdb/movie/' + refetchBtn.getAttribute('data-tmdb-id'));
            var mv = data.movie;
            function setF(name, val) { var el = body.querySelector('[name="'+name+'"]'); if (el) el.value = val; }
            setF('title', mv.title); setF('tagline', mv.tagline); setF('certificate', mv.certificate);
            setF('runtime', mv.runtime); setF('releaseDate', mv.releaseDate); setF('rating', mv.rating);
            setF('director', mv.director); setF('genres', mv.genres.join(', ')); setF('languages', mv.languages.join(', '));
            setF('cast', mv.cast.join(', ')); setF('posterUrl', mv.posterUrl); setF('backdropUrl', mv.backdropUrl);
            setF('trailerUrl', mv.trailerUrl); setF('synopsis', mv.synopsis);
            setF('tmdbId', mv.tmdbId); setF('votes', mv.votes);
            setF('castPhotos', JSON.stringify(mv.castPhotos || {}));
            toast('Re-fetched from TMDB - review & save', 'success');
          } catch(e) { toast(e.message, 'error'); }
          refetchBtn.disabled = false; refetchBtn.textContent = 'Refetch TMDB';
        });
      }

      results.addEventListener('click', async function(e) {
        var btn = e.target.closest('[data-tmdb-id]');
        if (!btn) return;
        hide();
        var tmdbId = btn.getAttribute('data-tmdb-id');
        try {
          var data = await API.get('/admin/tmdb/movie/' + tmdbId);
          var mv = data.movie;
          function set(name, val) { var el = body.querySelector('[name="'+name+'"]'); if (el) el.value = val; }
          set('title', mv.title); set('tagline', mv.tagline); set('certificate', mv.certificate);
          set('runtime', mv.runtime); set('releaseDate', mv.releaseDate); set('rating', mv.rating);
          set('director', mv.director); set('genres', mv.genres.join(', ')); set('languages', mv.languages.join(', '));
          set('cast', mv.cast.join(', ')); set('posterUrl', mv.posterUrl); set('backdropUrl', mv.backdropUrl);
          set('trailerUrl', mv.trailerUrl); set('synopsis', mv.synopsis);
          set('tmdbId', mv.tmdbId); set('votes', mv.votes);
          set('castPhotos', JSON.stringify(mv.castPhotos || {}));
          input.value = mv.title;
        } catch(e) { toast(e.message, 'error'); }
      });

      document.addEventListener('click', function closeOut(e) {
        if (!body.contains(e.target)) { hide(); document.removeEventListener('click', closeOut); }
      });
    }

    paint('');
  }

  // ── Cinemas ──────────────────────────────────────────────────────────────
  async function pageCinemas(content, topActions) {
    topActions.innerHTML = '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add cinema</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.cinemas('');

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head"><h2 class="panel__title">' + data.cinemas.length + ' cinemas</h2></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Cinema</th><th>City</th><th class="num">Screens</th><th class="num">Distance</th><th>Facilities</th><th class="num">Shows</th><th></th></tr></thead>' +
        '<tbody>' + (data.cinemas.length ? data.cinemas.map(function (c) {
          return '<tr><td><div class="cell-strong">' + esc(c.name) + '</div><div class="cell-sub">' + esc(c.area) + '</div></td>' +
            '<td>' + esc(c.city) + '</td><td class="num">' + esc(c.screenCount) + '</td>' +
            '<td class="num">' + esc(c.distanceKm) + ' km</td>' +
            '<td>' + esc((c.facilities || []).slice(0, 3).join(', ')) + '</td>' +
            '<td class="num">' + esc(c.showtimeCount) + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(c.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(c.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No cinemas yet.</td></tr>') +
      '</tbody></table></div></div></div>';

    function form(cinema) {
      var c = cinema || {};
      return h('<div class="form-grid">' +
        field('Name', 'name', c.name, { span: true }) +
        field('Brand', 'brand', c.brand) +
        field('City', 'city', c.city) +
        field('Area', 'area', c.area) +
        field('Distance (km)', 'distanceKm', c.distanceKm || 0, { type: 'number' }) +
        field('Rating', 'rating', c.rating || 4, { type: 'number' }) +
        field('Address', 'address', c.address, { span: true }) +
        field('Facilities', 'facilities', (c.facilities || []).join(', '), { span: true, hint: 'Comma separated, e.g. Dolby Atmos, Recliners' }) +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      return {
        name: raw.name, brand: raw.brand, city: raw.city, area: raw.area, address: raw.address,
        distanceKm: Number(raw.distanceKm), rating: Number(raw.rating), facilities: csvList(raw.facilities),
      };
    }

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var m = modal({ title: 'Add cinema', body: form(null), confirmLabel: 'Create cinema' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/cinemas', payloadFrom(m.body));
          toast('Cinema created', 'success');
          navigate('cinemas');
        });
      });
    });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      if (edit) {
        var cinema = data.cinemas.find(function (c) { return c.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + cinema.name, body: form(cinema), confirmLabel: 'Save changes' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/cinemas/' + cinema.id, payloadFrom(m.body));
            toast('Cinema updated', 'success');
            navigate('cinemas');
          });
        });
      }
      if (del) {
        var target = data.cinemas.find(function (c) { return c.id === del.getAttribute('data-del'); });
        var ok = await confirmDialog('Delete ' + target.name + '?', 'Its screens and showtimes will be removed. Cinemas with confirmed bookings are deactivated instead.', 'Delete cinema');
        if (!ok) return;
        try {
          var res = await API.del('/admin/cinemas/' + target.id);
          toast(res.archived ? 'Deactivated: ' + res.reason : 'Cinema deleted', res.archived ? undefined : 'success');
          navigate('cinemas');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  async function pageScreens(content, topActions) {
    topActions.innerHTML = '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add screen</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var results = await Promise.all([API.get('/admin/screens'), API.cinemas('')]);
    var data = results[0];
    var cinemas = results[1].cinemas;

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head"><h2 class="panel__title">' + data.screens.length + ' screens</h2></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Screen</th><th>Cinema</th><th>Format</th><th>Sound</th><th>Layout</th><th class="num">Capacity</th><th></th></tr></thead>' +
        '<tbody>' + (data.screens.length ? data.screens.map(function (s) {
          return '<tr><td class="cell-strong">' + esc(s.name) + (s.active === false ? ' <span class="pill pill--grey">inactive</span>' : '') + '</td>' +
            '<td>' + esc(s.cinemaName) + '</td><td>' + esc(s.format) + '</td><td>' + esc(s.soundSystem) + '</td>' +
            '<td>' + esc(s.layoutPreset) + '</td><td class="num">' + esc(s.capacity) + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(s.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(s.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No screens yet.</td></tr>') +
      '</tbody></table></div></div></div>';

    function form(screen) {
      var s = screen || {};
      return h('<div class="form-grid">' +
        field('Cinema', 'cinemaId', s.cinemaId, {
          span: true,
          options: cinemas.map(function (c) { return { value: c.id, label: c.name + ' — ' + c.city }; }),
        }) +
        field('Screen name', 'name', s.name) +
        field('Format', 'format', s.format || '2D', { options: ['2D', '3D', 'IMAX 2D', 'IMAX 3D', '4DX'] }) +
        field('Sound system', 'soundSystem', s.soundSystem || 'Dolby 7.1', { options: ['Dolby 7.1', 'Dolby Atmos', 'IMAX 12.1'] }) +
        field('Seat layout', 'layoutPreset', s.layoutPreset || 'standard', {
          options: data.layoutPresets,
          hint: 'standard ≈ 104 seats, compact ≈ 64, imax ≈ 116',
        }) +
        '</div>');
    }

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var m = modal({ title: 'Add screen', body: form(null), confirmLabel: 'Create screen' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/screens', readForm(m.body));
          toast('Screen created', 'success');
          navigate('screens');
        });
      });
    });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      if (edit) {
        var screen = data.screens.find(function (s) { return s.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + screen.name, body: form(screen), confirmLabel: 'Save changes' });
        m.body.querySelector('[name="cinemaId"]').disabled = true;
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            var raw = readForm(m.body);
            await API.put('/admin/screens/' + screen.id, {
              name: raw.name, format: raw.format, soundSystem: raw.soundSystem, layoutPreset: raw.layoutPreset,
            });
            toast('Screen updated', 'success');
            navigate('screens');
          });
        });
      }
      if (del) {
        var target = data.screens.find(function (s) { return s.id === del.getAttribute('data-del'); });
        var ok = await confirmDialog('Delete ' + target.name + '?', 'Its showtimes will be removed. Screens with confirmed bookings are deactivated instead.', 'Delete screen');
        if (!ok) return;
        try {
          var res = await API.del('/admin/screens/' + target.id);
          toast(res.archived ? 'Deactivated: ' + res.reason : 'Screen deleted', res.archived ? undefined : 'success');
          navigate('screens');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Showtimes ────────────────────────────────────────────────────────────
  async function pageShowtimes(content, topActions) {
    topActions.innerHTML =
      '<button class="btn btn--ghost" data-action="generate">' + icon('refresh', 17) + ' Auto-schedule</button> ' +
      '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add showtime</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';

    var today = new Date().toISOString().slice(0, 10);
    var results = await Promise.all([API.movies(''), API.cinemas(''), API.get('/admin/screens')]);
    var movies = results[0].movies;
    var cinemas = results[1].cinemas;
    var screens = results[2].screens;

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head">' +
        '<h2 class="panel__title">Schedule</h2>' +
        '<input class="input" type="date" data-date value="' + today + '" style="width:auto">' +
        '<select class="input" data-cinema style="width:auto;min-width:200px">' +
          '<option value="">All cinemas</option>' +
          cinemas.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
        '</select>' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Time</th><th>Movie</th><th>Cinema</th><th>Screen</th><th>Format</th><th>Language</th><th class="num">Price</th><th class="num">Seats</th><th></th></tr></thead>' +
        '<tbody data-rows><tr><td colspan="9" class="empty-state">Loading…</td></tr></tbody>' +
      '</table></div></div></div>';

    var tbody = content.querySelector('[data-rows]');
    var dateInput = content.querySelector('[data-date]');
    var cinemaSelect = content.querySelector('[data-cinema]');

    async function load() {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading…</td></tr>';
      var qs = 'date=' + dateInput.value + (cinemaSelect.value ? '&cinemaId=' + cinemaSelect.value : '') + '&limit=400';
      var data = await API.get('/showtimes?' + qs);
      tbody.innerHTML = data.showtimes.length
        ? data.showtimes.map(function (s) {
            var pct = s.capacity ? Math.round((s.seatsBooked / s.capacity) * 100) : 0;
            return '<tr>' +
              '<td class="cell-strong">' + esc(s.time) + '</td>' +
              '<td>' + esc(s.movie ? s.movie.title : '—') + '</td>' +
              '<td>' + esc(s.cinema ? s.cinema.name : '—') + '</td>' +
              '<td>' + esc(s.screen ? s.screen.name : '—') + '</td>' +
              '<td>' + esc(s.format) + '</td><td>' + esc(s.language) + '</td>' +
              '<td class="num">' + money(s.prices.regular) + '</td>' +
              '<td class="num">' + s.seatsBooked + '/' + s.capacity + ' <span class="cell-sub">(' + pct + '%)</span></td>' +
              '<td style="white-space:nowrap">' +
                (s.status === 'cancelled' ? '<span class="pill pill--red">cancelled</span> ' : '') +
                '<button class="btn btn--line btn--sm" data-del="' + esc(s.id) + '">Delete</button></td>' +
              '</tr>';
          }).join('')
        : '<tr><td colspan="9" class="empty-state">No showtimes for this date.</td></tr>';
    }

    dateInput.addEventListener('change', load);
    cinemaSelect.addEventListener('change', load);

    tbody.addEventListener('click', async function (event) {
      var del = event.target.closest('[data-del]');
      if (!del) return;
      var ok = await confirmDialog('Delete this showtime?', 'Showtimes with confirmed bookings are marked cancelled instead of deleted.', 'Delete');
      if (!ok) return;
      try {
        var res = await API.del('/admin/showtimes/' + del.getAttribute('data-del'));
        toast(res.cancelled ? res.reason : 'Showtime deleted', res.cancelled ? undefined : 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });

    topActions.querySelector('[data-action="generate"]').addEventListener('click', async function (btn) {
      try {
        var res = await API.post('/admin/showtimes/generate');
        toast(res.created ? 'Scheduled ' + res.created + ' new showtimes' : 'Schedule already complete', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var body = h('<div class="form-grid">' +
        field('Movie', 'movieId', '', { span: true, options: movies.map(function (m) { return { value: m.id, label: m.title }; }) }) +
        field('Screen', 'screenId', '', { span: true, options: screens.map(function (s) { return { value: s.id, label: s.cinemaName + ' — ' + s.name + ' (' + s.format + ')' }; }) }) +
        field('Date', 'date', dateInput.value, { type: 'date' }) +
        field('Time (HH:MM)', 'time', '19:00', { placeholder: '19:00' }) +
        field('Base ticket price', 'basePrice', 240, { type: 'number', hint: 'Premium = 1.5×, VIP = 2.2×' }) +
        field('Language', 'language', '', { placeholder: 'Defaults to the movie’s first language' }) +
        '</div>');
      var m = modal({ title: 'Add showtime', body: body, confirmLabel: 'Create showtime' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          await API.post('/admin/showtimes', {
            movieId: raw.movieId, screenId: raw.screenId, date: raw.date, time: raw.time,
            basePrice: Number(raw.basePrice), language: raw.language || undefined,
          });
          toast('Showtime created', 'success');
          load();
        });
      });
    });

    await load();
  }

  // ── Bookings ─────────────────────────────────────────────────────────────
  async function pageBookings(content) {
    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head">' +
        '<h2 class="panel__title">Bookings</h2>' +
        '<input class="input" data-q placeholder="Search reference, name or email…">' +
        '<select class="input" data-status style="width:auto">' +
          '<option value="">All statuses</option><option value="confirmed">Confirmed</option>' +
          '<option value="completed">Completed</option><option value="cancelled">Cancelled</option>' +
        '</select>' +
        '<select class="input" data-type style="width:auto">' +
          '<option value="">All types</option><option value="movie">Movie</option><option value="food">Food</option>' +
        '</select>' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Reference</th><th>Customer</th><th>Item</th><th>Show</th><th>Seats</th><th class="num">Amount</th><th>Payment</th><th>Status</th><th></th></tr></thead>' +
        '<tbody data-rows><tr><td colspan="9" class="empty-state">Loading…</td></tr></tbody>' +
      '</table></div></div></div>';

    var tbody = content.querySelector('[data-rows]');
    var timer = null;

    async function load() {
      var qs = new URLSearchParams();
      var q = content.querySelector('[data-q]').value.trim();
      if (q) qs.set('q', q);
      if (content.querySelector('[data-status]').value) qs.set('status', content.querySelector('[data-status]').value);
      if (content.querySelector('[data-type]').value) qs.set('type', content.querySelector('[data-type]').value);

      var data = await API.get('/admin/bookings' + (qs.toString() ? '?' + qs.toString() : ''));
      tbody.innerHTML = data.bookings.length
        ? data.bookings.map(function (b) {
            var pill = b.status === 'confirmed' ? 'pill--green' : b.status === 'cancelled' ? 'pill--red' : 'pill--purple';
            return '<tr>' +
              '<td class="mono cell-strong">' + esc(b.reference) + '</td>' +
              '<td>' + (b.customer ? '<div class="cell-strong">' + esc(b.customer.name) + '</div><div class="cell-sub">' + esc(b.customer.email) + '</div>' : '—') + '</td>' +
              '<td>' + esc(b.movieTitle || '—') + '<div class="cell-sub">' + esc(b.cinemaName) + '</div></td>' +
              '<td>' + (b.showDate ? esc(b.showDate) + ' ' + esc(b.showTime) : esc(dateTime(b.startsAt))) + '</td>' +
              '<td>' + esc(b.seatLabel || '—') + '</td>' +
              '<td class="num cell-strong">' + money(b.total) + (b.refundAmount ? '<div class="cell-sub">refund ' + money(b.refundAmount) + '</div>' : '') + '</td>' +
              '<td>' + esc(b.paymentLabel) + '</td>' +
              '<td><span class="pill ' + pill + '">' + esc(b.status) + '</span></td>' +
              '<td style="white-space:nowrap">' +
                (b.status === 'confirmed' ? '<button class="btn btn--ghost btn--sm" data-checkin="' + esc(b.id) + '">Check in</button> ' +
                  '<button class="btn btn--line btn--sm" data-cancel="' + esc(b.id) + '">Cancel</button>' : '') +
              '</td></tr>';
          }).join('')
        : '<tr><td colspan="9" class="empty-state">No bookings match these filters.</td></tr>';
    }

    content.querySelector('[data-q]').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(load, 240);
    });
    content.querySelector('[data-status]').addEventListener('change', load);
    content.querySelector('[data-type]').addEventListener('change', load);

    tbody.addEventListener('click', async function (event) {
      var checkin = event.target.closest('[data-checkin]');
      var cancel = event.target.closest('[data-cancel]');
      if (checkin) {
        try {
          await API.post('/admin/bookings/' + checkin.getAttribute('data-checkin') + '/checkin');
          toast('Checked in', 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }
      if (cancel) {
        var ok = await confirmDialog('Cancel this booking?', 'The seats will be released and a 75% refund recorded.', 'Cancel booking');
        if (!ok) return;
        try {
          await API.post('/bookings/' + cancel.getAttribute('data-cancel') + '/cancel');
          toast('Booking cancelled', 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    await load();
  }

  // ── Ticket verification (gate scanner) ───────────────────────────────────
  function pageVerify(content) {
    content.innerHTML =
      '<div class="panel" style="margin-top:0;max-width:640px"><div class="panel__head"><h2 class="panel__title">Verify a ticket</h2></div>' +
      '<div class="panel__body">' +
        '<p style="margin:0 0 14px;font-size:14px;color:var(--ink-soft)">Scan or type the booking reference printed under the barcode.</p>' +
        '<div class="toolbar">' +
          '<input class="input" data-ref placeholder="e.g. CF7K2M9QX3" style="flex:1;text-transform:uppercase" autofocus>' +
          '<button class="btn" data-go>Verify</button>' +
        '</div>' +
        '<div data-result style="margin-top:20px"></div>' +
      '</div></div>';

    var input = content.querySelector('[data-ref]');
    var result = content.querySelector('[data-result]');

    async function verify() {
      var ref = input.value.trim().toUpperCase();
      if (!ref) return;
      result.innerHTML = '<div class="spinner"></div>';
      try {
        var data = await API.get('/admin/verify/' + encodeURIComponent(ref));
        var b = data.booking;
        result.innerHTML =
          '<div style="border:2px solid ' + (data.valid ? 'var(--success)' : 'var(--danger)') + ';border-radius:12px;padding:18px">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
              '<span class="pill ' + (data.valid ? 'pill--green' : 'pill--red') + '">' + (data.valid ? 'Valid' : 'Not valid') + '</span>' +
              '<strong style="font-size:15px">' + esc(data.reason) + '</strong>' +
            '</div>' +
            '<table><tbody>' +
              tr('Reference', '<span class="mono">' + esc(b.reference) + '</span>') +
              tr('Customer', esc(b.customerName)) +
              tr(b.type === 'food' ? 'Order' : 'Movie', esc(b.movieTitle)) +
              tr('Cinema', esc(b.cinemaName)) +
              (b.showDate ? tr('Show', esc(b.showDate) + ' at ' + esc(b.showTime)) : '') +
              (b.seatLabel ? tr('Seats', esc(b.seatLabel)) : '') +
              (b.food && b.food.length ? tr('Food', esc(b.food.map(function (f) { return f.name + ' × ' + f.qty; }).join(', '))) : '') +
              tr('Amount paid', money(b.total)) +
            '</tbody></table>' +
          '</div>';
      } catch (err) {
        result.innerHTML = '<div style="border:2px solid var(--danger);border-radius:12px;padding:18px">' +
          '<span class="pill pill--red">Not found</span> <strong style="margin-left:8px">' + esc(err.message) + '</strong></div>';
      }
    }

    function tr(label, value) {
      return '<tr><td style="color:var(--muted);width:150px;border:0;padding:6px 0">' + esc(label) + '</td>' +
        '<td style="border:0;padding:6px 0" class="cell-strong">' + value + '</td></tr>';
    }

    content.querySelector('[data-go]').addEventListener('click', verify);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') verify(); });
  }

  // ── Food ─────────────────────────────────────────────────────────────────
  async function pageFood(content, topActions) {
    topActions.innerHTML = '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add item</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.get('/food?limit=200');
    var items = data.items;

    // Include unavailable items too, which /food hides from customers.
    var categories = ['Popcorn', 'Beverages', 'Snacks', 'Combos', 'Meals', 'Desserts'];

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head"><h2 class="panel__title">' + items.length + ' available items</h2>' +
        '<span class="hint">Items marked unavailable are hidden from the customer app.</span></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Item</th><th>Category</th><th class="num">Price</th><th>Size</th><th>Diet</th><th>Flags</th><th></th></tr></thead>' +
        '<tbody>' + (items.length ? items.map(function (f) {
          return '<tr><td><div style="display:flex;align-items:center;gap:11px">' +
              '<img src="' + esc(f.imageUrl) + '" alt="" style="width:38px;height:38px;border-radius:7px;object-fit:cover">' +
              '<div class="cell-strong">' + esc(f.name) + '</div></div></td>' +
            '<td>' + esc(f.category) + '</td><td class="num cell-strong">' + money(f.price) + '</td>' +
            '<td>' + esc(f.size || '—') + '</td>' +
            '<td><span class="pill ' + (f.veg ? 'pill--green' : 'pill--amber') + '">' + (f.veg ? 'Veg' : 'Non-veg') + '</span></td>' +
            '<td>' + (f.popular ? '<span class="pill pill--purple">popular</span>' : '') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(f.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(f.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No food items.</td></tr>') +
      '</tbody></table></div></div></div>';

    function form(item) {
      var f = item || {};
      return h('<div class="form-grid">' +
        field('Name', 'name', f.name, { span: true }) +
        field('Category', 'category', f.category || 'Snacks', { options: categories }) +
        field('Price', 'price', f.price || 0, { type: 'number' }) +
        field('Size', 'size', f.size, { placeholder: 'e.g. Large, 300 ml' }) +
        field('Image URL', 'imageUrl', f.imageUrl || '/img/food/_placeholder.svg') +
        field('Vegetarian', 'veg', f.veg === false ? 'false' : 'true', { options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] }) +
        field('Show as popular', 'popular', f.popular ? 'true' : 'false', { options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] }) +
        field('Available', 'available', f.available === false ? 'false' : 'true', { options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] }) +
        field('Description', 'description', f.description, { type: 'textarea', span: true }) +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      return {
        name: raw.name, category: raw.category, price: Number(raw.price), size: raw.size,
        imageUrl: raw.imageUrl, description: raw.description,
        veg: raw.veg === 'true', popular: raw.popular === 'true', available: raw.available === 'true',
      };
    }

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var m = modal({ title: 'Add food item', body: form(null), confirmLabel: 'Create item' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/food', payloadFrom(m.body));
          toast('Item created', 'success');
          navigate('food');
        });
      });
    });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      if (edit) {
        var item = items.find(function (f) { return f.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + item.name, body: form(item), confirmLabel: 'Save changes' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/food/' + item.id, payloadFrom(m.body));
            toast('Item updated', 'success');
            navigate('food');
          });
        });
      }
      if (del) {
        var target = items.find(function (f) { return f.id === del.getAttribute('data-del'); });
        var ok = await confirmDialog('Delete ' + target.name + '?', 'It will disappear from the customer menu immediately.', 'Delete item');
        if (!ok) return;
        try {
          await API.del('/admin/food/' + target.id);
          toast('Item deleted', 'success');
          navigate('food');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Offers ───────────────────────────────────────────────────────────────
  async function pageOffers(content, topActions) {
    topActions.innerHTML = '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add offer</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.offers();

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head"><h2 class="panel__title">' + data.offers.length + ' active offers</h2></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Offer</th><th>Code</th><th>Discount</th><th>Applies to</th><th class="num">Min spend</th><th class="num">Max off</th><th></th></tr></thead>' +
        '<tbody>' + (data.offers.length ? data.offers.map(function (o) {
          return '<tr><td><div class="cell-strong">' + esc(o.title) + '</div><div class="cell-sub">' + esc(o.subtitle) + '</div></td>' +
            '<td class="mono cell-strong">' + esc(o.code) + '</td>' +
            '<td>' + (o.discountType === 'percent' ? esc(o.discountValue) + '%' : money(o.discountValue)) + '</td>' +
            '<td><span class="pill pill--purple">' + esc(o.appliesTo) + '</span></td>' +
            '<td class="num">' + money(o.minAmount) + '</td><td class="num">' + money(o.maxDiscount) + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(o.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(o.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No offers yet.</td></tr>') +
      '</tbody></table></div></div></div>';

    function form(offer) {
      var o = offer || {};
      return h('<div class="form-grid">' +
        field('Title', 'title', o.title, { span: true }) +
        field('Subtitle', 'subtitle', o.subtitle, { span: true }) +
        field('Code', 'code', o.code, { placeholder: 'CINEWED' }) +
        field('Applies to', 'appliesTo', o.appliesTo || 'all', { options: [
          { value: 'all', label: 'Tickets + food' }, { value: 'tickets', label: 'Tickets only' }, { value: 'food', label: 'Food only' },
        ] }) +
        field('Discount type', 'discountType', o.discountType || 'percent', { options: [
          { value: 'percent', label: 'Percentage' }, { value: 'flat', label: 'Flat amount' },
        ] }) +
        field('Discount value', 'discountValue', o.discountValue || 10, { type: 'number' }) +
        field('Max discount', 'maxDiscount', o.maxDiscount || 0, { type: 'number' }) +
        field('Minimum order', 'minAmount', o.minAmount || 0, { type: 'number' }) +
        field('Banner URL', 'bannerUrl', o.bannerUrl || '/img/banners/best-ticket-offers.svg', { span: true }) +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      return {
        title: raw.title, subtitle: raw.subtitle, code: raw.code, appliesTo: raw.appliesTo,
        discountType: raw.discountType, discountValue: Number(raw.discountValue),
        maxDiscount: Number(raw.maxDiscount), minAmount: Number(raw.minAmount), bannerUrl: raw.bannerUrl,
      };
    }

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var m = modal({ title: 'Add offer', body: form(null), confirmLabel: 'Create offer' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/offers', payloadFrom(m.body));
          toast('Offer created', 'success');
          navigate('offers');
        });
      });
    });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      if (edit) {
        var offer = data.offers.find(function (o) { return o.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + offer.title, body: form(offer), confirmLabel: 'Save changes' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/offers/' + offer.id, payloadFrom(m.body));
            toast('Offer updated', 'success');
            navigate('offers');
          });
        });
      }
      if (del) {
        var ok = await confirmDialog('Delete this offer?', 'Customers will no longer be able to apply the code.', 'Delete offer');
        if (!ok) return;
        try {
          await API.del('/admin/offers/' + del.getAttribute('data-del'));
          toast('Offer deleted', 'success');
          navigate('offers');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Customers ────────────────────────────────────────────────────────────
  async function pageCustomers(content) {
    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head"><h2 class="panel__title">Customers</h2>' +
        '<input class="input" data-q placeholder="Search name, email or phone…"></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Name</th><th>Contact</th><th>City</th><th>Member ID</th><th class="num">Bookings</th><th class="num">Spent</th><th class="num">Points</th><th>Status</th><th></th></tr></thead>' +
        '<tbody data-rows><tr><td colspan="9" class="empty-state">Loading…</td></tr></tbody>' +
      '</table></div></div></div>';

    var tbody = content.querySelector('[data-rows]');
    var timer = null;

    async function load() {
      var q = content.querySelector('[data-q]').value.trim();
      var data = await API.get('/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
      tbody.innerHTML = data.users.length
        ? data.users.map(function (u) {
            return '<tr>' +
              '<td><div class="cell-strong">' + esc(u.name) + '</div>' +
                '<div class="cell-sub">' + esc(u.role) + '</div></td>' +
              '<td>' + esc(u.email) + '<div class="cell-sub">' + esc(u.phone || '—') + '</div></td>' +
              '<td>' + esc(u.city || '—') + '</td>' +
              '<td class="mono">' + esc(u.memberId || '—') + '</td>' +
              '<td class="num">' + u.bookingCount + '</td>' +
              '<td class="num cell-strong">' + money(u.totalSpent) + '</td>' +
              '<td class="num">' + (u.loyaltyPoints || 0) + '</td>' +
              '<td><span class="pill ' + (u.active === false ? 'pill--red' : 'pill--green') + '">' + (u.active === false ? 'disabled' : 'active') + '</span></td>' +
              '<td>' + (u.role === 'admin' ? '' : '<button class="btn btn--line btn--sm" data-toggle="' + esc(u.id) + '">' +
                (u.active === false ? 'Enable' : 'Disable') + '</button>') + '</td>' +
              '</tr>';
          }).join('')
        : '<tr><td colspan="9" class="empty-state">No customers found.</td></tr>';
    }

    content.querySelector('[data-q]').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(load, 240);
    });

    tbody.addEventListener('click', async function (event) {
      var btn = event.target.closest('[data-toggle]');
      if (!btn) return;
      try {
        await API.post('/admin/users/' + btn.getAttribute('data-toggle') + '/toggle');
        toast('Account updated', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });

    await load();
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  var PAGES = {
    dashboard: pageDashboard,
    movies: pageMovies,
    cinemas: pageCinemas,
    screens: pageScreens,
    showtimes: pageShowtimes,
    bookings: pageBookings,
    verify: pageVerify,
    food: pageFood,
    offers: pageOffers,
    customers: pageCustomers,
  };

  var shellEl = null;

  async function navigate(page) {
    state.page = page;
    window.location.hash = page;

    shellEl.querySelectorAll('[data-page]').forEach(function (link) {
      if (link.getAttribute('data-page') === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    var nav = NAV.find(function (n) { return n.id === page; });
    shellEl.querySelector('[data-title]').textContent = nav ? nav.label : 'Dashboard';

    var content = shellEl.querySelector('[data-content]');
    var topActions = shellEl.querySelector('[data-topactions]');
    topActions.innerHTML = '';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';

    try {
      await PAGES[page](content, topActions);
    } catch (err) {
      content.innerHTML = '<div class="panel" style="margin-top:0"><div class="panel__body">' +
        '<div class="empty-state"><strong style="color:var(--danger)">' + esc(err.message) + '</strong>' +
        '<div style="margin-top:14px"><button class="btn btn--ghost" onclick="location.reload()">Reload</button></div></div>' +
        '</div></div>';
    }
  }

  function mountShell() {
    shellEl = shell();
    root.innerHTML = '';
    root.appendChild(shellEl);
    shellEl.querySelector('[data-whoami]').textContent = state.user.name + ' · ' + state.user.email;

    shellEl.addEventListener('click', function (event) {
      var pageLink = event.target.closest('[data-page]');
      if (pageLink) { navigate(pageLink.getAttribute('data-page')); return; }
      var action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.getAttribute('data-action') === 'logout') {
        API.setToken(null);
        location.reload();
      }
      if (action.getAttribute('data-action') === 'customer-app') window.open('/', '_blank');
    });

    var initial = window.location.hash.replace('#', '');
    navigate(PAGES[initial] ? initial : 'dashboard');
  }

  function mountLogin(message) {
    root.innerHTML =
      '<div class="login-wrap"><div class="login-card">' +
        '<img src="/img/logo.svg" alt="">' +
        '<h1>Admin sign in</h1>' +
        '<p>CineFlex management console</p>' +
        '<form data-form>' +
          '<div class="form-row"><label class="label" for="email">Email</label>' +
            '<input class="input" id="email" name="email" type="email" value="admin@cineflex.com" autocomplete="username"></div>' +
          '<div class="form-row"><label class="label" for="password">Password</label>' +
            '<input class="input" id="password" name="password" type="password" value="admin123" autocomplete="current-password"></div>' +
          (message ? '<div class="error">' + esc(message) + '</div>' : '') +
          '<button class="btn" type="submit" style="width:100%;margin-top:8px">Sign in</button>' +
        '</form>' +
        '<p class="hint" style="margin-top:18px">Demo admin — admin@cineflex.com / admin123</p>' +
      '</div></div>';

    var form = root.querySelector('[data-form]');
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        var res = await API.login(form.email.value.trim(), form.password.value);
        if (res.user.role !== 'admin') throw new Error('That account is not an administrator.');
        API.setToken(res.token);
        state.user = res.user;
        mountShell();
      } catch (err) {
        mountLogin(err.message);
      }
    });
  }

  async function boot() {
    if (!API.isSignedIn()) { mountLogin(); return; }
    try {
      var res = await API.me();
      if (res.user.role !== 'admin') {
        API.setToken(null);
        mountLogin('That account is not an administrator.');
        return;
      }
      state.user = res.user;
      mountShell();
    } catch (_err) {
      API.setToken(null);
      mountLogin();
    }
  }

  window.addEventListener('hashchange', function () {
    var page = window.location.hash.replace('#', '');
    if (shellEl && PAGES[page] && page !== state.page) navigate(page);
  });

  boot();
})();
