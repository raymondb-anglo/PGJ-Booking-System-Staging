import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from './db.js';

async function testCreate() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await conn.query(
      'INSERT INTO AdminUsers (Username, PasswordHash, FirstName, LastName, IsActive, Role) VALUES (?, ?, ?, ?, 1, ?)',
      ['testadmin', hashedPassword, 'Test', 'Admin', 'SUPER_ADMIN']
    );
    await conn.commit();
    console.log('Success');
  } catch (err) {
    await conn.rollback();
    console.error('Error:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}
testCreate();
