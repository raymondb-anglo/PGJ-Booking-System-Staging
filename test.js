import 'dotenv/config';
import sql from 'mssql';

async function run() {
  try {
    const config = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
      database: process.env.DB_NAME,
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true
      }
    };
    
    const pool = await new sql.ConnectionPool(config).connect();
    const result = await pool.request().query('SELECT TOP 1 * FROM TimeSlots');
    
    // Log the types of the columns
    for (const [colName, meta] of Object.entries(result.recordset.columns)) {
      console.log(`${colName}: type.name=${meta.type.name}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
