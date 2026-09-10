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

  // Converts a "HH:MM" 24-hour string to "h:MM AM/PM" for display. Storage/inputs stay 24-hour.
  function time12(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return esc(t);
    var h24 = Number(m[1]);
    var mins = m[2];
    var period = h24 >= 12 ? 'PM' : 'AM';
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + mins + ' ' + period;
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
      '<div class="modal' + (options.wide ? ' modal--wide' : '') + '" role="dialog" aria-modal="true">' +
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
    { id: 'hotel', label: 'Hotel & Rooms', icon: 'bed' },
    { id: 'dinein', label: 'Dine-In', icon: 'dine' },
    { id: 'waterpark', label: 'Water Park', icon: 'waves' },
    { id: 'sliders', label: 'Tab Sliders', icon: 'grid' },
    { id: 'food', label: 'Food & Drinks', icon: 'food' },
    { id: 'offers', label: 'Offers', icon: 'tag' },
    { id: 'experiences', label: 'Experiences', icon: 'sparkle' },
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
        (stats.stays
          ? card('Stay revenue', money(stats.stays.revenue),
              stats.stays.roomNights + ' room nights · ' + stats.stays.upcoming + ' upcoming')
          : '') +
        (stats.dine
          ? card('Dine-In revenue', money(stats.dine.revenue),
              stats.dine.bills + ' bills · ' + money(stats.dine.discountGiven) + ' discount given')
          : '') +
        (stats.dine
          ? card('Dine-In reservations', String(stats.dine.reservations),
              stats.dine.reservedBills + ' billed with a booking · ' + stats.dine.walkinBills + ' walk-in')
          : '') +
        (stats.park
          ? card('Water park revenue', money(stats.park.revenue),
              stats.park.bookings + ' pass(es) · ' + money(stats.park.savingGiven) + ' saved for guests')
          : '') +
        (stats.park
          ? card('Water park guests', String(stats.park.guests),
              stats.park.packageBookings + ' on a package · ' + stats.park.individualBookings + ' per-person')
          : '') +
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

  /** Cover photo picker: keeps the full image (no forced crop), just downsizes if it's huge. */
  function imageField(label, name, value, opts) {
    var o = opts || {};
    var hasImg = !!value;
    return '<div class="form-row col-span">' +
      '<label class="label">' + esc(label) + '</label>' +
      '<div class="img-field" data-imgfield="' + name + '">' +
        '<div class="img-field__preview' + (hasImg ? '' : ' img-field__preview--empty') + '">' +
          (hasImg ? '<img src="' + esc(value) + '" alt="">' : icon('sparkle', 22)) +
        '</div>' +
        '<div class="img-field__controls">' +
          '<input type="file" accept="image/png,image/jpeg,image/webp" data-imgfield-input>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-imgfield-pick>Choose photo</button>' +
          '<div class="hint">Any size or ratio \u2014 poster, square post, whatever you use. Uploaded at full quality.</div>' +
        '</div>' +
      '</div>' +
      '<input type="hidden" name="' + name + '" value="' + esc(value || '') + '">' +
      '</div>';
  }

  /** Wires up an imageField() block: pick button, file read, downsize-only via canvas (never crops). */
  function bindImageField(body, name) {
    var wrap = body.querySelector('[data-imgfield="' + name + '"]');
    if (!wrap) return;
    var input = wrap.querySelector('[data-imgfield-input]');
    var pickBtn = wrap.querySelector('[data-imgfield-pick]');
    var preview = wrap.querySelector('.img-field__preview');
    var hidden = body.querySelector('input[type="hidden"][name="' + name + '"]');

    pickBtn.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var MAX_DIRECT_BYTES = 6 * 1024 * 1024; // send as-is (full quality, no re-encode) below this
        var MAX_DIMENSION = 2400; // only used as a safety cap for oversized files

        function apply(dataUrl) {
          hidden.value = dataUrl;
          preview.classList.remove('img-field__preview--empty');
          preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
        }

        if (file.size <= MAX_DIRECT_BYTES) {
          // Small enough already — upload the original bytes untouched, no cropping, no re-compression.
          apply(reader.result);
          return;
        }

        // Oversized file: downscale (never crop) so the longer side fits MAX_DIMENSION, at high quality.
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale);
          var hgt = Math.round(img.height * scale);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = hgt;
          canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
          apply(canvas.toDataURL('image/jpeg', 0.95));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Multi-photo gallery picker (room galleries, hotel photos).
   * Values live in a hidden input as a newline-separated list of paths and/or
   * freshly-picked data: URLs; the server persists the data: URLs to disk.
   */
  function galleryField(label, name, photos, opts) {
    var o = opts || {};
    return '<div class="form-row col-span">' +
      '<label class="label">' + esc(label) + '</label>' +
      '<div class="gal-field" data-galfield="' + name + '">' +
        '<div class="gal-field__grid" data-gal-grid></div>' +
        '<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-gal-input>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-gal-pick>' + icon('plus', 15) + ' Add photos</button>' +
        '<div class="hint">' + esc(o.hint || 'First photo is used as the cover. Drag-free reordering: use the arrows.') + '</div>' +
      '</div>' +
      '<input type="hidden" name="' + name + '" value="' + esc((photos || []).join('\n')) + '">' +
      '</div>';
  }

  /** Wires a galleryField(): add, remove and reorder. */
  function bindGalleryField(body, name) {
    var wrap = body.querySelector('[data-galfield="' + name + '"]');
    if (!wrap) return;

    var grid = wrap.querySelector('[data-gal-grid]');
    var input = wrap.querySelector('[data-gal-input]');
    var hidden = body.querySelector('input[type="hidden"][name="' + name + '"]');
    var list = hidden.value ? hidden.value.split('\n').filter(Boolean) : [];

    function sync() {
      hidden.value = list.join('\n');
      grid.innerHTML = list.length
        ? list.map(function (src, i) {
            return '<figure class="gal-item">' +
              '<img src="' + esc(src) + '" alt="">' +
              (i === 0 ? '<span class="gal-item__cover">Cover</span>' : '') +
              '<span class="gal-item__tools">' +
                (i > 0 ? '<button type="button" data-gal-move="' + i + '" data-dir="-1" title="Move left">&#8592;</button>' : '') +
                (i < list.length - 1 ? '<button type="button" data-gal-move="' + i + '" data-dir="1" title="Move right">&#8594;</button>' : '') +
                '<button type="button" data-gal-del="' + i + '" title="Remove">&times;</button>' +
              '</span></figure>';
          }).join('')
        : '<p class="hint" style="margin:0">No photos yet — the app will show a placeholder.</p>';
    }

    wrap.querySelector('[data-gal-pick]').addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      files.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function () {
          var MAX_DIRECT_BYTES = 6 * 1024 * 1024;
          var MAX_DIMENSION = 2400;

          function add(dataUrl) { list.push(dataUrl); sync(); }

          if (file.size <= MAX_DIRECT_BYTES) { add(reader.result); return; }

          // Oversized: downscale (never crop) so the longer side fits MAX_DIMENSION.
          var img = new Image();
          img.onload = function () {
            var scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            add(canvas.toDataURL('image/jpeg', 0.95));
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      input.value = '';
    });

    grid.addEventListener('click', function (event) {
      var del = event.target.closest('[data-gal-del]');
      var move = event.target.closest('[data-gal-move]');
      if (del) {
        list.splice(Number(del.getAttribute('data-gal-del')), 1);
        sync();
      }
      if (move) {
        var from = Number(move.getAttribute('data-gal-move'));
        var to = from + Number(move.getAttribute('data-dir'));
        if (to < 0 || to >= list.length) return;
        var moved = list.splice(from, 1)[0];
        list.splice(to, 0, moved);
        sync();
      }
    });

    sync();
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

    var nowPlaying  = data.movies.filter(function (m) { return m.status === 'now_playing'; });
    var comingSoon  = data.movies.filter(function (m) { return m.status === 'coming_soon'; });
    var archived    = data.movies.filter(function (m) { return m.status !== 'now_playing' && m.status !== 'coming_soon'; });

    var activeTab = 'now_playing';

    content.innerHTML =
      '<div class="panel" style="margin-top:0">' +
        '<div class="panel__head" style="flex-direction:column;align-items:flex-start;gap:12px;padding-bottom:0">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;width:100%">' +
            '<h2 class="panel__title" data-movie-count>' + data.movies.length + ' movies</h2>' +
            '<input class="input" data-search placeholder="Filter by title…" style="width:auto;min-width:200px">' +
          '</div>' +
          '<div class="status-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border);width:100%">' +
            '<button class="status-tab status-tab--active" data-tab="now_playing" style="padding:8px 18px;background:none;border:none;border-bottom:2.5px solid #7c3aed;margin-bottom:-2px;font-weight:600;color:#7c3aed;cursor:pointer;font-size:13.5px">▶ Now Playing <span class="tab-count" style="background:#7c3aed22;color:#7c3aed;border-radius:10px;padding:1px 7px;font-size:12px;margin-left:4px">' + nowPlaying.length + '</span></button>' +
            '<button class="status-tab" data-tab="coming_soon" style="padding:8px 18px;background:none;border:none;border-bottom:2.5px solid transparent;margin-bottom:-2px;font-weight:500;color:var(--ink-soft);cursor:pointer;font-size:13.5px">⏳ Coming Soon <span class="tab-count" style="background:#7c3aed11;color:var(--muted);border-radius:10px;padding:1px 7px;font-size:12px;margin-left:4px">' + comingSoon.length + '</span></button>' +
            '<button class="status-tab" data-tab="archived" style="padding:8px 18px;background:none;border:none;border-bottom:2.5px solid transparent;margin-bottom:-2px;font-weight:500;color:var(--ink-soft);cursor:pointer;font-size:13.5px">📦 Archived <span class="tab-count" style="background:#7c3aed11;color:var(--muted);border-radius:10px;padding:1px 7px;font-size:12px;margin-left:4px">' + archived.length + '</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Movie</th><th>Status</th><th>Genres</th><th>Languages</th><th class="num">Runtime</th><th class="num">Rating</th><th class="num">Shows</th><th></th></tr></thead>' +
        '<tbody data-rows></tbody></table></div></div></div>';

    var tbody = content.querySelector('[data-rows]');

    function tabList() {
      if (activeTab === 'now_playing') return nowPlaying;
      if (activeTab === 'coming_soon') return comingSoon;
      return archived;
    }

    content.querySelectorAll('.status-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = btn.getAttribute('data-tab');
        content.querySelectorAll('.status-tab').forEach(function (b) {
          var isActive = b.getAttribute('data-tab') === activeTab;
          b.style.borderBottomColor = isActive ? '#7c3aed' : 'transparent';
          b.style.color = isActive ? '#7c3aed' : 'var(--ink-soft)';
          b.style.fontWeight = isActive ? '600' : '500';
          b.querySelector('.tab-count').style.background = isActive ? '#7c3aed22' : '#7c3aed11';
          b.querySelector('.tab-count').style.color = isActive ? '#7c3aed' : 'var(--muted)';
        });
        var searchEl = content.querySelector('[data-search]');
        paint(searchEl ? searchEl.value : '');
      });
    });

    function paint(filter) {
      var needle = String(filter || '').toLowerCase();
      var source = tabList();
      var list = needle ? source.filter(function (m) { return m.title.toLowerCase().indexOf(needle) !== -1; }) : source;
      content.querySelector('[data-movie-count]').textContent = list.length + ' movies';
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
        : '<tr><td colspan="8" class="empty-state">No movies in this category.</td></tr>';
    }

    function form(movie) {
      var m = movie || {};
      return h('<div class="form-grid">' +
        '<input type="hidden" name="tmdbId" value="' + esc(m.tmdbId || '') + '">' +
        '<input type="hidden" name="votes" value="' + esc(m.votes || 0) + '">' +
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
          '<label class="label">Formats available in Mandla <span style="color:#f59e0b;font-size:11px;font-weight:600;margin-left:6px">Ask the theatre / confirm locally</span></label>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px" id="format-pills">' +
            ['2D','3D','IMAX 2D','4DX'].map(function(fmt) {
              var selected = (m.formats || ['2D']).indexOf(fmt) !== -1;
              return '<button type="button" class="pill-toggle' + (selected ? ' pill-toggle--on' : '') + '" data-fmt="' + fmt + '" ' +
                'style="padding:7px 14px;border-radius:20px;border:1.5px solid ' + (selected ? '#7c3aed' : '#555') + ';' +
                'background:' + (selected ? '#7c3aed22' : 'transparent') + ';color:' + (selected ? '#7c3aed' : 'var(--muted)') + ';' +
                'font-size:13px;font-weight:600;cursor:pointer">' + fmt + '</button>';
            }).join('') +
          '</div>' +
          '<input type="hidden" name="formats" value="' + esc((m.formats || ['2D']).join(', ')) + '">' +
          '<p style="font-size:11.5px;color:var(--muted);margin:0">Most shows in Mandla run in <strong>2D</strong>. Confirm with the theatre before selecting IMAX or 3D.</p>' +
        '</div>' +
        field('Cast', 'cast', (m.cast || []).join(', '), { span: true, hint: 'Comma separated' }) +
        field('Poster URL', 'posterUrl', m.posterUrl || '/img/posters/_placeholder.svg', { span: true }) +
        field('Backdrop URL', 'backdropUrl', m.backdropUrl || '/img/posters/_placeholder.svg', { span: true }) +
        field('Trailer URL', 'trailerUrl', m.trailerUrl, { span: true }) +
        field('Synopsis', 'synopsis', m.synopsis, { type: 'textarea', span: true }) +
        '<div class=\"form-row col-span\" style=\"background:#f0fdf4;border:1.5px solid #16a34a44;border-radius:10px;padding:14px 14px 10px;margin-top:4px\">' +
          '<label class=\"label\" style=\"font-weight:600;color:#16a34a;margin-bottom:8px;display:block\">Ticket Prices — by Seat Tier</label>' +
          '<p style=\"font-size:11.5px;color:var(--muted);margin:0 0 10px\">Set the price for each seat category for this movie. These apply to every showtime of this movie.</p>' +
          '<div style=\"display:grid;grid-template-columns:repeat(5,1fr);gap:10px\">' +
            ['sofa','recliner','platinum','gold','silver'].map(function(tier) {
              var tp = m.tierPrices || {};
              var defaults = { sofa: 500, recliner: 500, platinum: 400, gold: 300, silver: 250 };
              return '<div>' +
                '<label class=\"label\" style=\"font-size:11px;text-transform:capitalize;margin-bottom:4px\">' + tier + '</label>' +
                '<input class=\"input\" type=\"number\" name=\"tierPrice_' + tier + '\" value=\"' + esc(String(tp[tier] !== undefined ? tp[tier] : defaults[tier])) + '\" min=\"0\" style=\"width:100%\">' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      var castPhotos = {};
      try { castPhotos = JSON.parse(raw.castPhotos || '{}'); } catch (_e) { castPhotos = {}; }
      return {
        title: raw.title, tagline: raw.tagline, status: raw.status, certificate: raw.certificate,
        runtime: Number(raw.runtime), releaseDate: raw.releaseDate, rating: Number(raw.rating),
        director: raw.director, genres: csvList(raw.genres), languages: csvList(raw.languages),
        formats: csvList(raw.formats), cast: csvList(raw.cast), castPhotos: castPhotos,
        posterUrl: raw.posterUrl, backdropUrl: raw.backdropUrl, trailerUrl: raw.trailerUrl, synopsis: raw.synopsis,
        tmdbId: raw.tmdbId || null, votes: Number(raw.votes) || 0,
        tierPrices: {
          sofa:     Number(raw.tierPrice_sofa)     || 500,
          recliner: Number(raw.tierPrice_recliner)  || 500,
          platinum: Number(raw.tierPrice_platinum)  || 400,
          gold:     Number(raw.tierPrice_gold)      || 300,
          silver:   Number(raw.tierPrice_silver)    || 250,
        },
      };
    }

    content.querySelector('[data-search]').addEventListener('input', function (e) { paint(e.target.value); });
    paint('');

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
        var isOn = btn.classList.contains('pill-toggle--on');
        if (isOn) {
          btn.classList.remove('pill-toggle--on');
          btn.style.borderColor = '#555';
          btn.style.background = 'transparent';
          btn.style.color = 'var(--muted)';
        } else {
          btn.classList.add('pill-toggle--on');
          btn.style.borderColor = '#7c3aed';
          btn.style.background = '#7c3aed22';
          btn.style.color = '#7c3aed';
        }
        var selected = Array.from(container.querySelectorAll('.pill-toggle--on')).map(function(b){ return b.getAttribute('data-fmt'); });
        if (!selected.length) {
          // Always keep at least 2D
          var twoDBtn = container.querySelector('[data-fmt="2D"]');
          if (twoDBtn) { twoDBtn.classList.add('pill-toggle--on'); twoDBtn.style.borderColor='#7c3aed'; twoDBtn.style.background='#7c3aed22'; twoDBtn.style.color='#7c3aed'; selected = ['2D']; }
        }
        hiddenInput.value = selected.join(', ');
      });
    }

    function wireTmdbSearch(body) {
      var input = body.querySelector('#tmdb-search');
      var results = body.querySelector('#tmdb-results');
      if (!input) return;
      var timer = null;

      function hide() { results.hidden = true; results.innerHTML = ''; }

      // "Search TMDB" button (movies with no tmdbId yet) - triggers search with current input value
      var searchBtn = body.querySelector('#tmdb-search-btn');
      if (searchBtn) {
        searchBtn.addEventListener('click', function () {
          var q = input.value.trim();
          if (!q) { input.focus(); return; }
          clearTimeout(timer);
          searchBtn.disabled = true;
          searchBtn.textContent = 'Searching...';
          (async function () {
            try {
              var data = await API.get('/admin/tmdb/search?q=' + encodeURIComponent(q));
              if (!data.results.length) {
                results.hidden = false;
                results.innerHTML = '<div class="tmdb-results__empty">No matches on TMDB</div>';
              } else {
                results.innerHTML = data.results.map(function (r) {
                  return '<button type="button" class="tmdb-result" data-tmdb-id="' + r.id + '">' +
                    (r.posterUrl ? '<img src="' + esc(r.posterUrl) + '" alt="">' : '<span class="tmdb-result__noposter"></span>') +
                    '<span class="tmdb-result__text"><strong>' + esc(r.title) + '</strong>' + (r.year ? ' <span class="tmdb-result__year">(' + esc(r.year) + ')</span>' : '') + '</span>' +
                    '</button>';
                }).join('');
                results.hidden = false;
              }
            } catch (err) {
              results.hidden = false;
              results.innerHTML = '<div class="tmdb-results__empty">' + esc(err.message) + '</div>';
            }
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search TMDB';
          })();
        });
      }

      input.addEventListener('input', function () {
        var q = input.value.trim();
        clearTimeout(timer);
        if (!q) { hide(); return; }
        timer = setTimeout(async function () {
          try {
            var data = await API.get('/admin/tmdb/search?q=' + encodeURIComponent(q));
            if (!data.results.length) { results.hidden = false; results.innerHTML = '<div class="tmdb-results__empty">No matches on TMDB</div>'; return; }
            results.innerHTML = data.results.map(function (r) {
              return '<button type="button" class="tmdb-result" data-tmdb-id="' + r.id + '">' +
                (r.posterUrl ? '<img src="' + esc(r.posterUrl) + '" alt="">' : '<span class="tmdb-result__noposter"></span>') +
                '<span class="tmdb-result__text"><strong>' + esc(r.title) + '</strong>' + (r.year ? ' <span class="tmdb-result__year">(' + esc(r.year) + ')</span>' : '') + '</span>' +
                '</button>';
            }).join('');
            results.hidden = false;
          } catch (err) { results.hidden = false; results.innerHTML = '<div class="tmdb-results__empty">' + esc(err.message) + '</div>'; }
        }, 400);
      });

      results.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-tmdb-id]');
        if (!btn) return;
        var id = btn.getAttribute('data-tmdb-id');
        btn.disabled = true;
        try {
          var data = await API.get('/admin/tmdb/movie/' + id);
          var mv = data.movie;
          function set(name, value) { var el = body.querySelector('[name="' + name + '"]'); if (el) el.value = value; }
          set('title', mv.title);
          set('tagline', mv.tagline);
          set('certificate', mv.certificate);
          set('runtime', mv.runtime);
          set('releaseDate', mv.releaseDate);
          set('rating', mv.rating);
          set('director', mv.director);
          set('genres', mv.genres.join(', '));
          set('languages', mv.languages.join(', '));
          set('cast', mv.cast.join(', '));
          set('posterUrl', mv.posterUrl);
          set('backdropUrl', mv.backdropUrl);
          set('trailerUrl', mv.trailerUrl);
          set('synopsis', mv.synopsis);
          set('tmdbId', mv.tmdbId);
          set('votes', mv.votes);
          set('castPhotos', JSON.stringify(mv.castPhotos || {}));
          input.value = mv.title;
          hide();
          toast('Filled from TMDB — review before saving', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });


      var refetchBtn = body.querySelector('#tmdb-refetch-btn');
      if (refetchBtn) {
        refetchBtn.addEventListener('click', async function () {
          var tmdbId = refetchBtn.getAttribute('data-tmdb-id');
          refetchBtn.disabled = true;
          refetchBtn.textContent = 'Fetching…';
          try {
            var data = await API.get('/admin/tmdb/movie/' + tmdbId);
            var mv = data.movie;
            function setR(name, value) { var el = body.querySelector('[name="' + name + '"]'); if (el) el.value = value; }
            setR('title', mv.title);
            setR('tagline', mv.tagline);
            setR('certificate', mv.certificate);
            setR('runtime', mv.runtime);
            setR('releaseDate', mv.releaseDate);
            setR('rating', mv.rating);
            setR('director', mv.director);
            setR('genres', mv.genres.join(', '));
            setR('languages', mv.languages.join(', '));
            setR('cast', mv.cast.join(', '));
            setR('posterUrl', mv.posterUrl);
            setR('backdropUrl', mv.backdropUrl);
            setR('trailerUrl', mv.trailerUrl);
            setR('synopsis', mv.synopsis);
            setR('tmdbId', mv.tmdbId);
            setR('votes', mv.votes);
            setR('castPhotos', JSON.stringify(mv.castPhotos || {}));
            toast('✅ Re-fetched from TMDB — review & save', 'success');
          } catch (err) { toast(err.message, 'error'); }
          refetchBtn.disabled = false;
          refetchBtn.textContent = '↻ Re-fetch from TMDB';
        });
      }
      var closeOnOutsideClick = function (e) {
        if (!results.contains(e.target) && e.target !== input) hide();
      };
      document.addEventListener('click', closeOnOutsideClick);
      var host = document.getElementById('modal-host');
      var stop = new MutationObserver(function () {
        if (host.hidden) { document.removeEventListener('click', closeOnOutsideClick); stop.disconnect(); }
      });
      stop.observe(host, { attributes: true, attributeFilter: ['hidden'] });
    }
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
    topActions.innerHTML =
      '<button class="btn btn--ghost" data-action="purge">' + icon('trash', 17) + ' Purge all screens</button> ' +
      '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add screen</button>';
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

    function parseBlockedSeats(raw) {
      return String(raw || '').split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }

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
        field('Seat layout', 'layoutPreset', s.layoutPreset || 'kingfisher-standard', {
          options: data.layoutPresets,
          hint: 'Available layouts: ' + data.layoutPresets.join(', ') + '. Changing this rebuilds the seat map.',
        }) +
        field('Blocked seats', 'blockedSeats', (s.blockedSeats || []).join(', '), {
          type: 'textarea', span: true, placeholder: 'e.g. RC3, RC4, RC5, P110, P111',
          hint: 'Comma or space separated seat IDs (row+number) — pillar/no-view seats.',
        }) +
        '</div>');
    }

    topActions.querySelector('[data-action="purge"]').addEventListener('click', async function () {
      var ok = await confirmDialog(
        'Purge ALL screens?',
        'This permanently deletes every screen, showtime, booking and seat hold — including real ones, not just demo data. Use this only to clear out dummy/seed screens before adding real ones.',
        'Purge everything'
      );
      if (!ok) return;
      try {
        var res = await API.post('/admin/purge-dummy-screens', {});
        toast('Purged ' + res.purged.screens + ' screens, ' + res.purged.showtimes + ' showtimes, ' + res.purged.bookings + ' bookings', 'success');
        navigate('screens');
      } catch (err) { toast(err.message, 'error'); }
    });

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var m = modal({ title: 'Add screen', body: form(null), confirmLabel: 'Create screen' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          raw.blockedSeats = parseBlockedSeats(raw.blockedSeats);
          await API.post('/admin/screens', raw);
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
              blockedSeats: parseBlockedSeats(raw.blockedSeats),
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
      '<button class="btn btn--ghost btn--danger" data-action="clear-showtimes" style="color:#dc2626;border-color:#dc2626">' + icon('trash', 17) + ' Clear all showtimes</button> ' +
      '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add showtime</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';

    var today = new Date().toISOString().slice(0, 10);
    var results = await Promise.all([API.movies(''), API.cinemas(''), API.get('/admin/screens')]);
    var movies = results[0].movies.filter(function (m) { return m.status === 'now_playing' || m.status === 'coming_soon'; });
    var allMovies = results[0].movies;
    var cinemas = results[1].cinemas;
    var screens = results[2].screens;

    // expanded movie id
    var expandedMovieId = null;

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head">' +
        '<h2 class="panel__title">Schedule</h2>' +
        '<input class="input" type="date" data-date value="' + today + '" style="width:auto">' +
        '<select class="input" data-cinema style="width:auto;min-width:200px">' +
          '<option value="">All cinemas</option>' +
          cinemas.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div style="padding:0 16px 6px;font-size:12px;color:var(--muted)">Click a movie row to view and manage its showtimes for the selected date.</div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Movie</th><th>Status</th><th>Languages</th><th class="num">Showtimes</th><th></th></tr></thead>' +
        '<tbody data-movie-rows><tr><td colspan="5" class="empty-state">Loading…</td></tr></tbody>' +
      '</table></div></div></div>';

    var movieTbody = content.querySelector('[data-movie-rows]');
    var dateInput = content.querySelector('[data-date]');
    var cinemaSelect = content.querySelector('[data-cinema]');

    // All showtimes for the day (cached on load)
    var dayShowtimes = [];

    function countForMovie(movieId) {
      return dayShowtimes.filter(function (s) { return s.movie && s.movie.id === movieId; }).length;
    }

    function renderMovieRows() {
      if (!movies.length) {
        movieTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active movies found.</td></tr>';
        return;
      }
      var html = '';
      movies.forEach(function (m) {
        var pill = m.status === 'now_playing' ? 'pill--green' : 'pill--purple';
        var label = m.status === 'now_playing' ? 'Now Playing' : 'Coming Soon';
        var count = countForMovie(m.id);
        var isExpanded = expandedMovieId === m.id;
        html +=
          '<tr class="movie-row" data-movie-row="' + esc(m.id) + '" style="cursor:pointer;' + (isExpanded ? 'background:var(--surface-alt,#f5f0ff22);border-left:3px solid #7c3aed' : '') + '">' +
            '<td><div style="display:flex;align-items:center;gap:10px">' +
              '<span style="font-size:13px;color:#7c3aed;transition:transform .2s;display:inline-block;transform:rotate(' + (isExpanded ? '90' : '0') + 'deg)">▶</span>' +
              '<img src="' + esc(m.posterUrl) + '" alt="" style="width:30px;height:42px;border-radius:4px;object-fit:cover">' +
              '<div><div class="cell-strong">' + esc(m.title) + '</div>' +
              '<div class="cell-sub">' + esc(m.certificate) + ' · ' + esc(m.runtime) + 'm</div></div>' +
            '</div></td>' +
            '<td><span class="pill ' + pill + '">' + esc(label) + '</span></td>' +
            '<td>' + esc((m.languages || []).join(', ')) + '</td>' +
            '<td class="num"><span style="background:#7c3aed22;color:#7c3aed;padding:2px 10px;border-radius:10px;font-weight:600;font-size:13px">' + count + '</span></td>' +
            '<td><button class="btn btn--ghost btn--sm" data-add-for="' + esc(m.id) + '" style="white-space:nowrap">' + icon('plus', 14) + ' Add</button></td>' +
          '</tr>';
        if (isExpanded) {
          html += '<tr data-showtimes-row="' + esc(m.id) + '"><td colspan="5" style="padding:0;background:#faf8ff">' +
            '<div style="padding:12px 16px">' + renderShowtimesForMovie(m.id) + '</div>' +
          '</td></tr>';
        }
      });
      movieTbody.innerHTML = html;
    }

    function renderShowtimesForMovie(movieId) {
      var list = dayShowtimes.filter(function (s) { return s.movie && s.movie.id === movieId; });
      if (!list.length) {
        return '<div style="color:var(--muted);font-size:13px;padding:8px 0">No showtimes on this date. <button class="btn btn--ghost btn--sm" data-add-for="' + esc(movieId) + '" style="margin-left:8px">' + icon('plus', 14) + ' Add showtime</button></div>';
      }
      var rows = list.map(function (s) {
        var pct = s.capacity ? Math.round((s.seatsBooked / s.capacity) * 100) : 0;
        return '<tr>' +
          '<td class="cell-strong" style="font-size:14px;color:#7c3aed">' + time12(s.time) + '</td>' +
          '<td>' + esc(s.cinema ? s.cinema.name : '—') + '</td>' +
          '<td>' + esc(s.screen ? s.screen.name : '—') + '</td>' +
          '<td><span style="background:#e0e7ff;color:#3730a3;padding:1px 8px;border-radius:8px;font-size:12px">' + esc(s.format) + '</span></td>' +
          '<td>' + esc(s.language) + '</td>' +
          '<td class="num">' + (function(p){var v=p.silver||p.gold||p.platinum||p.recliner||p.sofa||p.regular||0;return money(v)+'+';})((s.prices||{})) + '</td>' +
          '<td class="num">' + s.seatsBooked + '/' + s.capacity + ' <span class="cell-sub">(' + pct + '%)</span></td>' +
          '<td style="white-space:nowrap">' +
            (s.status === 'cancelled' ? '<span class="pill pill--red">cancelled</span> ' : '') +
            '<button class="btn btn--ghost btn--sm" data-edit-showtime="' + esc(s.id) + '" data-movie-id="' + esc(movieId) + '" style="margin-right:4px">Edit</button>' +
            '<button class="btn btn--line btn--sm" data-del="' + esc(s.id) + '">Delete</button>' +
          '</td></tr>';
      }).join('');
      return '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
        '<thead><tr style="color:var(--muted);font-size:11px;text-transform:uppercase">' +
          '<th style="text-align:left;padding:4px 8px 6px 0;font-weight:600">Time</th>' +
          '<th style="text-align:left;padding:4px 8px 6px 0;font-weight:600">Cinema</th>' +
          '<th style="text-align:left;padding:4px 8px 6px 0;font-weight:600">Screen</th>' +
          '<th style="text-align:left;padding:4px 8px 6px 0;font-weight:600">Format</th>' +
          '<th style="text-align:left;padding:4px 8px 6px 0;font-weight:600">Language</th>' +
          '<th style="text-align:right;padding:4px 8px 6px 0;font-weight:600">Price</th>' +
          '<th style="text-align:right;padding:4px 8px 6px 0;font-weight:600">Seats</th>' +
          '<th></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
    }

    async function load() {
      var qs = 'date=' + dateInput.value + (cinemaSelect.value ? '&cinemaId=' + cinemaSelect.value : '') + '&limit=400';
      var data = await API.get('/showtimes?' + qs);
      dayShowtimes = data.showtimes || [];
      renderMovieRows();
    }

    dateInput.addEventListener('change', function () { expandedMovieId = null; load(); });
    cinemaSelect.addEventListener('change', function () { expandedMovieId = null; load(); });

    // AM/PM time picker helper - renders hour/min/period selects, writes back as HH:MM 24h to a hidden input named `name`
    function timePickerField(label, name, value24h) {
      var val = value24h || '19:00';
      var parts = val.split(':');
      var h24 = parseInt(parts[0], 10) || 19;
      var mins = parts[1] || '00';
      var period = h24 >= 12 ? 'PM' : 'AM';
      var h12 = h24 % 12; if (h12 === 0) h12 = 12;

      var hourOpts = [1,2,3,4,5,6,7,8,9,10,11,12].map(function(h) {
        return '<option value="' + h + '"' + (h === h12 ? ' selected' : '') + '>' + h + '</option>';
      }).join('');
      var minOpts = ['00','05','10','15','20','25','30','35','40','45','50','55'].map(function(m) {
        return '<option value="' + m + '"' + (m === mins ? ' selected' : '') + '>' + m + '</option>';
      }).join('');
      var periodOpts = ['AM','PM'].map(function(p) {
        return '<option value="' + p + '"' + (p === period ? ' selected' : '') + '>' + p + '</option>';
      }).join('');

      return '<div class="form-row">' +
        '<label class="label" for="tp-hour-' + name + '">' + esc(label) + '</label>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<select class="input" id="tp-hour-' + name + '" data-tp-hour="' + name + '" style="width:70px;text-align:center">' + hourOpts + '</select>' +
          '<span style="font-weight:700;font-size:18px;color:var(--ink-soft);line-height:1">:</span>' +
          '<select class="input" data-tp-min="' + name + '" style="width:70px;text-align:center">' + minOpts + '</select>' +
          '<select class="input" data-tp-period="' + name + '" style="width:70px;text-align:center">' + periodOpts + '</select>' +
        '</div>' +
        '<input type="hidden" name="' + name + '" value="' + esc(val) + '">' +
      '</div>';
    }

    function wireTimePicker(body, name) {
      function update() {
        var h = parseInt(body.querySelector('[data-tp-hour="' + name + '"]').value, 10);
        var m = body.querySelector('[data-tp-min="' + name + '"]').value;
        var p = body.querySelector('[data-tp-period="' + name + '"]').value;
        var h24 = p === 'PM' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
        body.querySelector('[name="' + name + '"]').value = String(h24).padStart(2, '0') + ':' + m;
      }
      body.querySelector('[data-tp-hour="' + name + '"]').addEventListener('change', update);
      body.querySelector('[data-tp-min="' + name + '"]').addEventListener('change', update);
      body.querySelector('[data-tp-period="' + name + '"]').addEventListener('change', update);
    }

    function openAddShowtime(movieId) {
      var body = h('<div class="form-grid">' +
        field('Movie', 'movieId', movieId || '', { span: true, options: allMovies.map(function (m) { return { value: m.id, label: m.title }; }) }) +
        field('Screen', 'screenId', '', { span: true, options: screens.map(function (s) { return { value: s.id, label: s.cinemaName + ' — ' + s.name + ' (' + s.format + ')' }; }) }) +
        field('Date', 'date', dateInput.value, { type: 'date' }) +
        timePickerField('Time', 'time', '19:00') +
        field('Language', 'language', '', {
          options: [
            { value: '', label: 'Default (movie\u2019s first language)' },
            { value: 'Hindi', label: 'Hindi' }, { value: 'English', label: 'English' },
            { value: 'Telugu', label: 'Telugu' }, { value: 'Tamil', label: 'Tamil' },
            { value: 'Kannada', label: 'Kannada' }, { value: 'Gujarati', label: 'Gujarati' },
          ],
        }) +
        '</div>');
      wireTimePicker(body, 'time');
      var m = modal({ title: 'Add showtime', body: body, confirmLabel: 'Create showtime' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          await API.post('/admin/showtimes', {
            movieId: raw.movieId, screenId: raw.screenId, date: raw.date, time: raw.time,
            language: raw.language || undefined,
          });
          toast('Showtime created', 'success');
          if (movieId) expandedMovieId = movieId;
          load();
        });
      });
    }

    function openEditShowtime(showtimeId, movieId) {
      var s = dayShowtimes.find(function (x) { return x.id === showtimeId; });
      if (!s) return;
      var body = h('<div class="form-grid">' +
        field('Screen', 'screenId', s.screen ? s.screen.id : '', { span: true, options: screens.map(function (sc) { return { value: sc.id, label: sc.cinemaName + ' — ' + sc.name + ' (' + sc.format + ')' }; }) }) +
        field('Date', 'date', dateInput.value, { type: 'date' }) +
        timePickerField('Time', 'time', s.time || '19:00') +
        field('Language', 'language', s.language || '', {
          options: [
            { value: '', label: 'Default' }, { value: 'Hindi', label: 'Hindi' }, { value: 'English', label: 'English' },
            { value: 'Telugu', label: 'Telugu' }, { value: 'Tamil', label: 'Tamil' },
            { value: 'Kannada', label: 'Kannada' }, { value: 'Gujarati', label: 'Gujarati' },
          ],
        }) +
        '</div>');
      wireTimePicker(body, 'time');
      var m = modal({ title: 'Edit showtime — ' + (s.movie ? s.movie.title : ''), body: body, confirmLabel: 'Save changes' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          await API.put('/admin/showtimes/' + showtimeId, {
            screenId: raw.screenId, date: raw.date, time: raw.time,
            language: raw.language || undefined,
          });
          toast('Showtime updated', 'success');
          if (movieId) expandedMovieId = movieId;
          load();
        });
      });
    }

    movieTbody.addEventListener('click', async function (event) {
      var addBtn = event.target.closest('[data-add-for]');
      var editBtn = event.target.closest('[data-edit-showtime]');
      var delBtn = event.target.closest('[data-del]');
      var movieRow = event.target.closest('[data-movie-row]');

      if (addBtn) { event.stopPropagation(); openAddShowtime(addBtn.getAttribute('data-add-for')); return; }

      if (editBtn) {
        event.stopPropagation();
        openEditShowtime(editBtn.getAttribute('data-edit-showtime'), editBtn.getAttribute('data-movie-id'));
        return;
      }

      if (delBtn) {
        event.stopPropagation();
        var ok = await confirmDialog('Delete this showtime?', 'Showtimes with confirmed bookings are marked cancelled instead of deleted.', 'Delete');
        if (!ok) return;
        try {
          var res = await API.del('/admin/showtimes/' + delBtn.getAttribute('data-del'));
          toast(res.cancelled ? res.reason : 'Showtime deleted', res.cancelled ? undefined : 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
        return;
      }

      if (movieRow && !addBtn && !editBtn && !delBtn) {
        var mid = movieRow.getAttribute('data-movie-row');
        expandedMovieId = expandedMovieId === mid ? null : mid;
        renderMovieRows();
      }
    });

    topActions.querySelector('[data-action="generate"]').addEventListener('click', async function () {
      try {
        var res = await API.post('/admin/showtimes/generate');
        toast(res.created ? 'Scheduled ' + res.created + ' new showtimes' : 'Schedule already complete', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });

    topActions.querySelector('[data-action="clear-showtimes"]').addEventListener('click', async function () {
      var ok = await confirmDialog('Clear all showtimes?', 'This removes every showtime and seat hold. Existing bookings are kept. This cannot be undone.', 'Clear all showtimes');
      if (!ok) return;
      try {
        var res = await API.post('/admin/clear-showtimes');
        toast('Cleared ' + res.cleared.showtimes + ' showtimes and ' + res.cleared.seatHolds + ' seat holds', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      openAddShowtime(null);
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
          '<option value="">All types</option><option value="movie">Movie</option>' +
          '<option value="hotel">Stay</option><option value="food">Food</option>' +
        '</select>' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Reference</th><th>Customer</th><th>Item</th><th>When</th><th>Seats / Rooms</th><th class="num">Amount</th><th>Payment</th><th>Status</th><th></th></tr></thead>' +
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
              '<td>' + esc(b.movieTitle || '—') + '<div class="cell-sub">' + esc(b.cinemaName) + '</div>' +
                (b.guestName ? '<div class="cell-sub">Guest: ' + esc(b.guestName) + '</div>' : '') + '</td>' +
              '<td>' + (b.stay
                  ? '<span class="mono">' + esc(b.stay.checkIn) + '</span> →<br><span class="mono">' + esc(b.stay.checkOut) + '</span>'
                  : b.showDate ? esc(b.showDate) + ' ' + esc(b.showTime) : esc(dateTime(b.startsAt))) + '</td>' +
              '<td>' + (b.stay ? esc(b.stay.label) : esc(b.seatLabel || '—')) + '</td>' +
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
        var ok = await confirmDialog('Cancel this booking?', 'The seats or rooms will be released and a 75% refund recorded.', 'Cancel booking');
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
              tr(b.type === 'food' ? 'Order' : b.type === 'hotel' ? 'Room' : 'Movie', esc(b.movieTitle)) +
              tr(b.type === 'hotel' ? 'Hotel' : 'Cinema', esc(b.cinemaName)) +
              (b.guestName ? tr('Guest name', esc(b.guestName)) : '') +
              (b.stay
                ? tr('Stay', esc(b.stay.checkIn) + ' → ' + esc(b.stay.checkOut) +
                    ' (' + b.stay.nights + ' night' + (b.stay.nights === 1 ? '' : 's') + ')') +
                  tr('Rooms', b.stay.rooms + ' × ' + esc(b.movieTitle) +
                    (b.stay.guests
                      ? ' · ' + b.stay.guests.adults + ' adult' + (b.stay.guests.adults === 1 ? '' : 's') +
                        (b.stay.guests.children ? ' + ' + b.stay.guests.children + ' child' : '')
                      : ''))
                : '') +
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
          { value: 'all', label: 'Everything (tickets, food, stays, dine-in, water park)' },
          { value: 'tickets', label: 'Tickets only' },
          { value: 'food', label: 'Food only' },
          { value: 'hotel', label: 'Hotel stays only' },
          { value: 'dinein', label: 'Dine-In bills only' },
          { value: 'waterpark', label: 'Water park passes only' },
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

  // ── Experiences (pool party, water park, wedding, etc.) ────────────────────
  async function pageExperiences(content, topActions) {
    topActions.innerHTML = '<button class="btn" data-action="new">' + icon('plus', 17) + ' Add experience</button>';
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.get('/admin/experiences');

    content.innerHTML =
      '<div class="panel" style="margin-top:0"><div class="panel__head"><h2 class="panel__title">' + data.experiences.length + ' experiences</h2></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Package</th><th>Category</th><th>Price</th><th>Badge</th><th class="num">Order</th><th>Status</th><th></th></tr></thead>' +
        '<tbody>' + (data.experiences.length ? data.experiences.map(function (e) {
          return '<tr><td><div class="cell-strong">' + esc(e.title) + '</div><div class="cell-sub">' + esc(e.subtitle || '') + '</div></td>' +
            '<td><span class="pill pill--purple">' + esc(e.category) + '</span></td>' +
            '<td>' + esc(e.priceLabel || '\u2014') + '</td>' +
            '<td>' + esc(e.badge || '\u2014') + '</td>' +
            '<td class="num">' + esc(e.order || 0) + '</td>' +
            '<td>' + (e.active !== false ? '<span class="pill pill--green">Active</span>' : '<span class="pill">Hidden</span>') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(e.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(e.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No experiences yet.</td></tr>') +
      '</tbody></table></div></div></div>';

    function form(exp) {
      var e = exp || {};
      return h('<div class="form-grid">' +
        imageField('Cover photo', 'image', e.image) +
        field('Title', 'title', e.title, { span: true, placeholder: 'Private Pool Party' }) +
        field('Category', 'category', e.category, { placeholder: 'Pool Party' }) +
        field('Badge (optional)', 'badge', e.badge, { placeholder: 'Popular' }) +
        field('Subtitle', 'subtitle', e.subtitle, { type: 'textarea', span: true, placeholder: 'One line describing the package' }) +
        field('Price label', 'priceLabel', e.priceLabel, { placeholder: '\u20B94,999' }) +
        field('Price note', 'priceNote', e.priceNote, { placeholder: 'up to 20 people' }) +
        field('Icon', 'icon', e.icon || 'sparkle', { options: ['sparkle', 'waves', 'users', 'cake', 'music', 'heart', 'gift', 'star', 'tag'] }) +
        field('Card color', 'color', e.color || '#7C3AED', { type: 'color' }) +
        field('Features (comma separated)', 'features', (e.features || []).join(', '), { type: 'textarea', span: true, placeholder: 'Unlimited tea, Music system, Free parking' }) +
        field('Display order', 'order', e.order || 1, { type: 'number' }) +
        field('Status', 'active', e.active === false ? 'false' : 'true', { options: [{ value: 'true', label: 'Active (visible to customers)' }, { value: 'false', label: 'Hidden' }] }) +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      return {
        title: raw.title, category: raw.category, badge: raw.badge, subtitle: raw.subtitle,
        priceLabel: raw.priceLabel, priceNote: raw.priceNote, icon: raw.icon, color: raw.color,
        features: csvList(raw.features), order: Number(raw.order) || 0, active: raw.active === 'true',
        image: raw.image || '',
      };
    }

    topActions.querySelector('[data-action="new"]').addEventListener('click', function () {
      var m = modal({ title: 'Add experience', body: form(null), confirmLabel: 'Create experience' });
      bindImageField(m.body, 'image');
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/experiences', payloadFrom(m.body));
          toast('Experience created', 'success');
          navigate('experiences');
        });
      });
    });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      if (edit) {
        var exp = data.experiences.find(function (e) { return e.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + exp.title, body: form(exp), confirmLabel: 'Save changes' });
        bindImageField(m.body, 'image');
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/experiences/' + exp.id, payloadFrom(m.body));
            toast('Experience updated', 'success');
            navigate('experiences');
          });
        });
      }
      if (del) {
        var ok = await confirmDialog('Delete this experience?', 'It will no longer be shown in the Experiences tab.', 'Delete experience');
        if (!ok) return;
        try {
          await API.del('/admin/experiences/' + del.getAttribute('data-del'));
          toast('Experience deleted', 'success');
          navigate('experiences');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Dine-In (discounts, notices, reservations, bills) ─────────────────────

  /* This section owns the two numbers the whole Dine-In tab turns on: the
     discount for a guest who reserved ahead, and the discount for a walk-in.
     Both, the length of the billing lock, and the wording of every customer
     notice are editable here and take effect on the next customer request.

     Notices are templates: the {tokens} listed under each input are substituted
     when a guest reads them, so changing a percentage automatically updates the
     copy without anyone having to retype it. */
  async function pageDineIn(content, topActions) {
    topActions.innerHTML =
      '<button class="btn btn--ghost" data-action="reset-notices">' + icon('refresh', 17) + ' Reset notices</button> ' +
      '<button class="btn" data-action="edit-settings">' + icon('edit', 17) + ' Edit discounts &amp; notices</button>';

    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.get('/admin/dine-in');
    var s = data.settings;
    var st = data.stats;

    function pct(n) { return (Number(n) || 0) + '%'; }

    function noticeBlock(label, text, when) {
      return '<div style="margin-bottom:16px">' +
        '<div class="label">' + esc(label) + '</div>' +
        '<div class="hint" style="margin:0 0 6px">' + esc(when) + '</div>' +
        '<div style="padding:11px 13px;border-radius:10px;background:var(--bg-sunken);font-size:13.5px;line-height:1.55">' +
          (text ? esc(text) : '<span class="hint">Empty — this banner is hidden from customers.</span>') +
        '</div></div>';
    }

    content.innerHTML =
      '<div class="cards">' +
        card('Reserved discount', pct(s.reservedDiscountPercent), 'needs a booking held ' + s.lockMinutes + ' min') +
        card('Walk-in discount', pct(s.walkinDiscountPercent), 'no booking, pays instantly') +
        card('Billing lock', s.lockMinutes + ' min', s.lockBasis === 'slot' ? 'counted from the reserved time' : 'counted from when they booked') +
        card('Billing opens', s.arriveEarlyMinutes + ' min early', 'before the reserved table time') +
        card('Dine-In revenue', money(st.revenue), st.bills + ' bill(s) settled in-app') +
        card('Discount given', money(st.discountGiven), 'total taken off customer bills') +
        card('Reservations', String(st.reservations), st.upcoming + ' still upcoming') +
      '</div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">' + esc(s.restaurantName) + '</h2>' +
        '<span class="pill ' + (s.active === false ? 'pill--red' : 'pill--green') + '">' +
          (s.active === false ? 'Tab hidden' : 'Live') + '</span>' +
      '</div><div class="panel__body">' +
        '<div class="grid-2">' +
          '<div><div class="label">How the discount is earned</div>' +
            '<div style="font-size:13.5px;line-height:1.6">Billing at <strong>' +
              pct(s.reservedDiscountPercent) + '</strong> opens once <em>both</em> are true: the table has been ' +
              'held for <strong>' + s.lockMinutes + ' minutes</strong>, and the sitting is within <strong>' +
              s.arriveEarlyMinutes + ' minutes</strong> of starting. That is what makes it "book before you ' +
              'arrive" — booking from the table, or booking a far-off slot to game the wait, earns nothing. ' +
              'Anyone without a reservation pays instantly at <strong>' + pct(s.walkinDiscountPercent) +
              '</strong> off.</div></div>' +
          '<div><div class="label">Restaurant</div>' +
            '<div>' + esc(s.address || '—') + '</div>' +
            '<div class="cell-sub">' + esc(s.phone || '—') + ' · open ' + esc(s.openTime) + '–' + esc(s.closeTime) + '</div>' +
            '<div class="cell-sub">Slots every ' + s.slotMinutes + ' min · up to ' + s.maxPartySize + ' guests · ' +
              s.capacityPerSlot + ' seats per slot</div></div>' +
        '</div>' +
        '<div class="grid-2" style="margin-top:16px">' +
          '<div><div class="label">Discount cap</div><div>' +
            (s.maxDiscountAmount ? money(s.maxDiscountAmount) + ' maximum per bill' : 'No cap') + '</div></div>' +
          '<div><div class="label">Minimum bill</div><div>' +
            (s.minBillAmount ? money(s.minBillAmount) : 'No minimum') + '</div></div>' +
        '</div>' +
        '<div style="margin-top:16px"><div class="label">Seating areas</div>' +
          ((s.areas || []).length
            ? (s.areas || []).map(function (a) { return '<span class="pill" style="margin:0 6px 6px 0">' + esc(a) + '</span>'; }).join('')
            : '<span class="hint">None configured</span>') +
        '</div>' +
        '<div class="hint" style="margin-top:14px">' +
          (s.allowWalkinWhileLocked !== false
            ? 'A guest whose reservation is still locked may choose to pay immediately at the walk-in rate.'
            : 'Guests must wait for their billing window — the walk-in rate is not offered as a fallback.') +
        '</div>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">Customer notices</h2>' +
        '<span class="hint">Exactly what guests read, with tokens filled in</span>' +
      '</div><div class="panel__body">' +
        noticeBlock('Reserved — ready to pay', data.previews.reserved, 'Shown when a held reservation has cleared the lock.') +
        noticeBlock('Reserved — still locked', data.previews.locked, 'Shown during the ' + s.lockMinutes + '-minute wait, with a live countdown.') +
        noticeBlock('Walk-in', data.previews.walkin, 'Shown to a guest with no reservation — the "book ahead next time" nudge.') +
        noticeBlock('Receipt — reserved', data.previews.paidReserved, 'Shown after a reserved-table bill is paid.') +
        noticeBlock('Receipt — walk-in', data.previews.paidWalkin, 'Shown after a walk-in bill is paid.') +
      '</div></div>' +

      '<div class="panel"><div class="panel__head"><h2 class="panel__title">' +
        data.reservations.length + ' reservation(s)</h2></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Guest</th><th>When</th><th class="num">Party</th><th>Seating</th>' +
          '<th>Billing</th><th>Status</th><th></th></tr></thead>' +
        '<tbody>' + (data.reservations.length ? data.reservations.map(function (r) {
          var billing = r.status !== 'confirmed' ? '—'
            : r.billId ? '<span class="pill pill--purple">Billed</span>'
            : r.lock.locked ? '<span class="pill">Locked · ' + r.lock.minutesLeft + 'm left</span>'
            : r.expired ? '<span class="pill pill--red">Expired</span>'
            : '<span class="pill pill--green">Open · ' + pct(s.reservedDiscountPercent) + '</span>';
          return '<tr>' +
            '<td><div class="cell-strong">' + esc((r.guest && r.guest.name) || r.customerName) + '</div>' +
              '<div class="cell-sub">' + esc(r.customerName) + ' · ' + esc(r.reference) + '</div></td>' +
            '<td>' + esc(shortDate(r.date)) + '<div class="cell-sub">' + esc(time12(r.time)) + '</div></td>' +
            '<td class="num">' + esc(r.partySize) + '</td>' +
            '<td>' + esc(r.area || '—') + '</td>' +
            '<td>' + billing + '</td>' +
            '<td>' + (r.status === 'confirmed' ? '<span class="pill pill--green">Confirmed</span>'
              : r.status === 'completed' ? '<span class="pill pill--purple">Completed</span>'
              : '<span class="pill pill--red">Cancelled</span>') + '</td>' +
            '<td style="white-space:nowrap">' +
              (r.status === 'confirmed'
                ? '<button class="btn btn--ghost btn--sm" data-cancel="' + esc(r.id) + '">Cancel</button> '
                : '') +
              '<button class="btn btn--line btn--sm" data-del="' + esc(r.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No reservations yet.</td></tr>') +
      '</tbody></table></div></div></div>' +

      '<div class="panel"><div class="panel__head"><h2 class="panel__title">' +
        data.bills.length + ' bill(s) paid in-app</h2></div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Reference</th><th>Guest</th><th>Paid</th><th>Tier</th>' +
          '<th class="num">Bill</th><th class="num">Discount</th><th class="num">Collected</th><th>Payment</th></tr></thead>' +
        '<tbody>' + (data.bills.length ? data.bills.map(function (b) {
          return '<tr>' +
            '<td class="mono cell-strong">' + esc(b.reference) + '</td>' +
            '<td>' + esc(b.customerName) + '</td>' +
            '<td>' + esc(dateTime(b.paidAt || b.createdAt)) + '</td>' +
            '<td>' + (b.mode === 'reserved'
              ? '<span class="pill pill--green">Reserved · ' + pct(b.amounts.discountPercent) + '</span>'
              : '<span class="pill">Walk-in · ' + pct(b.amounts.discountPercent) + '</span>') + '</td>' +
            '<td class="num">' + money(b.amounts.billAmount) + '</td>' +
            '<td class="num">- ' + money(b.amounts.discount) + '</td>' +
            '<td class="num cell-strong">' + money(b.amounts.total) + '</td>' +
            '<td>' + esc(b.payment.methodLabel) +
              (b.payment.status === 'pending' ? ' <span class="pill">due</span>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="8" class="empty-state">No bills settled through the app yet.</td></tr>') +
      '</tbody></table></div></div></div>';

    /** The token cheat-sheet shown under every notice input. */
    var tokenHint = 'Tokens: ' + data.noticeTokens.map(function (t) { return '{' + t + '}'; }).join('  ');

    function settingsForm() {
      return h('<div class="form-grid">' +
        field('Dine-In tab', 'active', s.active === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'Live (customers can reserve and pay)' },
          { value: 'false', label: 'Hidden (in-app billing switched off)' },
        ] }) +
        field('Restaurant name', 'restaurantName', s.restaurantName) +
        field('Tagline', 'tagline', s.tagline, { span: true }) +
        field('Address', 'address', s.address, { span: true }) +
        field('Phone', 'phone', s.phone) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Discounts</div></div>' +
        field('Reserved-table discount (%)', 'reservedDiscountPercent', s.reservedDiscountPercent, {
          type: 'number', hint: 'Applied when a reservation has been held for the lock window below.',
        }) +
        field('Walk-in discount (%)', 'walkinDiscountPercent', s.walkinDiscountPercent, {
          type: 'number', hint: 'Applied instantly when the guest has no reservation.',
        }) +
        field('Maximum discount (\u20B9)', 'maxDiscountAmount', s.maxDiscountAmount, {
          type: 'number', hint: '0 means no cap.',
        }) +
        field('Minimum bill (\u20B9)', 'minBillAmount', s.minBillAmount, {
          type: 'number', hint: '0 means any bill can be paid in the app.',
        }) +
        field('Maximum bill (\u20B9)', 'maxBillAmount', s.maxBillAmount, {
          type: 'number', hint: 'Guests type their own bill total, so anything larger must be paid at the counter.',
        }) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Billing lock</div></div>' +
        field('Lock window (minutes)', 'lockMinutes', s.lockMinutes, {
          type: 'number', hint: 'How long a reservation must be held before it can be billed. 0 disables the lock.',
        }) +
        field('Measured from', 'lockBasis', s.lockBasis, { options: [
          { value: 'booked', label: 'When the reservation was made' },
          { value: 'slot', label: 'The reserved table time' },
        ], hint: '"When the reservation was made" is the rule that requires booking ahead of arriving.' }) +
        field('Billing opens this many minutes before the table time', 'arriveEarlyMinutes', s.arriveEarlyMinutes, {
          type: 'number',
          hint: 'Ties the discount to the actual visit — without it a guest could book next week and claim the reserved rate today.',
        }) +
        field('Reservation still valid for (hours after the slot)', 'graceHours', s.graceHours, { type: 'number' }) +
        field('While locked', 'allowWalkinWhileLocked', s.allowWalkinWhileLocked === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'Let them pay now at the walk-in rate' },
          { value: 'false', label: 'Make them wait for the window' },
        ] }) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Reservation window</div></div>' +
        field('Opens', 'openTime', s.openTime, { placeholder: '11:00' }) +
        field('Closes', 'closeTime', s.closeTime, { placeholder: '23:00' }) +
        field('Slot length (minutes)', 'slotMinutes', s.slotMinutes, { type: 'number' }) +
        field('Seats per slot', 'capacityPerSlot', s.capacityPerSlot, { type: 'number' }) +
        field('Maximum party size', 'maxPartySize', s.maxPartySize, { type: 'number' }) +
        field('Bookable days ahead', 'advanceDays', s.advanceDays, { type: 'number' }) +
        field('Seating areas (comma separated)', 'areas', (s.areas || []).join(', '), {
          span: true, placeholder: 'Indoor AC, Garden, Rooftop',
        }) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Customer notices</div>' +
          '<div class="hint">' + esc(tokenHint) + '</div></div>' +
        field('Reserved — ready to pay', 'reservedNotice', s.reservedNotice, { type: 'textarea', span: true }) +
        field('Reserved — still locked', 'lockedNotice', s.lockedNotice, {
          type: 'textarea', span: true,
          hint: 'Shown during the wait. {minutesLeft} and {unlockTime} are filled in live.',
        }) +
        field('Walk-in', 'walkinNotice', s.walkinNotice, {
          type: 'textarea', span: true,
          hint: 'The "book a table before you arrive next time" nudge.',
        }) +
        field('Receipt — reserved', 'paidReservedNotice', s.paidReservedNotice, { type: 'textarea', span: true }) +
        field('Receipt — walk-in', 'paidWalkinNotice', s.paidWalkinNotice, { type: 'textarea', span: true }) +
        '</div>');
    }

    function payloadFrom(body) {
      var raw = readForm(body);
      return {
        active: raw.active === 'true',
        restaurantName: raw.restaurantName,
        tagline: raw.tagline,
        address: raw.address,
        phone: raw.phone,
        reservedDiscountPercent: Number(raw.reservedDiscountPercent),
        walkinDiscountPercent: Number(raw.walkinDiscountPercent),
        maxDiscountAmount: Number(raw.maxDiscountAmount),
        minBillAmount: Number(raw.minBillAmount),
        maxBillAmount: Number(raw.maxBillAmount),
        lockMinutes: Number(raw.lockMinutes),
        lockBasis: raw.lockBasis,
        arriveEarlyMinutes: Number(raw.arriveEarlyMinutes),
        graceHours: Number(raw.graceHours),
        allowWalkinWhileLocked: raw.allowWalkinWhileLocked === 'true',
        openTime: raw.openTime,
        closeTime: raw.closeTime,
        slotMinutes: Number(raw.slotMinutes),
        capacityPerSlot: Number(raw.capacityPerSlot),
        maxPartySize: Number(raw.maxPartySize),
        advanceDays: Number(raw.advanceDays),
        areas: csvList(raw.areas),
        reservedNotice: raw.reservedNotice,
        lockedNotice: raw.lockedNotice,
        walkinNotice: raw.walkinNotice,
        paidReservedNotice: raw.paidReservedNotice,
        paidWalkinNotice: raw.paidWalkinNotice,
      };
    }

    topActions.querySelector('[data-action="edit-settings"]').addEventListener('click', function () {
      var m = modal({ title: 'Dine-In discounts & notices', body: settingsForm(), confirmLabel: 'Save changes' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.put('/admin/dine-in/settings', payloadFrom(m.body));
          toast('Dine-In settings saved — live for customers now', 'success');
          navigate('dinein');
        });
      });
    });

    topActions.querySelector('[data-action="reset-notices"]').addEventListener('click', async function () {
      var ok = await confirmDialog(
        'Reset all notices?',
        'The five customer notices go back to their default wording. Your discount percentages and lock window are not touched.',
        'Reset notices'
      );
      if (!ok) return;
      try {
        await API.post('/admin/dine-in/notices/reset', {});
        toast('Notices reset', 'success');
        navigate('dinein');
      } catch (err) { toast(err.message, 'error'); }
    });

    content.addEventListener('click', async function (event) {
      var cancel = event.target.closest('[data-cancel]');
      var del = event.target.closest('[data-del]');
      if (cancel) {
        var ok = await confirmDialog('Cancel this reservation?', 'The table is released and the guest loses the reserved-table discount.', 'Cancel reservation');
        if (!ok) return;
        try {
          await API.post('/admin/dine-in/reservations/' + cancel.getAttribute('data-cancel') + '/cancel', {});
          toast('Reservation cancelled', 'success');
          navigate('dinein');
        } catch (err) { toast(err.message, 'error'); }
      }
      if (del) {
        var okDel = await confirmDialog('Delete this reservation?', 'It is removed from the ledger for good.', 'Delete');
        if (!okDel) return;
        try {
          await API.del('/admin/dine-in/reservations/' + del.getAttribute('data-del'));
          toast('Reservation deleted', 'success');
          navigate('dinein');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Water park ───────────────────────────────────────────────────────────

  /* The Family Fun Day console.

     Everything on this page is editable, and there is exactly one rate card
     behind all of it. A package does not store what it is worth — it stores
     quantities against rate-card lines, and the value breakup, the total actual
     value and the "you save" figure are all computed. So changing the adult
     entry rate here moves both packages, the per-person builder and every
     future quote at the same time, and the poster's own arithmetic can never
     drift from its line items.                                                */
  async function pageWaterpark(content, topActions) {
    topActions.innerHTML =
      '<button class="btn btn--ghost" data-action="reset-notices">' + icon('refresh', 17) + ' Reset notices</button> ' +
      '<button class="btn btn--line" data-action="edit-settings">' + icon('edit', 17) + ' Park settings</button> ' +
      '<button class="btn" data-action="new-booking">' + icon('plus', 17) + ' Sell a pass</button>';

    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.get('/admin/waterpark');
    var s = data.settings;
    var st = data.stats;
    var items = data.items;
    var sellable = items.filter(function (i) { return i.active !== false; });
    var addOns = data.addOns;
    var liveAddOns = addOns.filter(function (a) { return a.active !== false; });

    var UNIT_LABELS = {
      adult: 'per adult',
      child: 'per child',
      guest: 'per guest',
      booking: 'per booking',
    };

    function unitLabel(unit) { return UNIT_LABELS[unit] || 'per guest'; }
    function pct(n) { return (Number(n) || 0) + '%'; }
    function itemOf(id) {
      return items.filter(function (i) { return i.id === id; })[0] || null;
    }

    // ── Package cards, with the full value breakup ──
    function packCard(p) {
      var cls = 'wp-pack' + (p.active === false ? ' wp-pack--off' : '') +
        (p.overpriced || p.brokenLines ? ' wp-pack--warn' : '');

      var rows = p.lines.map(function (l) {
        return '<tr>' +
          '<td' + (l.missing ? ' class="wp-break__missing"' : '') + '>' + esc(l.label) +
            (l.entry ? ' <span class="pill pill--grey">gate</span>' : '') + '</td>' +
          '<td class="num">' + l.qty + '</td>' +
          '<td class="num">' + money(l.rate) + '</td>' +
          '<td class="num">' + money(l.value) + '</td></tr>';
      }).join('');

      return '<div class="' + cls + '">' +
        '<div class="wp-pack__head">' +
          '<div class="wp-pack__code">' + esc(p.code || '?') + '</div>' +
          '<div class="wp-pack__id">' +
            '<div class="wp-pack__name">' + esc(p.name) + '</div>' +
            '<div class="wp-pack__sub">' + esc(p.composition || '') +
              (p.composition ? ' \u00B7 ' : '') + p.guests + ' guest(s)' +
              (p.sold ? ' \u00B7 ' + p.sold + ' sold' : '') + '</div>' +
          '</div>' +
          (p.active === false
            ? '<span class="pill pill--red">Off sale</span>'
            : '<span class="pill pill--green">On sale</span>') +
        '</div>' +

        '<table class="wp-break">' +
          '<thead><tr><th>Particulars</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Value</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
          '<tfoot><tr><td colspan="3">Total actual value</td>' +
            '<td class="num">' + money(p.actualValue) + '</td></tr></tfoot>' +
        '</table>' +

        '<div class="wp-prices">' +
          '<div class="wp-price"><div class="wp-price__label">Package price</div>' +
            '<div class="wp-price__value">' + money(p.price) + '</div></div>' +
          (p.overpriced
            ? '<div class="wp-price wp-price--loss"><div class="wp-price__label">Costs more</div>' +
              '<div class="wp-price__value">+' + money(p.price - p.actualValue) + '</div></div>'
            : '<div class="wp-price wp-price--save"><div class="wp-price__label">You save</div>' +
              '<div class="wp-price__value">' + money(p.saving) + '</div></div>') +
        '</div>' +

        '<div class="wp-pack__foot">' +
          '<div class="hint">' +
            (p.brokenLines
              ? '<strong style="color:var(--danger)">' + p.brokenLines + ' line(s) point at a deleted rate \u2014 fix before selling.</strong>'
              : p.overpriced
                ? '<strong style="color:var(--danger)">Priced above its own value \u2014 guests save nothing.</strong>'
                : pct(p.savingPercent) + ' off the counter price') +
          '</div>' +
          '<button class="btn btn--line btn--sm" data-pack-edit="' + esc(p.id) + '">Edit</button> ' +
          '<button class="btn btn--line btn--sm" data-pack-del="' + esc(p.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }

    // ── Today's gate load ──
    function slotCard(slot) {
      var used = s.capacityPerSlot - slot.seatsLeft;
      var fill = s.capacityPerSlot > 0 ? Math.min(100, Math.round((used / s.capacityPerSlot) * 100)) : 0;
      var cls = 'wp-slot' + (slot.full ? ' wp-slot--full' : fill >= 70 ? ' wp-slot--busy' : '');
      return '<div class="' + cls + '">' +
        '<div class="wp-slot__time">' + esc(slot.label) + '</div>' +
        '<div class="wp-slot__meta">' + (slot.full ? 'Full' : slot.seatsLeft + ' left') +
          ' \u00B7 ' + used + '/' + s.capacityPerSlot + '</div>' +
        '<div class="wp-slot__bar"><div class="wp-slot__fill" style="width:' + fill + '%"></div></div>' +
      '</div>';
    }

    function noticeBlock(label, text, when) {
      return '<div style="margin-bottom:16px">' +
        '<div class="label">' + esc(label) + '</div>' +
        '<div class="hint" style="margin:0 0 6px">' + esc(when) + '</div>' +
        '<div class="wp-notice">' +
          (text ? esc(text) : '<span class="hint">Empty \u2014 this banner is hidden from customers.</span>') +
        '</div></div>';
    }

    // ── Page ──
    var html =
      '<div class="cards">' +
        card('Pass revenue', money(st.revenue), st.bookings + ' pass(es) sold \u00B7 ' + st.guests + ' guest(s)') +
        card('Today at the gate', String(st.todayGuests) + ' guests', money(st.todayRevenue) + ' taken today') +
        card('Packages vs per-person', st.packageBookings + ' / ' + st.individualBookings,
          st.counterSales + ' sold at the counter') +
        card('Savings given', money(st.savingGiven), 'what the bundle pricing cost against counter rates') +
        card('Add-on revenue', money(st.addOnRevenue), 'fish spa, rides, photography') +
        card('Upcoming visits', String(st.upcoming), st.checkedIn + ' checked in \u00B7 ' + st.cancelled + ' cancelled') +
      '</div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">' + esc(s.parkName) + ' \u2014 ' + esc(s.headline) + '</h2>' +
        (s.active === false
          ? '<span class="pill pill--red">Tab hidden</span>'
          : '<span class="pill pill--green">Live</span>') +
      '</div><div class="panel__body">' +
        '<div class="grid-2">' +
          '<div>' +
            '<div class="label">How it is sold</div>' +
            '<div style="font-size:13.5px;line-height:1.6">Guests either take a <strong>package</strong> at a flat ' +
              'price, or ' + (s.allowIndividual === false ? '<strong>(per-person booking is switched off)</strong>' :
              'build the day <strong>person by person</strong> at counter rates') + '. Both price from the one rate ' +
              'card below, so a package is only ever a deal because its parts really do cost more \u2014 that ' +
              'difference is the "you save" figure, and it is computed, never typed.</div>' +
            '<div class="hint" style="margin-top:10px">' + esc(s.validityNote || '') + '</div>' +
          '</div>' +
          '<div>' +
            '<div class="label">Park</div>' +
            '<div>' + esc(s.address || '\u2014') + '</div>' +
            '<div class="cell-sub">' + esc(s.phone || '\u2014') + '</div>' +
            '<div class="cell-sub">Open ' + time12(s.openTime) + '\u2013' + time12(s.closeTime) +
              ' \u00B7 entry every ' + s.slotMinutes + ' min \u00B7 ' + s.capacityPerSlot + ' guests per slot</div>' +
            '<div class="cell-sub">Bookable ' + s.advanceDays + ' day(s) ahead \u00B7 max ' +
              s.maxGuestsPerBooking + ' guests per booking</div>' +
            '<div class="cell-sub">' +
              (s.convenienceFeePercent || s.gstPercent
                ? 'Booking fee ' + pct(s.convenienceFeePercent) + ' \u00B7 tax ' + pct(s.gstPercent)
                : 'No booking fee or tax added \u2014 prices are all inclusive') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:16px"><div class="label">What\'s included</div><div class="wp-incl">' +
          ((s.inclusions || []).length
            ? (s.inclusions || []).map(function (i) { return '<span class="pill">' + esc(i) + '</span>'; }).join('')
            : '<span class="hint">None listed</span>') +
        '</div></div>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">' + data.packages.length + ' package(s)</h2>' +
        '<button class="btn btn--sm" data-action="new-pack">' + icon('plus', 16) + ' Add package</button>' +
      '</div><div class="panel__body">' +
        (data.packages.length
          ? '<div class="wp-packs">' + data.packages.map(packCard).join('') + '</div>'
          : '<div class="empty-state">No packages yet. Add one to start selling bundles.</div>') +
      '</div></div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">Rate card</h2>' +
        '<span class="hint" style="flex:1;margin:0 0 0 12px">Every package line and every per-person booking is priced from here</span>' +
        '<button class="btn btn--sm" data-action="new-item">' + icon('plus', 16) + ' Add line</button>' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Particulars</th><th>Applies</th><th class="num">Rate</th><th>Gate entry</th>' +
          '<th>Used by</th><th class="num">Sold</th><th class="num">Revenue</th><th>Status</th><th></th></tr></thead>' +
        '<tbody>' + (items.length ? items.map(function (i) {
          return '<tr>' +
            '<td class="cell-strong">' + esc(i.label) + '</td>' +
            '<td>' + esc(unitLabel(i.unit)) + '</td>' +
            '<td class="num cell-strong">' + money(i.rate) + '</td>' +
            '<td>' + (i.entry ? '<span class="pill pill--purple">Admits a guest</span>' : '<span class="hint">extra</span>') + '</td>' +
            '<td>' + (i.usedBy.length
              ? i.usedBy.map(function (n) { return '<span class="pill pill--grey">' + esc(n) + '</span>'; }).join(' ')
              : '<span class="hint">per-person only</span>') + '</td>' +
            '<td class="num">' + i.sales.qty + '</td>' +
            '<td class="num">' + money(i.sales.revenue) + '</td>' +
            '<td>' + (i.active === false ? '<span class="pill pill--red">Off</span>' : '<span class="pill pill--green">On</span>') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--line btn--sm" data-item-edit="' + esc(i.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-item-del="' + esc(i.id) + '">Delete</button></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="9" class="empty-state">The rate card is empty.</td></tr>') +
      '</tbody></table></div></div></div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">Add-ons</h2>' +
        '<span class="hint" style="flex:1;margin:0 0 0 12px">Sold on top of a package or a per-person day</span>' +
        '<button class="btn btn--sm" data-action="new-addon">' + icon('plus', 16) + ' Add add-on</button>' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Add-on</th><th>Variant</th><th class="num">Price</th>' +
          '<th class="num">Sold</th><th class="num">Revenue</th><th>Status</th><th></th></tr></thead>' +
        '<tbody>' + (addOns.length ? addOns.map(function (a) {
          return '<tr>' +
            '<td class="cell-strong">' + esc(a.label) + '</td>' +
            '<td>' + (a.note ? esc(a.note) : '<span class="hint">\u2014</span>') + '</td>' +
            '<td class="num cell-strong">' + money(a.price) + '</td>' +
            '<td class="num">' + a.sales.qty + '</td>' +
            '<td class="num">' + money(a.sales.revenue) + '</td>' +
            '<td>' + (a.active === false ? '<span class="pill pill--red">Off</span>' : '<span class="pill pill--green">On</span>') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--line btn--sm" data-addon-edit="' + esc(a.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-addon-del="' + esc(a.id) + '">Delete</button></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="7" class="empty-state">No add-ons yet.</td></tr>') +
      '</tbody></table></div></div></div>' +

      '<div class="grid-2">' +
        '<div class="panel" style="margin:0">' +
          '<div class="panel__head"><h2 class="panel__title">Gate load today</h2>' +
            '<span class="hint">' + esc(data.today) + '</span></div>' +
          '<div class="panel__body">' +
            (data.todaySlots.length
              ? '<div class="wp-slots">' + data.todaySlots.map(slotCard).join('') + '</div>'
              : '<div class="empty-state">No entry slots left today.</div>') +
          '</div>' +
        '</div>' +
        '<div class="panel" style="margin:0">' +
          '<div class="panel__head"><h2 class="panel__title">Customer notices</h2>' +
            '<span class="hint">tokens filled in</span></div>' +
          '<div class="panel__body">' +
            noticeBlock('Package selected', data.previews.package, 'Shown against a package before paying.') +
            noticeBlock('Per-person booking', data.previews.individual, 'The "a package is cheaper" nudge.') +
            noticeBlock('On the pass', data.previews.paid, 'Printed on the confirmed pass.') +
            noticeBlock('Slot full', data.previews.soldOut, 'Shown when the chosen entry slot has filled.') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">' + data.bookings.length + ' pass(es)</h2>' +
        '<div class="toolbar" style="margin-left:auto">' +
          '<input class="input" data-filter-text placeholder="Search reference, guest or phone">' +
          '<select class="input" data-filter-status>' +
            '<option value="">All statuses</option>' +
            '<option value="confirmed">Confirmed</option>' +
            '<option value="cancelled">Cancelled</option>' +
            '<option value="checkedin">Checked in</option>' +
            '<option value="pending-gate">Not yet arrived</option>' +
          '</select>' +
        '</div>' +
      '</div><div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Reference</th><th>Guest</th><th>Visit</th><th>What they bought</th>' +
          '<th class="num">Guests</th><th class="num">Paid</th><th class="num">Saved</th>' +
          '<th>Payment</th><th>Gate</th><th>Status</th><th></th></tr></thead>' +
        '<tbody data-rows>' + (data.bookings.length ? data.bookings.map(function (b) {
          var bought = b.mode === 'package'
            ? '<span class="pill pill--purple">' + esc(b.packageCode || '?') + '</span> ' + esc(b.packageName || '') +
              (b.packageQty > 1 ? ' \u00D7' + b.packageQty : '')
            : '<span class="pill">Per person</span>';
          var extras = (b.addOns || []).length
            ? '<div class="cell-sub">+ ' + (b.addOns || []).map(function (a) {
                return esc(a.label) + (a.note ? ' (' + esc(a.note) + ')' : '') + ' \u00D7' + a.qty;
              }).join(', ') + '</div>'
            : '';
          var searchable = [b.reference, b.customerName, b.guest && b.guest.name, b.guest && b.guest.phone]
            .filter(Boolean).join(' ').toLowerCase();
          var gateState = b.checkedInAt ? 'checkedin' : 'pending-gate';

          return '<tr data-search="' + esc(searchable) + '" data-status="' + esc(b.status) + '" data-gate="' + gateState + '">' +
            '<td class="mono cell-strong">' + esc(b.reference) + '</td>' +
            '<td><div class="cell-strong">' + esc((b.guest && b.guest.name) || b.customerName) + '</div>' +
              '<div class="cell-sub">' + esc((b.guest && b.guest.phone) || b.customerName) +
              (b.source === 'counter' ? ' \u00B7 counter' : '') + '</div></td>' +
            '<td>' + esc(b.dateLabel) + '<div class="cell-sub">' + esc(b.timeLabel) + '</div></td>' +
            '<td>' + bought + extras + '</td>' +
            '<td class="num">' + ((b.guests && b.guests.total) || 0) + '</td>' +
            '<td class="num cell-strong">' + money(b.amounts && b.amounts.total) + '</td>' +
            '<td class="num">' + (b.amounts && b.amounts.totalSaving ? money(b.amounts.totalSaving) : '\u2014') + '</td>' +
            '<td>' + esc((b.payment && b.payment.methodLabel) || '\u2014') +
              (b.payment && b.payment.status === 'pending' ? ' <span class="pill">due</span>' : '') + '</td>' +
            '<td>' + (b.checkedInAt
              ? '<span class="pill pill--green">In at ' + esc(time12(new Date(b.checkedInAt).toTimeString().slice(0, 5))) + '</span>'
              : b.status === 'confirmed' ? '<span class="pill pill--grey">Not arrived</span>' : '\u2014') + '</td>' +
            '<td>' + (b.status === 'confirmed'
              ? '<span class="pill pill--green">Confirmed</span>'
              : '<span class="pill pill--red">Cancelled</span>') + '</td>' +
            '<td style="white-space:nowrap">' +
              (b.status === 'confirmed' && !b.checkedInAt
                ? '<button class="btn btn--ghost btn--sm" data-checkin="' + esc(b.id) + '">Check in</button> '
                : '') +
              (b.checkedInAt
                ? '<button class="btn btn--line btn--sm" data-undo-checkin="' + esc(b.id) + '">Undo</button> '
                : '') +
              (b.status === 'confirmed'
                ? '<button class="btn btn--line btn--sm" data-cancel="' + esc(b.id) + '">Cancel</button> '
                : '') +
              '<button class="btn btn--line btn--sm" data-del="' + esc(b.id) + '">Delete</button></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="11" class="empty-state">No passes sold yet.</td></tr>') +
      '</tbody></table></div></div></div>';

    /* Rendered into a wrapper we own, so the delegated listener below is thrown
       away with the markup instead of stacking up on every visit to the tab. */
    content.innerHTML = '';
    var view = h('<div>' + html + '</div>');
    content.appendChild(view);

    // ── Ledger filtering ──
    var textFilter = view.querySelector('[data-filter-text]');
    var statusFilter = view.querySelector('[data-filter-status]');
    function applyFilter() {
      var q = (textFilter.value || '').trim().toLowerCase();
      var want = statusFilter.value;
      view.querySelectorAll('[data-rows] tr[data-search]').forEach(function (tr) {
        var okText = !q || tr.getAttribute('data-search').indexOf(q) !== -1;
        var okStatus = !want ||
          (want === 'checkedin' || want === 'pending-gate'
            ? tr.getAttribute('data-gate') === want && tr.getAttribute('data-status') === 'confirmed'
            : tr.getAttribute('data-status') === want);
        tr.hidden = !(okText && okStatus);
      });
    }
    if (textFilter) textFilter.addEventListener('input', applyFilter);
    if (statusFilter) statusFilter.addEventListener('change', applyFilter);

    // ── A reusable quantity editor over the rate card ──
    /**
     * One row per sellable rate-card line with an editable quantity. This is
     * the same control the package editor and the per-person counter booking
     * use, which is why "everything editable" means the same thing in both.
     */
    function qtyEditor(list, quantities, opts) {
      var o = opts || {};
      return '<div class="wp-lines">' + list.map(function (i) {
        var qty = quantities[i.id] || 0;
        var price = i.rate !== undefined ? i.rate : i.price;
        return '<div class="wp-line">' +
          '<div class="wp-line__text">' +
            '<div class="wp-line__label">' + esc(i.label) + (i.note ? ' <span class="hint">(' + esc(i.note) + ')</span>' : '') + '</div>' +
            '<div class="wp-line__meta">' + money(price) + ' ' +
              (i.rate !== undefined ? esc(unitLabel(i.unit)) : 'each') +
              (i.entry ? ' \u00B7 admits a guest' : '') + '</div>' +
          '</div>' +
          '<div class="wp-line__qty"><input class="input" type="number" min="0" max="99" ' +
            'data-' + (o.attr || 'qty') + '="' + esc(i.id) + '" data-rate="' + price + '" ' +
            'data-unit="' + esc(i.unit || '') + '" value="' + qty + '"></div>' +
          '<div class="wp-line__value' + (qty ? '' : ' wp-line__value--zero') + '" ' +
            'data-value-for="' + esc(i.id) + '">' + (qty ? money(price * qty) : '\u2014') + '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    /** Reads a quantity editor back out as [{itemId|id, qty}]. */
    function readQty(body, attr, key) {
      var out = [];
      body.querySelectorAll('[data-' + attr + ']').forEach(function (inp) {
        var qty = Math.max(0, Math.round(Number(inp.value) || 0));
        if (qty > 0) {
          var row = { qty: qty };
          row[key] = inp.getAttribute('data-' + attr);
          out.push(row);
        }
      });
      return out;
    }

    /** Repaints the per-line value column as quantities change. */
    function refreshValues(body, attr) {
      body.querySelectorAll('[data-' + attr + ']').forEach(function (inp) {
        var rate = Number(inp.getAttribute('data-rate')) || 0;
        var qty = Math.max(0, Number(inp.value) || 0);
        var cell = body.querySelector('[data-value-for="' + inp.getAttribute('data-' + attr) + '"]');
        if (!cell) return;
        cell.textContent = qty ? money(rate * qty) : '\u2014';
        cell.className = 'wp-line__value' + (qty ? '' : ' wp-line__value--zero');
      });
    }

    /** Fills quantities from a head count, using each line's "applies to". */
    function autofill(body, attr, adults, children) {
      body.querySelectorAll('[data-' + attr + ']').forEach(function (inp) {
        var unit = inp.getAttribute('data-unit');
        var qty = unit === 'adult' ? adults
          : unit === 'child' ? children
          : unit === 'booking' ? (adults + children > 0 ? 1 : 0)
          : adults + children;
        inp.value = qty;
      });
      refreshValues(body, attr);
    }

    // ── Park settings ──
    function settingsForm() {
      var tokenHint = 'Tokens: ' + data.noticeTokens.map(function (t) { return '{' + t + '}'; }).join('  ');
      return h('<div class="form-grid">' +
        field('Water park tab', 'active', s.active === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'Live (guests can book)' },
          { value: 'false', label: 'Hidden (booking switched off)' },
        ] }) +
        field('Per-person booking', 'allowIndividual', s.allowIndividual === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'Allowed \u2014 guests can build their own day' },
          { value: 'false', label: 'Packages only' },
        ], hint: 'Turning this off leaves the packages on sale.' }) +
        field('Park name', 'parkName', s.parkName) +
        field('Headline', 'headline', s.headline, { placeholder: 'Family Fun Day' }) +
        field('Tagline', 'tagline', s.tagline, { span: true }) +
        field('Sub-line', 'subline', s.subline, { span: true }) +
        field('Address', 'address', s.address, { span: true }) +
        field('Phone', 'phone', s.phone) +
        field('Validity note', 'validityNote', s.validityNote, { hint: 'Printed under the packages and on the pass.' }) +
        field('What\'s included (comma separated)', 'inclusions', (s.inclusions || []).join(', '), {
          span: true, placeholder: 'Water Park Entry, Movie Tickets, Costume',
          hint: 'The "what\'s included" strip. Presentation only \u2014 what a guest is charged for comes from the package lines.',
        }) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Entry slots &amp; capacity</div></div>' +
        field('Opens', 'openTime', s.openTime, { placeholder: '10:00' }) +
        field('Closes', 'closeTime', s.closeTime, { placeholder: '18:00' }) +
        field('Entry slot length (minutes)', 'slotMinutes', s.slotMinutes, { type: 'number' }) +
        field('Guests per slot', 'capacityPerSlot', s.capacityPerSlot, { type: 'number' }) +
        field('Bookable days ahead', 'advanceDays', s.advanceDays, { type: 'number', hint: '0 means same day only.' }) +
        field('Maximum guests per booking', 'maxGuestsPerBooking', s.maxGuestsPerBooking, { type: 'number' }) +
        field('Maximum packages per booking', 'maxPackagesPerBooking', s.maxPackagesPerBooking, { type: 'number' }) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Charges on top</div></div>' +
        field('Booking fee (%)', 'convenienceFeePercent', s.convenienceFeePercent, {
          type: 'number', hint: '0 means no fee \u2014 the package price is what they pay.',
        }) +
        field('Tax (%)', 'gstPercent', s.gstPercent, { type: 'number', hint: '0 means prices are tax inclusive.' }) +

        '<div class="col-span"><div class="label" style="margin-top:6px">Customer notices</div>' +
          '<div class="hint">' + esc(tokenHint) + '</div></div>' +
        field('Package selected', 'packageNotice', s.packageNotice, { type: 'textarea', span: true }) +
        field('Per-person booking', 'individualNotice', s.individualNotice, {
          type: 'textarea', span: true, hint: 'Use {bestSaving} to quote the best package saving automatically.',
        }) +
        field('On the pass', 'paidNotice', s.paidNotice, { type: 'textarea', span: true }) +
        field('Slot full', 'soldOutNotice', s.soldOutNotice, { type: 'textarea', span: true }) +
      '</div>');
    }

    function settingsPayload(body) {
      var raw = readForm(body);
      return {
        active: raw.active === 'true',
        allowIndividual: raw.allowIndividual === 'true',
        parkName: raw.parkName,
        headline: raw.headline,
        tagline: raw.tagline,
        subline: raw.subline,
        address: raw.address,
        phone: raw.phone,
        validityNote: raw.validityNote,
        inclusions: csvList(raw.inclusions),
        openTime: raw.openTime,
        closeTime: raw.closeTime,
        slotMinutes: Number(raw.slotMinutes),
        capacityPerSlot: Number(raw.capacityPerSlot),
        advanceDays: Number(raw.advanceDays),
        maxGuestsPerBooking: Number(raw.maxGuestsPerBooking),
        maxPackagesPerBooking: Number(raw.maxPackagesPerBooking),
        convenienceFeePercent: Number(raw.convenienceFeePercent),
        gstPercent: Number(raw.gstPercent),
        packageNotice: raw.packageNotice,
        individualNotice: raw.individualNotice,
        paidNotice: raw.paidNotice,
        soldOutNotice: raw.soldOutNotice,
      };
    }

    // ── Rate-card line editor ──
    function itemForm(item) {
      var i = item || { label: '', rate: 0, unit: 'guest', entry: false, active: true };
      return h('<div class="form-grid">' +
        field('Particulars', 'label', i.label, { span: true, placeholder: 'Water Park Entry \u2013 Adult' }) +
        field('Rate (\u20B9)', 'rate', i.rate, { type: 'number' }) +
        field('Applies to', 'unit', i.unit, { options: [
          { value: 'adult', label: 'Per adult' },
          { value: 'child', label: 'Per child' },
          { value: 'guest', label: 'Per guest (adults and children)' },
          { value: 'booking', label: 'Per booking (one per order)' },
        ], hint: 'Used to fill quantities from a head count.' }) +
        field('Gate entry', 'entry', i.entry ? 'true' : 'false', { options: [
          { value: 'false', label: 'No \u2014 an extra' },
          { value: 'true', label: 'Yes \u2014 this ticket admits a guest' },
        ], hint: 'Entry lines are what capacity and the head count are counted on. Only per-adult or per-child lines can admit a guest.' }) +
        field('Status', 'active', i.active === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'On sale' },
          { value: 'false', label: 'Off sale' },
        ] }) +
        (item ? '<div class="col-span"><div class="hint">Changing this rate immediately moves every package that uses it, ' +
          'and every per-person booking made from here on.</div></div>' : '') +
      '</div>');
    }

    function itemPayload(body) {
      var raw = readForm(body);
      return {
        label: raw.label,
        rate: Number(raw.rate),
        unit: raw.unit,
        entry: raw.entry === 'true',
        active: raw.active === 'true',
      };
    }

    // ── Add-on editor ──
    function addOnForm(addOn) {
      var a = addOn || { label: '', note: '', price: 0, active: true };
      return h('<div class="form-grid">' +
        field('Add-on', 'label', a.label, { placeholder: 'Massage Chair' }) +
        field('Variant', 'note', a.note, { placeholder: '15 min', hint: 'Optional \u2014 distinguishes two prices for the same thing.' }) +
        field('Price (\u20B9)', 'price', a.price, { type: 'number' }) +
        field('Status', 'active', a.active === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'On sale' },
          { value: 'false', label: 'Off sale' },
        ] }) +
      '</div>');
    }

    function addOnPayload(body) {
      var raw = readForm(body);
      return { label: raw.label, note: raw.note, price: Number(raw.price), active: raw.active === 'true' };
    }

    // ── Package editor, with a live value breakup ──
    function packForm(pkg) {
      var p = pkg || { code: '', name: '', composition: '', adults: 2, children: 0, price: 0, badge: '', active: true, lines: [] };
      var quantities = {};
      (p.lines || []).forEach(function (l) { quantities[l.itemId] = l.qty; });

      /* A line the package already uses is listed even if that rate has since
         been taken off sale — otherwise saving the package would silently drop
         it, quietly changing what the guest gets. */
      var editable = sellable.slice();
      (p.lines || []).forEach(function (l) {
        var known = editable.filter(function (i) { return i.id === l.itemId; }).length;
        if (known) return;
        var offSale = itemOf(l.itemId);
        if (offSale) editable.push(offSale);
      });

      var body = h('<div>' +
        '<div class="form-grid">' +
          field('Package letter', 'code', p.code, { placeholder: 'A', hint: 'Shown in the badge on the card.' }) +
          field('Name', 'name', p.name, { placeholder: 'Family of 3' }) +
          field('Composition', 'composition', p.composition, { placeholder: '2 Adults + 1 Child', span: true }) +
          field('Adults', 'adults', p.adults, { type: 'number' }) +
          field('Children', 'children', p.children, { type: 'number' }) +
          field('Package price (\u20B9)', 'price', p.price, { type: 'number', hint: 'The flat price guests pay.' }) +
          field('Badge', 'badge', p.badge, { placeholder: 'Save big' }) +
          field('Status', 'active', p.active === false ? 'false' : 'true', { options: [
            { value: 'true', label: 'On sale' },
            { value: 'false', label: 'Off sale' },
          ] }) +
        '</div>' +
        '<div class="label" style="margin-top:4px">Value breakup</div>' +
        '<div class="hint" style="margin:0 0 10px">Set a quantity against each rate-card line. The total actual value ' +
          'and the saving are computed from these \u2014 they are never typed in.</div>' +
        '<div style="margin-bottom:10px"><button class="btn btn--line btn--sm" data-action="autofill">' +
          icon('refresh', 15) + ' Fill quantities from the head count</button></div>' +
        qtyEditor(editable, quantities, { attr: 'qty' }) +
        '<div class="wp-live" data-live>' +
          '<div class="wp-live__row">Total actual value <strong data-live-value>\u2014</strong></div>' +
          '<div class="wp-live__row">Package price <strong data-live-price>\u2014</strong></div>' +
          '<div class="wp-live__row">You save <strong data-live-save>\u2014</strong></div>' +
          '<div class="wp-live__row"><span data-live-warn class="wp-live__err"></span></div>' +
        '</div>' +
        '<div class="hint" style="margin-top:10px">Entry tickets must add up to the head count above, or the gate would ' +
          'turn a guest away holding a valid pass.</div>' +
      '</div>');

      function recompute() {
        refreshValues(body, 'qty');
        var value = 0;
        var entries = 0;
        body.querySelectorAll('[data-qty]').forEach(function (inp) {
          var qty = Math.max(0, Number(inp.value) || 0);
          value += (Number(inp.getAttribute('data-rate')) || 0) * qty;
          var item = itemOf(inp.getAttribute('data-qty'));
          if (item && item.entry) entries += qty;
        });
        var price = Math.max(0, Number(body.querySelector('[name="price"]').value) || 0);
        var heads = Math.max(0, Number(body.querySelector('[name="adults"]').value) || 0) +
          Math.max(0, Number(body.querySelector('[name="children"]').value) || 0);

        body.querySelector('[data-live-value]').textContent = money(value);
        body.querySelector('[data-live-price]').textContent = money(price);
        body.querySelector('[data-live-save]').textContent = money(Math.max(0, value - price));

        var warn = '';
        if (price > value) warn = 'This costs ' + money(price - value) + ' MORE than its parts \u2014 guests would save nothing.';
        else if (entries && heads && entries !== heads) {
          warn = entries + ' entry ticket(s) for ' + heads + ' guest(s) \u2014 these must match.';
        } else if (!heads) warn = 'Set how many adults and children this package is for.';
        body.querySelector('[data-live-warn]').textContent = warn;
      }

      body.addEventListener('input', recompute);
      body.addEventListener('change', recompute);
      body.querySelector('[data-action="autofill"]').addEventListener('click', function () {
        autofill(
          body, 'qty',
          Math.max(0, Number(body.querySelector('[name="adults"]').value) || 0),
          Math.max(0, Number(body.querySelector('[name="children"]').value) || 0)
        );
        recompute();
      });
      recompute();
      return body;
    }

    function packPayload(body) {
      var raw = readForm(body);
      return {
        code: raw.code,
        name: raw.name,
        composition: raw.composition,
        adults: Number(raw.adults),
        children: Number(raw.children),
        price: Number(raw.price),
        badge: raw.badge,
        active: raw.active === 'true',
        lines: readQty(body, 'qty', 'itemId'),
      };
    }

    // ── Counter booking builder ──
    /**
     * Sells a pass at the desk. Supports both modes, and every quantity is
     * editable in either — a walk-up family of five can take the family-of-four
     * package plus one extra adult, or be priced entirely per person.
     *
     * The total is always fetched from the server rather than added up here, so
     * the clerk can never quote a figure the booking endpoint disagrees with.
     */
    function bookingForm() {
      var packOptions = data.packages
        .filter(function (p) { return p.active !== false && !p.brokenLines; })
        .map(function (p) {
          return { value: p.id, label: (p.code ? p.code + ' \u2014 ' : '') + p.name + ' (' + money(p.price) + ', ' + p.guests + ' guests)' };
        });

      var body = h('<div>' +
        '<div class="form-grid">' +
          field('How are they buying?', 'mode', packOptions.length ? 'package' : 'individual', { options: [].concat(
            packOptions.length ? [{ value: 'package', label: 'A package' }] : [],
            s.allowIndividual === false ? [] : [{ value: 'individual', label: 'Per person \u2014 build it line by line' }]
          ) }) +
          field('Visit date', 'date', data.today, { type: 'date' }) +
          '<div class="form-row"><label class="label">Entry slot</label>' +
            '<select class="input" name="time" data-slots><option value="">Loading\u2026</option></select>' +
            '<div class="hint" data-slot-hint></div></div>' +
          field('Guest name', 'guestName', '', { placeholder: 'Name for the pass' }) +
          field('Phone', 'guestPhone', '', { placeholder: '93030 17878' }) +
          field('Payment taken', 'paymentMethod', 'cash', { options: [
            { value: 'cash', label: 'Cash at counter' },
            { value: 'upi', label: 'UPI at counter' },
            { value: 'card', label: 'Card at counter' },
          ] }) +
          field('Link to customer account', 'customerEmail', '', {
            placeholder: 'optional email', hint: 'If they have an app account, the pass appears there too.',
          }) +
          field('Offer code', 'offerCode', '', { placeholder: 'optional' }) +
        '</div>' +

        '<div data-section="package">' +
          (packOptions.length
            ? '<div class="form-grid">' +
                field('Package', 'packageId', packOptions[0].value, { options: packOptions }) +
                field('How many of it', 'packageQty', 1, { type: 'number' }) +
              '</div>' +
              '<div class="label">Extra guests or extras, at counter rates</div>' +
              '<div class="hint" style="margin:0 0 10px">Leave at zero unless the group is bigger than the package, ' +
                'or wants something it does not include.</div>' +
              qtyEditor(sellable, {}, { attr: 'extra' })
            : '<div class="hint">No packages are on sale \u2014 sell per person instead.</div>') +
        '</div>' +

        '<div data-section="individual" hidden>' +
          '<div class="form-grid">' +
            field('Adults', 'fillAdults', 2, { type: 'number' }) +
            field('Children', 'fillChildren', 1, { type: 'number' }) +
          '</div>' +
          '<div style="margin-bottom:10px"><button class="btn btn--line btn--sm" data-action="autofill-ind">' +
            icon('refresh', 15) + ' Fill quantities from that head count</button></div>' +
          '<div class="hint" style="margin:0 0 10px">Every line is editable \u2014 drop the costume for the adults, ' +
            'give only one child the jumping section, whatever they actually want.</div>' +
          qtyEditor(sellable, {}, { attr: 'line' }) +
        '</div>' +

        '<div class="label" style="margin-top:16px">Add-ons</div>' +
        (liveAddOns.length ? qtyEditor(liveAddOns, {}, { attr: 'addon' }) : '<div class="hint">No add-ons on sale.</div>') +

        '<div class="form-row" style="margin-top:14px"><label class="label">Note</label>' +
          '<input class="input" name="notes" placeholder="Anything the gate should know"></div>' +

        '<div class="wp-live wp-live--total" data-quote>' +
          '<div class="wp-live__row">Total <strong data-q-total>\u2014</strong></div>' +
          '<div class="wp-live__row">Guests <strong data-q-guests>\u2014</strong></div>' +
          '<div class="wp-live__row">They save <strong data-q-save>\u2014</strong></div>' +
        '</div>' +
        '<div class="hint" data-q-detail></div>' +
        '<div class="error" data-q-error hidden></div>' +
      '</div>');

      var modeSel = body.querySelector('[name="mode"]');
      var dateInput = body.querySelector('[name="date"]');
      var slotSel = body.querySelector('[data-slots]');
      var slotHint = body.querySelector('[data-slot-hint]');
      var seq = 0;
      var quoteTimer = null;

      function currentMode() { return modeSel ? modeSel.value : 'individual'; }

      function syncSections() {
        var mode = currentMode();
        body.querySelector('[data-section="package"]').hidden = mode !== 'package';
        body.querySelector('[data-section="individual"]').hidden = mode !== 'individual';
      }

      /** The payload both the live quote and the final sale are built from. */
      function payload() {
        var raw = readForm(body);
        var order = {
          mode: currentMode(),
          date: raw.date,
          time: raw.time,
          addOns: readQty(body, 'addon', 'id'),
          offerCode: raw.offerCode || undefined,
        };
        if (order.mode === 'package') {
          order.packageId = raw.packageId;
          order.packageQty = Number(raw.packageQty) || 1;
          order.extras = readQty(body, 'extra', 'itemId');
        } else {
          order.lines = readQty(body, 'line', 'itemId');
        }
        return order;
      }

      /** Tomorrow, as a YYYY-MM-DD key. */
      function dayAfter(key) {
        var d = new Date(key + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }

      async function loadSlots(opts) {
        slotSel.innerHTML = '<option value="">Loading\u2026</option>';
        try {
          var res = await API.get('/waterpark/slots?date=' + encodeURIComponent(dateInput.value));
          if (!res.slots.length) {
            /* By late afternoon today has no slots left at all. Roll the form
               on to tomorrow once, rather than leaving the clerk on a date
               with nothing to sell. */
            if (!(opts && opts.rolled) && dateInput.value === data.today && s.advanceDays > 0) {
              dateInput.value = dayAfter(data.today);
              return loadSlots({ rolled: true });
            }
            slotSel.innerHTML = '<option value="">No slots left</option>';
            slotHint.textContent = 'Nothing bookable on that date \u2014 pick another day.';
            quote(); // the price does not depend on the slot, so still show it
            return;
          }
          slotSel.innerHTML = res.slots.map(function (slot) {
            return '<option value="' + esc(slot.time) + '"' + (slot.full ? ' disabled' : '') + '>' +
              esc(slot.label) + ' \u00B7 ' + (slot.full ? 'full' : slot.seatsLeft + ' left') + '</option>';
          }).join('');
          var firstOpen = res.slots.filter(function (x) { return !x.full; })[0];
          if (firstOpen) slotSel.value = firstOpen.time;
          slotHint.textContent = res.slots.length + ' slot(s) on ' + res.dateLabel;
        } catch (err) {
          slotSel.innerHTML = '<option value="">Could not load slots</option>';
          slotHint.textContent = err.message;
        }
        quote();
      }

      /** Server-priced, debounced, and guarded by a sequence number so a slow
          earlier response can never overwrite a newer one. */
      function quote() {
        clearTimeout(quoteTimer);
        quoteTimer = setTimeout(async function () {
          var mine = ++seq;
          var errBox = body.querySelector('[data-q-error]');
          try {
            var res = await API.post('/admin/waterpark/quote', payload());
            if (mine !== seq) return;
            errBox.hidden = true;
            body.querySelector('[data-q-total]').textContent = money(res.amounts.total);
            body.querySelector('[data-q-guests]').textContent = String(res.order.guests.total);
            body.querySelector('[data-q-save]').textContent = res.amounts.totalSaving
              ? money(res.amounts.totalSaving) : '\u2014';

            var bits = [];
            bits.push('Day out ' + money(res.amounts.baseAmount));
            if (res.amounts.addOnAmount) bits.push('add-ons ' + money(res.amounts.addOnAmount));
            if (res.amounts.offerDiscount) bits.push('offer \u2212' + money(res.amounts.offerDiscount));
            if (res.amounts.convenienceFee) bits.push('fee ' + money(res.amounts.convenienceFee));
            if (res.amounts.gst) bits.push('tax ' + money(res.amounts.gst));
            if (res.offerRejected) bits.push('that offer code does not apply');
            if (res.slot && res.slot.seatsLeft < res.order.guests.total) {
              bits.push('only ' + res.slot.seatsLeft + ' space(s) left in that slot');
            }
            body.querySelector('[data-q-detail]').textContent = bits.join(' \u00B7 ');
          } catch (err) {
            if (mine !== seq) return;
            body.querySelector('[data-q-total]').textContent = '\u2014';
            body.querySelector('[data-q-guests]').textContent = '\u2014';
            body.querySelector('[data-q-save]').textContent = '\u2014';
            body.querySelector('[data-q-detail]').textContent = '';
            errBox.hidden = false;
            errBox.textContent = err.message;
          }
        }, 260);
      }

      body.addEventListener('input', function (event) {
        if (event.target.hasAttribute && (event.target.hasAttribute('data-qty') ||
          event.target.hasAttribute('data-extra') || event.target.hasAttribute('data-line') ||
          event.target.hasAttribute('data-addon'))) {
          refreshValues(body, 'extra');
          refreshValues(body, 'line');
          refreshValues(body, 'addon');
        }
        quote();
      });
      body.addEventListener('change', function (event) {
        if (event.target === modeSel) syncSections();
        if (event.target === dateInput) { loadSlots(); return; }
        quote();
      });
      body.querySelector('[data-action="autofill-ind"]').addEventListener('click', function () {
        autofill(
          body, 'line',
          Math.max(0, Number(body.querySelector('[name="fillAdults"]').value) || 0),
          Math.max(0, Number(body.querySelector('[name="fillChildren"]').value) || 0)
        );
        quote();
      });

      syncSections();
      loadSlots();
      return { body: body, payload: payload };
    }

    // ── Top action wiring ──
    topActions.querySelector('[data-action="edit-settings"]').addEventListener('click', function () {
      var m = modal({ title: 'Water park settings', body: settingsForm(), confirmLabel: 'Save changes', wide: true });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.put('/admin/waterpark/settings', settingsPayload(m.body));
          toast('Water park settings saved \u2014 live for guests now', 'success');
          navigate('waterpark');
        });
      });
    });

    topActions.querySelector('[data-action="reset-notices"]').addEventListener('click', async function () {
      var ok = await confirmDialog(
        'Reset all notices?',
        'The four customer notices go back to their default wording. Your prices, packages and add-ons are not touched.',
        'Reset notices'
      );
      if (!ok) return;
      try {
        await API.post('/admin/waterpark/notices/reset', {});
        toast('Notices reset', 'success');
        navigate('waterpark');
      } catch (err) { toast(err.message, 'error'); }
    });

    topActions.querySelector('[data-action="new-booking"]').addEventListener('click', function () {
      var form = bookingForm();
      var m = modal({ title: 'Sell a pass at the counter', body: form.body, confirmLabel: 'Take payment & issue pass', wide: true });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          var res = await API.post('/admin/waterpark/bookings', Object.assign(form.payload(), {
            guestName: raw.guestName,
            guestPhone: raw.guestPhone,
            paymentMethod: raw.paymentMethod,
            customerEmail: raw.customerEmail || undefined,
            notes: raw.notes,
          }));
          toast('Pass ' + res.booking.reference + ' issued \u00B7 ' + money(res.booking.amounts.total) + ' taken', 'success');
          navigate('waterpark');
        });
      });
    });

    // ── In-page action wiring ──
    view.addEventListener('click', async function (event) {
      var target = function (attr) { return event.target.closest('[' + attr + ']'); };
      var m;

      // Packages
      if (event.target.closest('[data-action="new-pack"]')) {
        m = modal({ title: 'New package', body: packForm(null), confirmLabel: 'Create package', wide: true });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.post('/admin/waterpark/packages', packPayload(m.body));
            toast('Package created', 'success');
            navigate('waterpark');
          });
        });
        return;
      }
      var packEdit = target('data-pack-edit');
      if (packEdit) {
        var pkg = data.packages.filter(function (p) { return p.id === packEdit.getAttribute('data-pack-edit'); })[0];
        m = modal({ title: 'Edit ' + pkg.name, body: packForm(pkg), confirmLabel: 'Save package', wide: true });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/waterpark/packages/' + pkg.id, packPayload(m.body));
            toast('Package saved \u2014 the new value breakup is live', 'success');
            navigate('waterpark');
          });
        });
        return;
      }
      var packDel = target('data-pack-del');
      if (packDel) {
        var delId = packDel.getAttribute('data-pack-del');
        var delPack = data.packages.filter(function (p) { return p.id === delId; })[0];
        var okPack = await confirmDialog(
          'Delete ' + delPack.name + '?',
          delPack.sold
            ? 'It has already sold ' + delPack.sold + ' time(s), so it will be taken off sale instead of deleted — issued passes name it.'
            : 'It is removed from the tab straight away.',
          delPack.sold ? 'Take off sale' : 'Delete'
        );
        if (!okPack) return;
        try {
          var res = await API.del('/admin/waterpark/packages/' + delId);
          toast(res.deleted ? 'Package deleted' : 'Package taken off sale', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }

      // Rate card
      if (event.target.closest('[data-action="new-item"]')) {
        m = modal({ title: 'New rate-card line', body: itemForm(null), confirmLabel: 'Add line' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.post('/admin/waterpark/items', itemPayload(m.body));
            toast('Rate-card line added', 'success');
            navigate('waterpark');
          });
        });
        return;
      }
      var itemEdit = target('data-item-edit');
      if (itemEdit) {
        var item = itemOf(itemEdit.getAttribute('data-item-edit'));
        m = modal({ title: 'Edit ' + item.label, body: itemForm(item), confirmLabel: 'Save rate' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/waterpark/items/' + item.id, itemPayload(m.body));
            toast('Rate saved \u2014 every package using it has been repriced', 'success');
            navigate('waterpark');
          });
        });
        return;
      }
      var itemDel = target('data-item-del');
      if (itemDel) {
        var dItem = itemOf(itemDel.getAttribute('data-item-del'));
        var okItem = await confirmDialog(
          'Delete "' + dItem.label + '"?',
          dItem.usedBy.length
            ? 'It is part of ' + dItem.usedBy.join(', ') + '. Those packages must drop it first — switching it off sale is usually what you want instead.'
            : 'It disappears from the per-person builder. Passes already sold keep the rate they were charged.',
          'Delete line'
        );
        if (!okItem) return;
        try {
          await API.del('/admin/waterpark/items/' + dItem.id);
          toast('Rate-card line deleted', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }

      // Add-ons
      if (event.target.closest('[data-action="new-addon"]')) {
        m = modal({ title: 'New add-on', body: addOnForm(null), confirmLabel: 'Add add-on' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.post('/admin/waterpark/addons', addOnPayload(m.body));
            toast('Add-on added', 'success');
            navigate('waterpark');
          });
        });
        return;
      }
      var addEdit = target('data-addon-edit');
      if (addEdit) {
        var addOn = addOns.filter(function (a) { return a.id === addEdit.getAttribute('data-addon-edit'); })[0];
        m = modal({ title: 'Edit ' + addOn.label, body: addOnForm(addOn), confirmLabel: 'Save add-on' });
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/waterpark/addons/' + addOn.id, addOnPayload(m.body));
            toast('Add-on saved', 'success');
            navigate('waterpark');
          });
        });
        return;
      }
      var addDel = target('data-addon-del');
      if (addDel) {
        var okAdd = await confirmDialog('Delete this add-on?', 'It is removed from the tab. Passes already sold keep it.', 'Delete');
        if (!okAdd) return;
        try {
          await API.del('/admin/waterpark/addons/' + addDel.getAttribute('data-addon-del'));
          toast('Add-on deleted', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }

      // Passes
      var checkin = target('data-checkin');
      if (checkin) {
        try {
          await API.post('/admin/waterpark/bookings/' + checkin.getAttribute('data-checkin') + '/checkin', {});
          toast('Checked in \u2014 enjoy the day!', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      var undo = target('data-undo-checkin');
      if (undo) {
        try {
          await API.post('/admin/waterpark/bookings/' + undo.getAttribute('data-undo-checkin') + '/undo-checkin', {});
          toast('Check-in undone', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      var cancel = target('data-cancel');
      if (cancel) {
        var okCancel = await confirmDialog(
          'Cancel this pass?',
          'The entry slot is released and the guest is notified.',
          'Cancel pass'
        );
        if (!okCancel) return;
        try {
          await API.post('/admin/waterpark/bookings/' + cancel.getAttribute('data-cancel') + '/cancel', {});
          toast('Pass cancelled', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      var del = target('data-del');
      if (del) {
        var okDel = await confirmDialog('Delete this pass?', 'It is removed from the ledger for good.', 'Delete');
        if (!okDel) return;
        try {
          await API.del('/admin/waterpark/bookings/' + del.getAttribute('data-del'));
          toast('Pass deleted', 'success');
          navigate('waterpark');
        } catch (err) { toast(err.message, 'error'); }
      }
    });
  }

  // ── Tab sliders ──────────────────────────────────────────────────────────

  /* The auto-scrolling banner at the top of each customer tab.

     One slider per tab, each with its own slides and its own scroll speed. The
     preview on the right is the same markup and gradient the phone renders, so
     what the admin approves here is what a customer sees.                     */
  async function pageSliders(content, topActions) {
    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.get('/admin/promos');

    // Survives a reload of this page so editing one tab does not bounce you back.
    var current = state.cache.sliderSection || data.sections[0].id;
    if (!data.sections.some(function (s) { return s.id === current; })) current = data.sections[0].id;

    function sectionOf(id) {
      return data.sections.filter(function (s) { return s.id === id; })[0];
    }

    function seconds(ms) {
      return (Math.round((Number(ms) || 0) / 100) / 10) + 's';
    }

    topActions.innerHTML =
      '<button class="btn btn--line" data-action="edit-slider">' + icon('edit', 17) + ' Slider settings</button> ' +
      '<button class="btn" data-action="new-slide">' + icon('plus', 17) + ' Add slide</button>';

    function slideRow(slide, index, total) {
      return '<div class="sl-slide' + (slide.active === false ? ' sl-slide--off' : '') + '">' +
        '<div class="sl-slide__order">' +
          '<button class="btn btn--line btn--sm" data-move="up" data-id="' + esc(slide.id) + '"' +
            (index === 0 ? ' disabled' : '') + ' aria-label="Move up">' + icon('chevron-up', 14) + '</button>' +
          '<button class="btn btn--line btn--sm" data-move="down" data-id="' + esc(slide.id) + '"' +
            (index === total - 1 ? ' disabled' : '') + ' aria-label="Move down">' + icon('chevron-down', 14) + '</button>' +
        '</div>' +
        '<div class="sl-slide__thumb">' +
          (slide.imageUrl ? '<img src="' + esc(slide.imageUrl) + '" alt="">' : icon('sparkle', 20)) +
        '</div>' +
        '<div class="sl-slide__text">' +
          '<div class="sl-slide__title">' + (slide.title ? esc(slide.title) : '<span class="hint">No heading</span>') + '</div>' +
          (slide.subtitle ? '<div class="sl-slide__sub">' + esc(slide.subtitle) + '</div>' : '') +
          '<div class="sl-slide__meta">' +
            (slide.ctaPath
              ? icon('arrow-right', 12) + ' ' + esc(slide.ctaLabel || 'Opens') + ' \u00B7 ' + esc(slide.ctaPath)
              : 'Not tappable') +
          '</div>' +
        '</div>' +
        '<div class="sl-slide__actions">' +
          (slide.active === false
            ? '<span class="pill pill--red">Hidden</span> '
            : '<span class="pill pill--green">Live</span> ') +
          '<button class="btn btn--line btn--sm" data-edit="' + esc(slide.id) + '">Edit</button> ' +
          '<button class="btn btn--line btn--sm" data-del="' + esc(slide.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }

    /** The slider as the phone draws it, first slide only. */
    function preview(section) {
      var live = section.slides.filter(function (s) { return s.active !== false; });
      if (!live.length || section.settings.active === false) {
        return '<div class="sl-preview"><div class="empty-state" style="padding:28px 12px">' +
          (section.settings.active === false
            ? 'The slider is switched off for this tab.'
            : 'No live slides \u2014 nothing shows on this tab.') +
          '</div></div>';
      }
      var first = live[0];
      return '<div class="sl-preview">' +
        '<div class="sl-preview__frame">' +
          '<img src="' + esc(first.imageUrl) + '" alt="">' +
          (first.title || first.subtitle ? '<div class="sl-preview__veil"></div>' +
            '<div class="sl-preview__text">' +
              (first.title ? '<span class="sl-preview__title">' + esc(first.title) + '</span>' : '') +
              (first.subtitle ? '<span class="sl-preview__sub">' + esc(first.subtitle) + '</span>' : '') +
              (first.ctaLabel ? '<span class="sl-preview__cta">' + esc(first.ctaLabel) + '</span>' : '') +
            '</div>' : '') +
        '</div>' +
        (live.length > 1
          ? '<div class="sl-preview__dots">' + live.map(function (_s, i) {
              return '<span class="sl-preview__dot' + (i === 0 ? ' sl-preview__dot--on' : '') + '"></span>';
            }).join('') + '</div>'
          : '') +
        '<div class="hint" style="text-align:center;margin-top:8px">' +
          (live.length > 1 ? live.length + ' slides, advancing every ' + seconds(section.settings.intervalMs)
            : 'Single slide \u2014 shown as a still, no auto-scroll') +
        '</div>' +
      '</div>';
    }

    function render() {
      var section = sectionOf(current);

      content.innerHTML = '';
      var view = h('<div>' +
        '<div class="sl-tabs">' +
          data.sections.map(function (s) {
            return '<button class="sl-tab" data-section="' + esc(s.id) + '"' +
              ' aria-pressed="' + (s.id === current ? 'true' : 'false') + '">' +
              esc(s.label) +
              '<span class="sl-tab__count">' + s.liveCount + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +

        '<div class="panel" style="margin-top:0"><div class="panel__head">' +
          '<h2 class="panel__title">' + esc(section.label) + ' tab slider</h2>' +
          (section.settings.active === false
            ? '<span class="pill pill--red">Switched off</span>'
            : '<span class="pill pill--green">Live \u00B7 every ' + seconds(section.settings.intervalMs) + '</span>') +
        '</div><div class="panel__body">' +
          '<div class="grid-2">' +
            '<div>' +
              '<div class="label">What this controls</div>' +
              '<div style="font-size:13.5px;line-height:1.6">The banner at the top of the <strong>' +
                esc(section.label) + '</strong> tab. Slides advance on their own every <strong>' +
                seconds(section.settings.intervalMs) + '</strong>, pausing while a guest is swiping. ' +
                'A slide with a link becomes tappable; one without is just artwork.' +
                (section.id === 'stay'
                  ? ' This speed also drives the property photo slider on that tab.'
                  : '') +
              '</div>' +
              '<div class="hint" style="margin-top:10px">Slides are shown in the order below. ' +
                'Hidden slides keep their place but are not sent to the app.</div>' +
            '</div>' +
            preview(section) +
          '</div>' +
        '</div></div>' +

        '<div class="panel"><div class="panel__head">' +
          '<h2 class="panel__title">' + section.slides.length + ' slide(s)</h2>' +
          '<button class="btn btn--sm" data-action="new-slide-inline">' + icon('plus', 16) + ' Add slide</button>' +
        '</div><div class="panel__body">' +
          (section.slides.length
            ? '<div class="sl-slides">' +
              section.slides.map(function (s, i) { return slideRow(s, i, section.slides.length); }).join('') +
              '</div>'
            : '<div class="empty-state">No slides yet. Add one and it appears at the top of the ' +
              esc(section.label) + ' tab.</div>') +
        '</div></div>' +
      '</div>');
      content.appendChild(view);
      wire(view);
    }

    // ── Forms ──
    function slideForm(slide) {
      var s = slide || { title: '', subtitle: '', imageUrl: '', ctaLabel: '', ctaPath: '', active: true };
      var body = h('<div><div class="form-grid">' +
        imageField('Slide image', 'imageUrl', s.imageUrl, {}) +
        field('Heading', 'title', s.title, { placeholder: 'Family Fun Day', hint: 'Leave blank to show the artwork on its own.' }) +
        field('Sub-heading', 'subtitle', s.subtitle, { placeholder: 'Water park, movie and more' }) +
        field('Button label', 'ctaLabel', s.ctaLabel, { placeholder: 'See packages', hint: 'Optional. Needs a link below.' }) +
        field('Opens', 'ctaPath', s.ctaPath, {
          placeholder: '/waterpark',
          hint: 'An in-app path starting with "/", e.g. /waterpark, /food, /dine-in. Leave blank to make the slide untappable.',
        }) +
        field('Status', 'active', s.active === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'Live' },
          { value: 'false', label: 'Hidden' },
        ] }) +
      '</div></div>');
      bindImageField(body, 'imageUrl');
      return body;
    }

    function slidePayload(body) {
      var raw = readForm(body);
      return {
        section: current,
        imageUrl: raw.imageUrl,
        title: raw.title,
        subtitle: raw.subtitle,
        ctaLabel: raw.ctaLabel,
        ctaPath: raw.ctaPath,
        active: raw.active === 'true',
      };
    }

    function openSlideModal(slide) {
      var m = modal({
        title: slide ? 'Edit slide' : 'New ' + sectionOf(current).label + ' slide',
        body: slideForm(slide),
        confirmLabel: slide ? 'Save slide' : 'Add slide',
      });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          if (slide) await API.put('/admin/promos/slides/' + slide.id, slidePayload(m.body));
          else await API.post('/admin/promos', slidePayload(m.body));
          toast('Slide saved \u2014 live on the ' + sectionOf(current).label + ' tab now', 'success');
          navigate('sliders');
        });
      });
    }

    function openSettingsModal() {
      var section = sectionOf(current);
      var body = h('<div class="form-grid">' +
        field('Slider', 'active', section.settings.active === false ? 'false' : 'true', { options: [
          { value: 'true', label: 'Show it on the ' + section.label + ' tab' },
          { value: 'false', label: 'Hide it completely' },
        ] }) +
        field('Seconds per slide', 'intervalSeconds', Math.round(section.settings.intervalMs / 100) / 10, {
          type: 'number',
          hint: 'Between ' + (data.intervalBounds.min / 1000) + ' and ' + (data.intervalBounds.max / 1000) +
            ' seconds. Autoplay pauses while a guest is swiping.',
        }) +
      '</div>');

      var m = modal({ title: section.label + ' slider settings', body: body, confirmLabel: 'Save settings' });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var raw = readForm(m.body);
          await API.put('/admin/promos/' + current + '/settings', {
            active: raw.active === 'true',
            intervalMs: Math.round(Number(raw.intervalSeconds) * 1000),
          });
          toast('Slider settings saved', 'success');
          navigate('sliders');
        });
      });
    }

    // ── Wiring ──
    topActions.querySelector('[data-action="new-slide"]').addEventListener('click', function () { openSlideModal(null); });
    topActions.querySelector('[data-action="edit-slider"]').addEventListener('click', openSettingsModal);

    function wire(view) {
      view.addEventListener('click', async function (event) {
        var tab = event.target.closest('[data-section]');
        if (tab) {
          current = tab.getAttribute('data-section');
          state.cache.sliderSection = current;
          render();
          return;
        }

        if (event.target.closest('[data-action="new-slide-inline"]')) { openSlideModal(null); return; }

        var edit = event.target.closest('[data-edit]');
        if (edit) {
          var id = edit.getAttribute('data-edit');
          openSlideModal(sectionOf(current).slides.filter(function (s) { return s.id === id; })[0]);
          return;
        }

        var move = event.target.closest('[data-move]');
        if (move) {
          try {
            await API.post('/admin/promos/slides/' + move.getAttribute('data-id') + '/move',
              { direction: move.getAttribute('data-move') });
            navigate('sliders');
          } catch (err) { toast(err.message, 'error'); }
          return;
        }

        var del = event.target.closest('[data-del]');
        if (del) {
          var ok = await confirmDialog(
            'Delete this slide?',
            'It disappears from the ' + sectionOf(current).label + ' tab straight away, and a starter slide will not come back on restart.',
            'Delete slide'
          );
          if (!ok) return;
          try {
            await API.del('/admin/promos/slides/' + del.getAttribute('data-del'));
            toast('Slide deleted', 'success');
            navigate('sliders');
          } catch (err) { toast(err.message, 'error'); }
        }
      });
    }

    render();
  }

  // ── Hotel & rooms ────────────────────────────────────────────────────────

  /* Property photo galleries.

     These are categorised galleries that hang off the property rather than off
     a room type, so every room — including ones added later — shows the same
     set on its booking page. Category list: /js/hotel-photo-categories.js.     */
  var PHOTO_CATEGORIES = window.HotelPhotoCategories || [];

  /** Field name used for a category's hidden gallery input. */
  function photoFieldName(categoryId) {
    return 'pp_' + categoryId.replace(/-/g, '_');
  }

  function photosFor(hotel, categoryId) {
    return (hotel && hotel.propertyPhotos && hotel.propertyPhotos[categoryId]) || [];
  }

  /** Count pills for the property panel, so it's obvious what's still empty. */
  function propertyPhotoSummary(hotel) {
    var total = PHOTO_CATEGORIES.reduce(function (sum, c) { return sum + photosFor(hotel, c.id).length; }, 0);
    if (!total) {
      return '<span class="hint">No property photos yet — guests only see the room gallery.</span>';
    }
    return PHOTO_CATEGORIES.map(function (c) {
      var n = photosFor(hotel, c.id).length;
      return '<span class="pill ' + (n ? 'pill--green' : '') + '" style="margin:0 6px 6px 0">' +
        esc(c.label) + ' · ' + n + '</span>';
    }).join('') + '<div class="hint" style="margin-top:6px">' + total + ' photo(s) across the property.</div>';
  }

  /**
   * Splits a gallery into request-sized batches.
   *
   * Freshly picked photos are base64 data: URLs, so a single category can easily
   * be tens of megabytes — well past the server's request body limit. Batching
   * keeps every request small; the first is sent as `replace` and the rest as
   * `append`, which rebuilds the category server-side in order.
   */
  function batchPhotos(list, budgetBytes) {
    var budget = budgetBytes || 6 * 1024 * 1024;
    var batches = [];
    var current = [];
    var size = 0;

    list.forEach(function (entry) {
      // A stored path costs nothing; a data: URL is roughly its string length.
      var cost = entry.length;
      if (current.length && size + cost > budget) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push(entry);
      size += cost;
    });

    // Always emit one batch, even when empty — that's how a category is cleared.
    batches.push(current);
    return batches;
  }

  function sameList(a, b) {
    return a.length === b.length && a.every(function (v, i) { return v === b[i]; });
  }

  async function pageHotel(content, topActions) {
    topActions.innerHTML =
      '<button class="btn btn--ghost" data-action="edit-hotel">' + icon('building', 17) + ' Property details</button> ' +
      '<button class="btn btn--ghost" data-action="property-photos">' + icon('grid', 17) + ' Property photos</button> ' +
      '<button class="btn" data-action="new-room">' + icon('plus', 17) + ' Add room type</button>';

    content.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
    var data = await API.get('/admin/hotel');
    var hotel = data.hotel;

    if (!hotel) {
      content.innerHTML = '<div class="panel" style="margin-top:0"><div class="panel__body">' +
        '<div class="empty-state"><strong>No hotel set up yet</strong>' +
        '<p class="hint" style="margin-top:8px">Add the property details to start listing rooms.</p>' +
        '<div style="margin-top:14px"><button class="btn" data-action="edit-hotel-empty">Add property details</button></div>' +
        '</div></div></div>';
      content.querySelector('[data-action="edit-hotel-empty"]').addEventListener('click', editHotel);
      topActions.querySelector('[data-action="edit-hotel"]').addEventListener('click', editHotel);
      topActions.querySelector('[data-action="property-photos"]').addEventListener('click', function () {
        toast('Add the property details first — photos attach to the property.', 'info');
      });
      return;
    }

    var t = data.totals;
    content.innerHTML =
      '<div class="cards">' +
        card('Room types', String(t.roomTypes), t.physicalRooms + ' physical rooms') +
        card('Upcoming stays', String(t.upcomingStays), 'checking out today or later') +
        card('Room nights sold', String(t.roomNightsSold), 'all time') +
        card('Stay revenue', money(t.revenue), 'excludes cancellations') +
      '</div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">' + esc(hotel.name) + '</h2>' +
        '<span class="pill ' + (hotel.active === false ? 'pill--red' : 'pill--green') + '">' +
          (hotel.active === false ? 'Hidden' : 'Live') + '</span>' +
      '</div><div class="panel__body">' +
        '<div class="grid-2">' +
          '<div><div class="label">Address</div><div>' + esc(hotel.address || '—') + '</div>' +
            '<div class="cell-sub">' + esc([hotel.area, hotel.city].filter(Boolean).join(', ')) + '</div></div>' +
          '<div><div class="label">Front desk</div><div>' + esc(hotel.phone || '—') + '</div>' +
            '<div class="cell-sub">Check-in ' + esc(hotel.checkInTime || '12:00') +
            ' · Check-out ' + esc(hotel.checkOutTime || '11:00') + '</div></div>' +
        '</div>' +
        '<div style="margin-top:16px"><div class="label">Hotel amenities</div>' +
          ((hotel.amenities || []).length
            ? hotel.amenities.map(function (a) { return '<span class="pill pill--purple" style="margin:0 6px 6px 0">' + esc(a) + '</span>'; }).join('')
            : '<span class="hint">None listed</span>') +
        '</div>' +
        '<div style="margin-top:16px"><div class="label">Property photos ' +
          '<span class="hint" style="font-weight:400">— shown on every room\u2019s booking page</span></div>' +
          propertyPhotoSummary(hotel) +
        '</div>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__head">' +
        '<h2 class="panel__title">Room types</h2>' +
        '<span class="hint">Occupancy shown for the next ' + data.window.days + ' nights</span>' +
      '</div>' +
      '<div class="panel__body panel__body--flush"><div class="table-wrap"><table>' +
        '<thead><tr><th>Room</th><th>Sleeps</th><th class="num">Rate / night</th><th class="num">Taxes</th>' +
          '<th class="num">Rooms</th><th class="num">Peak booked</th><th>Status</th><th></th></tr></thead>' +
        '<tbody>' + (data.rooms.length ? data.rooms.map(function (r) {
          var off = r.mrpPerNight > r.pricePerNight
            ? '<div class="cell-sub"><s>' + money(r.mrpPerNight) + '</s> · ' +
              Math.round((1 - r.pricePerNight / r.mrpPerNight) * 100) + '% off</div>'
            : '';
          return '<tr>' +
            '<td><div class="cell-strong">' + esc(r.name) + '</div>' +
              '<div class="cell-sub">' + esc(r.subtitle || '') + '</div>' +
              '<div class="cell-sub">' + (r.sizeSqft ? r.sizeSqft + ' sq.ft · ' : '') +
                (r.view ? esc(r.view) + ' · ' : '') +
                esc(r.bedCount + ' ' + r.bedType) + ' · ' + (r.photos || []).length + ' photo(s)</div></td>' +
            '<td>' + (r.maxGuests || 0) + ' adult' + ((r.maxGuests || 0) === 1 ? '' : 's') +
              (r.maxChildren ? '<div class="cell-sub">+ ' + r.maxChildren + ' child</div>' : '') + '</td>' +
            '<td class="num cell-strong">' + money(r.pricePerNight) + off + '</td>' +
            '<td class="num">' + money(r.taxesPerNight) + '</td>' +
            '<td class="num">' + (r.totalRooms || 0) + '</td>' +
            '<td class="num">' + r.peakBooked + '<div class="cell-sub">' + r.occupancyPercent + '%</div></td>' +
            '<td>' + (r.active !== false ? '<span class="pill pill--green">Live</span>' : '<span class="pill">Hidden</span>') + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn--ghost btn--sm" data-cal="' + esc(r.id) + '">Calendar</button> ' +
              '<button class="btn btn--ghost btn--sm" data-edit="' + esc(r.id) + '">Edit</button> ' +
              '<button class="btn btn--line btn--sm" data-del="' + esc(r.id) + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="8" class="empty-state">No room types yet — add one to start taking bookings.</td></tr>') +
      '</tbody></table></div></div></div>';

    // ── Property form ──
    function hotelForm(existing) {
      var p = existing || {};
      return h('<div class="form-grid">' +
        field('Hotel name', 'name', p.name, { span: true, placeholder: 'Hotel Kingfisher' }) +
        field('Tagline', 'tagline', p.tagline, { span: true, placeholder: 'Comfortable AC rooms next to the water park' }) +
        field('Area', 'area', p.area, { placeholder: 'Nagpur Road' }) +
        field('City', 'city', p.city || 'Mandla') +
        field('Address', 'address', p.address, { type: 'textarea', span: true }) +
        field('Front desk phone', 'phone', p.phone, { placeholder: '7648913272' }) +
        field('Rating (0-5)', 'rating', p.rating, { type: 'number', placeholder: '4.3' }) +
        field('Review count', 'reviewCount', p.reviewCount, { type: 'number' }) +
        field('Check-in time', 'checkInTime', p.checkInTime || '12:00', { placeholder: '12:00' }) +
        field('Check-out time', 'checkOutTime', p.checkOutTime || '11:00', { placeholder: '11:00' }) +
        imageField('Cover photo', 'coverPhoto', p.coverPhoto, {}) +
        galleryField('Property photos', 'photos', p.photos, {
          hint: 'These replace the placeholder artwork at the top of the Stay tab. Add more than ' +
            'one and guests can swipe through them. The first photo is the cover.',
        }) +
        field('Hotel amenities (comma separated)', 'amenities', (p.amenities || []).join(', '),
          { type: 'textarea', span: true, placeholder: 'Free Wi-Fi, Free parking, Room service' }) +
        field('Policies (one per line)', 'policies', (p.policies || []).join('\n'),
          { type: 'textarea', span: true, placeholder: 'Check-in from 12:00 PM\nValid photo ID required' }) +
        field('Status', 'active', p.active === false ? 'false' : 'true',
          { options: [{ value: 'true', label: 'Live (visible to customers)' }, { value: 'false', label: 'Hidden' }] }) +
        '</div>');
    }

    function hotelPayload(body) {
      var raw = readForm(body);
      return {
        name: raw.name,
        tagline: raw.tagline,
        area: raw.area,
        city: raw.city,
        address: raw.address,
        phone: raw.phone,
        rating: Number(raw.rating) || 0,
        reviewCount: Number(raw.reviewCount) || 0,
        checkInTime: raw.checkInTime,
        checkOutTime: raw.checkOutTime,
        coverPhoto: raw.coverPhoto || '',
        photos: (raw.photos || '').split('\n').filter(Boolean),
        amenities: csvList(raw.amenities),
        policies: (raw.policies || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        active: raw.active === 'true',
      };
    }

    function editHotel() {
      var m = modal({
        title: hotel ? 'Edit ' + hotel.name : 'Add property details',
        body: hotelForm(hotel),
        confirmLabel: 'Save property',
      });
      bindImageField(m.body, 'coverPhoto');
      bindGalleryField(m.body, 'photos');
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.put('/admin/hotel', hotelPayload(m.body));
          toast('Property saved', 'success');
          navigate('hotel');
        });
      });
    }

    // ── Property photo galleries ──
    function propertyPhotosForm() {
      return h('<div>' +
        '<p class="hint" style="margin:0 0 18px">Photos of the property itself — these appear under ' +
          '<strong>Check-in &amp; check-out</strong> on the booking page of <strong>every</strong> room type, ' +
          'including any you add later. Upload once here instead of per room.</p>' +
        PHOTO_CATEGORIES.map(function (c) {
          var name = photoFieldName(c.id);
          var existing = photosFor(hotel, c.id);
          return '<section class="photo-cat-field">' +
            '<div class="form-grid">' +
              galleryField(c.label, name, existing, {
                hint: existing.length
                  ? existing.length + ' photo(s) — the first one leads the ' + c.label + ' row.'
                  : 'No ' + c.label + ' photos yet. This section stays hidden from guests until you add one.',
              }) +
            '</div>' +
          '</section>';
        }).join('') +
        '</div>');
    }

    /**
     * Saves only the categories that actually changed, one request per batch, so
     * a big upload can't exceed the server's request body limit.
     */
    async function savePropertyPhotos(body) {
      var changed = 0;

      for (var i = 0; i < PHOTO_CATEGORIES.length; i++) {
        var category = PHOTO_CATEGORIES[i];
        var hidden = body.querySelector('input[type="hidden"][name="' + photoFieldName(category.id) + '"]');
        if (!hidden) continue;

        var next = hidden.value ? hidden.value.split('\n').filter(Boolean) : [];
        if (sameList(next, photosFor(hotel, category.id))) continue;

        var batches = batchPhotos(next);
        for (var b = 0; b < batches.length; b++) {
          await API.put('/admin/hotel/photos', {
            category: category.id,
            photos: batches[b],
            mode: b === 0 ? 'replace' : 'append',
          });
        }
        changed++;
      }

      return changed;
    }

    function editPropertyPhotos() {
      var m = modal({
        title: 'Property photos',
        body: propertyPhotosForm(),
        confirmLabel: 'Save photos',
      });
      PHOTO_CATEGORIES.forEach(function (c) { bindGalleryField(m.body, photoFieldName(c.id)); });
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          var changed = await savePropertyPhotos(m.body);
          toast(changed ? 'Property photos saved' : 'Nothing changed', changed ? 'success' : 'info');
          navigate('hotel');
        });
      });
    }

    // ── Room form ──
    function roomForm(room) {
      var r = room || {};
      var groups = (r.amenityGroups || []).map(function (g) {
        return g.title + ': ' + (g.items || []).join(', ');
      }).join('\n');

      return h('<div class="form-grid">' +
        field('Room name', 'name', r.name, { span: true, placeholder: 'Deluxe Room' }) +
        field('Subtitle', 'subtitle', r.subtitle, { type: 'textarea', span: true, placeholder: 'Cosy AC room with a double bed' }) +
        field('Badge (optional)', 'badge', r.badge, { placeholder: 'Best Seller' }) +
        field('Display order', 'order', r.order || 1, { type: 'number' }) +

        field('Size (sq.ft)', 'sizeSqft', r.sizeSqft, { type: 'number', placeholder: '72' }) +
        field('Size (sq.mt)', 'sizeSqmt', r.sizeSqmt, { type: 'number', placeholder: '7' }) +
        field('View (optional)', 'view', r.view, { placeholder: 'Garden View', hint: 'Shown as a spec chip. Leave blank if there is no view to sell.' }) +
        field('Bed type', 'bedType', r.bedType || 'Double Bed', { placeholder: 'Double Bed' }) +
        field('Number of beds', 'bedCount', r.bedCount || 1, { type: 'number' }) +
        field('Bathrooms', 'bathrooms', r.bathrooms || 1, { type: 'number' }) +
        field('Total rooms (inventory)', 'totalRooms', r.totalRooms || 1,
          { type: 'number', hint: 'How many of this room type exist. Drives availability.' }) +
        field('Max adults per room', 'maxGuests', r.maxGuests || 2, { type: 'number' }) +
        field('Max children per room', 'maxChildren', r.maxChildren === undefined ? 1 : r.maxChildren, { type: 'number' }) +

        field('Rack rate / night (₹)', 'mrpPerNight', r.mrpPerNight,
          { type: 'number', hint: 'Shown struck through. Leave 0 for no discount badge.' }) +
        field('Selling rate / night (₹)', 'pricePerNight', r.pricePerNight,
          { type: 'number', hint: 'What the guest actually pays per night.' }) +
        field('Taxes & fees / night (₹)', 'taxesPerNight', r.taxesPerNight,
          { type: 'number', hint: 'Added on top of the nightly rate.' }) +

        galleryField('Room photos', 'photos', r.photos) +

        field('Popular with Guests (comma separated)', 'popularAmenities', (r.popularAmenities || []).join(', '),
          { type: 'textarea', span: true, hint: 'The app shows the first 5 and collapses the rest into "N More".' }) +
        field('Amenity groups — one per line, "Title: item, item"', 'amenityGroups', groups,
          { type: 'textarea', span: true, placeholder: 'Bathroom: Towels, Slippers, Toiletries\nMedia and Entertainment: TV' }) +
        field('Included with the stay (comma separated)', 'inclusions', (r.inclusions || []).join(', '),
          { type: 'textarea', span: true, placeholder: 'Free Wi-Fi, Free parking, Daily housekeeping' }) +

        field('Status', 'active', r.active === false ? 'false' : 'true',
          { options: [{ value: 'true', label: 'Live (bookable)' }, { value: 'false', label: 'Hidden' }] }) +
        '</div>');
    }

    function roomPayload(body) {
      var raw = readForm(body);
      return {
        name: raw.name,
        subtitle: raw.subtitle,
        badge: raw.badge,
        order: Number(raw.order) || 0,
        sizeSqft: Number(raw.sizeSqft) || 0,
        sizeSqmt: Number(raw.sizeSqmt) || 0,
        view: raw.view,
        bedType: raw.bedType,
        bedCount: Number(raw.bedCount) || 1,
        bathrooms: Number(raw.bathrooms) || 1,
        totalRooms: Number(raw.totalRooms) || 1,
        maxGuests: Number(raw.maxGuests) || 2,
        maxChildren: Number(raw.maxChildren) || 0,
        mrpPerNight: Number(raw.mrpPerNight) || 0,
        pricePerNight: Number(raw.pricePerNight) || 0,
        taxesPerNight: Number(raw.taxesPerNight) || 0,
        photos: (raw.photos || '').split('\n').filter(Boolean),
        popularAmenities: csvList(raw.popularAmenities),
        amenityGroups: raw.amenityGroups || '',
        inclusions: csvList(raw.inclusions),
        active: raw.active === 'true',
      };
    }

    topActions.querySelector('[data-action="edit-hotel"]').addEventListener('click', editHotel);
    topActions.querySelector('[data-action="property-photos"]').addEventListener('click', editPropertyPhotos);

    topActions.querySelector('[data-action="new-room"]').addEventListener('click', function () {
      var m = modal({ title: 'Add room type', body: roomForm(null), confirmLabel: 'Create room type' });
      bindGalleryField(m.body, 'photos');
      m.confirmBtn.addEventListener('click', function () {
        submitModal(m, async function () {
          await API.post('/admin/hotel/rooms', roomPayload(m.body));
          toast('Room type created', 'success');
          navigate('hotel');
        });
      });
    });

    content.addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      var cal = event.target.closest('[data-cal]');

      if (edit) {
        var room = data.rooms.find(function (r) { return r.id === edit.getAttribute('data-edit'); });
        var m = modal({ title: 'Edit ' + room.name, body: roomForm(room), confirmLabel: 'Save changes' });
        bindGalleryField(m.body, 'photos');
        m.confirmBtn.addEventListener('click', function () {
          submitModal(m, async function () {
            await API.put('/admin/hotel/rooms/' + room.id, roomPayload(m.body));
            toast('Room type updated', 'success');
            navigate('hotel');
          });
        });
      }

      if (cal) {
        var id = cal.getAttribute('data-cal');
        var cm = modal({ title: 'Availability', body: '<div class="boot"><div class="spinner"></div></div>', footer: false });
        try {
          var res = await API.get('/admin/hotel/rooms/' + id + '/calendar?days=21');
          cm.body.innerHTML =
            '<p class="hint" style="margin:0 0 12px">' + esc(res.room.name) + ' — ' +
              res.room.totalRooms + ' room(s) in inventory. Next 21 nights.</p>' +
            '<div class="table-wrap"><table><thead><tr><th>Night</th><th class="num">Booked</th>' +
              '<th class="num">Available</th><th>Status</th></tr></thead><tbody>' +
            res.nights.map(function (n) {
              var pct = res.room.totalRooms ? n.booked / res.room.totalRooms : 0;
              var pill = n.available === 0 ? 'pill--red' : pct >= 0.7 ? 'pill--amber' : 'pill--green';
              var label = n.available === 0 ? 'Sold out' : pct >= 0.7 ? 'Filling up' : 'Open';
              return '<tr><td class="mono">' + esc(n.date) + '</td>' +
                '<td class="num">' + n.booked + '</td>' +
                '<td class="num cell-strong">' + n.available + '</td>' +
                '<td><span class="pill ' + pill + '">' + label + '</span></td></tr>';
            }).join('') +
            '</tbody></table></div>';
        } catch (err) {
          cm.body.innerHTML = '<div class="error">' + esc(err.message) + '</div>';
        }
      }

      if (del) {
        var ok = await confirmDialog(
          'Delete this room type?',
          'It will stop appearing in the app. If it has upcoming stays it is hidden instead of deleted.',
          'Delete room type'
        );
        if (!ok) return;
        try {
          var out = await API.del('/admin/hotel/rooms/' + del.getAttribute('data-del'));
          toast(out.archived ? out.reason : 'Room type deleted', out.archived ? 'info' : 'success');
          navigate('hotel');
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
        '<thead><tr><th>Name</th><th>Contact</th><th>City</th><th>Member ID</th><th class="num">Bookings</th><th class="num">Spent</th><th>Status</th><th></th></tr></thead>' +
        '<tbody data-rows><tr><td colspan="8" class="empty-state">Loading…</td></tr></tbody>' +
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
              '<td><span class="pill ' + (u.active === false ? 'pill--red' : 'pill--green') + '">' + (u.active === false ? 'disabled' : 'active') + '</span></td>' +
              '<td>' + (u.role === 'admin' ? '' : '<button class="btn btn--line btn--sm" data-toggle="' + esc(u.id) + '">' +
                (u.active === false ? 'Enable' : 'Disable') + '</button>') + '</td>' +
              '</tr>';
          }).join('')
        : '<tr><td colspan="8" class="empty-state">No customers found.</td></tr>';
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
    hotel: pageHotel,
    dinein: pageDineIn,
    waterpark: pageWaterpark,
    sliders: pageSliders,
    food: pageFood,
    offers: pageOffers,
    experiences: pageExperiences,
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
