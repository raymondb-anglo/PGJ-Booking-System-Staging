import { Router } from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requireSuperAdmin } from './adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'templates');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'header_' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (PNG, JPG, GIF, SVG) are allowed.'));
    }
  }
});

const router = Router();

router.get('/', async (req, res) => {
  try {
    const [templates] = await pool.query(
      'SELECT * FROM PdfTemplates ORDER BY IsActive DESC, TemplateID DESC'
    );
    const canEdit = req.session.adminRole === 'SUPER_ADMIN';
    res.render('admin/pdf-template', {
      title: 'PDF Template',
      templates,
      canEdit,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('PDF template page error:', error.message);
    res.render('admin/pdf-template', {
      title: 'PDF Template',
      templates: [],
      canEdit: false,
      success: null,
      error: 'Failed to load templates.'
    });
  }
});

router.get('/edit/:id', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM PdfTemplates WHERE TemplateID = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Template not found.'));
    }
    res.render('admin/pdf-template-form', {
      title: 'Edit PDF Template',
      template: rows[0],
      error: req.query.error || null
    });
  } catch (error) {
    res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Failed to load template.'));
  }
});

router.get('/create', requireSuperAdmin, (req, res) => {
  res.render('admin/pdf-template-form', {
    title: 'Create PDF Template',
    template: null,
    error: req.query.error || null
  });
});

router.post('/save', requireSuperAdmin, upload.single('headerImage'), async (req, res) => {
  const { templateId, headerText, subHeaderText, bodyText, footerText, removeImage } = req.body;

  try {
    let headerImage = null;

    if (templateId) {
      const [existing] = await pool.query('SELECT HeaderImage FROM PdfTemplates WHERE TemplateID = ?', [templateId]);
      if (existing.length > 0) {
        headerImage = existing[0].HeaderImage;
      }
    }

    if (removeImage === '1') {
      if (headerImage) {
        const oldPath = path.join(__dirname, '..', 'public', headerImage);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      headerImage = null;
    }

    if (req.file) {
      if (headerImage) {
        const oldPath = path.join(__dirname, '..', 'public', headerImage);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      headerImage = '/uploads/templates/' + req.file.filename;
    }

    if (templateId) {
      await pool.query(
        'UPDATE PdfTemplates SET HeaderImage = ?, HeaderText = ?, SubHeaderText = ?, BodyText = ?, FooterText = ? WHERE TemplateID = ?',
        [headerImage, headerText || null, subHeaderText || null, bodyText || null, footerText || null, templateId]
      );
    } else {
      await pool.query(
        'INSERT INTO PdfTemplates (HeaderImage, HeaderText, SubHeaderText, BodyText, FooterText, IsActive) VALUES (?, ?, ?, ?, ?, 0)',
        [headerImage, headerText || null, subHeaderText || null, bodyText || null, footerText || null]
      );
    }

    res.redirect('/admin/pdf-template?success=' + encodeURIComponent('Template saved successfully.'));
  } catch (error) {
    console.error('Save template error:', error.message);
    const target = templateId ? `/admin/pdf-template/edit/${templateId}` : '/admin/pdf-template/create';
    res.redirect(target + '?error=' + encodeURIComponent('Failed to save template.'));
  }
});

router.post('/activate/:id', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE PdfTemplates SET IsActive = 0');
    await pool.query('UPDATE PdfTemplates SET IsActive = 1 WHERE TemplateID = ?', [req.params.id]);
    res.redirect('/admin/pdf-template?success=' + encodeURIComponent('Template activated.'));
  } catch (error) {
    res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Failed to activate template.'));
  }
});

router.post('/delete/:id', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT HeaderImage, IsActive FROM PdfTemplates WHERE TemplateID = ?', [req.params.id]);
    if (rows.length > 0 && rows[0].IsActive) {
      return res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Cannot delete the active template.'));
    }
    if (rows.length > 0 && rows[0].HeaderImage) {
      const imgPath = path.join(__dirname, '..', 'public', rows[0].HeaderImage);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    await pool.query('DELETE FROM PdfTemplates WHERE TemplateID = ?', [req.params.id]);
    res.redirect('/admin/pdf-template?success=' + encodeURIComponent('Template deleted.'));
  } catch (error) {
    res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Failed to delete template.'));
  }
});

router.get('/preview/:id', async (req, res) => {
  try {
    const { generateBookingPdf } = await import('../utils/pdfGenerator.js');
    const sampleData = {
      studentName: 'John Doe',
      studentId: '12345678',
      pcClass: 'PC-2B',
      teacherName: 'Jane Teacher',
      meetingDate: 'Monday, 15 April 2026',
      meetingTime: '09:00 - 09:10',
      room: 'Room 101',
      translator: 'Thai'
    };

    const [rows] = await pool.query('SELECT * FROM PdfTemplates WHERE TemplateID = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Template not found.'));
    }

    const pdfBuffer = await generateBookingPdf(sampleData, rows[0]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="template_preview.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Preview error:', error.message);
    res.redirect('/admin/pdf-template?error=' + encodeURIComponent('Failed to generate preview.'));
  }
});

export default router;
