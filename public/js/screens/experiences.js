/* Experiences (Events) tab: Kingfisher celebrations & venue packages. Every
   item renders a prominent image, price info and Call / WhatsApp actions. */
(function () {
  'use strict';

  var PHONE = '7648913272';
  var WHATSAPP = 'https://wa.me/91' + PHONE;

  function featureList(features) {
    if (!features || !features.length) return '';
    return '<ul class="exp-card__features">' +
      features.map(function (f) {
        return '<li>' + UI.icon('check', 15) + '<span>' + UI.esc(f) + '</span></li>';
      }).join('') +
      '</ul>';
  }

  function expCard(item) {
    return '<article class="exp-card">' +
      '<div class="exp-card__media">' +
        '<img class="exp-card__img" src="' + UI.esc(item.imageUrl) + '" alt="' + UI.esc(item.title) + '" loading="lazy" data-fallback="/img/posters/_placeholder.svg">' +
        (item.badge ? '<span class="exp-card__badge">' + UI.esc(item.badge) + '</span>' : '') +
      '</div>' +
      '<div class="exp-card__body">' +
        '<span class="exp-card__cat">' + UI.esc(item.category || '') + '</span>' +
        '<h3 class="exp-card__title">' + UI.esc(item.title) + '</h3>' +
        '<p class="exp-card__sub">' + UI.esc(item.subtitle || '') + '</p>' +
        '<div class="exp-card__price">' + UI.esc(item.priceLabel || '') + '</div>' +
        (item.priceNote ? '<div class="exp-card__note">' + UI.esc(item.priceNote) + '</div>' : '') +
        featureList(item.features) +
        '<div class="exp-card__actions">' +
          '<a class="btn" href="tel:' + PHONE + '">' + UI.icon('phone', 18) + ' Call to book</a>' +
          '<a class="btn-outline" href="' + WHATSAPP + '?text=' + encodeURIComponent('Hi, I would like to enquire about the ' + item.title + ' package.') + '" target="_blank" rel="noopener">WhatsApp</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  window.Screens.experiences = {
    tab: 'experiences',
    render: async function () {
      var data = await API.experiences();
      var items = (data && data.experiences) || [];

      var view = UI.h(
        '<div class="screen">' +
          UI.appbar({ title: 'Experiences' }) +
          '<div class="scroll">' +
            '<div class="section">' +
              UI.sectionHead('Celebrate at Kingfisher') +
              '<p class="exp-intro">Weddings, parties and family days out - every experience is fully customizable. Tap to call or WhatsApp us to book.</p>' +
              (items.length
                ? '<div class="exp-list">' + items.map(expCard).join('') + '</div>'
                : UI.empty({ icon: 'sparkle', title: 'No experiences yet', text: 'Check back soon for our celebration packages.' })) +
            '</div>' +
            '<div class="spacer-24"></div>' +
          '</div>' +
        '</div>'
      );

      return view;
    },
  };
})();
