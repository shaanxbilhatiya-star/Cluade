const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');

function readJSON(file) {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── MOVIES ────────────────────────────────────────────────────────────────────
app.get('/api/movies', (req, res) => {
  const movies = readJSON('movies.json');
  const { status, genre, language } = req.query;
  let result = movies;
  if (status) result = result.filter(m => m.status === status);
  if (genre) result = result.filter(m => m.genre.includes(genre));
  if (language) result = result.filter(m => m.language.toLowerCase() === language.toLowerCase());
  res.json(result);
});

app.get('/api/movies/:id', (req, res) => {
  const movies = readJSON('movies.json');
  const movie = movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json(movie);
});

app.post('/api/movies', (req, res) => {
  const movies = readJSON('movies.json');
  const movie = { id: 'movie-' + uuidv4().slice(0, 8), ...req.body };
  movies.push(movie);
  writeJSON('movies.json', movies);
  res.status(201).json(movie);
});

app.put('/api/movies/:id', (req, res) => {
  const movies = readJSON('movies.json');
  const idx = movies.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Movie not found' });
  movies[idx] = { ...movies[idx], ...req.body, id: req.params.id };
  writeJSON('movies.json', movies);
  res.json(movies[idx]);
});

app.delete('/api/movies/:id', (req, res) => {
  let movies = readJSON('movies.json');
  const idx = movies.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Movie not found' });
  movies.splice(idx, 1);
  writeJSON('movies.json', movies);
  // Also remove associated showtimes
  let showtimes = readJSON('showtimes.json');
  showtimes = showtimes.filter(s => s.movieId !== req.params.id);
  writeJSON('showtimes.json', showtimes);
  res.json({ success: true });
});

// ── SHOWTIMES ─────────────────────────────────────────────────────────────────
app.get('/api/showtimes', (req, res) => {
  const showtimes = readJSON('showtimes.json');
  const { movieId, date } = req.query;
  let result = showtimes;
  if (movieId) result = result.filter(s => s.movieId === movieId);
  if (date) result = result.filter(s => s.date === date);
  res.json(result);
});

app.get('/api/showtimes/:id', (req, res) => {
  const showtimes = readJSON('showtimes.json');
  const show = showtimes.find(s => s.id === req.params.id);
  if (!show) return res.status(404).json({ error: 'Showtime not found' });
  res.json(show);
});

app.post('/api/showtimes', (req, res) => {
  const showtimes = readJSON('showtimes.json');
  const show = { id: 'show-' + uuidv4().slice(0, 8), bookedSeats: [], ...req.body };
  showtimes.push(show);
  writeJSON('showtimes.json', showtimes);
  res.status(201).json(show);
});

app.put('/api/showtimes/:id', (req, res) => {
  const showtimes = readJSON('showtimes.json');
  const idx = showtimes.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Showtime not found' });
  showtimes[idx] = { ...showtimes[idx], ...req.body, id: req.params.id };
  writeJSON('showtimes.json', showtimes);
  res.json(showtimes[idx]);
});

app.delete('/api/showtimes/:id', (req, res) => {
  let showtimes = readJSON('showtimes.json');
  const idx = showtimes.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Showtime not found' });
  showtimes.splice(idx, 1);
  writeJSON('showtimes.json', showtimes);
  res.json({ success: true });
});

// ── BOOKINGS ──────────────────────────────────────────────────────────────────
app.get('/api/bookings', (req, res) => {
  const bookings = readJSON('bookings.json');
  const { showtimeId, phone } = req.query;
  let result = bookings;
  if (showtimeId) result = result.filter(b => b.showtimeId === showtimeId);
  if (phone) result = result.filter(b => b.phone === phone);
  res.json(result);
});

app.get('/api/bookings/:id', (req, res) => {
  const bookings = readJSON('bookings.json');
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json(booking);
});

app.post('/api/bookings', (req, res) => {
  const { showtimeId, seats, name, phone, email } = req.body;
  if (!showtimeId || !seats || !seats.length || !name || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Check seat availability
  const showtimes = readJSON('showtimes.json');
  const showIdx = showtimes.findIndex(s => s.id === showtimeId);
  if (showIdx === -1) return res.status(404).json({ error: 'Showtime not found' });

  const show = showtimes[showIdx];
  const conflict = seats.filter(s => show.bookedSeats.includes(s));
  if (conflict.length > 0) {
    return res.status(409).json({ error: `Seats already booked: ${conflict.join(', ')}` });
  }

  // Compute pricing
  const premiumRows = ['A', 'B'];
  let total = 0;
  seats.forEach(seat => {
    const row = seat.charAt(0);
    total += premiumRows.includes(row) ? show.price.premium : show.price.normal;
  });

  // Create booking
  const bookings = readJSON('bookings.json');
  const booking = {
    id: 'BK' + Date.now().toString().slice(-8),
    showtimeId,
    seats,
    name,
    phone,
    email: email || '',
    total,
    bookedAt: new Date().toISOString(),
    status: 'confirmed'
  };
  bookings.push(booking);
  writeJSON('bookings.json', bookings);

  // Mark seats as booked in showtime
  showtimes[showIdx].bookedSeats = [...show.bookedSeats, ...seats];
  writeJSON('showtimes.json', showtimes);

  res.status(201).json(booking);
});

app.delete('/api/bookings/:id', (req, res) => {
  let bookings = readJSON('bookings.json');
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  const booking = bookings[idx];
  // Free up the seats
  const showtimes = readJSON('showtimes.json');
  const showIdx = showtimes.findIndex(s => s.id === booking.showtimeId);
  if (showIdx !== -1) {
    showtimes[showIdx].bookedSeats = showtimes[showIdx].bookedSeats.filter(
      s => !booking.seats.includes(s)
    );
    writeJSON('showtimes.json', showtimes);
  }

  bookings[idx].status = 'cancelled';
  writeJSON('bookings.json', bookings);
  res.json({ success: true });
});

// ── STATS (Admin Dashboard) ───────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const movies = readJSON('movies.json');
  const showtimes = readJSON('showtimes.json');
  const bookings = readJSON('bookings.json');

  const confirmedBookings = bookings.filter(b => b.status === 'confirmed');
  const totalRevenue = confirmedBookings.reduce((sum, b) => sum + (b.total || 0), 0);
  const totalSeatsBooked = confirmedBookings.reduce((sum, b) => sum + (b.seats?.length || 0), 0);

  // Revenue per movie
  const revenueByMovie = {};
  confirmedBookings.forEach(b => {
    const show = showtimes.find(s => s.id === b.showtimeId);
    if (show) {
      revenueByMovie[show.movieId] = (revenueByMovie[show.movieId] || 0) + b.total;
    }
  });

  res.json({
    totalMovies: movies.length,
    nowShowing: movies.filter(m => m.status === 'now_showing').length,
    totalShowtimes: showtimes.length,
    totalBookings: confirmedBookings.length,
    totalRevenue,
    totalSeatsBooked,
    revenueByMovie
  });
});

// ── SPA Fallbacks ─────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/book/*', (req, res) => res.sendFile(path.join(__dirname, 'public/user/book.html')));
app.get('/confirm/*', (req, res) => res.sendFile(path.join(__dirname, 'public/user/confirm.html')));

app.listen(PORT, () => {
  console.log(`\n🎬 Movie Booking System running at http://localhost:${PORT}`);
  console.log(`   Admin Panel  → http://localhost:${PORT}/admin`);
  console.log(`   User Portal  → http://localhost:${PORT}\n`);
});
