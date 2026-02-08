require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDB() {
  try {
    await client.connect();
    console.log('Connected to database');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS user_responses (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username TEXT,
        who_are_you TEXT,
        function TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await client.query(createTableQuery);
    console.log('Table "user_responses" created or already exists.');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    await client.end();
  }
}

initDB();
