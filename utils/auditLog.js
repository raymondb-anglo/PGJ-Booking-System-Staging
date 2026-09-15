import pool from '../db.js';

export async function logAudit(req, action, category, details) {
  try {
    const adminId = req.session?.adminId || null;
    const adminUsername = req.session?.adminUsername || null;
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    await pool.query(
      'DECLARE @NextLogID INT = ISNULL((SELECT MAX(LogID) FROM AuditLogs WITH (UPDLOCK, HOLDLOCK)), 0) + 1; INSERT INTO AuditLogs (LogID, AdminID, AdminUsername, Action, Category, Details, IPAddress, CreatedAt) VALUES (@NextLogID, ?, ?, ?, ?, ?, ?, GETDATE())',
      [adminId, adminUsername, action, category, details || null, ip]
    );
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}
