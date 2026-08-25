const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// --- Data helpers ---
const DATA_DIR = path.join(__dirname, 'data');

function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err.message);
    return [];
  }
}

function writeJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

// --- MIME types for static file serving ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

// --- Response helpers ---
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

function addCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// --- Body parser ---
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Limit body size to 1MB
      if (body.length > 1048576) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// --- Static file server ---
function serveStaticFile(req, res, pathname) {
  // Default to index.html
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const filePath = path.join(__dirname, 'public', pathname);

  // Prevent directory traversal
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(path.join(__dirname, 'public'))) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  fs.stat(normalizedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If file not found, try serving index.html for SPA routing
      const indexPath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(indexPath, (err2, data) => {
        if (err2) {
          sendError(res, 404, 'Not Found');
          return;
        }
        addCORSHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(normalizedPath, (readErr, data) => {
      if (readErr) {
        sendError(res, 500, 'Internal Server Error');
        return;
      }
      addCORSHeaders(res);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

// --- Route matching helper ---
function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// --- API Route Handlers ---

// MOVIES
function handleGetMovies(req, res, query) {
  let movies = readJSON('movies.json');

  if (query.status) {
    movies = movies.filter(m => m.status === query.status);
  }
  if (query.genre) {
    movies = movies.filter(m => m.genre.toLowerCase() === query.genre.toLowerCase());
  }
  if (query.language) {
    movies = movies.filter(m => m.language.toLowerCase() === query.language.toLowerCase());
  }

  sendJSON(res, 200, movies);
}

function handleGetMovieById(req, res, params) {
  const movies = readJSON('movies.json');
  const movie = movies.find(m => m.id === params.id);
  if (!movie) {
    sendError(res, 404, 'Movie not found');
    return;
  }
  sendJSON(res, 200, movie);
}

async function handleCreateMovie(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.title || !body.genre || !body.language) {
      sendError(res, 400, 'Missing required fields: title, genre, language');
      return;
    }

    const movies = readJSON('movies.json');
    const newMovie = {
      id: generateId('movie'),
      title: body.title,
      genre: body.genre,
      duration: body.duration || 120,
      rating: body.rating || 0,
      language: body.language,
      description: body.description || '',
      cast: body.cast || [],
      director: body.director || '',
      poster: body.poster || 'poster-default',
      status: body.status || 'coming_soon',
      releaseDate: body.releaseDate || new Date().toISOString().split('T')[0]
    };

    movies.push(newMovie);
    writeJSON('movies.json', movies);
    sendJSON(res, 201, newMovie);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

async function handleUpdateMovie(req, res, params) {
  try {
    const body = await parseBody(req);
    const movies = readJSON('movies.json');
    const index = movies.findIndex(m => m.id === params.id);

    if (index === -1) {
      sendError(res, 404, 'Movie not found');
      return;
    }

    const updatedMovie = { ...movies[index], ...body, id: params.id };
    movies[index] = updatedMovie;
    writeJSON('movies.json', movies);
    sendJSON(res, 200, updatedMovie);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

function handleDeleteMovie(req, res, params) {
  const movies = readJSON('movies.json');
  const index = movies.findIndex(m => m.id === params.id);

  if (index === -1) {
    sendError(res, 404, 'Movie not found');
    return;
  }

  movies.splice(index, 1);
  writeJSON('movies.json', movies);

  // Also remove associated showtimes
  let showtimes = readJSON('showtimes.json');
  showtimes = showtimes.filter(s => s.movieId !== params.id);
  writeJSON('showtimes.json', showtimes);

  sendJSON(res, 200, { message: 'Movie deleted successfully' });
}

// SHOWTIMES
function handleGetShowtimes(req, res, query) {
  let showtimes = readJSON('showtimes.json');

  if (query.movieId) {
    showtimes = showtimes.filter(s => s.movieId === query.movieId);
  }
  if (query.date) {
    showtimes = showtimes.filter(s => s.date === query.date);
  }

  sendJSON(res, 200, showtimes);
}

function handleGetShowtimeById(req, res, params) {
  const showtimes = readJSON('showtimes.json');
  const showtime = showtimes.find(s => s.id === params.id);
  if (!showtime) {
    sendError(res, 404, 'Showtime not found');
    return;
  }
  sendJSON(res, 200, showtime);
}

async function handleCreateShowtime(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.movieId || !body.date || !body.time || !body.screen) {
      sendError(res, 400, 'Missing required fields: movieId, date, time, screen');
      return;
    }

    // Verify movie exists
    const movies = readJSON('movies.json');
    if (!movies.find(m => m.id === body.movieId)) {
      sendError(res, 404, 'Movie not found');
      return;
    }

    const showtimes = readJSON('showtimes.json');
    const newShowtime = {
      id: generateId('show'),
      movieId: body.movieId,
      screen: body.screen,
      date: body.date,
      time: body.time,
      endTime: body.endTime || '',
      price: body.price || { standard: 200, premium: 400, vip: 600 },
      totalSeats: body.totalSeats || 100,
      bookedSeats: [],
      cinema: body.cinema || 'PVR Cinemas'
    };

    showtimes.push(newShowtime);
    writeJSON('showtimes.json', showtimes);
    sendJSON(res, 201, newShowtime);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

function handleDeleteShowtime(req, res, params) {
  const showtimes = readJSON('showtimes.json');
  const index = showtimes.findIndex(s => s.id === params.id);

  if (index === -1) {
    sendError(res, 404, 'Showtime not found');
    return;
  }

  showtimes.splice(index, 1);
  writeJSON('showtimes.json', showtimes);
  sendJSON(res, 200, { message: 'Showtime deleted successfully' });
}

// BOOKINGS
function handleGetBookings(req, res, query) {
  let bookings = readJSON('bookings.json');

  if (query.phone) {
    bookings = bookings.filter(b => b.phone === query.phone);
  }
  if (query.showtimeId) {
    bookings = bookings.filter(b => b.showtimeId === query.showtimeId);
  }

  sendJSON(res, 200, bookings);
}

function handleGetBookingById(req, res, params) {
  const bookings = readJSON('bookings.json');
  const booking = bookings.find(b => b.id === params.id);
  if (!booking) {
    sendError(res, 404, 'Booking not found');
    return;
  }
  sendJSON(res, 200, booking);
}

async function handleCreateBooking(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.showtimeId || !body.seats || !body.name || !body.phone) {
      sendError(res, 400, 'Missing required fields: showtimeId, seats, name, phone');
      return;
    }

    if (!Array.isArray(body.seats) || body.seats.length === 0) {
      sendError(res, 400, 'Seats must be a non-empty array');
      return;
    }

    // Get showtime and validate seats
    const showtimes = readJSON('showtimes.json');
    const showtimeIndex = showtimes.findIndex(s => s.id === body.showtimeId);

    if (showtimeIndex === -1) {
      sendError(res, 404, 'Showtime not found');
      return;
    }

    const showtime = showtimes[showtimeIndex];

    // Check if seats are already booked
    const alreadyBooked = body.seats.filter(seat => showtime.bookedSeats.includes(seat));
    if (alreadyBooked.length > 0) {
      sendError(res, 409, `Seats already booked: ${alreadyBooked.join(', ')}`);
      return;
    }

    // Check if enough seats available
    if (showtime.bookedSeats.length + body.seats.length > showtime.totalSeats) {
      sendError(res, 409, 'Not enough seats available');
      return;
    }

    // Calculate pricing
    const seatType = body.seatType || 'standard';
    const pricePerSeat = showtime.price[seatType] || showtime.price.standard;
    const totalAmount = pricePerSeat * body.seats.length;

    // Mark seats as booked
    showtimes[showtimeIndex].bookedSeats = [...showtime.bookedSeats, ...body.seats];
    writeJSON('showtimes.json', showtimes);

    // Get movie info
    const movies = readJSON('movies.json');
    const movie = movies.find(m => m.id === showtime.movieId);

    // Create booking
    const bookings = readJSON('bookings.json');
    const newBooking = {
      id: generateId('booking'),
      showtimeId: body.showtimeId,
      movieId: showtime.movieId,
      movieTitle: movie ? movie.title : 'Unknown',
      name: body.name,
      phone: body.phone,
      email: body.email || '',
      seats: body.seats,
      seatType: seatType,
      pricePerSeat: pricePerSeat,
      totalAmount: totalAmount,
      screen: showtime.screen,
      cinema: showtime.cinema,
      date: showtime.date,
      time: showtime.time,
      endTime: showtime.endTime,
      status: 'confirmed',
      foodOrders: body.foodOrders || [],
      createdAt: new Date().toISOString()
    };

    bookings.push(newBooking);
    writeJSON('bookings.json', bookings);
    sendJSON(res, 201, newBooking);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

function handleDeleteBooking(req, res, params) {
  const bookings = readJSON('bookings.json');
  const bookingIndex = bookings.findIndex(b => b.id === params.id);

  if (bookingIndex === -1) {
    sendError(res, 404, 'Booking not found');
    return;
  }

  const booking = bookings[bookingIndex];

  // Free up seats in the showtime
  const showtimes = readJSON('showtimes.json');
  const showtimeIndex = showtimes.findIndex(s => s.id === booking.showtimeId);
  if (showtimeIndex !== -1) {
    showtimes[showtimeIndex].bookedSeats = showtimes[showtimeIndex].bookedSeats.filter(
      seat => !booking.seats.includes(seat)
    );
    writeJSON('showtimes.json', showtimes);
  }

  // Mark booking as cancelled
  bookings[bookingIndex].status = 'cancelled';
  writeJSON('bookings.json', bookings);

  sendJSON(res, 200, { message: 'Booking cancelled successfully', booking: bookings[bookingIndex] });
}

// FOOD ITEMS
function handleGetFoodItems(req, res, query) {
  let items = readJSON('food-items.json');

  if (query.category) {
    items = items.filter(i => i.category === query.category);
  }

  sendJSON(res, 200, items);
}

// FOOD ORDERS
async function handleCreateFoodOrder(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.items || !body.phone) {
      sendError(res, 400, 'Missing required fields: items, phone');
      return;
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      sendError(res, 400, 'Items must be a non-empty array');
      return;
    }

    const foodItems = readJSON('food-items.json');
    let totalAmount = 0;
    const orderItems = [];

    for (const item of body.items) {
      const foodItem = foodItems.find(f => f.id === item.id);
      if (!foodItem) {
        sendError(res, 404, `Food item not found: ${item.id}`);
        return;
      }
      if (!foodItem.available) {
        sendError(res, 409, `Food item not available: ${foodItem.name}`);
        return;
      }
      const quantity = item.quantity || 1;
      totalAmount += foodItem.price * quantity;
      orderItems.push({
        id: foodItem.id,
        name: foodItem.name,
        price: foodItem.price,
        quantity: quantity
      });
    }

    // Store food orders in a separate file
    let foodOrders = [];
    try {
      foodOrders = readJSON('food-orders.json');
    } catch (e) {
      foodOrders = [];
    }

    const newOrder = {
      id: generateId('ford'),
      phone: body.phone,
      name: body.name || '',
      items: orderItems,
      totalAmount: totalAmount,
      bookingId: body.bookingId || null,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    foodOrders.push(newOrder);
    writeJSON('food-orders.json', foodOrders);
    sendJSON(res, 201, newOrder);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

function handleGetFoodOrders(req, res, query) {
  let foodOrders = [];
  try {
    foodOrders = readJSON('food-orders.json');
  } catch (e) {
    foodOrders = [];
  }

  if (query.phone) {
    foodOrders = foodOrders.filter(o => o.phone === query.phone);
  }

  sendJSON(res, 200, foodOrders);
}

// USERS
function handleGetUserById(req, res, params) {
  const users = readJSON('users.json');
  const user = users.find(u => u.id === params.id);
  if (!user) {
    sendError(res, 404, 'User not found');
    return;
  }
  sendJSON(res, 200, user);
}

async function handleUpdateUser(req, res, params) {
  try {
    const body = await parseBody(req);
    const users = readJSON('users.json');
    const index = users.findIndex(u => u.id === params.id);

    if (index === -1) {
      sendError(res, 404, 'User not found');
      return;
    }

    // Don't allow overwriting the id
    const updatedUser = { ...users[index], ...body, id: params.id };
    users[index] = updatedUser;
    writeJSON('users.json', users);
    sendJSON(res, 200, updatedUser);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// STATS
function handleGetStats(req, res) {
  const movies = readJSON('movies.json');
  const bookings = readJSON('bookings.json');
  const showtimes = readJSON('showtimes.json');

  const activeBookings = bookings.filter(b => b.status === 'confirmed');
  const totalRevenue = activeBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
  const totalSeatsBooked = activeBookings.reduce((sum, b) => sum + (b.seats ? b.seats.length : 0), 0);

  sendJSON(res, 200, {
    totalMovies: movies.length,
    nowShowing: movies.filter(m => m.status === 'now_showing').length,
    comingSoon: movies.filter(m => m.status === 'coming_soon').length,
    totalShowtimes: showtimes.length,
    totalBookings: bookings.length,
    activeBookings: activeBookings.length,
    cancelledBookings: bookings.filter(b => b.status === 'cancelled').length,
    totalRevenue: totalRevenue,
    totalSeatsBooked: totalSeatsBooked
  });
}

// --- Main request handler ---
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;
  const method = req.method.toUpperCase();

  // Add CORS headers
  addCORSHeaders(res);

  // Handle preflight requests
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    let params;

    // Movies routes
    if (pathname === '/api/movies' && method === 'GET') {
      return handleGetMovies(req, res, query);
    }
    if (pathname === '/api/movies' && method === 'POST') {
      return handleCreateMovie(req, res);
    }
    if ((params = matchRoute('/api/movies/:id', pathname)) && method === 'GET') {
      return handleGetMovieById(req, res, params);
    }
    if ((params = matchRoute('/api/movies/:id', pathname)) && method === 'PUT') {
      return handleUpdateMovie(req, res, params);
    }
    if ((params = matchRoute('/api/movies/:id', pathname)) && method === 'DELETE') {
      return handleDeleteMovie(req, res, params);
    }

    // Showtimes routes
    if (pathname === '/api/showtimes' && method === 'GET') {
      return handleGetShowtimes(req, res, query);
    }
    if (pathname === '/api/showtimes' && method === 'POST') {
      return handleCreateShowtime(req, res);
    }
    if ((params = matchRoute('/api/showtimes/:id', pathname)) && method === 'GET') {
      return handleGetShowtimeById(req, res, params);
    }
    if ((params = matchRoute('/api/showtimes/:id', pathname)) && method === 'DELETE') {
      return handleDeleteShowtime(req, res, params);
    }

    // Bookings routes
    if (pathname === '/api/bookings' && method === 'GET') {
      return handleGetBookings(req, res, query);
    }
    if (pathname === '/api/bookings' && method === 'POST') {
      return handleCreateBooking(req, res);
    }
    if ((params = matchRoute('/api/bookings/:id', pathname)) && method === 'GET') {
      return handleGetBookingById(req, res, params);
    }
    if ((params = matchRoute('/api/bookings/:id', pathname)) && method === 'DELETE') {
      return handleDeleteBooking(req, res, params);
    }

    // Food items routes
    if (pathname === '/api/food-items' && method === 'GET') {
      return handleGetFoodItems(req, res, query);
    }

    // Food orders routes
    if (pathname === '/api/food-orders' && method === 'POST') {
      return handleCreateFoodOrder(req, res);
    }
    if (pathname === '/api/food-orders' && method === 'GET') {
      return handleGetFoodOrders(req, res, query);
    }

    // Users routes
    if ((params = matchRoute('/api/users/:id', pathname)) && method === 'GET') {
      return handleGetUserById(req, res, params);
    }
    if ((params = matchRoute('/api/users/:id', pathname)) && method === 'PUT') {
      return handleUpdateUser(req, res, params);
    }

    // Stats route
    if (pathname === '/api/stats' && method === 'GET') {
      return handleGetStats(req, res);
    }

    // API route not found
    sendError(res, 404, 'API endpoint not found');
    return;
  }

  // Static file serving
  serveStaticFile(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Movie Booking Server running on http://localhost:${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api/`);
  console.log(`Press Ctrl+C to stop`);
});

module.exports = server;
