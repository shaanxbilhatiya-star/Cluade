/**
 * Property photo categories.
 *
 * These galleries hang off the *hotel* record rather than off a room type, so
 * every room — including ones added months from now — shows the same set on its
 * booking page without anyone having to re-upload anything.
 *
 * Stored on the hotel as:
 *   hotel.propertyPhotos = { outdoors: ['/uploads/hotels/x.jpg', ...], ... }
 * Categories with no photos are left out of the map entirely.
 *
 * The browser needs the same ids (plus labels and icons) to render the galleries
 * and the admin form; that copy lives in public/js/hotel-photo-categories.js.
 * Keep the two id lists in step.
 */

const PROPERTY_PHOTO_CATEGORIES = [
  { id: 'outdoors', label: 'Outdoors' },
  { id: 'washroom', label: 'Washroom' },
  { id: 'swimming-pool', label: 'Swimming Pool' },
  { id: 'entrance', label: 'Entrance' },
  { id: 'reception', label: 'Reception' },
  { id: 'common-area', label: 'Common Area' },
  { id: 'facade', label: 'Facade' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'play-area', label: 'Play Area' },
  { id: 'garden', label: 'Garden' },
  { id: 'jacuzzi', label: 'Jacuzzi' },
  { id: 'others', label: 'Others' },
];

const PROPERTY_PHOTO_CATEGORY_IDS = PROPERTY_PHOTO_CATEGORIES.map((c) => c.id);

/** Photos kept per category. Generous, but bounded so the JSON db stays sane. */
const PHOTOS_PER_CATEGORY = 60;

function isPropertyPhotoCategory(id) {
  return PROPERTY_PHOTO_CATEGORY_IDS.includes(String(id));
}

module.exports = {
  PROPERTY_PHOTO_CATEGORIES,
  PROPERTY_PHOTO_CATEGORY_IDS,
  PHOTOS_PER_CATEGORY,
  isPropertyPhotoCategory,
};
