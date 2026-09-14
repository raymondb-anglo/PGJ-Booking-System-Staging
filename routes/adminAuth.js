import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';

const router = Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', {
    layout: 'layout',
    title: 'Admin Login',
    error: req.query.error || null
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.redirect('/admin/login?error=' + encodeURIComponent('Username and password are required.'));
  }

  try {
    const [rows] = await pool.query(
      'SELECT AdminID, Username, PasswordHash, FirstName, LastName, IsActive, Role FROM AdminUsers WHERE Username = ?',
      [username.trim()]
    );

    if (rows.length === 0) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('Invalid username or password.'));
    }

    const admin = rows[0];

    if (!admin.IsActive) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('This account is inactive.'));
    }

    let passwordMatch = false;
    if (admin.PasswordHash.startsWith('$2a$') || admin.PasswordHash.startsWith('$2b$') || admin.PasswordHash.startsWith('$2y$')) {
      passwordMatch = await bcrypt.compare(password, admin.PasswordHash);
    } else {
      passwordMatch = (password === admin.PasswordHash);
    }

    if (!passwordMatch) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('Invalid username or password.'));
    }

    req.session.regenerate(async (err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.redirect('/admin/login?error=' + encodeURIComponent('An error occurred. Please try again.'));
      }
      req.session.isAdmin = true;
      req.session.adminId = admin.AdminID;
      req.session.adminUsername = admin.Username;
      req.session.adminName = (admin.FirstName + ' ' + admin.LastName).trim();
      req.session.adminRole = admin.Role || 'ADMIN';

      await logAudit(req, 'LOGIN', 'AUTH', 'Admin logged in');
      res.redirect('/admin/dashboard');
    });
  } catch (error) {
    console.error('Admin login error:', error.message);
    console.error('Admin login error stack:', error.stack);
    const msg = error.code === 'ECONNREFUSED'
      ? 'Database connection refused. Check DB_HOST and DB_PORT in .env'
      : error.code === 'ER_ACCESS_DENIED_ERROR'
      ? 'Database access denied. Check DB_USER and DB_PASSWORD in .env'
      : error.code === 'ER_BAD_DB_ERROR'
      ? 'Database not found. Check DB_NAME in .env'
      : 'An error occurred. Please try again.';
    res.redirect('/admin/login?error=' + encodeURIComponent(msg));
  }
});

router.get('/logout', async (req, res) => {
  await logAudit(req, 'LOGOUT', 'AUTH', 'Admin logged out');
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

export function requireAdminAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/logout') {
    return next();
  }
  if (!req.session || !req.session.isAdmin) {
    return res.redirect('/admin/login');
  }
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.redirect('/admin/login');
  }
  if (req.session.adminRole !== 'SUPER_ADMIN') {
    return res.status(403).render('admin/forbidden', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page. Super Admin access required.'
    });
  }
  next();
}

export default router;
