const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        email VARCHAR(255),
        category VARCHAR(100),
        city VARCHAR(100),
        has_website BOOLEAN DEFAULT false,
        website_url VARCHAR(255),
        rating DECIMAL(3,1),
        review_count INTEGER DEFAULT 0,
        place_id VARCHAR(255) UNIQUE,
        status VARCHAR(50) DEFAULT 'found',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
        channel VARCHAR(20) NOT NULL,
        direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
        content TEXT NOT NULL,
        ai_draft BOOLEAN DEFAULT true,
        status VARCHAR(50) DEFAULT 'draft',
        portfolio_id INTEGER,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS portfolios (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        file_path VARCHAR(500),
        canva_link VARCHAR(500),
        file_type VARCHAR(50),
        tags TEXT[],
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS searches (
        id SERIAL PRIMARY KEY,
        query VARCHAR(255) NOT NULL,
        city VARCHAR(100),
        category VARCHAR(100),
        leads_found INTEGER DEFAULT 0,
        status VARCHAR(50) DEFAULT 'running',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };
