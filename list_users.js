import 'dotenv/config';
import pool from './db.js';

async function run() {
  try {
    const [rows] = await pool.query('SELECT AdminID, Username, Role FROM AdminUsers');
    console.table(rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
