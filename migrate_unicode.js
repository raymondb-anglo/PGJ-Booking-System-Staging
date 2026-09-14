import 'dotenv/config';
import pool from './db.js';

async function run() {
  try {
    const [constraints] = await pool.query(`
      SELECT obj.name AS constraint_name,
             tab.name AS table_name,
             col.name AS column_name
      FROM sys.default_constraints obj
      INNER JOIN sys.tables tab ON obj.parent_object_id = tab.object_id
      INNER JOIN sys.columns col ON obj.parent_object_id = col.object_id AND obj.parent_column_id = col.column_id
      WHERE tab.name IN ('ParentLoginConfig', 'TcTemplates')
    `);

    for (const c of constraints) {
      if (['WelcomeEN', 'WelcomeTH', 'WelcomeCN', 'Content'].includes(c.column_name)) {
        console.log(`Dropping constraint ${c.constraint_name} on ${c.table_name}.${c.column_name}`);
        await pool.query(`ALTER TABLE ${c.table_name} DROP CONSTRAINT ${c.constraint_name}`);
      }
    }

    console.log('Altering columns...');
    
    // ParentLoginConfig
    const loginCols = ['WelcomeEN', 'WelcomeTH', 'WelcomeCN'];
    for (const col of loginCols) {
      console.log(`Altering ParentLoginConfig.${col}`);
      await pool.query(`ALTER TABLE ParentLoginConfig ALTER COLUMN ${col} NVARCHAR(MAX)`);
    }

    // TcTemplates
    console.log(`Altering TcTemplates.Content`);
    await pool.query(`ALTER TABLE TcTemplates ALTER COLUMN Content NVARCHAR(MAX)`);

    console.log('Done!');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
