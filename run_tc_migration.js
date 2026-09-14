import pool from './db.js';

async function runMigration() {
  try {
    console.log('Adding Thai and Chinese columns...');
    
    try {
      await pool.query('ALTER TABLE TcTemplates ADD ContentTH NVARCHAR(MAX) NULL');
      console.log('Added ContentTH column');
    } catch (e) {
      console.log('ContentTH column might already exist:', e.message);
    }

    try {
      await pool.query('ALTER TABLE TcTemplates ADD ContentCN NVARCHAR(MAX) NULL');
      console.log('Added ContentCN column');
    } catch (e) {
      console.log('ContentCN column might already exist:', e.message);
    }
    
    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
