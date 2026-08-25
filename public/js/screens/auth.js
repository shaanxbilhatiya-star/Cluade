/* Sign in / create account. */
(function () {
  'use strict';

  function field(opts) {
    return '<div class="field">' +
      '<label class="field__label" for="' + opts.name + '">' + UI.esc(opts.label) + '</label>' +
      '<div class="field__control">' + UI.icon(opts.icon, 20) +
        '<input id="' + opts.name + '" name="' + opts.name + '" type="' + (opts.type || 'text') + '" ' +
        'placeholder="' + UI.esc(opts.placeholder || '') + '" ' +
        (opts.autocomplete ? 'autocomplete="' + opts.autocomplete + '" ' : '') +
        (opts.value ? 'value="' + UI.esc(opts.value) + '" ' : '') +
        'required>' +
      '</div>' +
      '</div>';
  }

  function brandHeader(title, subtitle) {
    return '<div style="text-align:center;padding:38px 24px 26px">' +
      '<img src="/img/logo.svg" alt="CineFlex" width="70" height="70" style="margin:0 auto;border-radius:18px">' +
      '<h1 style="margin:18px 0 0;font-size:26px;font-weight:800;letter-spacing:-.5px">' + UI.esc(title) + '</h1>' +
      '<p style="margin:8px 0 0;font-size:14.5px;color:var(--muted);line-height:1.5">' + UI.esc(subtitle) + '</p>' +
      '</div>';
  }

  function errorBox() {
    return '<p class="field__error" data-error style="padding:0 16px 12px;display:none"></p>';
  }

  function showError(view, message) {
    var box = view.querySelector('[data-error]');
    box.textContent = message;
    box.style.display = 'block';
  }

  function submitting(button, busy, label) {
    button.disabled = busy;
    button.innerHTML = busy
      ? '<span class="spinner" style="width:19px;height:19px;border-width:2.5px;border-top-color:#fff"></span>'
      : label;
  }

  window.Screens.login = {
    render: function () {
      var view = UI.h(
        '<div class="screen">' +
          '<div class="scroll">' +
            brandHeader('Welcome back', 'Sign in to book tickets, pick seats and order snacks.') +
            '<form data-form novalidate>' +
              field({ name: 'email', label: 'Email or phone', icon: 'mail', type: 'text', placeholder: 'andrew@example.com', autocomplete: 'username', value: 'andrew@example.com' }) +
              field({ name: 'password', label: 'Password', icon: 'lock', type: 'password', placeholder: 'Your password', autocomplete: 'current-password', value: '1234' }) +
              errorBox() +
              '<div style="padding:6px 16px 0"><button class="btn" type="submit" data-submit>Sign In</button></div>' +
            '</form>' +
            '<p class="text-center" style="margin:22px 0 0;font-size:14.5px;color:var(--muted)">' +
              'New to CineFlex? <button class="link-btn" data-action="register">Create an account</button>' +
            '</p>' +
            '<div class="divider"></div>' +
            '<div style="padding:0 16px">' +
              '<button class="btn-outline btn-outline--lg" data-action="guest">Browse without signing in</button>' +
            '</div>' +
            '<div class="notice" style="margin-top:22px">' +
              '<strong>Demo accounts</strong><br>' +
              'Customer &mdash; andrew@example.com / 1234<br>' +
              'Admin &mdash; admin@cineflex.com / admin123 (use the <a href="/admin/" style="text-decoration:underline">admin panel</a>)' +
            '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      var form = view.querySelector('[data-form]');
      var button = view.querySelector('[data-submit]');

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var email = form.email.value.trim();
        var password = form.password.value;
        if (!email || !password) { showError(view, 'Enter your email and password.'); return; }

        submitting(button, true, 'Sign In');
        try {
          var payload = await API.login(email, password);
          UI.toast('Welcome back, ' + payload.user.name.split(' ')[0] + '!', 'success');
          App.afterAuth(payload);
        } catch (err) {
          showError(view, err.message);
          submitting(button, false, 'Sign In');
        }
      });

      UI.actions(view, {
        register: function () { App.navigate('/register'); },
        guest: function () { App.navigate('/home'); },
      });

      return view;
    },
  };

  window.Screens.register = {
    render: function () {
      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Create account', back: true }) +
          '<div class="scroll">' +
            brandHeader('Join CineFlex', 'One account for tickets, snacks and offers.') +
            '<form data-form novalidate>' +
              field({ name: 'name', label: 'Full name', icon: 'user', placeholder: 'Your name', autocomplete: 'name' }) +
              field({ name: 'email', label: 'Email', icon: 'mail', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' }) +
              field({ name: 'phone', label: 'Mobile number', icon: 'phone', type: 'tel', placeholder: '+91 98765 43210', autocomplete: 'tel' }) +
              field({ name: 'password', label: 'Password', icon: 'lock', type: 'password', placeholder: 'At least 4 characters', autocomplete: 'new-password' }) +
              errorBox() +
              '<div style="padding:6px 16px 0"><button class="btn" type="submit" data-submit>Create Account</button></div>' +
            '</form>' +
            '<p class="text-center" style="margin:22px 0 0;font-size:14.5px;color:var(--muted)">' +
              'Already have an account? <button class="link-btn" data-action="login">Sign in</button>' +
            '</p>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      var form = view.querySelector('[data-form]');
      var button = view.querySelector('[data-submit]');

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var payload = {
          name: form.name.value.trim(),
          email: form.email.value.trim(),
          phone: form.phone.value.trim(),
          password: form.password.value,
          city: Store.city,
        };
        if (!payload.name || !payload.email || !payload.password) {
          showError(view, 'Name, email and password are required.');
          return;
        }
        if (payload.password.length < 4) {
          showError(view, 'Password must be at least 4 characters.');
          return;
        }

        submitting(button, true, 'Create Account');
        try {
          var result = await API.register(payload);
          UI.toast('Account created. Welcome to CineFlex!', 'success');
          App.afterAuth(result);
        } catch (err) {
          showError(view, err.message);
          submitting(button, false, 'Create Account');
        }
      });

      UI.actions(view, { login: function () { App.navigate('/login'); } });
      return view;
    },
  };
})();
