import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from './db.js';

async function createOrUpdateAdmin(username, plainTextPassword) {
  try {
    console.log(`Generating bcrypt hash for password...`);
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(plainTextPassword, salt);

    console.log(`Checking if user '${username}' exists...`);
    const [rows] = await pool.query('SELECT AdminID FROM AdminUsers WHERE Username = ?', [username]);
    
    if (rows.length > 0) {
      console.log(`User exists. Updating password and ensuring SUPER_ADMIN role...`);
      await pool.query(
        'UPDATE AdminUsers SET PasswordHash = ?, Role = ?, IsActive = 1 WHERE Username = ?',
        [hash, 'SUPER_ADMIN', username]
      );
      console.log(`✅ User '${username}' updated successfully!`);
    } else {
      console.log(`User does not exist. Creating new SUPER_ADMIN user...`);
      await pool.query(
        'INSERT INTO AdminUsers (Username, PasswordHash, FirstName, LastName, Role, IsActive) VALUES (?, ?, ?, ?, ?, 1)',
        [username, hash, 'Super', 'Admin', 'SUPER_ADMIN']
      );
      console.log(`✅ New user '${username}' created successfully!`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

// Default credentials if not passed as arguments
const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin123';

createOrUpdateAdmin(username, password);
