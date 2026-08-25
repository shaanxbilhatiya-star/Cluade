# 🎬 CineBook — Movie Booking System

A full-stack movie booking system built with **Node.js + Express**, featuring a rich user portal and a complete admin panel. Data is stored in local JSON files — no database required.

---

## 🚀 Quick Start

**Windows:**
```
Double-click START-WINDOWS.bat
```

**Mac / Linux:**
```bash
chmod +x START-LINUX-MAC.sh
./START-LINUX-MAC.sh
```

**Manual:**
```bash
npm install
node server.js
```

Then visit:
- **User Portal** → http://localhost:3000
- **Admin Panel** → http://localhost:3000/admin

---

## 📁 Project Structure

```
movie-booking/
├── server.js              # Express backend (all API routes)
├── package.json
├── data/
│   ├── movies.json        # Movie catalogue
│   ├── showtimes.json     # Screenings & seat availability
│   └── bookings.json      # Confirmed/cancelled bookings
└── public/
    ├── index.html         # User homepage (browse movies)
    ├── admin/
    │   └── index.html     # Admin dashboard
    └── user/
        ├── book.html      # Seat selection page
        ├── confirm.html   # Booking confirmation ticket
        └── my-bookings.html  # Customer booking lookup
```

---

## ✨ Features

### User Portal
- Browse now-showing & coming-soon movies
- Filter by status, select date
- View movie details + available showtimes
- Interactive seat map with premium (A-B) and normal rows
- Real-time seat availability
- Booking confirmation ticket (printable)
- Look up bookings by phone number
- Cancel bookings

### Admin Panel
- Dashboard with live stats (revenue, bookings, seats sold)
- Full movie CRUD (add/edit/delete with poster URL)
- Showtime management (per screen, date, time, pricing)
- All bookings table with search & filter
- Cancel any booking from admin

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/movies` | List movies (filter: status, genre, language) |
| POST | `/api/movies` | Add a movie |
| PUT | `/api/movies/:id` | Update movie |
| DELETE | `/api/movies/:id` | Delete movie |
| GET | `/api/showtimes` | List showtimes (filter: movieId, date) |
| POST | `/api/showtimes` | Add showtime |
| PUT | `/api/showtimes/:id` | Update showtime |
| DELETE | `/api/showtimes/:id` | Delete showtime |
| GET | `/api/bookings` | List bookings (filter: showtimeId, phone) |
| POST | `/api/bookings` | Create booking |
| DELETE | `/api/bookings/:id` | Cancel booking |
| GET | `/api/stats` | Dashboard statistics |

---

## 💺 Seat Layout

Each screen has **60 seats** across 8 rows (A–H) × 10 columns.

- **Rows A–B**: Premium seats (higher price)
- **Rows C–H**: Normal seats
- Max **8 seats per booking**
