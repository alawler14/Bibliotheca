const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

// Google Books API configuration
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || 'AIzaSyB_DDn21AYWrztDH2U8dJvYmfAC1aDx9Bk';
const GOOGLE_BOOKS_BASE_URL = 'https://www.googleapis.com/books/v1/volumes';

// Rate limiter: 50 requests per day per IP address
const searchLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 50, // limit each IP to 50 requests per day
  message: {
    error: 'Too many searches from this IP, please try again tomorrow.',
    remainingRequests: 0
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).json({
      error: 'Daily search limit exceeded (50 searches per day). Please try again tomorrow.',
      resetTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  },
  // Add custom headers to show remaining requests
  onLimitReached: (req, res) => {
    console.log(`Rate limit reached for IP: ${req.ip}`);
  }
});

// Apply rate limiter to search endpoint
app.use('/api/books/search', searchLimiter);

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

// Search books endpoint
app.get('/api/books/search', async (req, res) => {
  try {
    const { query, maxResults = 15, startIndex = 0 } = req.query;

    if (!query || query.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Build Google Books API URL
    const url = `${GOOGLE_BOOKS_BASE_URL}?q=${encodeURIComponent(query)}&key=${GOOGLE_BOOKS_API_KEY}&maxResults=${maxResults}&startIndex=${startIndex}`;

    // Check cache first
    const cachedData = await getCachedOrFetch(url);
    if (cachedData) {
      console.log(`Cache hit for query: ${query}`);
      return res.json(cachedData);
    }

    // Fetch from Google Books API
    console.log(`Fetching from Google Books API for query: ${query}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Google Books API error: ${response.status}`);
    }

    const data = await response.json();

    // Normalize and clean the data
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

    // Cache the response
    cache.set(url, { data: responseData, timestamp: Date.now() });

    // Add rate limit info to response headers
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

// Get book by ID endpoint
app.get('/api/books/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const url = `${GOOGLE_BOOKS_BASE_URL}/${id}?key=${GOOGLE_BOOKS_API_KEY}`;

    // Check cache
    const cachedData = await getCachedOrFetch(url);
    if (cachedData) {
      return res.json(cachedData);
    }

    // Fetch from API
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Google Books API error: ${response.status}`);
    }

    const data = await response.json();

    const book = {
      id: data.id,
      googleBooksId: data.id,
      title: data.volumeInfo.title,
      subtitle: data.volumeInfo.subtitle,
      authors: data.volumeInfo.authors || ['Unknown Author'],
      author: (data.volumeInfo.authors || ['Unknown Author']).join(', '),
      publishedDate: data.volumeInfo.publishedDate,
      description: data.volumeInfo.description || 'No description available',
      cover: data.volumeInfo.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
      largeCover: data.volumeInfo.imageLinks?.large?.replace('http:', 'https:') || null,
      pageCount: data.volumeInfo.pageCount,
      categories: data.volumeInfo.categories || [],
      averageRating: data.volumeInfo.averageRating,
      ratingsCount: data.volumeInfo.ratingsCount,
      language: data.volumeInfo.language,
      previewLink: data.volumeInfo.previewLink,
      infoLink: data.volumeInfo.infoLink,
      publisher: data.volumeInfo.publisher,
      isbn: data.volumeInfo.industryIdentifiers?.find(id => id.type === 'ISBN_13')?.identifier
    };

    // Cache the response
    cache.set(url, { data: book, timestamp: Date.now() });

    res.json(book);
  } catch (error) {
    console.error('Error fetching book:', error);
    res.status(500).json({
      error: 'Failed to fetch book details',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cacheSize: cache.size
  });
});

// Rate limit status endpoint
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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));
  
  // Catch-all handler for React Router (after all API routes)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📚 Google Books API proxy ready`);
  console.log(`🛡️  Rate limit: 50 searches per IP per day`);
  console.log(`💾 Caching enabled (1 hour TTL)`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`🌐 Serving static files from /public`);
  }
});

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
