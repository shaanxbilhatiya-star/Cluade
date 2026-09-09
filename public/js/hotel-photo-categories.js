/* Property photo categories — shared by the customer app and the admin panel.

   These galleries belong to the property, not to a single room type, so every
   room (including ones added later) shows the same set on its booking page.

   The server keeps a matching id list in src/hotelPhotos.js for validation —
   keep the two in step when adding or renaming a category.                    */
(function () {
  'use strict';

  window.HotelPhotoCategories = [
    { id: 'outdoors', label: 'Outdoors', icon: 'sun' },
    { id: 'washroom', label: 'Washroom', icon: 'bath' },
    { id: 'swimming-pool', label: 'Swimming Pool', icon: 'waves' },
    { id: 'entrance', label: 'Entrance', icon: 'arrow-right' },
    { id: 'reception', label: 'Reception', icon: 'concierge' },
    { id: 'common-area', label: 'Common Area', icon: 'users' },
    { id: 'facade', label: 'Facade', icon: 'building' },
    { id: 'restaurant', label: 'Restaurant', icon: 'food' },
    { id: 'play-area', label: 'Play Area', icon: 'sparkle' },
    { id: 'garden', label: 'Garden', icon: 'tree' },
    { id: 'jacuzzi', label: 'Jacuzzi', icon: 'droplet' },
    { id: 'others', label: 'Others', icon: 'grid' },
  ];
})();
