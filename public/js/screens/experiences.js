/* Experiences tab — promotes Kingfisher's non-movie packages (pool party,
   water park, kitty party, weddings, birthdays, etc.). Content and pricing
   are fully editable from the admin panel; this screen just renders it. */
(function () {
  'use strict';

  function telHref(phone) { return 'tel:' + String(phone).replace(/\s+/g, ''); }
  function waHref(phone, text) {
    return 'https://wa.me/91' + String(phone).replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
  }

  function callBanner(phone) {
    return '<a class="card exp-call" href="' + telHref(phone) + '">' +
      '<span class="exp-call__icon">' + UI.icon('phone', 22) + '</span>' +
      '<span class="exp-call__text">' +
        '<strong>Book instantly — Call or WhatsApp</strong>' +
        '<span>' + UI.esc(phone.slice(0, 4) + ' ' + phone.slice(4)) + '</span>' +
      '</span>' +
      '<span class="exp-call__arrow">' + UI.icon('arrow-right', 18) + '</span>' +
      '</a>';
  }

  function experienceCard(exp, phone) {
    var msg = 'Hi Kingfisher, I am interested in the ' + exp.title + '. Please share more details.';
    return '<article class="card exp-card">' +
      '<div class="exp-card__head" style="background:' + UI.esc(exp.color || '#7C3AED') + '">' +
        (exp.badge ? '<span class="exp-card__badge">' + UI.esc(exp.badge) + '</span>' : '') +
        '<span class="exp-card__icon">' + UI.icon(exp.icon || 'sparkle', 30) + '</span>' +
      '</div>' +
      '<div class="exp-card__body">' +
        '<span class="exp-card__category">' + UI.esc(exp.category) + '</span>' +
        '<h3 class="exp-card__title">' + UI.esc(exp.title) + '</h3>' +
        '<p class="exp-card__subtitle">' + UI.esc(exp.subtitle) + '</p>' +
        (exp.priceLabel
          ? '<div class="exp-card__price">' + UI.esc(exp.priceLabel) +
            (exp.priceNote ? '<span class="exp-card__pricenote">' + UI.esc(exp.priceNote) + '</span>' : '') + '</div>'
          : '') +
        (exp.features && exp.features.length
          ? '<ul class="exp-card__features">' + exp.features.map(function (f) {
              return '<li>' + UI.icon('check', 14) + '<span>' + UI.esc(f) + '</span></li>';
            }).join('') + '</ul>'
          : '') +
        '<div class="exp-card__actions">' +
          '<a class="btn" href="' + telHref(phone) + '">' + UI.icon('phone', 16) + ' Call to book</a>' +
          '<a class="btn-outline" href="' + waHref(phone, msg) + '" target="_blank" rel="noopener">WhatsApp</a>' +
        '</div>' +
      '</div>' +
      '</article>';
  }

  window.Screens.experiences = {
    tab: 'experiences',
    render: async function () {
      var data = await API.experiences();
      var phone = data.phone || '7648913272';

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Experiences' }) +
          '<div class="scroll">' +
            '<div style="padding:14px 16px 0">' +
              '<p style="color:var(--muted);font-size:13.5px;margin:0 0 12px">' +
                'Beyond the movies — pool parties, water park days, kitty parties and wedding venues at Kingfisher Mandla.' +
              '</p>' +
              callBanner(phone) +
            '</div>' +
            '<div class="exp-grid">' +
              (data.experiences.length
                ? data.experiences.map(function (e) { return experienceCard(e, phone); }).join('')
                : UI.empty({ icon: 'sparkle', title: 'Nothing here yet', text: 'Check back soon for new packages and offers.' })) +
            '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      return view;
    },
  };
})();
