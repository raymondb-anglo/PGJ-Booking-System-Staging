import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function buildWhereAndParams(query) {
  const category = query.category || '';
  const action = query.action || '';
  const admin = query.admin || '';
  const dateFrom = query.dateFrom || '';
  const dateTo = query.dateTo || '';

  let where = [];
  let params = [];

  if (category) {
    where.push('Category = ?');
    params.push(category);
  }
  if (action) {
    where.push('Action = ?');
    params.push(action);
  }
  if (admin) {
    where.push('AdminUsername LIKE ?');
    params.push('%' + admin + '%');
  }
  if (dateFrom) {
    where.push('CreatedAt >= ?');
    params.push(dateFrom + ' 00:00:00');
  }
  if (dateTo) {
    where.push('CreatedAt <= ?');
    params.push(dateTo + ' 23:59:59');
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  return { whereClause, params, filters: { category, action, admin, dateFrom, dateTo } };
}

router.get('/', async (req, res) => {
  try {
    const { whereClause, params, filters } = buildWhereAndParams(req.query);

    const [logs] = await pool.query(
      `SELECT * FROM AuditLogs ${whereClause} ORDER BY CreatedAt DESC`,
      params
    );

    const [categories] = await pool.query('SELECT DISTINCT Category FROM AuditLogs ORDER BY Category');
    const [actions] = await pool.query('SELECT DISTINCT Action FROM AuditLogs ORDER BY Action');

    res.render('admin/audit-logs', {
      title: 'Audit Logs',
      logs,
      categories: categories.map(c => c.Category),
      actions: actions.map(a => a.Action),
      filters,
      total: logs.length,
      adminRole: req.session.adminRole || 'ADMIN'
    });
  } catch (error) {
    console.error('Audit logs error:', error.message);
    res.render('admin/audit-logs', {
      title: 'Audit Logs',
      logs: [],
      categories: [],
      actions: [],
      filters: { category: '', action: '', admin: '', dateFrom: '', dateTo: '' },
      total: 0,
      adminRole: req.session.adminRole || 'ADMIN',
      error: error.message
    });
  }
});

router.get('/export', async (req, res) => {
  try {
    if (req.session.adminRole !== 'SUPER_ADMIN') {
      return res.status(403).send('Access denied. SUPER_ADMIN only.');
    }

    const { whereClause, params } = buildWhereAndParams(req.query);

    const [logs] = await pool.query(
      `SELECT * FROM AuditLogs ${whereClause} ORDER BY CreatedAt DESC`,
      params
    );

    const header = ['Log ID', 'Date/Time', 'Category', 'Action', 'Admin', 'Details', 'IP Address'];
    const rows = logs.map(log => [
      log.LogID,
      new Date(log.CreatedAt).toISOString(),
      log.Category || '',
      log.Action || '',
      log.AdminUsername || 'System',
      (log.Details || '').replace(/"/g, '""'),
      log.IPAddress || ''
    ]);

    let csv = header.map(h => `"${h}"`).join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(val => `"${val}"`).join(',') + '\n';
    });

    const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('Audit logs export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

export default router;
