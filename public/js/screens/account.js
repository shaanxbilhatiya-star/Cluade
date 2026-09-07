/* Account tab and every settings sub-page. */
(function () {
  'use strict';

  function signInPrompt(title) {
    var view = UI.h(
      '<div class="screen">' +
        UI.appbar({ title: title || 'Account' }) +
        '<div class="scroll">' +
          UI.empty({
            icon: 'user',
            title: 'You are browsing as a guest',
            text: 'Sign in to book tickets, keep a watchlist and see your order history.',
            action: 'signin',
            actionLabel: 'Sign in',
          }) +
          '<div style="padding:0 32px"><button class="btn-outline btn-outline--lg" data-action="register">Create an account</button></div>' +
        '</div>' +
      '</div>'
    );
    UI.actions(view, {
      signin: function () { App.navigate('/login'); },
      register: function () { App.navigate('/register'); },
    });
    return view;
  }

  function membershipSheet(user) {
    UI.sheet({
      title: 'Membership card',
      body:
        '<div style="padding:0 16px 22px;text-align:center">' +
          '<img src="' + UI.esc(user.avatarUrl) + '" alt="" style="width:66px;height:66px;border-radius:50%;margin:0 auto 12px" data-fallback="/img/avatars/guest.svg">' +
          '<h3 style="margin:0;font-size:19px;font-weight:800">' + UI.esc(user.name) + '</h3>' +
          '<p style="margin:5px 0 0;font-size:13.5px;color:var(--muted)">Member ID ' + UI.esc(user.memberId) + '</p>' +
          '<div style="background:#fff;border-radius:14px;padding:14px;margin:20px 0 0">' +
            '<img src="/api/barcode.svg?value=' + encodeURIComponent(user.memberId) + '" alt="Membership barcode" style="width:100%">' +
          '</div>' +
          '<p style="margin:14px 0 0;font-size:12.5px;color:var(--muted);line-height:1.55">' +
            'Scan at the counter to collect tickets or redeem your ' + UI.esc(user.loyaltyPoints) + ' reward points.' +
          '</p>' +
        '</div>',
    });
  }

  // ── Account home ───────────────────────────────────────────────────────────
  window.Screens.account = {
    tab: 'account',
    render: async function () {
      if (!API.isSignedIn()) return signInPrompt('Account');

      var res = await API.me();
      var user = res.user;
      var stats = res.stats;
      Store.user = user;

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Account' }) +
          '<div class="scroll">' +

            '<div class="profile">' +
              '<img class="profile__avatar" src="' + UI.esc(user.avatarUrl) + '" alt="" data-fallback="/img/avatars/guest.svg">' +
              '<div class="profile__text">' +
                '<h2 class="profile__name">' + UI.esc(user.name) + '</h2>' +
                '<p class="profile__email">' + UI.esc(user.email) + '</p>' +
              '</div>' +
              '<button class="icon-btn" data-action="qr" aria-label="Membership card">' + UI.icon('qr', 26) + '</button>' +
            '</div>' +

            '<div class="stat-strip">' +
              '<div class="stat"><div class="stat__value">' + stats.totalBookings + '</div><div class="stat__label">Bookings</div></div>' +
              '<div class="stat"><div class="stat__value">' + stats.loyaltyPoints + '</div><div class="stat__label">Points</div></div>' +
              '<div class="stat"><div class="stat__value">' + UI.money(stats.totalSpent) + '</div><div class="stat__label">Spent</div></div>' +
            '</div>' +

            '<div class="profile__divider"></div>' +

            '<div class="list">' +
              UI.row({ icon: 'heart', label: 'Watchlist', action: 'watchlist', value: stats.watchlistCount ? String(stats.watchlistCount) : '' }) +
              UI.row({ icon: 'grid', label: 'Movie Interest', action: 'interests' }) +
              UI.row({ icon: 'card', label: 'Payment Methods', action: 'payments', value: String((user.paymentMethods || []).length) }) +
            '</div>' +

            '<div class="list__group-label">General</div>' +
            '<div class="list">' +
              UI.row({ icon: 'user', label: 'Personal Info', action: 'profile' }) +
              UI.row({ icon: 'bell', label: 'Notification', action: 'notifications' }) +
              UI.row({ icon: 'shield', label: 'Security', action: 'security' }) +
              UI.row({ icon: 'doc', label: 'Language', action: 'language', value: (user.settings && user.settings.language) || 'English (US)' }) +
              UI.row({ icon: 'eye', label: 'Dark Mode', action: 'dark', toggle: App.isDark() }) +
            '</div>' +

            '<div class="list__group-label">About</div>' +
            '<div class="list">' +
              UI.row({ icon: 'file', label: 'Help Center', action: 'help' }) +
              UI.row({ icon: 'info', label: 'About CineFlex', action: 'about' }) +
              UI.row({ icon: 'logout', label: 'Log Out', action: 'logout', danger: true }) +
            '</div>' +

            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        qr: function () { membershipSheet(user); },
        watchlist: function () { App.navigate('/account/watchlist'); },
        interests: function () { App.navigate('/account/interests'); },
        payments: function () { App.navigate('/account/payments'); },
        profile: function () { App.navigate('/account/profile'); },
        notifications: function () { App.navigate('/account/notifications'); },
        security: function () { App.navigate('/account/security'); },
        language: function () { App.navigate('/account/language'); },
        help: function () { App.navigate('/account/help'); },
        about: function () { App.navigate('/account/about'); },

        dark: async function (el) {
          var next = el.getAttribute('aria-checked') !== 'true';
          el.setAttribute('aria-checked', next ? 'true' : 'false');
          App.applyTheme(next);
          try {
            await API.updateSettings({ darkMode: next });
          } catch (err) {
            UI.toast('Theme saved on this device only (' + err.message + ')');
          }
        },

        logout: async function () {
          var ok = await UI.confirm({
            title: 'Log out?',
            message: 'You will need to sign in again to see your tickets and watchlist.',
            confirmLabel: 'Log out',
            danger: true,
          });
          if (ok) App.signOut();
        },
      });

      return view;
    },
  };

  // ── Watchlist ──────────────────────────────────────────────────────────────
  window.Screens.watchlist = {
    auth: true,
    render: async function () {
      var data = await API.watchlist();

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Watchlist', back: true }) +
          '<div class="scroll">' +
            (data.movies.length
              ? '<div class="spacer-16"></div><div class="grid-2">' +
                data.movies.map(function (m) { return UI.movieCard(m); }).join('') + '</div>' +
                '<style>.grid-2 .movie-card{width:100%}</style>'
              : UI.empty({
                  icon: 'heart', title: 'Your watchlist is empty',
                  text: 'Tap the heart on any movie to save it for later.',
                  action: 'browse', actionLabel: 'Browse movies',
                })) +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        browse: function () { App.navigate('/home'); },
        movie: function (el) { App.navigate('/movie/' + el.getAttribute('data-id')); },
        book: function (el) { App.navigate('/movie/' + el.getAttribute('data-id') + '/showtimes'); },
      });

      return view;
    },
  };

  // ── Movie interests ────────────────────────────────────────────────────────
  window.Screens.interests = {
    auth: true,
    render: async function () {
      var data = await API.interests();
      var picked = new Set(data.interests);
      var languages = new Set(data.preferredLanguages);

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Movie Interest', back: true }) +
          '<div class="scroll">' +
            '<p class="prose" style="padding-top:14px">Pick the genres and languages you enjoy. We use these to build your Home recommendations.</p>' +
            '<h2 class="subhead">Genres</h2>' +
            '<div class="pickers">' +
              data.allGenres.map(function (g) {
                return '<button class="chip chip--sm" data-genre="' + UI.esc(g) + '" aria-pressed="' + (picked.has(g) ? 'true' : 'false') + '">' + UI.esc(g) + '</button>';
              }).join('') +
            '</div>' +
            '<h2 class="subhead">Languages</h2>' +
            '<div class="pickers">' +
              data.allLanguages.map(function (l) {
                return '<button class="chip chip--sm" data-lang="' + UI.esc(l) + '" aria-pressed="' + (languages.has(l) ? 'true' : 'false') + '">' + UI.esc(l) + '</button>';
              }).join('') +
            '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
          '<div class="actionbar"><button class="btn" data-action="save">Save preferences</button></div>' +
        '</div>'
      );

      view.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-genre],[data-lang]');
        if (!chip) return;
        var isGenre = chip.hasAttribute('data-genre');
        var value = chip.getAttribute(isGenre ? 'data-genre' : 'data-lang');
        var set = isGenre ? picked : languages;
        if (set.has(value)) set.delete(value); else set.add(value);
        chip.setAttribute('aria-pressed', set.has(value) ? 'true' : 'false');
      });

      UI.actions(view, {
        save: async function (el) {
          el.disabled = true;
          try {
            await API.saveInterests({ interests: Array.from(picked), preferredLanguages: Array.from(languages) });
            if (Store.user) Store.user.interests = Array.from(picked);
            UI.toast('Preferences saved', 'success');
            App.back('/account');
          } catch (err) {
            UI.toast(err.message, 'error');
            el.disabled = false;
          }
        },
      });

      return view;
    },
  };

  // ── Payment methods ────────────────────────────────────────────────────────
  window.Screens.payments = {
    auth: true,
    render: async function () {
      var data = await API.paymentMethods();

      function iconFor(type) {
        return type === 'upi' ? 'phone' : type === 'wallet' ? 'wallet' : type === 'netbanking' ? 'bank' : 'card';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Payment Methods', back: true }) +
          '<div class="scroll" data-body></div>' +
          '<div class="actionbar"><button class="btn" data-action="add">' + UI.icon('plus', 19) + ' Add payment method</button></div>' +
        '</div>'
      );

      var body = view.querySelector('[data-body]');

      function paint(methods) {
        body.innerHTML = methods.length
          ? '<div style="padding:16px">' + methods.map(function (m) {
              return '<div class="option"' + (m.isDefault ? ' aria-pressed="true"' : '') + '>' +
                '<span class="option__icon">' + UI.icon(iconFor(m.type), 21) + '</span>' +
                '<span class="option__text">' +
                  '<span class="option__title">' + UI.esc(m.label) + (m.isDefault ? ' · Default' : '') + '</span>' +
                  '<span class="option__sub">' +
                    UI.esc(m.last4 ? (m.brand ? m.brand + ' •••• ' + m.last4 : '•••• ' + m.last4) : m.handle || (m.type === 'wallet' ? 'Wallet' : m.type.toUpperCase())) +
                    (m.expiry ? ' · exp ' + UI.esc(m.expiry) : '') +
                  '</span>' +
                '</span>' +
                (m.isDefault ? '' : '<button class="link-btn" data-action="default" data-id="' + UI.esc(m.id) + '" style="font-size:13px">Set default</button>') +
                '<button class="icon-btn" data-action="remove" data-id="' + UI.esc(m.id) + '" aria-label="Remove ' + UI.esc(m.label) + '" style="color:var(--danger);width:34px;height:34px">' + UI.icon('trash', 19) + '</button>' +
                '</div>';
            }).join('') + '</div>' +
            '<p class="prose" style="font-size:12px;padding-top:6px">Card numbers are never stored — this demo keeps only the label, brand and last 4 digits.</p>'
          : UI.empty({ icon: 'card', title: 'No payment methods', text: 'Add a card, UPI ID or wallet to check out faster.' });
      }

      function addSheet() {
        var form = UI.h(
          '<form style="padding:0 0 8px">' +
            '<div class="field">' +
              '<label class="field__label">Type</label>' +
              '<div class="field__control">' + UI.icon('card', 20) +
                '<select name="type">' +
                  '<option value="card">Credit / Debit card</option>' +
                  '<option value="upi">UPI</option>' +
                  '<option value="wallet">Wallet</option>' +
                  '<option value="netbanking">Net banking</option>' +
                '</select>' + UI.icon('chevron-down', 18) +
              '</div>' +
            '</div>' +
            '<div class="field"><label class="field__label">Label</label>' +
              '<div class="field__control">' + UI.icon('edit', 20) + '<input name="label" placeholder="e.g. HDFC Credit Card" required></div></div>' +
            '<div data-card-fields>' +
              '<div class="field"><label class="field__label">Last 4 digits</label>' +
                '<div class="field__control">' + UI.icon('lock', 20) + '<input name="last4" inputmode="numeric" maxlength="4" placeholder="4821"></div></div>' +
              '<div class="field"><label class="field__label">Expiry (MM/YY)</label>' +
                '<div class="field__control">' + UI.icon('calendar', 20) + '<input name="expiry" placeholder="09/28" maxlength="5"></div></div>' +
            '</div>' +
            '<div data-upi-fields hidden>' +
              '<div class="field"><label class="field__label">UPI ID</label>' +
                '<div class="field__control">' + UI.icon('phone', 20) + '<input name="handle" placeholder="name@bank"></div></div>' +
            '</div>' +
            '<p class="field__error" data-error style="padding:0 16px 10px;display:none"></p>' +
            '<div style="padding:0 16px"><button class="btn" type="submit">Save method</button></div>' +
          '</form>'
        );

        var sheet = UI.sheet({ title: 'Add payment method', body: form });
        var typeSelect = form.querySelector('[name="type"]');

        function syncFields() {
          var isCard = typeSelect.value === 'card';
          var isUpi = typeSelect.value === 'upi';
          form.querySelector('[data-card-fields]').hidden = !isCard;
          form.querySelector('[data-upi-fields]').hidden = !isUpi;
        }
        typeSelect.addEventListener('change', syncFields);
        syncFields();

        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          var payload = { type: typeSelect.value, label: form.label.value.trim() };
          if (payload.type === 'card') {
            payload.last4 = form.last4.value.trim();
            payload.expiry = form.expiry.value.trim();
          }
          if (payload.type === 'upi') payload.handle = form.handle.value.trim();

          try {
            var res = await API.addPaymentMethod(payload);
            sheet.close();
            UI.toast('Payment method added', 'success');
            paint(res.paymentMethods);
          } catch (err) {
            var box = form.querySelector('[data-error]');
            box.textContent = err.message;
            box.style.display = 'block';
          }
        });
      }

      UI.actions(view, {
        add: addSheet,
        default: async function (el) {
          try {
            var res = await API.makeDefaultPaymentMethod(el.getAttribute('data-id'));
            paint(res.paymentMethods);
            UI.toast('Default updated', 'success');
          } catch (err) { UI.toast(err.message, 'error'); }
        },
        remove: async function (el) {
          var ok = await UI.confirm({ title: 'Remove this method?', message: 'You can add it again at any time.', confirmLabel: 'Remove', danger: true });
          if (!ok) return;
          try {
            var res = await API.deletePaymentMethod(el.getAttribute('data-id'));
            paint(res.paymentMethods);
            UI.toast('Removed');
          } catch (err) { UI.toast(err.message, 'error'); }
        },
      });

      paint(data.paymentMethods);
      return view;
    },
  };

  // ── Personal info ──────────────────────────────────────────────────────────
  window.Screens.personalInfo = {
    auth: true,
    render: async function () {
      var res = await API.me();
      var user = res.user;

      function textField(name, label, icon, value, type, placeholder) {
        return '<div class="field"><label class="field__label" for="' + name + '">' + UI.esc(label) + '</label>' +
          '<div class="field__control">' + UI.icon(icon, 20) +
          '<input id="' + name + '" name="' + name + '" type="' + (type || 'text') + '" value="' + UI.esc(value || '') + '" placeholder="' + UI.esc(placeholder || '') + '"></div></div>';
      }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Personal Info', back: true }) +
          '<div class="scroll">' +
            '<div style="text-align:center;padding:20px 0 6px">' +
              '<img src="' + UI.esc(user.avatarUrl) + '" alt="" style="width:88px;height:88px;border-radius:50%;margin:0 auto" data-fallback="/img/avatars/guest.svg">' +
              '<p style="margin:10px 0 0;font-size:12.5px;color:var(--muted)">Member since ' + UI.esc(UI.shortDate(user.createdAt)) + ' · ' + UI.esc(user.memberId) + '</p>' +
            '</div>' +
            '<form data-form style="padding-top:14px">' +
              textField('name', 'Full name', 'user', user.name) +
              textField('phone', 'Mobile number', 'phone', user.phone, 'tel', '+91 98765 43210') +
              textField('dateOfBirth', 'Date of birth', 'cake', user.dateOfBirth, 'date') +
              '<div class="field"><label class="field__label" for="gender">Gender</label>' +
                '<div class="field__control">' + UI.icon('user', 20) +
                  '<select id="gender" name="gender">' +
                    ['', 'male', 'female', 'other', 'prefer_not_to_say'].map(function (g) {
                      var label = g === '' ? 'Not specified' : g === 'prefer_not_to_say' ? 'Prefer not to say' : g.charAt(0).toUpperCase() + g.slice(1);
                      return '<option value="' + g + '"' + (user.gender === g ? ' selected' : '') + '>' + label + '</option>';
                    }).join('') +
                  '</select>' + UI.icon('chevron-down', 18) +
                '</div></div>' +
              '<div class="field"><label class="field__label" for="city">City</label>' +
                '<div class="field__control">' + UI.icon('map-pin', 20) + '<input id="city" name="city" value="' + UI.esc(user.city || '') + '"></div></div>' +
              '<div class="field"><label class="field__label">Email</label>' +
                '<div class="field__control" style="opacity:.6">' + UI.icon('mail', 20) + '<input value="' + UI.esc(user.email) + '" disabled></div>' +
                '<p class="field__hint">Contact support to change the email on your account.</p></div>' +
              '<p class="field__error" data-error style="padding:0 16px 10px;display:none"></p>' +
            '</form>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
          '<div class="actionbar"><button class="btn" data-action="save">Save changes</button></div>' +
        '</div>'
      );

      var form = view.querySelector('[data-form]');

      UI.actions(view, {
        save: async function (el) {
          el.disabled = true;
          try {
            var updated = await API.updateProfile({
              name: form.name.value.trim(),
              phone: form.phone.value.trim(),
              dateOfBirth: form.dateOfBirth.value,
              gender: form.gender.value,
              city: form.city.value.trim(),
            });
            Store.user = updated.user;
            if (updated.user.city) Store.setCity(updated.user.city);
            UI.toast('Profile updated', 'success');
            App.back('/account');
          } catch (err) {
            var box = view.querySelector('[data-error]');
            box.textContent = err.message;
            box.style.display = 'block';
            el.disabled = false;
          }
        },
      });

      return view;
    },
  };

  // ── Notification settings ──────────────────────────────────────────────────
  window.Screens.notificationSettings = {
    auth: true,
    render: async function () {
      var res = await API.me();
      var prefs = (res.user.settings && res.user.settings.notifications) || {};

      var ITEMS = [
        { key: 'bookingUpdates', icon: 'ticket-check', label: 'Booking updates' },
        { key: 'reminders', icon: 'clock', label: 'Show reminders' },
        { key: 'offers', icon: 'tag', label: 'Offers & discounts' },
        { key: 'newReleases', icon: 'sparkle', label: 'New releases' },
      ];

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Notification', back: true }) +
          '<div class="scroll">' +
            '<p class="prose" style="padding-top:14px">Choose what CineFlex may notify you about.</p>' +
            '<div class="list" style="margin-top:8px">' +
              ITEMS.map(function (item) {
                return UI.row({ icon: item.icon, label: item.label, action: 'toggle:' + item.key, toggle: prefs[item.key] !== false });
              }).join('') +
            '</div>' +
            '<div class="divider"></div>' +
            '<div class="list">' + UI.row({ icon: 'inbox', label: 'View all notifications', action: 'inbox' }) + '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      view.addEventListener('click', async function (event) {
        var btn = event.target.closest('[data-action^="toggle:"]');
        if (!btn) return;
        var key = btn.getAttribute('data-action').slice(7);
        var next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', next ? 'true' : 'false');
        var patch = {};
        patch[key] = next;
        try {
          await API.updateSettings({ notifications: patch });
        } catch (err) {
          btn.setAttribute('aria-checked', next ? 'false' : 'true');
          UI.toast(err.message, 'error');
        }
      });

      UI.actions(view, { inbox: function () { App.navigate('/notifications'); } });
      return view;
    },
  };

  // ── Security ───────────────────────────────────────────────────────────────
  window.Screens.security = {
    auth: true,
    render: function () {
      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Security', back: true }) +
          '<div class="scroll">' +
            '<h2 class="subhead">Change password</h2>' +
            '<form data-form>' +
              '<div class="field"><label class="field__label" for="current">Current password</label>' +
                '<div class="field__control">' + UI.icon('lock', 20) + '<input id="current" name="current" type="password" autocomplete="current-password" required></div></div>' +
              '<div class="field"><label class="field__label" for="next">New password</label>' +
                '<div class="field__control">' + UI.icon('lock', 20) + '<input id="next" name="next" type="password" autocomplete="new-password" required></div>' +
                '<p class="field__hint">At least 4 characters.</p></div>' +
              '<div class="field"><label class="field__label" for="confirm">Confirm new password</label>' +
                '<div class="field__control">' + UI.icon('lock', 20) + '<input id="confirm" name="confirm" type="password" autocomplete="new-password" required></div></div>' +
              '<p class="field__error" data-error style="padding:0 16px 10px;display:none"></p>' +
              '<div style="padding:0 16px"><button class="btn" type="submit">Update password</button></div>' +
            '</form>' +
            '<div class="divider"></div>' +
            '<div class="notice">This demo stores passwords as salted scrypt hashes and issues HMAC-signed session tokens that expire after 30 days.</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      var form = view.querySelector('[data-form]');
      var box = view.querySelector('[data-error]');

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        box.style.display = 'none';
        if (form.next.value !== form.confirm.value) {
          box.textContent = 'The new passwords do not match.';
          box.style.display = 'block';
          return;
        }
        try {
          await API.changePassword(form.current.value, form.next.value);
          UI.toast('Password updated', 'success');
          App.back('/account');
        } catch (err) {
          box.textContent = err.message;
          box.style.display = 'block';
        }
      });

      return view;
    },
  };

  // ── Language ───────────────────────────────────────────────────────────────
  window.Screens.language = {
    auth: true,
    render: async function () {
      var res = await API.me();
      var current = (res.user.settings && res.user.settings.language) || 'English (US)';
      var OPTIONS = ['English (US)', 'English (UK)', 'हिन्दी', 'ગુજરાતી', 'தமிழ்', 'తెలుగు', 'मराठी', 'ಕನ್ನಡ'];

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Language', back: true }) +
          '<div class="scroll">' +
            '<div style="padding:16px">' +
              OPTIONS.map(function (opt) {
                return '<button class="option" data-action="pick" data-value="' + UI.esc(opt) + '" aria-pressed="' + (opt === current ? 'true' : 'false') + '">' +
                  '<span class="option__icon">' + UI.icon('globe', 21) + '</span>' +
                  '<span class="option__text"><span class="option__title">' + UI.esc(opt) + '</span></span>' +
                  '<span class="option__radio"></span></button>';
              }).join('') +
            '</div>' +
            '<p class="prose" style="font-size:12.5px">This sets your preferred language for notifications and ticket emails. The interface itself is English in this build.</p>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        pick: async function (el) {
          var value = el.getAttribute('data-value');
          view.querySelectorAll('[data-action="pick"]').forEach(function (b) {
            b.setAttribute('aria-pressed', b === el ? 'true' : 'false');
          });
          try {
            await API.updateSettings({ language: value });
            UI.toast('Language set to ' + value, 'success');
          } catch (err) { UI.toast(err.message, 'error'); }
        },
      });

      return view;
    },
  };

  // ── Help centre ────────────────────────────────────────────────────────────
  window.Screens.help = {
    render: function () {
      var FAQ = [
        { q: 'How do I cancel a ticket?', a: 'Open My Tickets, tap the booking and choose “Cancel booking”. Cancellations are allowed up to 2 hours before showtime and refund 75% of the amount paid.' },
        { q: 'How long are my seats held?', a: 'Once you pick seats they are held for 10 minutes while you pay. A countdown is shown on the payment screen. If it runs out, the seats go back on sale.' },
        { q: 'Can I order food without a movie ticket?', a: 'Yes. Use the Food Order tab, add items to your cart and choose a cinema plus a pickup time at checkout.' },
        { q: 'Where do I find my booking reference?', a: 'It is printed under the barcode on every ticket, and starts with CF for movies or FD for food orders.' },
        { q: 'Do I need to print my ticket?', a: 'No. Show the barcode inside the app at the entry gate — the staff scanner reads it directly from your screen.' },
        { q: 'How are refunds paid back?', a: 'Refunds go back to the original payment method within 5–7 working days. You will get a notification when it is initiated.' },
      ];

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Help Center', back: true }) +
          '<div class="scroll">' +
            '<h2 class="subhead">Frequently asked</h2>' +
            '<div class="list">' +
              FAQ.map(function (item, i) {
                return '<div style="border-top:1px solid var(--line)' + (i === 0 ? ';border-top:0' : '') + '">' +
                  '<button class="row" data-faq="' + i + '" style="border:0">' +
                    '<span class="row__label" style="font-size:15.5px">' + UI.esc(item.q) + '</span>' +
                    '<span class="row__chevron" data-chev>' + UI.icon('chevron-down', 19) + '</span>' +
                  '</button>' +
                  '<p data-answer hidden style="margin:0 0 16px;font-size:14px;line-height:1.6;color:var(--ink-soft)">' + UI.esc(item.a) + '</p>' +
                  '</div>';
              }).join('') +
            '</div>' +
            '<h2 class="subhead">Still need help?</h2>' +
            '<div class="list">' +
              UI.row({ icon: 'phone', label: 'Call support', value: '1800-CINE', action: 'call' }) +
              UI.row({ icon: 'mail', label: 'Email us', value: 'help@cineflex.com', action: 'mail' }) +
            '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      view.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-faq]');
        if (!btn) return;
        var answer = btn.parentElement.querySelector('[data-answer]');
        answer.hidden = !answer.hidden;
        btn.querySelector('[data-chev]').style.transform = answer.hidden ? '' : 'rotate(180deg)';
      });

      UI.actions(view, {
        call: function () { window.location.href = 'tel:1800246339'; },
        mail: function () { window.location.href = 'mailto:help@cineflex.com'; },
      });

      return view;
    },
  };

  // ── About ──────────────────────────────────────────────────────────────────
  window.Screens.about = {
    render: async function () {
      var health = null;
      try { health = await API.get('/health'); } catch (_e) { /* offline is fine */ }

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'About CineFlex', back: true }) +
          '<div class="scroll">' +
            '<div style="text-align:center;padding:30px 24px 10px">' +
              '<img src="/img/logo.svg" alt="" width="76" height="76" style="margin:0 auto;border-radius:20px">' +
              '<h2 style="margin:16px 0 0;font-size:22px;font-weight:800">CineFlex</h2>' +
              '<p style="margin:6px 0 0;font-size:13.5px;color:var(--muted)">Version ' + UI.esc(health ? health.version : '1.0.0') + '</p>' +
            '</div>' +
            '<p class="prose" style="padding-top:12px">A complete movie ticket booking system — browse what is playing, pick your exact seats, pre-order snacks and carry your ticket as a scannable barcode.</p>' +
            (health
              ? '<h2 class="subhead">Catalogue</h2>' +
                '<div style="padding:0 16px">' +
                  '<div class="kv"><span class="kv__key">Movies</span><span class="kv__val">' + health.counts.movies + '</span></div>' +
                  '<div class="kv"><span class="kv__key">Cinemas</span><span class="kv__val">' + health.counts.cinemas + '</span></div>' +
                  '<div class="kv"><span class="kv__key">Showtimes</span><span class="kv__val">' + health.counts.showtimes + '</span></div>' +
                  '<div class="kv"><span class="kv__key">Food items</span><span class="kv__val">' + health.counts.foodItems + '</span></div>' +
                '</div>'
              : '') +
            '<h2 class="subhead">Legal</h2>' +
            '<div class="list">' +
              UI.row({ icon: 'doc', label: 'Terms & Conditions', action: 'terms' }) +
              UI.row({ icon: 'shield', label: 'Privacy Policy', action: 'privacy' }) +
            '</div>' +
            '<p class="prose" style="font-size:12px;padding-top:20px">Movie titles and artwork in this build are placeholders generated locally for demonstration purposes.</p>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      UI.actions(view, {
        terms: function () {
          UI.sheet({
            title: 'Terms & Conditions',
            body: '<div class="prose" style="line-height:1.7;font-size:13.5px">' +
              '<p>Tickets are valid only for the show, date, screen and seats printed on them.</p>' +
              '<p>Cancellations are accepted up to 2 hours before showtime and refund 75% of the amount paid. Convenience fees are non-refundable once a show has started.</p>' +
              '<p>Entry is subject to the certification of the film. Photo ID may be requested for A-rated titles.</p>' +
              '<p>Outside food and beverages are not permitted inside the auditorium.</p>' +
              '<p>Pre-ordered food must be collected from the assigned counter within 30 minutes of the chosen slot.</p></div>',
          });
        },
        privacy: function () {
          UI.sheet({
            title: 'Privacy Policy',
            body: '<div class="prose" style="line-height:1.7;font-size:13.5px">' +
              '<p>We store only what is needed to sell you a ticket: your name, email, mobile number, city and booking history.</p>' +
              '<p>Passwords are stored as salted scrypt hashes and are never recoverable in plain text.</p>' +
              '<p>Card numbers are never stored. Saved payment methods keep only a label, the brand and the last four digits.</p>' +
              '<p>Your genre and language preferences are used solely to order the recommendations on your Home screen.</p>' +
              '<p>You can delete a saved payment method or turn off any notification category at any time from Account.</p></div>',
          });
        },
      });

      return view;
    },
  };
})();
