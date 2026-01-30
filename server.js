const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const db = require('./database/db');
const { runMigrations } = require('./database/migrate');
const { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  authenticateToken,
  optionalAuth 
} = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Google Books API configuration
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || 'AIzaSyB_DDn21AYWrztDH2U8dJvYmfAC1aDx9Bk';
const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1/volumes';

// Rate limiter: 50 requests per day per IP address
const searchLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 50,
  message: {
    error: 'Too many searches from this IP, please try again tomorrow.',
    remainingRequests: 0
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Daily search limit exceeded (50 searches per day). Please try again tomorrow.',
      resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  }
});

// In-memory cache to reduce API calls to Google
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hour

// Helper function to get from cache or fetch
const getCachedOrFetch = async (url) => {
  if (cache.has(url)) {
    const { data, timestamp } = cache.get(url);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
    cache.delete(url);
  }
  return null;
};

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

// Register new user
app.post('/api/auth/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const result = await db.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, passwordHash, name || null]
    );

    const user = result.rows[0];
    const token = generateToken(user.id, user.email);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
app.post('/api/auth/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password } = req.body;

    // Find user
    const result = await db.query(
      'SELECT id, email, name, password_hash, created_at FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken(user.id, user.email);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ============================================
// BOOK SEARCH ENDPOINT (with rate limiting)
// ============================================

app.get('/api/books/search', searchLimiter, async (req, res) => {
  try {
    const { query, maxResults = 15, startIndex = 0 } = req.query;

    if (!query || query.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const url = `${GOOGLE_BOOKS_BASE_URL}?q=${encodeURIComponent(query)}&key=${GOOGLE_BOOKS_API_KEY}&maxResults=${maxResults}&startIndex=${startIndex}`;

    const cachedData = await getCachedOrFetch(url);
    if (cachedData) {
      console.log(`Cache hit for query: ${query}`);
      return res.json(cachedData);
    }

    console.log(`Fetching from Google Books API for query: ${query}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Google Books API error: ${response.status}`);
    }

    const data = await response.json();

    const books = data.items?.map(item => ({
      id: item.id,
      googleBooksId: item.id,
      title: item.volumeInfo.title,
      subtitle: item.volumeInfo.subtitle,
      authors: item.volumeInfo.authors || ['Unknown Author'],
      author: (item.volumeInfo.authors || ['Unknown Author']).join(', '),
      publishedDate: item.volumeInfo.publishedDate,
      description: item.volumeInfo.description?.substring(0, 300) + '...' || 'No description available',
      cover: item.volumeInfo.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
      pageCount: item.volumeInfo.pageCount,
      categories: item.volumeInfo.categories || [],
      series: item.volumeInfo.categories?.[0] || 'Standalone',
      averageRating: item.volumeInfo.averageRating,
      ratingsCount: item.volumeInfo.ratingsCount,
      language: item.volumeInfo.language,
      previewLink: item.volumeInfo.previewLink,
      infoLink: item.volumeInfo.infoLink
    })) || [];

    const responseData = {
      books,
      totalItems: data.totalItems || 0,
      query
    };

    cache.set(url, { data: responseData, timestamp: Date.now() });

    const remaining = res.getHeader('RateLimit-Remaining');
    res.setHeader('X-Searches-Remaining', remaining || '50');

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({
      error: 'Failed to search books. Please try again later.',
      details: error.message
    });
  }
});

// ============================================
// TRACKING ENDPOINTS (require authentication)
// ============================================

// Track a book
app.post('/api/tracking/books', authenticateToken, async (req, res) => {
  try {
    const { googleBooksId, title, authors, cover, publishedDate, releaseDate, series } = req.body;
    const userId = req.user.userId;

    // First, create or get the book
    let bookResult = await db.query(
      'SELECT id FROM books WHERE google_books_id = $1',
      [googleBooksId]
    );

    let bookId;
    if (bookResult.rows.length === 0) {
      // Create new book
      const newBook = await db.query(
        `INSERT INTO books (google_books_id, title, cover_url, published_date, release_date) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [googleBooksId, title, cover, publishedDate, releaseDate]
      );
      bookId = newBook.rows[0].id;

      // Handle authors
      if (authors && authors.length > 0) {
        for (let i = 0; i < authors.length; i++) {
          const authorName = authors[i];
          
          // Create or get author
          let authorResult = await db.query(
            'INSERT INTO authors (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id',
            [authorName]
          );
          const authorId = authorResult.rows[0].id;

          // Link book to author
          await db.query(
            'INSERT INTO book_authors (book_id, author_id, author_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [bookId, authorId, i + 1]
          );
        }
      }

      // Handle series if provided
      if (series && series !== 'Standalone') {
        let seriesResult = await db.query(
          'INSERT INTO series (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id',
          [series]
        );
        const seriesId = seriesResult.rows[0].id;

        await db.query(
          'UPDATE books SET series_id = $1 WHERE id = $2',
          [seriesId, bookId]
        );
      }
    } else {
      bookId = bookResult.rows[0].id;
    }

    // Track the book for this user
    await db.query(
      'INSERT INTO user_tracked_books (user_id, book_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, bookId]
    );

    res.json({ success: true, message: 'Book tracked successfully' });
  } catch (error) {
    console.error('Error tracking book:', error);
    res.status(500).json({ error: 'Failed to track book' });
  }
});

// Track an author
app.post('/api/tracking/authors', authenticateToken, async (req, res) => {
  try {
    const { authorName } = req.body;
    const userId = req.user.userId;

    // Create or get author
    let authorResult = await db.query(
      'INSERT INTO authors (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id',
      [authorName]
    );
    const authorId = authorResult.rows[0].id;

    // Track the author
    await db.query(
      'INSERT INTO user_tracked_authors (user_id, author_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, authorId]
    );

    res.json({ success: true, message: 'Author tracked successfully' });
  } catch (error) {
    console.error('Error tracking author:', error);
    res.status(500).json({ error: 'Failed to track author' });
  }
});

// Get user's tracked items
app.get('/api/tracking/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get tracked books with authors
    const books = await db.query(`
      SELECT 
        b.id,
        b.google_books_id,
        b.title,
        b.cover_url,
        b.release_date,
        b.published_date,
        array_agg(a.name) as authors,
        s.name as series_name
      FROM user_tracked_books utb
      JOIN books b ON utb.book_id = b.id
      LEFT JOIN book_authors ba ON b.id = ba.book_id
      LEFT JOIN authors a ON ba.author_id = a.id
      LEFT JOIN series s ON b.series_id = s.id
      WHERE utb.user_id = $1
      GROUP BY b.id, s.name
      ORDER BY b.release_date ASC NULLS LAST
    `, [userId]);

    // Get tracked authors
    const authors = await db.query(`
      SELECT a.id, a.name
      FROM user_tracked_authors uta
      JOIN authors a ON uta.author_id = a.id
      WHERE uta.user_id = $1
      ORDER BY a.name
    `, [userId]);

    // Get tracked series
    const series = await db.query(`
      SELECT s.id, s.name
      FROM user_tracked_series uts
      JOIN series s ON uts.series_id = s.id
      WHERE uts.user_id = $1
      ORDER BY s.name
    `, [userId]);

    res.json({
      books: books.rows,
      authors: authors.rows,
      series: series.rows
    });
  } catch (error) {
    console.error('Error getting tracked items:', error);
    res.status(500).json({ error: 'Failed to get tracked items' });
  }
});

// Untrack a book
app.delete('/api/tracking/books/:bookId', authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user.userId;

    await db.query(
      'DELETE FROM user_tracked_books WHERE user_id = $1 AND book_id = $2',
      [userId, bookId]
    );

    res.json({ success: true, message: 'Book untracked' });
  } catch (error) {
    console.error('Error untracking book:', error);
    res.status(500).json({ error: 'Failed to untrack book' });
  }
});

// Untrack an author
app.delete('/api/tracking/authors/:authorId', authenticateToken, async (req, res) => {
  try {
    const { authorId } = req.params;
    const userId = req.user.userId;

    await db.query(
      'DELETE FROM user_tracked_authors WHERE user_id = $1 AND author_id = $2',
      [userId, authorId]
    );

    res.json({ success: true, message: 'Author untracked' });
  } catch (error) {
    console.error('Error untracking author:', error);
    res.status(500).json({ error: 'Failed to untrack author' });
  }
});

// Get calendar data (all releases for the year)
app.get('/api/calendar/:year', authenticateToken, async (req, res) => {
  try {
    const { year } = req.params;
    const userId = req.user.userId;

    // Get all releases for tracked books in the given year
    const releases = await db.query(`
      SELECT 
        b.id,
        b.title,
        b.cover_url,
        b.release_date,
        array_agg(a.name) as authors,
        s.name as series_name
      FROM user_tracked_books utb
      JOIN books b ON utb.book_id = b.id
      LEFT JOIN book_authors ba ON b.id = ba.book_id
      LEFT JOIN authors a ON ba.author_id = a.id
      LEFT JOIN series s ON b.series_id = s.id
      WHERE utb.user_id = $1 
        AND EXTRACT(YEAR FROM b.release_date) = $2
      GROUP BY b.id, s.name
      ORDER BY b.release_date
    `, [userId, year]);

    res.json({ releases: releases.rows });
  } catch (error) {
    console.error('Error getting calendar:', error);
    res.status(500).json({ error: 'Failed to get calendar data' });
  }
});

// ============================================
// UTILITY ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cacheSize: cache.size
  });
});

// Rate limit status
app.get('/api/rate-limit-status', searchLimiter, (req, res) => {
  const remaining = res.getHeader('RateLimit-Remaining');
  const limit = res.getHeader('RateLimit-Limit');
  const reset = res.getHeader('RateLimit-Reset');

  res.json({
    limit: parseInt(limit) || 50,
    remaining: parseInt(remaining) || 50,
    resetTime: reset ? new Date(parseInt(reset) * 1000).toISOString() : null
  });
});

// Start server
async function startServer() {
  try {
    // Run database migrations first
    await runMigrations();
    
    // Then start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📚 Google Books API proxy ready`);
      console.log(`🛡️  Rate limit: 50 searches per IP per day`);
      console.log(`💾 Caching enabled (1 hour TTL)`);
      console.log(`🔐 Authentication enabled`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Cleanup old cache entries every hour
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
  }
}, 3600000);
