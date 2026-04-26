require('dotenv').config(); // EZ LEGYEN AZ ELSŐ SOR!
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD), // Biztosítsuk, hogy string legyen
  port: process.env.DB_PORT,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Hiba az adatbázis kapcsolódásnál:', err.message);
  } else {
    console.log('Sikeresen csatlakozva a PostgreSQL-hez!');
  }
});

module.exports = pool;