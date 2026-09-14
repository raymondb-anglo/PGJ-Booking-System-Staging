import sql from 'mssql';

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
  database: process.env.DB_NAME,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // true for azure
    trustServerCertificate: true // true for local dev/self-signed
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('MSSQL connection successful. Connected to database:', process.env.DB_NAME);
    return pool;
  })
  .catch(err => {
    console.error('MSSQL connection failed:', err.message);
    throw err;
  });

function convertQuery(sqlString, params) {
  let paramIdx = 0;
  // Replace unquoted ? with @p0, @p1 etc.
  let newSql = sqlString.replace(/\?/g, () => `@p${paramIdx++}`);
  
  // If it's an INSERT statement (but not part of a MERGE or IF @@ROWCOUNT), append SELECT SCOPE_IDENTITY()
  // to ensure we get the insertId back in the result set for mysql2 compatibility.
  if (/^\s*INSERT\s+INTO/i.test(newSql) && !newSql.includes('SCOPE_IDENTITY')) {
    newSql += '; SELECT SCOPE_IDENTITY() AS insertId;';
  }
  
  return { newSql, paramCount: paramIdx };
}

async function executeQuery(poolOrTransaction, sqlString, params = []) {
  const request = poolOrTransaction.request();
  const { newSql } = convertQuery(sqlString, params);
  
  for (let i = 0; i < params.length; i++) {
    request.input(`p${i}`, params[i]);
  }
  
  try {
    console.log('Executing query:', newSql);
    const result = await request.query(newSql);
    console.log('Query finished.');
    // Mimic mysql2 return format: [rows, fields]
    const rows = result.recordset || [];
    
    // Convert TIME columns to HH:mm:ss strings to mimic mysql2 and prevent .substring() crashes
    // MSSQL driver returns TIME columns as 1970-01-01 Date objects. Metadata isn't always reliable for JOINs.
    if (rows.length > 0) {
      for (const row of rows) {
        for (const col in row) {
          if (row[col] instanceof Date && row[col].toISOString().startsWith('1970-01-01T')) {
            row[col] = row[col].toISOString().substring(11, 19);
          }
        }
      }
    }
    
    // Mimic insertId for mysql2
    // If the query was an INSERT and returned SCOPE_IDENTITY() as insertId
    if (result.recordset && result.recordset.length > 0 && result.recordset[0]['insertId']) {
      rows.insertId = result.recordset[0]['insertId'];
    } else if (result.recordset && result.recordset.length > 0 && result.recordset[0]['insertId'] === undefined && Object.keys(result.recordset[0]).length === 1 && result.recordset[0]['']) {
        // sometimes scope_identity returns without a column name
        rows.insertId = result.recordset[0][''];
    }

    // Attach affected rows
    rows.affectedRows = result.rowsAffected.reduce((a, b) => a + b, 0);

    return [rows, null];
  } catch (err) {
    if (err.message.includes('Violation of PRIMARY KEY') || err.message.includes('Violation of UNIQUE KEY') || err.message.includes('Cannot insert duplicate key')) {
      err.code = 'ER_DUP_ENTRY';
    }
    throw err;
  }
}

const pool = {
  query: async (sqlString, params) => {
    const cp = await poolPromise;
    return executeQuery(cp, sqlString, params);
  },
  getConnection: async () => {
    const cp = await poolPromise;
    const transaction = new sql.Transaction(cp);
    await transaction.begin();
    let released = false;
    
    return {
      query: async (sqlString, params) => {
        if (released) throw new Error('Transaction already released');
        return executeQuery(transaction, sqlString, params);
      },
      beginTransaction: async () => { /* already begun */ },
      commit: async () => { 
        if (!released) {
          await transaction.commit(); 
        }
      },
      rollback: async () => { 
        if (!released) {
          await transaction.rollback(); 
        }
      },
      release: () => { 
        released = true;
      }
    };
  }
};

export async function testConnection() {
  try {
    await poolPromise;
    return true;
  } catch (error) {
    return false;
  }
}

export default pool;
