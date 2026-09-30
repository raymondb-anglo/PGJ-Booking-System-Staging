import sql from 'mssql';

const config = {
  user: 'sa',
  password: 'AngloSingapore2014',
  server: '172.16.10.4',
  port: 1433,
  database: 'PGJ64SA12627_Staging',
  options: { encrypt: false, trustServerCertificate: true }
};

const pool = new sql.ConnectionPool(config);
const p = await pool.connect();

const r = await p.request().query("SELECT DISTINCT PCClass FROM Students WHERE IsActive = 1 AND PCClass IS NOT NULL ORDER BY PCClass");
console.log('=== ALL DISTINCT PCClass VALUES ===');
r.recordset.forEach(row => console.log(`  "${row.PCClass}"`));

// Show what the short level extraction would look like
console.log('\n=== SHORT LEVEL EXTRACTION ===');
const shortLevels = new Set();
r.recordset.forEach(row => {
  const pc = row.PCClass;
  // Extract the short level: everything before " Mentorship" or " Pastoral Care" or " - "
  const match = pc.match(/^(K\d+P?|P\d+|S\d+|JC\d+|Secondary\s+\d+)/i);
  if (match) {
    shortLevels.add(match[1]);
  } else {
    console.log(`  No match for: "${pc}"`);
  }
});
console.log('Unique short levels:', [...shortLevels].sort());

await p.close();
