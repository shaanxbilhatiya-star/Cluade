# Movie Booking System

A mobile-first movie booking web application built with Node.js using zero external dependencies. Uses only Node.js built-in modules (`http`, `fs`, `path`, `url`, `crypto`).

## Features

- Browse now showing and coming soon movies
- Book movie tickets with seat selection
- Order food and beverages
- View and manage bookings (upcoming, past, cancelled)
- User account management
- Admin stats dashboard

## Getting Started

### Prerequisites

- Node.js v18 or higher

### Running the Server

```bash
cd movie-booking
node server.js
```

The server starts on `http://localhost:3000` by default. Set the `PORT` environment variable to use a different port:

```bash
PORT=8080 node server.js
```

### Project Structure

```
movie-booking/
├── server.js          # Main server (http module, routing, API handlers)
├── package.json       # Project metadata (no dependencies)
├── README.md          # This file
├── data/              # JSON file-based storage
│   ├── movies.json
│   ├── showtimes.json
│   ├── bookings.json
│   ├── food-items.json
│   └── users.json
└── public/            # Static frontend files (HTML/CSS/JS)
```

## API Endpoints

### Movies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/movies | List all movies (filter: status, genre, language) |
| GET | /api/movies/:id | Get single movie |
| POST | /api/movies | Create a new movie |
| PUT | /api/movies/:id | Update a movie |
| DELETE | /api/movies/:id | Delete a movie (removes associated showtimes) |

### Showtimes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/showtimes | List showtimes (filter: movieId, date) |
| GET | /api/showtimes/:id | Get single showtime |
| POST | /api/showtimes | Create a showtime |
| DELETE | /api/showtimes/:id | Delete a showtime |

### Bookings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/bookings | List bookings (filter: phone, showtimeId) |
| GET | /api/bookings/:id | Get single booking |
| POST | /api/bookings | Create a booking (validates seats, computes pricing) |
| DELETE | /api/bookings/:id | Cancel a booking (frees up seats) |

### Food

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/food-items | List food menu items (filter: category) |
| POST | /api/food-orders | Place a food order |
| GET | /api/food-orders | Get food orders (filter: phone) |

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users/:id | Get user profile |
| PUT | /api/users/:id | Update user profile |

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/stats | Admin dashboard stats |

## Booking Flow

1. Browse movies via GET /api/movies
2. Select a showtime via GET /api/showtimes?movieId=X
3. Book seats via POST /api/bookings with body:
   ```json
   {
     "showtimeId": "show-001",
     "seats": ["A1", "A2"],
     "seatType": "standard",
     "name": "John Doe",
     "phone": "1234567890"
   }
   ```
4. Optionally order food via POST /api/food-orders

## Technical Details

- Zero external dependencies - uses only Node.js built-in modules
- File-based JSON storage (reads/writes to data/ directory)
- Atomic file writes (write to temp file, then rename) to prevent data corruption
- XSS protection via escapeHTML utility on all server-returned strings
- CORS enabled for all origins
- UUID generation via crypto.randomBytes
- Input validation on all endpoints
- Seat availability checking with conflict detection
- Automatic price calculation based on seat type
- Phone number stored in localStorage for ticket lookup (no hardcoded values)
- Body parser with 1MB limit and proper stream cleanup on oversize requests

## Known Limitations

- **No authentication/authorization**: This is a local demo/prototype. All API endpoints are publicly accessible. In a production system, you would add user sessions, JWT tokens, or similar authentication for write operations (booking, profile updates, movie management).
- **File-based storage**: Suitable for single-instance deployments. Not appropriate for multi-instance or high-concurrency production use.
- **No HTTPS**: Run behind a reverse proxy (nginx, Caddy) for TLS in production.
