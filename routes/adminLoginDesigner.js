import { Router } from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'login');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'logo-' + Date.now() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

async function ensureTable() {
  // MSSQL schema is already pre-configured by user.
  return;
}

async function getConfig() {
  await ensureTable();
  const [rows] = await pool.query('SELECT TOP 1 * FROM ParentLoginConfig ORDER BY ConfigID DESC');
  if (rows.length > 0) return rows[0];
  await pool.query(
    `INSERT INTO ParentLoginConfig (HeaderTitle, HeaderSubtitle, HeaderBgColor, FooterText) VALUES (?, ?, ?, ?)`,
    ['PGJ – Personal Growth Journey', '', null, '']
  );
  const [newRows] = await pool.query('SELECT TOP 1 * FROM ParentLoginConfig ORDER BY ConfigID DESC');
  return newRows[0];
}

function sanitizeHtml(input) {
  if (!input) return '';
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '');
}

router.get('/', async (req, res) => {
  try {
    const config = await getConfig();
    res.render('admin/parent-login-designer', {
      title: 'Parent Login Page Designer',
      config,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Login designer error:', error.message);
    res.render('admin/parent-login-designer', {
      title: 'Parent Login Page Designer',
      config: {},
      success: null,
      error: 'Failed to load configuration.'
    });
  }
});

router.post('/save', upload.single('headerLogo'), async (req, res) => {
  try {
    const config = await getConfig();
    const {
      headerBgColor, headerTitle, headerSubtitle,
      welcomeEN, welcomeTH, welcomeCN,
      termsBgColor, footerText, removeLogo, noBgColor
    } = req.body;

    let logoPath = config.HeaderLogo;

    if (removeLogo === '1') {
      if (logoPath) {
        const oldFile = path.join(__dirname, '..', 'public', logoPath);
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      logoPath = null;
    }

    if (req.file) {
      if (config.HeaderLogo) {
        const oldFile = path.join(__dirname, '..', 'public', config.HeaderLogo);
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch (e) {}
        }
      }
      logoPath = '/uploads/login/' + req.file.filename;
    }

    await pool.query(
      `UPDATE ParentLoginConfig SET
        HeaderLogo = ?, HeaderBgColor = ?, HeaderTitle = ?, HeaderSubtitle = ?,
        WelcomeEN = ?, WelcomeTH = ?, WelcomeCN = ?,
        TermsBgColor = ?, FooterText = ?
       WHERE ConfigID = ?`,
      [
        logoPath,
        noBgColor === '1' ? 'transparent' : (headerBgColor || null),
        (headerTitle || '').substring(0, 500),
        (headerSubtitle || '').substring(0, 500),
        sanitizeHtml(welcomeEN),
        sanitizeHtml(welcomeTH),
        sanitizeHtml(welcomeCN),
        termsBgColor || '#f8f9fa',
        (footerText || '').substring(0, 1000),
        config.ConfigID
      ]
    );

    res.redirect('/admin/parent-login-designer?success=' + encodeURIComponent('Design saved successfully!'));
  } catch (error) {
    console.error('Save login designer error:', error.message);
    res.redirect('/admin/parent-login-designer?error=' + encodeURIComponent('Failed to save. ' + error.message));
  }
});

export { getConfig };
export default router;
