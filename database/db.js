const { Pool } = require('pg');

// Debug: Log database configuration
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('❌ ERROR: DATABASE_URL environment variable is not set!');
  console.error('Please add DATABASE_URL in Render Environment settings');
  process.exit(1);
}

console.log('📊 Attempting to connect to database...');
console.log('   URL starts with:', dbUrl.substring(0, 25) + '...');
console.log('   NODE_ENV:', process.env.NODE_ENV);

// Try to parse the URL to see what we're connecting to
try {
  const url = new URL(dbUrl);
  console.log('   Host:', url.hostname);
  console.log('   Port:', url.port || '5432');
  console.log('   Database:', url.pathname.substring(1));
} catch (e) {
  console.error('   ⚠️  Could not parse DATABASE_URL:', e.message);
}

// PostgreSQL connection pool with increased timeout
const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000, // 10 seconds
  idleTimeoutMillis: 30000
});

// Test connection
pool.on('connect', () => {
  console.log('💾 Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err);
});

// Helper function to execute queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Query error:', error);
    throw error;
  }
};

// Get a client from the pool for transactions
const getClient = async () => {
  return await pool.connect();
};

module.exports = {
  query,
  getClient,
  pool
};
