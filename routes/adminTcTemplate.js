import { Router } from 'express';
import pool from '../db.js';
import { requireSuperAdmin } from './adminAuth.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const [templates] = await pool.query(
      'SELECT * FROM TcTemplates ORDER BY IsActive DESC, TemplateID DESC'
    );
    const canEdit = req.session.adminRole === 'SUPER_ADMIN';
    res.render('admin/tc-template', {
      title: 'Terms & Conditions Templates',
      templates,
      canEdit,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('TC template page error:', error.message);
    res.render('admin/tc-template', {
      title: 'Terms & Conditions Templates',
      templates: [],
      canEdit: false,
      success: null,
      error: 'Failed to load templates.'
    });
  }
});

router.get('/create', requireSuperAdmin, (req, res) => {
  res.render('admin/tc-template-form', {
    title: 'Create T&C Template',
    template: null,
    error: req.query.error || null
  });
});

router.get('/edit/:id', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM TcTemplates WHERE TemplateID = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.redirect('/admin/tc-template?error=' + encodeURIComponent('Template not found.'));
    }
    res.render('admin/tc-template-form', {
      title: 'Edit T&C Template',
      template: rows[0],
      error: req.query.error || null
    });
  } catch (error) {
    res.redirect('/admin/tc-template?error=' + encodeURIComponent('Failed to load template.'));
  }
});

router.post('/save', requireSuperAdmin, async (req, res) => {
  const { templateId, templateName, content, contentTH, contentCN } = req.body;
  if (!templateName || !templateName.trim()) {
    const target = templateId ? `/admin/tc-template/edit/${templateId}` : '/admin/tc-template/create';
    return res.redirect(target + '?error=' + encodeURIComponent('Template name is required.'));
  }

  try {
    if (templateId) {
      await pool.query(
        'UPDATE TcTemplates SET TemplateName = ?, Content = ?, ContentTH = ?, ContentCN = ? WHERE TemplateID = ?',
        [templateName.trim(), content || '', contentTH || '', contentCN || '', templateId]
      );
    } else {
      await pool.query(
        'DECLARE @NextID INT = ISNULL((SELECT MAX(TemplateID) FROM TcTemplates WITH (UPDLOCK, HOLDLOCK)), 0) + 1; INSERT INTO TcTemplates (TemplateID, TemplateName, Content, ContentTH, ContentCN, IsActive) VALUES (@NextID, ?, ?, ?, ?, 0)',
        [templateName.trim(), content || '', contentTH || '', contentCN || '']
      );
    }
    res.redirect('/admin/tc-template?success=' + encodeURIComponent('Template saved successfully.'));
  } catch (error) {
    console.error('Save TC template error:', error.message);
    const target = templateId ? `/admin/tc-template/edit/${templateId}` : '/admin/tc-template/create';
    res.redirect(target + '?error=' + encodeURIComponent('Failed to save template.'));
  }
});

router.post('/activate/:id', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE TcTemplates SET IsActive = 0');
    await pool.query('UPDATE TcTemplates SET IsActive = 1 WHERE TemplateID = ?', [req.params.id]);
    res.redirect('/admin/tc-template?success=' + encodeURIComponent('Template activated.'));
  } catch (error) {
    res.redirect('/admin/tc-template?error=' + encodeURIComponent('Failed to activate template.'));
  }
});

router.post('/delete/:id', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT IsActive FROM TcTemplates WHERE TemplateID = ?', [req.params.id]);
    if (rows.length > 0 && rows[0].IsActive) {
      return res.redirect('/admin/tc-template?error=' + encodeURIComponent('Cannot delete the active template.'));
    }
    await pool.query('DELETE FROM TcTemplates WHERE TemplateID = ?', [req.params.id]);
    res.redirect('/admin/tc-template?success=' + encodeURIComponent('Template deleted.'));
  } catch (error) {
    res.redirect('/admin/tc-template?error=' + encodeURIComponent('Failed to delete template.'));
  }
});

export default router;
