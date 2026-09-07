# 🎬 CineFlex — Movie Ticket Booking System

A complete movie booking platform: a **mobile-only customer app**, a **desktop admin console**, and a **REST API** — all served by a single Node.js process with **zero npm dependencies**.

```bash
node server.js        # → http://localhost:3000
```

No `npm install`. No database to set up. No build step.

| Surface | URL | Purpose |
|---|---|---|
| Customer app | `http://localhost:3000/` | Phone-first booking experience |
| Admin console | `http://localhost:3000/admin/` | Catalogue, scheduling, bookings, reporting |
| REST API | `http://localhost:3000/api/health` | JSON API used by both front ends |

**Demo logins**

| Role | Email | Password |
|---|---|---|
| Customer | `andrew@example.com` | `1234` |
| Admin | `admin@cineflex.com` | `admin123` |

---

## Getting started

**Requirements:** Node.js 18 or newer. That's it.

```bash
node server.js
```

Or double-click **`START-WINDOWS.bat`** (Windows) / run **`./START-LINUX-MAC.sh`** (macOS, Linux). Both check for Node, start the server and open your browser.

On first run the server seeds a full demo catalogue — 11 movies, 5 cinemas, 12 screens, ~790 showtimes, 14 food items, 5 offers and some example bookings — into `data/*.json`.

### Testing on a real phone

Start the server and read the LAN address it prints:

```
On your phone (same Wi-Fi):
   http://192.168.1.24:3000/
```

Open that on your phone (same network). The customer UI is designed phone-first; on a desktop browser it renders inside a phone frame, because that is the intended form factor.

### Useful commands

```bash
npm start          # node server.js
npm test           # end-to-end API smoke test (134 assertions)
npm run seed       # wipe data/ and re-seed the demo catalogue
npm run assets     # regenerate the SVG artwork
PORT=8080 node server.js
```

---

## Deploying

The app is a single Node process that serves its own front end, so most
platforms need no configuration beyond "run `node server.js`".

- It binds `0.0.0.0` and reads **`PORT`** from the environment, so platform-assigned ports work as-is.
- There are **no dependencies to install**, so builds are near-instant.
- `/api/health` is a ready-made health check endpoint.

### Railway

Deploy the repository as-is. `railway.json` already sets the start command and
health check, and `package.json` at the repository root is what tells the
builder this is a Node app — so the project must be deployed from the root, not
from a subdirectory. If you point Railway at a subdirectory (or the app is
nested), the builder reports *"could not determine how to build the app"*.

### Persisting data between deploys

`data/` is the database, and it is deliberately git-ignored. On a platform with
an ephemeral filesystem (Railway, Render, Fly, Heroku) the directory is
recreated and **re-seeded with the demo catalogue on every deploy** — which is
usually what you want for a demo, and definitely not what you want in
production.

To keep real bookings, mount a persistent volume and point the app at it:

```bash
DATA_DIR=/data node server.js
```

`DATA_DIR` overrides where the JSON collections live (see `src/db.js`). On
Railway: add a volume, mount it at `/data`, and set `DATA_DIR=/data`.

For anything beyond a single cinema, replace `src/db.js` with a real database —
the in-memory cache means only one server process can safely own the data, so
the app cannot be scaled to multiple replicas as-is.

---

## The customer app

Mobile-only, five tabs, dark mode throughout.

**Home** — city picker, notification bell with unread badge, auto-playing hero carousel, "Your next show" card, *Now Playing* and *Coming Soon* rails with **View All**, personalised "Because you like…" rail, offer banners, nearby cinemas.

**Cinemas** — nearby cinemas with distance, rating, formats and facilities; tap through to a cinema's day-by-day schedule grouped by movie.

**Food Order** — offer-banner carousel, category rails (*Most Popular*, *New Beverages*, *Value Combos*…), item detail pages, a persistent cart, and checkout with cinema + pickup-slot selection.

**My Tickets** — `Upcoming / Passed / Canceled` tabs × `Movie / Food / Event` filters, per-booking **"Remind me 30 minutes earlier"** toggle, and a full ticket view with a scannable barcode, itemised bill and cancellation.

**Account** — Watchlist, Movie Interest, Payment Methods, Personal Info, Notification preferences, Security (password change), Language, **Dark Mode** toggle, Help Center, About, and a membership card with its own barcode.

**Booking flow** — movie detail (synopsis, cast, reviews, trailer, watchlist) → date + cinema + showtime → **seat map** (screen curve, aisles, Regular/Premium/VIP tiers, live availability) → **10-minute seat hold with a live countdown** → optional snacks, offer code, payment method → confirmation with barcode.

## The admin console

Dashboard (revenue, 7-day trend, occupancy, top movies) · Movies CRUD · Cinemas CRUD · Screens with seat-layout presets · Showtimes (manual + auto-scheduler, clash detection) · Bookings (search, check-in, cancel) · **Verify Ticket** gate scanner · Food CRUD · Offers CRUD · Customers (spend, points, enable/disable).

---

## How it works

```
.
├── server.js              HTTP server, routing, static hosting, SPA fallback
├── src/
│   ├── router.js           Express-like router built on node:http
│   ├── http.js             Body parsing, JSON responses, safe static serving
│   ├── db.js               JSON datastore: in-memory reads, atomic writes
│   ├── auth.js             scrypt password hashing + HMAC session tokens
│   ├── pricing.js          Single source of truth for money
│   ├── seats.js            Seat maps, availability, temporary holds
│   ├── barcode.js          Code 39 barcode renderer (SVG)
│   ├── catalog.js          Demo catalogue + seat-layout presets
│   ├── seed.js             First-run seeding + rolling showtime schedule
│   └── routes/             auth · home · movies · cinemas · showtimes ·
│                           bookings · food · users · admin
├── public/
│   ├── index.html          Customer app shell
│   ├── css/app.css         Design system (light + dark via CSS variables)
│   ├── js/                 api · ui · icons · app (router) · screens/*
│   ├── admin/              Admin console
│   └── img/                Generated SVG artwork
├── tools/
│   ├── generate-assets.js  Draws all posters, food art, banners, avatars
│   └── smoke-test.js       End-to-end API test
└── data/                   Runtime JSON database (git-ignored)
```

### Notable decisions

**Zero dependencies.** Everything uses Node's standard library, so the project runs on any machine with Node installed — no install step, no lockfile drift, nothing to audit. The trade-offs: a small hand-written router (`src/router.js`) instead of Express, and scrypt/HMAC (`src/auth.js`) instead of bcrypt/jsonwebtoken.

**JSON file storage.** `src/db.js` loads each collection into memory once, serves reads from there, and persists with debounced *atomic* writes (write to a temp file, then rename) so a crash can never leave a half-written file. A corrupt file is moved aside rather than crashing the server. Good for a demo or a single-cinema deployment; swap this one module for SQLite or Postgres to scale out.

**Seat holds, not optimistic booking.** Picking seats creates a 10-minute hold (`src/seats.js`). Other users immediately see those seats as unavailable, the checkout screen counts down, expired holds are reaped every 30 seconds, and checkout re-validates availability before writing the booking — so two people racing for the last seat get a clear 409 instead of a double sale.

**Money is computed server-side only.** `src/pricing.js` owns ticket subtotals, the ₹30/seat convenience fee, 18% GST on that fee and offer discounts. The client asks `POST /api/bookings/quote` for a preview and never computes a payable amount itself. All amounts are whole rupees, so a receipt's parts always sum exactly to its total.

**Deletes protect paid tickets.** Deleting a movie, cinema, screen or showtime that has confirmed bookings *archives* it instead, and the API says so in the response. Paid tickets are never orphaned.

**Artwork is generated, not downloaded.** `tools/generate-assets.js` draws every poster, backdrop, food illustration, banner and avatar as an SVG (49 files). The app therefore looks complete with no internet access and no binary blobs in git. Food art is hand-drawn vector — not emoji — because emoji render as empty boxes wherever a colour-emoji font is missing. Any movie's `posterUrl` can be pointed at a real remote image from the admin panel; the UI falls back to the generated art if that image fails to load.

**Barcodes, not QR codes.** Tickets carry a real [Code 39](https://en.wikipedia.org/wiki/Code_39) barcode rendered server-side (`src/barcode.js`) — the symbology cinemas and event venues most commonly use for printed tickets. It needs no error-correction tables and encodes our booking references exactly. QR would need a third-party library, which would break the zero-dependency guarantee; if you want QR, add a library and swap the `/api/bookings/:id/barcode.svg` handler.

**Rolling schedule.** Every boot tops the schedule up to 7 days ahead and keeps 3 days of history (`ensureRollingShowtimes`), so the app is never empty no matter when you start it. Showtimes referenced by a booking are never pruned.

---

## API reference

All responses are JSON. Authenticated routes take `Authorization: Bearer <token>`.

### Auth
| Method | Endpoint | Notes |
|---|---|---|
| `POST` | `/api/auth/register` | `{name, email, phone, password}` → `{token, user}` |
| `POST` | `/api/auth/login` | Accepts email **or** phone |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/change-password` | |

### Discovery
| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/home?city=` | Everything the Home screen needs, one request |
| `GET` | `/api/search?q=` | Movies + cinemas + food |
| `GET` | `/api/movies` | `?status=&genre=&language=&q=&city=&sort=&limit=` |
| `GET` | `/api/movies/:id` | Detail + reviews + where it's playing |
| `GET` | `/api/movies/:id/showtimes` | `?date=&city=` grouped by cinema |
| `POST` | `/api/movies/:id/reviews` | 🔒 rating 1–10 |
| `GET` | `/api/cinemas` | `?city=&q=&movieId=` |
| `GET` | `/api/cinemas/:id/showtimes` | `?date=` grouped by movie |
| `GET` | `/api/showtimes/:id/seats` | Full seat map with tiers and status |

### Booking
| Method | Endpoint | Notes |
|---|---|---|
| `POST` | `/api/showtimes/:id/hold` | 🔒 `{seats:[...]}` → 10-minute hold; `409` on conflict |
| `GET`/`DELETE` | `/api/holds/:id` | 🔒 Inspect / release a hold |
| `POST` | `/api/bookings/quote` | 🔒 Price preview |
| `POST` | `/api/offers/validate` | 🔒 Check an offer code against a cart |
| `POST` | `/api/bookings` | 🔒 `{holdId, food, offerCode, payment}` → ticket |
| `POST` | `/api/bookings/food` | 🔒 Standalone food pickup order |
| `GET` | `/api/bookings` | 🔒 `?bucket=upcoming|passed|cancelled&type=movie|food` |
| `GET` | `/api/bookings/:id` | 🔒 By id **or** booking reference |
| `GET` | `/api/bookings/:id/barcode.svg` | Ticket barcode (public, for gate scanners) |
| `POST` | `/api/bookings/:id/cancel` | 🔒 75% refund, blocked inside 2h of showtime |
| `PATCH` | `/api/bookings/:id/reminder` | 🔒 Reminder toggle |

### Food & account
`GET /api/food/home` · `GET /api/food` · `GET /api/food/:id` · `GET /api/offers` ·
`GET|PATCH /api/me` · `PATCH /api/me/settings` · `GET|POST|DELETE /api/me/watchlist` ·
`GET|PUT /api/me/interests` · `GET|POST|DELETE /api/me/payment-methods` ·
`GET /api/me/notifications` · `POST /api/me/notifications/read`

### Admin (🔒 admin role)
`GET /api/admin/stats` · CRUD on `/api/admin/{movies,cinemas,screens,showtimes,food,offers}` ·
`POST /api/admin/showtimes/generate` · `GET /api/admin/bookings` · `GET /api/admin/users` ·
`POST /api/admin/users/:id/toggle` · `GET /api/admin/verify/:reference` ·
`POST /api/admin/bookings/:id/checkin`

---

## Testing

```bash
npm test
```

Spawns the server against a throwaway data directory (your real `data/` is untouched) and runs ~140 assertions across the whole journey: catalogue filters, auth and token tampering, seat maps, hold conflicts between two users, spent-hold reuse, pricing arithmetic, offer validation, checkout, barcode rendering, cancellation and seat release, account features, every admin CRUD path, archive-instead-of-delete protection, and error handling (404 / 405 / malformed JSON / path traversal).

---

## Notes & limits

- **Payments are simulated.** No gateway is integrated; card numbers are never collected or stored — saved methods keep only a label, brand and last four digits. Wire up a real gateway in `paymentRecord()` (`src/routes/bookings.routes.js`) before taking money.
- **Reminders are stored, not delivered.** The toggle persists the preference; sending push/email needs a notification provider.
- **Single-process design.** The in-memory cache means one server process owns the data. Run one instance, or move `src/db.js` to a real database first.
- **Movie titles and artwork are placeholders** generated locally for demonstration.

## Licence

MIT.
