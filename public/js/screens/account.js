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
            text: 'Sign in to book tickets, rooms and passes, and to see your booking history.',
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
            'Scan this at the counter to collect your tickets.' +
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
              '<div class="stat"><div class="stat__value">' + UI.money(stats.totalSpent) + '</div><div class="stat__label">Spent</div></div>' +
            '</div>' +

            '<div class="profile__divider"></div>' +

            /* Everything the guest has booked, grouped by where they booked it:
               the cinema, then the resort, then the water park. */
            '<div class="list">' +
              UI.row({ icon: 'ticket', label: 'Movie Tickets', action: 'movie-tickets' }) +
              UI.row({ icon: 'popcorn', label: 'Movie Food & Beverages', action: 'movie-food' }) +
            '</div>' +

            '<div class="list__sep"></div>' +

            '<div class="list">' +
              UI.row({ icon: 'bed', label: 'Hotel Reservations', action: 'hotel-bookings' }) +
              UI.row({ icon: 'dine', label: 'Restaurant Reservations', action: 'restaurant-bookings' }) +
            '</div>' +

            '<div class="list__sep"></div>' +

            '<div class="list">' +
              UI.row({ icon: 'waves', label: 'Waterpark Bookings', action: 'waterpark-bookings' }) +
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

        /* The first three reuse My Tickets, which filters the one polymorphic
           bookings collection by type. Dine-in and the water park keep their
           own collections, so they have their own list screens. */
        'movie-tickets': function () { App.navigate('/tickets?type=movie'); },
        'movie-food': function () { App.navigate('/tickets?type=food'); },
        'hotel-bookings': function () { App.navigate('/tickets?type=hotel'); },
        'restaurant-bookings': function () { App.navigate('/account/restaurant'); },
        'waterpark-bookings': function () { App.navigate('/account/waterpark'); },

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
            message: 'You will need to sign in again to see your tickets and bookings.',
            confirmLabel: 'Log out',
            danger: true,
          });
          if (ok) App.signOut();
        },
      });

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
              '<p>Card numbers are never collected or stored. Payment details are entered at the time of payment and are not kept.</p>' +
              '<p>You can turn off any notification category at any time from Account.</p></div>',
          });
        },
      });

      return view;
    },
  };
})();
