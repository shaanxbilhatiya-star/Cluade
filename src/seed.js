'use strict';
/**
 * Seeds the demo catalogue on first run and keeps a rolling showtime schedule
 * (3 days back for history, 7 days ahead for booking) on every boot - so the
 * app always has something to show, whenever you start it.
 */
const db = require('./db');
const auth = require('./auth');
const { MOVIES, LAYOUTS, CINEMAS, FOOD_ITEMS, OFFERS, SHOW_SLOTS } = require('./catalog');
const { computeTotals } = require('./pricing');

const DAYS_BACK = 3;
const DAYS_AHEAD = 7;

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** Local-time ISO timestamp for a date key + HH:mm. */
function atTime(key, hhmm) {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function basePrice(brand, slot) {
  const brandBase = { PVR: 240, INOX: 220, Cinepolis: 230, Rajhans: 170, Miraj: 190, Kingfisher: 250 }[brand] || 200;
  const hour = Number(slot.split(':')[0]);
  if (hour < 11) return Math.round(brandBase * 0.65); // morning show
  if (hour >= 21) return Math.round(brandBase * 1.1); // late night
  return brandBase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core catalogue
// ─────────────────────────────────────────────────────────────────────────────
function seedMovies() {
  const out = [];
  for (const m of MOVIES) {
    out.push(
      db.insert('movies', {
        id: `mov_${m.slug}`,
        slug: m.slug,
        title: m.title,
        tagline: m.tagline,
        status: m.status,
        genres: m.genres,
        languages: m.languages,
        formats: m.formats,
        certificate: m.certificate,
        runtime: m.runtime,
        rating: m.rating,
        votes: m.votes,
        releaseDate: m.releaseDate,
        director: m.director,
        cast: m.cast,
        synopsis: m.synopsis,
        trailerUrl: m.trailerUrl,
        posterUrl: `/img/posters/${m.slug}.svg`,
        backdropUrl: `/img/backdrops/${m.slug}.svg`,
        accentColor: m.art.colors[1],
        active: true,
      })
    );
  }
  return out;
}

function seedCinemas() {
  for (const c of CINEMAS) {
    db.insert('cinemas', {
      id: `cin_${c.slug}`,
      slug: c.slug,
      name: c.name,
      brand: c.brand,
      city: c.city,
      area: c.area,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      distanceKm: c.distanceKm,
      rating: c.rating,
      facilities: c.facilities,
      active: true,
    });

    // Kingfisher Multiplex screens are seeded here with exact BookMyShow layouts.
    if (c.screens && c.screens.length) {
      for (const s of c.screens) {
        const layoutKey = s.layout;
        const layout = LAYOUTS[layoutKey] || [];
        const screenId = `scr_${c.slug}-${s.name.toLowerCase().replace(/\s+/g, '-')}`;
        if (!db.byId('screens', screenId)) {
          db.insert('screens', {
            id: screenId,
            cinemaId: `cin_${c.slug}`,
            name: s.name,
            format: s.format || '2D',
            soundSystem: s.soundSystem || 'Dolby 7.1',
            layoutPreset: layoutKey,
            layout,
            prices: s.prices || {},
            blockedSeats: [],
            active: true,
          });
        }
      }
    }
    // Other screens are added via the admin panel
    // (Cinemas → a cinema → Add screen) so seat layouts reflect actual venues.
  }
}

function seedFood() {
  for (const f of FOOD_ITEMS) {
    db.insert('foodItems', {
      id: `food_${f.slug}`,
      slug: f.slug,
      name: f.name,
      category: f.category,
      price: f.price,
      description: f.description,
      size: f.size,
      veg: f.veg,
      popular: f.popular,
      imageUrl: `/img/food/${f.slug}.svg`,
      available: true,
    });
  }
}

function seedOffers() {
  for (const o of OFFERS) {
    db.insert('offers', {
      id: `off_${o.slug}`,
      slug: o.slug,
      title: o.title,
      subtitle: o.subtitle,
      code: o.code,
      discountType: o.discountType,
      discountValue: o.discountValue,
      maxDiscount: o.maxDiscount,
      minAmount: o.minAmount,
      appliesTo: o.appliesTo,
      bannerUrl: `/img/banners/${o.slug}.svg`,
      active: true,
    });
  }
}

function seedUsers() {
  const users = [
    {
      id: 'usr_andrew',
      name: 'Andrew Ainsely',
      email: 'andrew@example.com',
      phone: '+91 98250 41007',
      password: auth.hashPassword('1234'),
      role: 'customer',
      avatarUrl: '/img/avatars/andrew.svg',
      city: 'Ahmedabad',
      dateOfBirth: '1994-04-12',
      gender: 'male',
      memberId: 'CF-2024-000117',
      loyaltyPoints: 1450,
      watchlist: ['mov_animal', 'mov_kalki-2898-ad', 'mov_oppenheimer'],
      interests: ['Action', 'Thriller', 'Sci-Fi', 'Comedy'],
      preferredLanguages: ['Hindi', 'English', 'Gujarati'],
      paymentMethods: [
        { id: 'pm_1', type: 'card', label: 'HDFC Credit Card', last4: '4821', brand: 'Visa', expiry: '09/28', isDefault: true },
        { id: 'pm_2', type: 'upi', label: 'Google Pay', handle: 'andrew@okhdfcbank', isDefault: false },
        { id: 'pm_3', type: 'wallet', label: 'Paytm Wallet', balance: 1250, isDefault: false },
      ],
      settings: {
        darkMode: false,
        language: 'English (US)',
        notifications: { bookingUpdates: true, offers: true, newReleases: true, reminders: true },
      },
      active: true,
    },
    {
      id: 'usr_admin',
      name: 'Cine Admin',
      email: 'admin@cineflex.com',
      phone: '+91 90000 00001',
      password: auth.hashPassword('admin123'),
      role: 'admin',
      avatarUrl: '/img/avatars/admin.svg',
      city: 'Ahmedabad',
      memberId: 'CF-ADMIN-0001',
      loyaltyPoints: 0,
      watchlist: [],
      interests: [],
      preferredLanguages: ['English'],
      paymentMethods: [],
      settings: { darkMode: true, language: 'English (US)', notifications: { bookingUpdates: true, offers: false, newReleases: false, reminders: false } },
      active: true,
    },
    {
      id: 'usr_priya',
      name: 'Priya Sharma',
      email: 'priya@example.com',
      phone: '+91 98765 43210',
      password: auth.hashPassword('1234'),
      role: 'customer',
      avatarUrl: '/img/avatars/priya.svg',
      city: 'Mumbai',
      memberId: 'CF-2024-000118',
      loyaltyPoints: 320,
      watchlist: ['mov_dunki'],
      interests: ['Romance', 'Comedy', 'Drama'],
      preferredLanguages: ['Hindi', 'English'],
      paymentMethods: [{ id: 'pm_1', type: 'upi', label: 'PhonePe', handle: 'priya@ybl', isDefault: true }],
      settings: { darkMode: false, language: 'English (US)', notifications: { bookingUpdates: true, offers: true, newReleases: true, reminders: true } },
      active: true,
    },
  ];
  users.forEach((u) => db.insert('users', u));
}

function seedReviews() {
  const reviews = [
    { movieId: 'mov_jawan', userId: 'usr_priya', rating: 9, text: 'Mass entertainer. The interval block is worth the ticket alone.' },
    { movieId: 'mov_jawan', userId: 'usr_andrew', rating: 8, text: 'Great pace, brilliant background score.' },
    { movieId: 'mov_jawan', userId: 'usr_priya', rating: 9, text: 'SRK at his absolute best. The action sequences are top-notch and the emotional beats land perfectly.' },
    { movieId: 'mov_jawan', userId: 'usr_andrew', rating: 7, text: 'A few pacing issues in the second half, but the climax more than makes up for it. Must watch in theatres.' },
    { movieId: 'mov_jawan', userId: 'usr_priya', rating: 8, text: 'Atlee brings the south masala formula to Bollywood and it works brilliantly. Interval twist is chef\'s kiss.' },
    { movieId: 'mov_jawan', userId: 'usr_andrew', rating: 9, text: 'One of the best action films to come out of India. Every single penny of the ticket is worth it.' },
    { movieId: 'mov_jawan', userId: 'usr_priya', rating: 8, text: 'Nayanthara and Vijay Sethupathi are phenomenal. The soundtrack stays with you long after the movie ends.' },
    { movieId: 'mov_the-nun-ii', userId: 'usr_andrew', rating: 7, text: 'Genuinely creepy in places, but the plot drags mid-way.' },
    { movieId: 'mov_the-nun-ii', userId: 'usr_priya', rating: 6, text: 'Good jump scares but relies too much on the same formula. Taissa Farmiga carries the film.' },
    { movieId: 'mov_the-nun-ii', userId: 'usr_andrew', rating: 7, text: 'Better than the first one. The French setting adds atmosphere but the pacing could be tighter.' },
    { movieId: 'mov_the-nun-ii', userId: 'usr_priya', rating: 5, text: 'Started strong but fizzled out. The demon design is still fantastic though.' },
    { movieId: 'mov_the-nun-ii', userId: 'usr_andrew', rating: 6, text: 'A decent watch if you\'re a Conjuring universe fan. Don\'t expect anything groundbreaking.' },
    { movieId: 'mov_oppenheimer', userId: 'usr_priya', rating: 10, text: 'Watch it in IMAX. Cillian Murphy is extraordinary.' },
    { movieId: 'mov_oppenheimer', userId: 'usr_andrew', rating: 9, text: 'Nolan at his finest. The courtroom scenes are as tense as any thriller. 3 hours flew by.' },
    { movieId: 'mov_oppenheimer', userId: 'usr_priya', rating: 10, text: 'A masterpiece. The sound design alone deserves an Oscar. RDJ is unrecognisable and brilliant.' },
    { movieId: 'mov_oppenheimer', userId: 'usr_andrew', rating: 8, text: 'Dense and demanding but incredibly rewarding. Not a casual watch — bring your full attention.' },
    { movieId: 'mov_oppenheimer', userId: 'usr_priya', rating: 9, text: 'The Trinity test sequence is the most visceral thing I\'ve experienced in a cinema. Pure cinema.' },
    { movieId: 'mov_oppenheimer', userId: 'usr_andrew', rating: 9, text: 'Florence Pugh is underused but every other performance is career-best. Stunning photography.' },
    { movieId: 'mov_hu-ane-tu', userId: 'usr_priya', rating: 8, text: 'Sweet, funny and very relatable. Perfect family watch.' },
    { movieId: 'mov_hu-ane-tu', userId: 'usr_andrew', rating: 7, text: 'Wholesome Gujarati humour. The wedding chaos scenes had the entire theatre laughing.' },
    { movieId: 'mov_hu-ane-tu', userId: 'usr_priya', rating: 8, text: 'Finally a regional film that doesn\'t try to be Bollywood. Authentic, warm and genuinely funny.' },
    { movieId: 'mov_hu-ane-tu', userId: 'usr_andrew', rating: 7, text: 'Great chemistry between the leads. A few predictable moments but the charm makes up for it.' },
    { movieId: 'mov_hu-ane-tu', userId: 'usr_priya', rating: 9, text: 'Took my parents and they loved it. Clean comedy, no vulgarity, just good storytelling.' },
    { movieId: 'mov_leo', userId: 'usr_andrew', rating: 8, text: 'Lokesh Kanagaraj builds tension like nobody else. The cafe fight is an all-timer.' },
    { movieId: 'mov_leo', userId: 'usr_priya', rating: 9, text: 'Vijay in a completely different avatar. The LCU is becoming India\'s MCU and I\'m here for it.' },
    { movieId: 'mov_leo', userId: 'usr_andrew', rating: 7, text: 'First half is slow burn, second half is pure adrenaline. Anirudh\'s BGM elevates every scene.' },
    { movieId: 'mov_leo', userId: 'usr_priya', rating: 8, text: 'Sanjay Dutt as the villain is terrifying. The gore might put some people off but the story is solid.' },
    { movieId: 'mov_leo', userId: 'usr_andrew', rating: 8, text: 'Connected universe done right. You need to watch Kaithi and Vikram first for full impact.' },
    { movieId: 'mov_fukrey-3', userId: 'usr_priya', rating: 6, text: 'Good laughs but feels stretched. Varun Sharma is still the highlight.' },
    { movieId: 'mov_fukrey-3', userId: 'usr_andrew', rating: 5, text: 'The magic of the first film is missing. A few funny moments but overall forgettable.' },
    { movieId: 'mov_fukrey-3', userId: 'usr_priya', rating: 7, text: 'Choocha\'s dream sequences are hilarious. Don\'t expect depth, just turn off your brain and enjoy.' },
  ];
  reviews.forEach((r, i) =>
    db.insert('reviews', {
      id: `rev_${i + 1}`,
      movieId: r.movieId,
      userId: r.userId,
      rating: r.rating,
      text: r.text,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Showtimes - rolling window, idempotent
// ─────────────────────────────────────────────────────────────────────────────
function ensureRollingShowtimes() {
  const movies = db.get('movies').filter((m) => m.status === 'now_playing' && m.active !== false);
  const cinemas = db.get('cinemas').filter((c) => c.active !== false);
  const screens = db.get('screens').filter((s) => s.active !== false);
  if (!movies.length || !screens.length) return 0;

  const existing = new Set(db.get('showtimes').map((s) => `${s.screenId}|${s.date}|${s.time}`));
  const today = new Date();
  let created = 0;

  for (let dayOffset = -DAYS_BACK; dayOffset <= DAYS_AHEAD; dayOffset += 1) {
    const key = dateKey(addDays(today, dayOffset));

    cinemas.forEach((cinema, cinemaIdx) => {
      const cinemaScreens = screens.filter((s) => s.cinemaId === cinema.id);

      cinemaScreens.forEach((screen, screenIdx) => {
        SHOW_SLOTS.forEach((slot, slotIdx) => {
          const fingerprint = `${screen.id}|${key}|${slot}`;
          if (existing.has(fingerprint)) return;

          // Rotate movies so each screen shows a varied but stable line-up.
          const pick = movies[(cinemaIdx + screenIdx * 2 + slotIdx + Math.abs(dayOffset)) % movies.length];
          const start = atTime(key, slot);
          const end = new Date(start.getTime() + (pick.runtime + 25) * 60_000);
          const base = basePrice(cinema.brand, slot);

          const format = pick.formats.includes(screen.format) ? screen.format : pick.formats[0];
          const language = pick.languages[(screenIdx + slotIdx) % pick.languages.length];

          db.insert('showtimes', {
            id: db.id('sht'),
            movieId: pick.id,
            cinemaId: cinema.id,
            screenId: screen.id,
            date: key,
            time: slot,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            format,
            language,
            prices: screen.prices && Object.keys(screen.prices).length
              ? screen.prices
              : {
                  regular: base,
                  premium: Math.round(base * 1.5),
                  vip: Math.round(base * 2.2),
                },
            status: 'active',
          });
          existing.add(fingerprint);
          created += 1;
        });
      });
    });
  }

  // Prune shows older than the history window, unless a booking references them.
  const cutoff = dateKey(addDays(today, -DAYS_BACK));
  const referenced = new Set(db.get('bookings').map((b) => b.showtimeId).filter(Boolean));
  const kept = db.get('showtimes').filter((s) => s.date >= cutoff || referenced.has(s.id));
  if (kept.length !== db.get('showtimes').length) db.replace('showtimes', kept);

  if (created) console.log(`[seed] scheduled ${created} new showtime(s)`);
  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo bookings + notifications for the signed-in demo customer
// ─────────────────────────────────────────────────────────────────────────────
function seatsFor(showtimeId, seatIds) {
  const { seatIndex } = require('./seats');
  const { index } = seatIndex(showtimeId);
  return seatIds
    .filter((s) => index.has(s))
    .map((s) => {
      const seat = index.get(s);
      return { id: seat.id, row: seat.row, number: seat.number, tier: seat.tier, price: seat.price };
    });
}

function makeBooking({ userId, showtime, seatIds, status, food = [], offerCode = null, paymentLabel = 'HDFC Credit Card', reminder = false }) {
  const seats = seatsFor(showtime.id, seatIds);
  if (!seats.length) return null;
  const offer = offerCode ? db.findOne('offers', (o) => o.code === offerCode) : null;
  const amounts = computeTotals({ seats, food, offer });

  return db.insert('bookings', {
    id: db.id('bkg'),
    reference: db.reference('CF'),
    type: 'movie',
    userId,
    status,
    movieId: showtime.movieId,
    cinemaId: showtime.cinemaId,
    screenId: showtime.screenId,
    showtimeId: showtime.id,
    showDate: showtime.date,
    showTime: showtime.time,
    startsAt: showtime.startsAt,
    endsAt: showtime.endsAt,
    format: showtime.format,
    language: showtime.language,
    seats,
    food,
    amounts,
    offerCode: amounts.offerCode,
    payment: {
      method: 'card',
      methodLabel: paymentLabel,
      status: status === 'cancelled' ? 'refunded' : 'paid',
      transactionId: `TXN${db.reference('').slice(0, 10)}`,
      paidAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    reminder: { enabled: reminder, minutesBefore: 30 },
    cancelledAt: status === 'cancelled' ? new Date(Date.now() - 43_200_000).toISOString() : null,
    refundAmount: status === 'cancelled' ? Math.round(amounts.total * 0.75) : 0,
  });
}

function seedBookings() {
  const userId = 'usr_andrew';
  const showtimes = db.get('showtimes');
  const evening = (movieSlug, dayOffset) => {
    const key = dateKey(addDays(new Date(), dayOffset));
    return showtimes.find((s) => s.movieId === `mov_${movieSlug}` && s.date === key) || null;
  };
  const anyFor = (movieSlug, predicate) =>
    showtimes.find((s) => s.movieId === `mov_${movieSlug}` && predicate(s)) || null;

  const todayKey = dateKey(new Date());
  const upcoming = [
    { slug: 'jawan', seats: ['E5', 'E6'], reminder: false, food: [] },
    { slug: 'the-nun-ii', seats: ['F7', 'F8', 'F9'], reminder: true, food: [{ itemId: 'food_jumbo-popcorn', name: 'Jumbo Popcorn (Salted)', qty: 1, price: 350 }] },
    { slug: 'hu-ane-tu', seats: ['C4', 'C5'], reminder: false, food: [] },
  ];

  for (const item of upcoming) {
    const showtime =
      evening(item.slug, 1) || evening(item.slug, 2) || anyFor(item.slug, (s) => s.date > todayKey);
    if (!showtime) continue;
    makeBooking({
      userId,
      showtime,
      seatIds: item.seats,
      status: 'confirmed',
      food: item.food,
      reminder: item.reminder,
    });
  }

  const past = anyFor('oppenheimer', (s) => s.date < todayKey);
  if (past) makeBooking({ userId, showtime: past, seatIds: ['D6', 'D7'], status: 'completed', offerCode: 'CINEWED' });

  const cancelled = anyFor('leo', (s) => s.date >= todayKey);
  if (cancelled) makeBooking({ userId, showtime: cancelled, seatIds: ['B3', 'B4'], status: 'cancelled' });

  // A standalone food pickup order (My Tickets -> Food tab)
  const cinema = db.byId('cinemas', 'cin_pvr-icon-phoenix');
  const food = [
    { itemId: 'food_cheese-popcorn-combo', name: 'Cheese Popcorn + 2 Pepsi', qty: 1, price: 620 },
    { itemId: 'food_french-fries', name: 'Peri Peri French Fries', qty: 2, price: 220 },
  ];
  const amounts = computeTotals({ seats: [], food, offer: null });
  db.insert('bookings', {
    id: db.id('bkg'),
    reference: db.reference('FD'),
    type: 'food',
    userId,
    status: 'confirmed',
    cinemaId: cinema ? cinema.id : null,
    seats: [],
    food,
    amounts,
    offerCode: null,
    pickup: {
      cinemaName: cinema ? cinema.name : 'PVR ICON: Phoenix Mall',
      slot: '19:15',
      counter: 'Counter 3',
      date: dateKey(addDays(new Date(), 1)),
    },
    startsAt: atTime(dateKey(addDays(new Date(), 1)), '19:15').toISOString(),
    payment: {
      method: 'upi',
      methodLabel: 'Google Pay',
      status: 'paid',
      transactionId: `TXN${db.reference('').slice(0, 10)}`,
      paidAt: new Date().toISOString(),
    },
    reminder: { enabled: false, minutesBefore: 30 },
  });
}

function seedNotifications() {
  const items = [
    { userId: 'usr_andrew', title: 'Booking confirmed', body: 'Your seats for Jawan are locked in. Tap to view your ticket.', kind: 'booking', read: false },
    { userId: 'usr_andrew', title: '50% off every Wednesday', body: 'Use code CINEWED and save up to \u20B9250 on tickets.', kind: 'offer', read: false },
    { userId: 'usr_andrew', title: 'Animal tickets open soon', body: 'Booking opens 3 days before release. We will remind you.', kind: 'release', read: true },
    { userId: 'usr_andrew', title: 'Popcorn Party is live', body: 'Buy one jumbo tub, get one free this weekend.', kind: 'offer', read: true },
    { userId: 'usr_priya', title: 'Welcome to CineFlex', body: 'Your account is ready. Get 10% off your first booking.', kind: 'system', read: false },
  ];
  items.forEach((n, i) =>
    db.insert('notifications', {
      id: `ntf_${i + 1}`,
      userId: n.userId,
      title: n.title,
      body: n.body,
      kind: n.kind,
      read: n.read,
      createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    })
  );
}

function run() {
  seedUsers();
  seedMovies();
  seedCinemas();
  seedFood();
  seedOffers();
  seedReviews();
  ensureRollingShowtimes();
  seedBookings();
  seedNotifications();

  const meta = db.get('meta');
  meta.seededAt = new Date().toISOString();
  meta.appName = 'CineFlex';
  meta.currency = 'INR';
  meta.currencySymbol = '\u20B9';
  db.markDirty('meta');
  db.flushNow();

  console.log(
    `[seed] ${db.get('movies').length} movies, ${db.get('cinemas').length} cinemas, ` +
      `${db.get('showtimes').length} showtimes, ${db.get('foodItems').length} food items, ` +
      `${db.get('bookings').length} demo bookings.`
  );
}

module.exports = { run, ensureRollingShowtimes, dateKey, addDays };
