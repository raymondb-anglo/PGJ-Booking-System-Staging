import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function superAdminOnly(req, res, next) {
  if (req.session && req.session.adminRole === 'SUPER_ADMIN') return next();
  return res.status(403).render('admin/forbidden', {
    title: 'Access Denied',
    message: 'You do not have permission to access this page. Super Admin access required.'
  });
}

router.get('/', (req, res) => {
  res.redirect('/admin/config/school-year');
});

router.get('/school-year', superAdminOnly, async (req, res) => {
  try {
    const [years] = await pool.query('SELECT * FROM SchoolYears ORDER BY SchoolYearID DESC');
    const [terms] = await pool.query(
      `SELECT bt.*, sy.YearLabel
       FROM BookingTerms bt
       JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       ORDER BY bt.SchoolYearID DESC, bt.TermID DESC`
    );
    res.render('admin/config/school-year', {
      title: 'School Year & Terms',
      years,
      terms,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading school years:', error.message);
    res.render('admin/config/school-year', { title: 'School Year & Terms', years: [], terms: [], error: error.message });
  }
});

router.post('/school-year/create', superAdminOnly, async (req, res) => {
  const { yearLabel } = req.body;
  if (!yearLabel || !yearLabel.trim()) {
    return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('Year label is required.'));
  }
  try {
    await pool.query('INSERT INTO SchoolYears (YearLabel) VALUES (?)', [yearLabel.trim()]);
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('School year created.'));
  } catch (error) {
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  }
});

router.post('/school-year/edit', superAdminOnly, async (req, res) => {
  const { schoolYearId, yearLabel } = req.body;
  if (!schoolYearId || !yearLabel || !yearLabel.trim()) {
    return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('Year ID and label are required.'));
  }
  try {
    await pool.query('UPDATE SchoolYears SET YearLabel = ? WHERE SchoolYearID = ?', [yearLabel.trim(), schoolYearId]);
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('School year updated.'));
  } catch (error) {
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  }
});

router.post('/school-year/activate', superAdminOnly, async (req, res) => {
  const { schoolYearId } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE SchoolYears SET IsActive = 0');
    await conn.query('UPDATE SchoolYears SET IsActive = 1 WHERE SchoolYearID = ?', [schoolYearId]);
    await conn.commit();
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('School year activated.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  } finally {
    conn.release();
  }
});

router.post('/term/create', superAdminOnly, async (req, res) => {
  const { schoolYearId, termLabel } = req.body;
  if (!schoolYearId || !termLabel || !termLabel.trim()) {
    return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('School year and term label are required.'));
  }
  try {
    await pool.query('INSERT INTO BookingTerms (SchoolYearID, TermLabel) VALUES (?, ?)', [schoolYearId, termLabel.trim()]);
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('Booking term created.'));
  } catch (error) {
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  }
});

router.post('/term/edit', superAdminOnly, async (req, res) => {
  const { termId, termLabel, schoolYearId } = req.body;
  if (!termId || !termLabel || !termLabel.trim()) {
    return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('Term ID and label are required.'));
  }
  try {
    const updates = ['TermLabel = ?'];
    const params = [termLabel.trim()];
    if (schoolYearId) {
      updates.push('SchoolYearID = ?');
      params.push(schoolYearId);
    }
    params.push(termId);
    await pool.query(`UPDATE BookingTerms SET ${updates.join(', ')} WHERE TermID = ?`, params);
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('Booking term updated.'));
  } catch (error) {
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  }
});

router.post('/term/activate', superAdminOnly, async (req, res) => {
  const { termId } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE BookingTerms SET IsActive = 0');
    await conn.query('UPDATE BookingTerms SET IsActive = 1 WHERE TermID = ?', [termId]);
    await conn.commit();
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('Term activated.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  } finally {
    conn.release();
  }
});

router.post('/school-year/delete', superAdminOnly, async (req, res) => {
  const { schoolYearId } = req.body;
  if (!schoolYearId) {
    return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('School year ID is required.'));
  }
  try {
    const [yr] = await pool.query('SELECT IsActive FROM SchoolYears WHERE SchoolYearID = ?', [schoolYearId]);
    if (yr.length > 0 && yr[0].IsActive) {
      return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('Cannot delete the active school year.'));
    }
    await pool.query('DELETE FROM BookingTerms WHERE SchoolYearID = ?', [schoolYearId]);
    await pool.query('DELETE FROM SchoolYears WHERE SchoolYearID = ?', [schoolYearId]);
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('School year and its terms deleted.'));
  } catch (error) {
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  }
});

router.post('/term/delete', superAdminOnly, async (req, res) => {
  const { termId } = req.body;
  if (!termId) {
    return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('Term ID is required.'));
  }
  try {
    const [tm] = await pool.query('SELECT IsActive FROM BookingTerms WHERE TermID = ?', [termId]);
    if (tm.length > 0 && tm[0].IsActive) {
      return res.redirect('/admin/config/school-year?error=' + encodeURIComponent('Cannot delete the active booking term.'));
    }
    await pool.query('DELETE FROM BookingTerms WHERE TermID = ?', [termId]);
    res.redirect('/admin/config/school-year?success=' + encodeURIComponent('Booking term deleted.'));
  } catch (error) {
    res.redirect('/admin/config/school-year?error=' + encodeURIComponent(error.message));
  }
});

router.get('/parent-login', superAdminOnly, async (req, res) => {
  try {
    const [terms] = await pool.query(
      `SELECT bt.TermID, bt.TermLabel, sy.YearLabel, bt.IsActive
       FROM BookingTerms bt
       JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       ORDER BY bt.IsActive DESC, bt.TermID DESC`
    );

    const [allContent] = await pool.query(
      "SELECT TermID, SettingValue FROM SystemSettings WHERE SettingKey = 'parent_login_content'"
    );
    const contentMap = {};
    allContent.forEach(c => { contentMap[c.TermID] = c.SettingValue; });

    terms.forEach(t => {
      t.hasContent = !!(contentMap[t.TermID] && contentMap[t.TermID].trim().length > 0);
    });

    let content = '';
    let selectedTermId = req.query.termId || null;

    if (!selectedTermId && terms.length > 0) {
      const activeTerm = terms.find(t => t.IsActive) || terms[0];
      selectedTermId = activeTerm.TermID;
    }

    if (selectedTermId) {
      content = contentMap[selectedTermId] || '';
    }

    res.render('admin/config/parent-login', {
      title: 'Parent Login Content',
      terms,
      selectedTermId: parseInt(selectedTermId),
      content,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    res.render('admin/config/parent-login', { title: 'Parent Login Content', terms: [], selectedTermId: null, content: '', error: error.message });
  }
});

router.post('/parent-login/save', superAdminOnly, async (req, res) => {
  const { termId, content } = req.body;
  if (!termId) {
    return res.redirect('/admin/config/parent-login?error=' + encodeURIComponent('Please select a term.'));
  }
  try {
    await pool.query(
      `UPDATE SystemSettings SET SettingValue = ? WHERE TermID = ? AND SettingKey = 'parent_login_content';
       IF @@ROWCOUNT = 0
       INSERT INTO SystemSettings (TermID, SettingKey, SettingValue) VALUES (?, 'parent_login_content', ?);`,
      [content || '', termId, termId, content || '']
    );
    res.redirect('/admin/config/parent-login?termId=' + termId + '&success=' + encodeURIComponent('Content saved.'));
  } catch (error) {
    res.redirect('/admin/config/parent-login?error=' + encodeURIComponent(error.message));
  }
});

export default router;
