require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
});

console.log('Testing connection to:', process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':***@'));

client.connect()
    .then(() => {
        console.log('Successfully connected!');
        return client.end();
    })
    .catch(err => {
        console.error('Connection failed:', err.message);
        process.exit(1);
    });
