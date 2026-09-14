import 'dotenv/config';
import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { testConnection } from './db.js';
import adminAuthRoutes, { requireAdminAuth, requireSuperAdmin } from './routes/adminAuth.js';
import adminRoutes from './routes/admin.js';
import configRoutes from './routes/config.js';
import adminUsersRoutes from './routes/adminUsers.js';
import adminPdfTemplateRoutes from './routes/adminPdfTemplate.js';
import adminTcTemplateRoutes from './routes/adminTcTemplate.js';
import adminAuditLogsRoutes from './routes/adminAuditLogs.js';
import adminLoginDesignerRoutes from './routes/adminLoginDesigner.js';
import adminStudentsRoutes from './routes/adminStudents.js';
import adminTeachersRoutes from './routes/adminTeachers.js';
import adminMeetingDatesRoutes from './routes/adminMeetingDates.js';
import adminTeacherAvailabilityRoutes from './routes/adminTeacherAvailability.js';
import adminBookingsRoutes from './routes/adminBookings.js';
import adminReportsRoutes from './routes/adminReports.js';
import adminAdvancedExportRoutes from './routes/adminAdvancedExport.js';
import adminTranslationsRoutes from './routes/adminTranslations.js';
import parentBookingRoutes from './routes/parentBooking.js';
import teacherScheduleRoutes from './routes/teacherSchedule.js';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'pgj-booking-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: null
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  console.log('[REQ] Handling / redirect');
  res.redirect('/booking');
});

app.use('/admin', requireAdminAuth);
app.use('/admin', (req, res, next) => {
  res.locals.isAdmin = !!(req.session && req.session.isAdmin);
  res.locals.adminRole = (req.session && req.session.adminRole) || '';
  res.locals.adminUsername = (req.session && req.session.adminUsername) || '';
  next();
});
app.use('/admin', adminAuthRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/users', requireSuperAdmin, adminUsersRoutes);
app.use('/admin/pdf-template', requireSuperAdmin, adminPdfTemplateRoutes);
app.use('/admin/tc-template', requireSuperAdmin, adminTcTemplateRoutes);
app.use('/admin/audit-logs', adminAuditLogsRoutes);
app.use('/admin/parent-login-designer', requireSuperAdmin, adminLoginDesignerRoutes);
app.use('/admin/students', adminStudentsRoutes);
app.use('/admin/teachers', adminTeachersRoutes);
app.use('/admin/config/meeting-dates', adminMeetingDatesRoutes);
app.use('/admin/config/teacher-availability', adminTeacherAvailabilityRoutes);
app.use('/admin/bookings', adminBookingsRoutes);
app.use('/admin/translations', adminTranslationsRoutes);
app.use('/admin/reports/advanced-export', adminAdvancedExportRoutes);
app.use('/admin/reports', adminReportsRoutes);
app.use('/admin/config', configRoutes);

app.use('/booking', parentBookingRoutes);
app.use('/teacher-schedule', teacherScheduleRoutes);

app.get('/health/db', (req, res, next) => {
  if (!req.session || !req.session.isAdmin || req.session.adminRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ status: 'error', message: 'Access denied. Super Admin access required.' });
  }
  next();
}, async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'success',
      message: 'MSSQL connection is healthy',
      database: process.env.DB_NAME
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'MSSQL connection failed',
      error: error.message
    });
  }
});

const port = parseInt(process.env.PORT || '5040', 10);

(async () => {
  let dbConnected = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    dbConnected = await testConnection();
    if (dbConnected) break;
    console.log(`Database connection attempt ${attempt}/5 failed. Retrying in ${attempt * 2}s...`);
    await new Promise(r => setTimeout(r, attempt * 2000));
  }
  if (!dbConnected) {
    console.error('Failed to connect to database after 5 attempts. Starting server anyway...');
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port} (${process.env.NODE_ENV || 'development'})`);
  });
})();
