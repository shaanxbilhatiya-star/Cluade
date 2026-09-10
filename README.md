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
npm start              # node server.js
npm test               # end-to-end API smoke test (134 assertions)
npm run test:dine-in   # Dine-In tab, end to end (90 assertions)
npm run test:waterpark # Water park tab, end to end (152 assertions)
npm run test:promos    # Tab sliders, end to end (59 assertions)
npm run test:ui        # renders the admin console + app in headless Chrome (224 assertions)
npm run seed           # wipe data/ and re-seed the demo catalogue
npm run assets         # regenerate the SVG artwork
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

Two things have to survive a redeploy, and **both** live under one directory
(see `src/storage.js`):

| What | Where | Contains |
|---|---|---|
| Database | `<data dir>/*.json` | bookings, room types, prices, users, admin edits |
| Uploads | `<data dir>/uploads/` | photos uploaded from the admin panel |

On a platform with an ephemeral filesystem (Railway, Render, Fly, Heroku) the
deployed app directory is rebuilt from the repo on every deploy. Anything stored
inside it is **erased** — bookings reset to the demo catalogue and uploaded
photos disappear.

**Attach a volume and you are done.** Railway sets `RAILWAY_VOLUME_MOUNT_PATH`
automatically when a volume is attached, and the app picks it up with no extra
configuration:

1. Right-click the service → **Attach volume**, mount path `/data`.
2. Redeploy.

The boot log then confirms it:

```
[storage] persistent  data=/data  uploads=/data/uploads
```

If no volume is detected it says so loudly instead:

```
⚠  [storage] EPHEMERAL STORAGE — bookings and uploaded photos will be
   lost on the next deploy.
```

`GET /api/health` reports the same thing under `storage`, so you can check from
a browser without opening the logs.

Overrides, in order of precedence:

| Variable | Effect |
|---|---|
| `DATA_DIR` | Where the JSON collections live |
| `UPLOAD_DIR` | Where uploads live (defaults to `<DATA_DIR>/uploads`) |
| `RAILWAY_VOLUME_MOUNT_PATH` | Set by Railway; used automatically |
| `VOLUME_PATH` | Same idea, for other hosts |

```bash
DATA_DIR=/data node server.js   # equivalent to attaching a volume at /data
```

Uploaded images are served from `/uploads/...` off that disk, **not** from
`public/`. Photos uploaded by older builds (which wrote into `public/img/`) are
migrated automatically on the next boot.

For anything beyond a single cinema, replace `src/db.js` with a real database —
the in-memory cache means only one server process can safely own the data, so
the app cannot be scaled to multiple replicas as-is.

---

## The customer app

Mobile-only, six tabs, dark mode throughout.

Movie, Stay, Dine-In and Water Park can each open with an **auto-scrolling photo slider**, built from photos the admin uploads (see *Tab Sliders* below). It advances on its own, pauses while a guest is swiping, and is absent entirely until photos are added.

**Home** — city picker, notification bell with unread badge, auto-playing hero carousel, "Your next show" card, *Now Playing* and *Coming Soon* rails with **View All**, personalised "Because you like…" rail, offer banners, nearby cinemas.

**Cinemas** — nearby cinemas with distance, rating, formats and facilities; tap through to a cinema's day-by-day schedule grouped by movie.

**Food Order** — offer-banner carousel, category rails (*Most Popular*, *New Beverages*, *Value Combos*…), item detail pages, a persistent cart, and checkout with cinema + pickup-slot selection.

**Water Park** — the *Family Fun Day* tab. All-in-one family packages, each showing its full value breakup (every line, its quantity, its rate and its value) so the guest can see why the flat price is a saving; or **build the day person by person** from the same rate card with every quantity editable. Add-ons (fish spa, bull ride, massage chair, photography) on top of either, entry-slot capacity, and a day pass with a scannable gate barcode. Totals are always quoted by the server, so the price shown is the price charged.

**My Tickets** — `Upcoming / Passed / Canceled` tabs × `Movie / Food / Event` filters, per-booking **"Remind me 30 minutes earlier"** toggle, and a full ticket view with a scannable barcode, itemised bill and cancellation.

**Account** — everything the guest has booked, grouped by where they booked it: **Movie Tickets** and **Movie Food & Beverages**, then **Hotel Reservations** and **Restaurant Reservations**, then **Waterpark Bookings**. Below that, *General* (Personal Info, Notification preferences, Security, Language, **Dark Mode** toggle) and *About* (Help Center, About, Log Out), plus a membership card with its own barcode.

The first three rows deep-link into My Tickets filtered by type (`#/tickets?type=movie|food|hotel`), because movie, food and hotel bookings share one polymorphic collection. Dine-in and the water park keep their own collections, so they get their own list screens (`/account/restaurant`, `/account/waterpark`) that open the existing bill and pass screens.

**Booking flow** — movie detail (synopsis, cast, reviews, trailer) → date + cinema + showtime → **seat map** (screen curve, aisles, Regular/Premium/VIP tiers, live availability) → **10-minute seat hold with a live countdown** → optional snacks, offer code, payment method → confirmation with barcode.

## The admin console

Dashboard (revenue, 7-day trend, occupancy, top movies) · Movies CRUD · Cinemas CRUD · Screens with seat-layout presets · Showtimes (manual + auto-scheduler, clash detection) · Bookings (search, check-in, cancel) · **Verify Ticket** gate scanner · Hotel & Rooms · Dine-In · **Water Park** · **Tab Sliders** · Food CRUD · Offers CRUD · Customers (spend, enable/disable).

**Tab Sliders** manages the auto-scrolling photo strip at the top of the Movie, Stay, Dine-In and Water Park tabs. Pick a tab, add photos, set the seconds per photo, save. It uses the same multi-photo picker as the hotel's *Property photos*, so slider photos are managed exactly like property photos: any size or ratio, uploaded at full quality, shown whole rather than cropped, first photo first. Nothing is drawn over a photo — these are finished creatives. A tab with no photos shows no slider at all, and the whole strip can be switched off per tab.

**Water Park** is a full operations console for the tab: one editable **rate card** that every package line and every per-person booking is priced from, so changing the adult entry rate reprices both packages and the per-person builder at once. Packages are edited as quantities against that rate card — the total actual value and the "you save" figure are computed, never typed, and the editor recomputes them as you type while warning if a package is priced above its own parts or carries the wrong number of entry tickets. Plus add-on pricing, opening hours and slot capacity, admin-editable customer notices with `{token}` substitution, a live gate-load view, a filterable pass ledger with check-in, and **counter sales** — sell a walk-up pass (package or per person) with a live server-priced total and no customer account needed.

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
`GET|PATCH /api/me` · `PATCH /api/me/settings` ·
`GET /api/me/notifications` · `POST /api/me/notifications/read`

### Tab sliders
`GET /api/promos` · `GET /api/promos/:section` — each returns `{ active, intervalMs, photos }`, and the
same block is embedded as `slider` in `/api/home`, `/api/hotels`, `/api/dine-in` and `/api/waterpark`,
so a tab needs no extra request.

### Water park
`GET /api/waterpark` · `GET /api/waterpark/slots` · `POST /api/waterpark/quote` ·
`POST /api/waterpark/offers/validate` · `GET|POST /api/waterpark/bookings` 🔒 ·
`GET /api/waterpark/bookings/:id` 🔒 · `POST /api/waterpark/bookings/:id/cancel` 🔒 ·
`GET /api/waterpark/bookings/:id/barcode.svg`

### Admin (🔒 admin role)
`GET /api/admin/stats` · CRUD on `/api/admin/{movies,cinemas,screens,showtimes,food,offers}` ·
`GET /api/admin/promos` · `PUT /api/admin/promos/:section` ·
`GET|PUT /api/admin/waterpark[/settings]` · CRUD on `/api/admin/waterpark/{items,packages,addons}` ·
`POST /api/admin/waterpark/{quote,bookings,notices/reset,reset}` ·
`POST /api/admin/waterpark/bookings/:id/{checkin,undo-checkin,cancel}` ·
`POST /api/admin/showtimes/generate` · `GET /api/admin/bookings` · `GET /api/admin/users` ·
`POST /api/admin/users/:id/toggle` · `GET /api/admin/verify/:reference` ·
`POST /api/admin/bookings/:id/checkin`

---

## Testing

```bash
npm test
```

Every suite spawns the server against a throwaway data directory, so your real `data/` is never touched.

`npm run test:waterpark` proves the package arithmetic the poster advertises (Package A is worth ₹2,450, sells for ₹1,499 and saves ₹951; Package B ₹3,200 / ₹1,799 / ₹1,401), that a per-person booking is charged counter rates and saves nothing, that nobody gets through the gate without an entry ticket, and that editing a rate in the admin API moves both packages and the per-person builder immediately.

`npm run test:ui` renders the admin console and the customer app in headless Chrome (driven over the DevTools Protocol with no browser-automation dependency) and asserts against the real DOM — including a complete counter sale and a complete customer booking. It fails on any console error or uncaught exception, which is what catches a screen that loads but is quietly broken. Add `-- --shots` to write PNGs to `tools/screenshots/`.

`npm test` runs 134 assertions across the whole movie journey: catalogue filters, auth and token tampering, seat maps, hold conflicts between two users, spent-hold reuse, pricing arithmetic, offer validation, checkout, barcode rendering, cancellation and seat release, account features, every admin CRUD path, archive-instead-of-delete protection, and error handling (404 / 405 / malformed JSON / path traversal).

---

## Notes & limits

- **Payments are simulated.** No gateway is integrated and card numbers are never collected or stored — the guest picks a method (UPI, card, net banking, or pay at the counter) and the booking records that choice. Wire up a real gateway in `paymentRecord()` (`src/bookings.js`) before taking money.
- **There is no loyalty-points scheme.** Bookings are not scored and nothing is accrued or redeemed; the membership card is only an identity barcode for collecting tickets at the counter.
- **Reminders are stored, not delivered.** The toggle persists the preference; sending push/email needs a notification provider.
- **Single-process design.** The in-memory cache means one server process owns the data. Run one instance, or move `src/db.js` to a real database first.
- **Movie titles and artwork are placeholders** generated locally for demonstration.

## Licence

MIT.
