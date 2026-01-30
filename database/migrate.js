const db = require('./db');

// Run all migrations
async function runMigrations() {
  console.log('🔄 Running database migrations...');

  try {
    // Check if migrations are needed
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);

    if (tableCheck.rows[0].exists) {
      console.log('✅ Database tables already exist. Skipping migration.');
      return;
    }

    console.log('📝 Creating database schema...');

    // Create tables in order (respecting foreign key dependencies)
    
    // 1. Users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Created users table');

    // 2. Authors table
    await db.query(`
      CREATE TABLE IF NOT EXISTS authors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        google_books_author_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name)
      );
    `);
    console.log('✓ Created authors table');

    // 3. Series table
    await db.query(`
      CREATE TABLE IF NOT EXISTS series (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name)
      );
    `);
    console.log('✓ Created series table');

    // 4. Books table
    await db.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        google_books_id VARCHAR(255) UNIQUE,
        title VARCHAR(500) NOT NULL,
        subtitle VARCHAR(500),
        description TEXT,
        cover_url VARCHAR(500),
        published_date DATE,
        release_date DATE,
        page_count INTEGER,
        isbn VARCHAR(50),
        is_released BOOLEAN DEFAULT true,
        series_id INTEGER REFERENCES series(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Created books table');

    // 5. Book-Author relationship
    await db.query(`
      CREATE TABLE IF NOT EXISTS book_authors (
        book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE,
        author_order INTEGER DEFAULT 1,
        PRIMARY KEY (book_id, author_id)
      );
    `);
    console.log('✓ Created book_authors table');

    // 6. User tracked books
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_tracked_books (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
        tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notify_on_release BOOLEAN DEFAULT true,
        UNIQUE(user_id, book_id)
      );
    `);
    console.log('✓ Created user_tracked_books table');

    // 7. User tracked authors
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_tracked_authors (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE,
        tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notify_on_release BOOLEAN DEFAULT true,
        UNIQUE(user_id, author_id)
      );
    `);
    console.log('✓ Created user_tracked_authors table');

    // 8. User tracked series
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_tracked_series (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
        tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notify_on_release BOOLEAN DEFAULT true,
        UNIQUE(user_id, series_id)
      );
    `);
    console.log('✓ Created user_tracked_series table');

    // 9. Community release dates
    await db.query(`
      CREATE TABLE IF NOT EXISTS community_release_dates (
        id SERIAL PRIMARY KEY,
        book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
        submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        release_date DATE NOT NULL,
        source_url VARCHAR(500),
        votes_up INTEGER DEFAULT 0,
        votes_down INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT false,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Created community_release_dates table');

    // 10. Create indexes
    console.log('📊 Creating indexes...');
    
    await db.query('CREATE INDEX IF NOT EXISTS idx_books_google_id ON books(google_books_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_books_release_date ON books(release_date);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_user_tracked_books_user ON user_tracked_books(user_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_user_tracked_authors_user ON user_tracked_authors(user_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_user_tracked_series_user ON user_tracked_series(user_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_book_authors_book ON book_authors(book_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_book_authors_author ON book_authors(author_id);');
    
    console.log('✓ Created indexes');

    console.log('✅ Database migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

module.exports = { runMigrations };
