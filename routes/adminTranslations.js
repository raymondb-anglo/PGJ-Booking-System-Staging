import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';

const router = Router();

async function ensureTranslationsTable() {
  // MSSQL schema is already pre-configured by user.
  return;
}

router.get('/', async (req, res) => {
  try {
    await ensureTranslationsTable();
    const [languages] = await pool.query(
      'SELECT * FROM Translations ORDER BY SortOrder, LanguageName'
    );
    res.render('admin/translations', {
      title: 'Translator Languages',
      languages,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Translations page error:', error.message);
    res.render('admin/translations', {
      title: 'Translator Languages',
      languages: [],
      error: 'Failed to load languages: ' + error.message,
      success: null
    });
  }
});

router.post('/add', async (req, res) => {
  try {
    await ensureTranslationsTable();
    const { languageName, languageCode, sortOrder } = req.body;
    if (!languageName || !languageName.trim()) {
      return res.redirect('/admin/translations?error=' + encodeURIComponent('Language name is required.'));
    }

    const [existing] = await pool.query(
      'SELECT TranslationID FROM Translations WHERE LanguageName = ?',
      [languageName.trim()]
    );
    if (existing.length > 0) {
      return res.redirect('/admin/translations?error=' + encodeURIComponent('This language already exists.'));
    }

    await pool.query(
      'INSERT INTO Translations (LanguageName, LanguageCode, SortOrder) VALUES (?, ?, ?)',
      [languageName.trim(), (languageCode || '').trim() || null, parseInt(sortOrder) || 0]
    );
    await logAudit(req, 'ADD_LANGUAGE', 'TRANSLATIONS', `Added language: ${languageName.trim()}`);
    res.redirect('/admin/translations?success=' + encodeURIComponent('Language added successfully.'));
  } catch (error) {
    console.error('Add language error:', error.message);
    res.redirect('/admin/translations?error=' + encodeURIComponent('Failed to add language.'));
  }
});

router.post('/:id/update', async (req, res) => {
  try {
    const { id } = req.params;
    const { languageName, languageCode, sortOrder, isActive } = req.body;
    if (!languageName || !languageName.trim()) {
      return res.redirect('/admin/translations?error=' + encodeURIComponent('Language name is required.'));
    }

    await pool.query(
      'UPDATE Translations SET LanguageName = ?, LanguageCode = ?, SortOrder = ?, IsActive = ? WHERE TranslationID = ?',
      [languageName.trim(), (languageCode || '').trim() || null, parseInt(sortOrder) || 0, isActive === 'on' || isActive === '1' ? 1 : 0, id]
    );
    await logAudit(req, 'UPDATE_LANGUAGE', 'TRANSLATIONS', `Updated language ID: ${id}, Name: ${languageName.trim()}`);
    res.redirect('/admin/translations?success=' + encodeURIComponent('Language updated successfully.'));
  } catch (error) {
    console.error('Update language error:', error.message);
    res.redirect('/admin/translations?error=' + encodeURIComponent('Failed to update language.'));
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const [lang] = await pool.query('SELECT LanguageName FROM Translations WHERE TranslationID = ?', [id]);
    await pool.query('DELETE FROM Translations WHERE TranslationID = ?', [id]);
    await logAudit(req, 'DELETE_LANGUAGE', 'TRANSLATIONS', `Deleted language ID: ${id}, Name: ${lang[0]?.LanguageName || 'Unknown'}`);
    res.redirect('/admin/translations?success=' + encodeURIComponent('Language deleted.'));
  } catch (error) {
    console.error('Delete language error:', error.message);
    res.redirect('/admin/translations?error=' + encodeURIComponent('Failed to delete language.'));
  }
});

router.get('/api/languages', async (req, res) => {
  try {
    await ensureTranslationsTable();
    const [languages] = await pool.query(
      'SELECT TranslationID, LanguageName, LanguageCode FROM Translations WHERE IsActive = 1 ORDER BY SortOrder, LanguageName'
    );
    res.json(languages);
  } catch (error) {
    console.error('API languages error:', error.message);
    res.json([]);
  }
});

export default router;
