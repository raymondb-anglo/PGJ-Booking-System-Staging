import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requireSuperAdmin } from './adminAuth.js';

const router = Router();

router.use(requireSuperAdmin);

router.get('/', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT AdminID, Username, FirstName, LastName, IsActive, Role, CreatedAt FROM AdminUsers ORDER BY CreatedAt DESC'
    );
    res.render('admin/users', {
      title: 'Admin Users',
      users,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Admin users list error:', error.message);
    res.render('admin/users', {
      title: 'Admin Users',
      users: [],
      success: null,
      error: 'Failed to load admin users.'
    });
  }
});

router.get('/create', (req, res) => {
  res.render('admin/user-form', {
    title: 'Create Admin User',
    user: null,
    error: null
  });
});

router.post('/create', async (req, res) => {
  const { username, password, confirmPassword, firstName, lastName, role } = req.body;
  const selectedRole = (role === 'SUPER_ADMIN' || role === 'ADMIN') ? role : 'ADMIN';

  if (!username || !password || !firstName || !lastName) {
    return res.render('admin/user-form', {
      title: 'Create Admin User',
      user: { Username: username, FirstName: firstName, LastName: lastName, Role: selectedRole },
      error: 'All fields are required.'
    });
  }

  if (password.length < 6) {
    return res.render('admin/user-form', {
      title: 'Create Admin User',
      user: { Username: username, FirstName: firstName, LastName: lastName, Role: selectedRole },
      error: 'Password must be at least 6 characters.'
    });
  }

  if (password !== confirmPassword) {
    return res.render('admin/user-form', {
      title: 'Create Admin User',
      user: { Username: username, FirstName: firstName, LastName: lastName, Role: selectedRole },
      error: 'Passwords do not match.'
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query(
      'SELECT AdminID FROM AdminUsers WHERE Username = ?',
      [username.trim()]
    );
    if (existing.length > 0) {
      await conn.rollback();
      return res.render('admin/user-form', {
        title: 'Create Admin User',
        user: { Username: username, FirstName: firstName, LastName: lastName, Role: selectedRole },
        error: 'Username already exists.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [maxIdResult] = await conn.query('SELECT MAX(AdminID) as maxId FROM AdminUsers');
    const newAdminId = (maxIdResult[0].maxId || 0) + 1;

    await conn.query(
      'INSERT INTO AdminUsers (AdminID, Username, PasswordHash, FirstName, LastName, IsActive, Role) VALUES (?, ?, ?, ?, ?, 1, ?)',
      [newAdminId, username.trim(), hashedPassword, firstName.trim(), lastName.trim(), selectedRole]
    );

    await conn.commit();
    res.redirect('/admin/users?success=' + encodeURIComponent('Admin user created successfully.'));
  } catch (error) {
    await conn.rollback();
    console.error('Create admin user error:', error.message);
    res.render('admin/user-form', {
      title: 'Create Admin User',
      user: { Username: username, FirstName: firstName, LastName: lastName, Role: selectedRole },
      error: 'Failed to create admin user.'
    });
  } finally {
    conn.release();
  }
});

router.get('/edit/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT AdminID, Username, FirstName, LastName, IsActive, Role FROM AdminUsers WHERE AdminID = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.redirect('/admin/users?error=' + encodeURIComponent('Admin user not found.'));
    }
    res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: rows[0],
      error: null
    });
  } catch (error) {
    console.error('Edit admin user error:', error.message);
    res.redirect('/admin/users?error=' + encodeURIComponent('Failed to load admin user.'));
  }
});

router.post('/edit/:id', async (req, res) => {
  const adminId = parseInt(req.params.id, 10);
  const { username, password, confirmPassword, firstName, lastName, isActive, role } = req.body;
  const selectedRole = (role === 'SUPER_ADMIN' || role === 'ADMIN') ? role : 'ADMIN';
  const isSelf = adminId === req.session.adminId;

  if (!username || !firstName || !lastName) {
    return res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: isActive === '1' ? 1 : 0, Role: selectedRole },
      error: 'Username, first name, and last name are required.'
    });
  }

  if (password && password.length < 6) {
    return res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: isActive === '1' ? 1 : 0, Role: selectedRole },
      error: 'Password must be at least 6 characters.'
    });
  }

  if (password && password !== confirmPassword) {
    return res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: isActive === '1' ? 1 : 0, Role: selectedRole },
      error: 'Passwords do not match.'
    });
  }

  const newIsActive = isActive === '1' ? 1 : 0;

  if (isSelf && newIsActive === 0) {
    return res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: 1, Role: req.session.adminRole },
      error: 'You cannot deactivate your own account.'
    });
  }

  if (isSelf && selectedRole !== req.session.adminRole) {
    return res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: newIsActive, Role: req.session.adminRole },
      error: 'You cannot change your own role.'
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query(
      'SELECT AdminID FROM AdminUsers WHERE Username = ? AND AdminID != ?',
      [username.trim(), adminId]
    );
    if (existing.length > 0) {
      await conn.rollback();
      return res.render('admin/user-form', {
        title: 'Edit Admin User',
        user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: newIsActive, Role: selectedRole },
        error: 'Username already taken by another admin.'
      });
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await conn.query(
        'UPDATE AdminUsers SET Username = ?, PasswordHash = ?, FirstName = ?, LastName = ?, IsActive = ?, Role = ? WHERE AdminID = ?',
        [username.trim(), hashedPassword, firstName.trim(), lastName.trim(), newIsActive, selectedRole, adminId]
      );
    } else {
      await conn.query(
        'UPDATE AdminUsers SET Username = ?, FirstName = ?, LastName = ?, IsActive = ?, Role = ? WHERE AdminID = ?',
        [username.trim(), firstName.trim(), lastName.trim(), newIsActive, selectedRole, adminId]
      );
    }

    await conn.commit();
    res.redirect('/admin/users?success=' + encodeURIComponent('Admin user updated successfully.'));
  } catch (error) {
    await conn.rollback();
    console.error('Update admin user error:', error.message);
    res.render('admin/user-form', {
      title: 'Edit Admin User',
      user: { AdminID: adminId, Username: username, FirstName: firstName, LastName: lastName, IsActive: newIsActive, Role: selectedRole },
      error: 'Failed to update admin user.'
    });
  } finally {
    conn.release();
  }
});

export default router;
