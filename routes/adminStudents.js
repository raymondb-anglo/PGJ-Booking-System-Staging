import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const pcClass = (req.query.pcClass || '').trim();
    let query = 'SELECT * FROM Students WHERE IsActive = 1';
    const params = [];

    if (search) {
      query += ' AND (StudentID LIKE ? OR StudentName LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (pcClass) {
      query += ' AND PCClass = ?';
      params.push(pcClass);
    }
    query += ' ORDER BY StudentID ASC';

    const [students] = await pool.query(query, params);
    const [classes] = await pool.query('SELECT DISTINCT PCClass FROM Students WHERE IsActive = 1 AND PCClass IS NOT NULL ORDER BY PCClass');
    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');

    res.render('admin/students', {
      title: 'Students',
      students,
      classes: classes.map(c => c.PCClass),
      teachers,
      search,
      pcClass,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Students list error:', error.message);
    res.status(500).render('admin/students', {
      title: 'Students',
      students: [],
      classes: [],
      teachers: [],
      search: '',
      pcClass: '',
      error: 'Failed to load students.'
    });
  }
});

router.get('/create', async (req, res) => {
  try {
    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
    res.render('admin/student-form', {
      title: 'Add Student',
      student: null,
      teachers,
      error: null
    });
  } catch (error) {
    res.status(500).render('admin/student-form', { title: 'Add Student', student: null, teachers: [], error: 'Failed to load form.' });
  }
});

router.post('/create', async (req, res) => {
  const { studentId, studentName, sNickname, magClass, pcClass, teacherCode, email } = req.body;
  if (!studentId || !studentName) {
    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
    return res.render('admin/student-form', {
      title: 'Add Student',
      student: req.body,
      teachers,
      error: 'Student ID and Name are required.'
    });
  }

  try {
    const [existing] = await pool.query('SELECT StudentID FROM Students WHERE StudentID = ?', [studentId.trim()]);
    if (existing.length > 0) {
      const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
      return res.render('admin/student-form', {
        title: 'Add Student',
        student: req.body,
        teachers,
        error: 'Student ID already exists.'
      });
    }

    let teacherName = null;
    let teacherNickname = null;
    if (teacherCode) {
      const [t] = await pool.query('SELECT TeacherName, TeacherNickname FROM Teachers WHERE TeacherCode = ? AND IsActive = 1', [teacherCode]);
      if (t.length === 0) {
        const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
        return res.render('admin/student-form', {
          title: 'Add Student',
          student: req.body,
          teachers,
          error: 'Selected teacher does not exist or is inactive.'
        });
      }
      teacherName = t[0].TeacherName;
      teacherNickname = t[0].TeacherNickname;
    }

    await pool.query(
      'INSERT INTO Students (StudentID, StudentName, SNickname, MAGClass, PCClass, TeacherID, TeacherName, TeacherNickname, Email, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [studentId.trim(), studentName.trim(), (sNickname || '').trim() || null, (magClass || '').trim() || null, (pcClass || '').trim() || null, teacherCode || null, teacherName, teacherNickname, (email || '').trim() || null]
    );

    await logAudit(req, 'CREATE_STUDENT', 'STUDENTS', `Created student ${studentId.trim()}`);
    res.redirect('/admin/students?success=Student+created+successfully');
  } catch (error) {
    console.error('Create student error:', error.message);
    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
    res.render('admin/student-form', {
      title: 'Add Student',
      student: req.body,
      teachers,
      error: 'Failed to create student.'
    });
  }
});

router.get('/edit/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Students WHERE StudentID = ?', [req.params.id]);
    if (rows.length === 0) return res.redirect('/admin/students?error=Student+not+found');

    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
    res.render('admin/student-form', {
      title: 'Edit Student',
      student: rows[0],
      teachers,
      error: null
    });
  } catch (error) {
    res.redirect('/admin/students?error=Failed+to+load+student');
  }
});

router.post('/edit/:id', async (req, res) => {
  const { studentName, sNickname, magClass, pcClass, teacherCode, email } = req.body;
  if (!studentName) {
    const [rows] = await pool.query('SELECT * FROM Students WHERE StudentID = ?', [req.params.id]);
    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
    return res.render('admin/student-form', {
      title: 'Edit Student',
      student: { ...rows[0], ...req.body },
      teachers,
      error: 'Student Name is required.'
    });
  }

  try {
    let teacherName = null;
    let teacherNickname = null;
    if (teacherCode) {
      const [t] = await pool.query('SELECT TeacherName, TeacherNickname FROM Teachers WHERE TeacherCode = ? AND IsActive = 1', [teacherCode]);
      if (t.length === 0) {
        const [rows] = await pool.query('SELECT * FROM Students WHERE StudentID = ?', [req.params.id]);
        const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName');
        return res.render('admin/student-form', {
          title: 'Edit Student',
          student: { ...rows[0], ...req.body },
          teachers,
          error: 'Selected teacher does not exist or is inactive.'
        });
      }
      teacherName = t[0].TeacherName;
      teacherNickname = t[0].TeacherNickname;
    }

    await pool.query(
      'UPDATE Students SET StudentName = ?, SNickname = ?, MAGClass = ?, PCClass = ?, TeacherID = ?, TeacherName = ?, TeacherNickname = ?, Email = ? WHERE StudentID = ?',
      [studentName.trim(), (sNickname || '').trim() || null, (magClass || '').trim() || null, (pcClass || '').trim() || null, teacherCode || null, teacherName, teacherNickname, (email || '').trim() || null, req.params.id]
    );

    await logAudit(req, 'UPDATE_STUDENT', 'STUDENTS', `Updated student ${req.params.id}`);
    res.redirect('/admin/students?success=Student+updated+successfully');
  } catch (error) {
    console.error('Update student error:', error.message);
    res.redirect('/admin/students/edit/' + req.params.id + '?error=Failed+to+update+student');
  }
});

router.post('/delete/:id', async (req, res) => {
  try {
    await pool.query('UPDATE Students SET IsActive = 0 WHERE StudentID = ?', [req.params.id]);
    await logAudit(req, 'DELETE_STUDENT', 'STUDENTS', `Soft-deleted student ${req.params.id}`);
    res.redirect('/admin/students?success=Student+deleted+successfully');
  } catch (error) {
    console.error('Delete student error:', error.message);
    res.redirect('/admin/students?error=Failed+to+delete+student');
  }
});

router.get('/import', (req, res) => {
  res.render('admin/student-import', { title: 'Import Students', error: null, preview: null, summary: null });
});

router.get('/import/template', (req, res) => {
    const csvContent = 'StudentId,Email,StudentName,SNickName,MAGClass,PCClass,TeacherID,TeacherName,TeacherNickname,IsActive\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Student_Import_Template.csv');
  res.send(csvContent);
});

router.post('/import/preview', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.render('admin/student-import', { title: 'Import Students', error: 'Please upload a CSV file.', preview: null, summary: null });
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });

    if (records.length === 0) {
      return res.render('admin/student-import', { title: 'Import Students', error: 'CSV file is empty.', preview: null, summary: null });
    }

    const [existingStudents] = await pool.query('SELECT StudentID FROM Students');
    const existingIds = new Set(existingStudents.map(s => s.StudentID));
    const [teachers] = await pool.query('SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1');
    const teacherMap = {};
    teachers.forEach(t => { teacherMap[t.TeacherCode] = t; });

    const preview = [];
    const seenIds = new Set();
    for (const row of records) {
      const studentId = (row.StudentId || row.StudentID || row.student_id || row.studentId || '').trim();
      const studentName = (row.StudentName || row.student_name || row.studentName || '').trim();
      const sNickname = (row.SNickName || row.SNickname || row.s_nickname || row.nickname || '').trim();
      const magClass = (row.MAGClass || row.mag_class || row.magClass || '').trim();
      const pcClass = (row.PCClass || row.pc_class || row.pcClass || '').trim();
      const teacherCode = (row.TeacherID || row.teacher_id || row.teacherCode || row.TeacherCode || '').trim();
      const email = (row.Email || row.email || '').trim();

      const errors = [];
      if (!studentId) errors.push('Missing Student ID');
      if (!studentName) errors.push('Missing Student Name');
      if (studentId && existingIds.has(studentId)) errors.push('Duplicate ID (exists in DB)');
      if (studentId && seenIds.has(studentId)) errors.push('Duplicate ID (in file)');
      if (teacherCode && !teacherMap[teacherCode]) errors.push('Unknown Teacher Code');

      if (studentId) seenIds.add(studentId);

      preview.push({
        studentId, studentName, sNickname, magClass, pcClass, teacherCode, email,
        teacherName: teacherMap[teacherCode]?.TeacherName || '',
        teacherNickname: teacherMap[teacherCode]?.TeacherNickname || '',
        errors,
        valid: errors.length === 0
      });
    }

    req.session.importPreview = preview;
    res.render('admin/student-import', { title: 'Import Students', error: null, preview, summary: null });
  } catch (error) {
    console.error('Import preview error:', error.message);
    res.render('admin/student-import', { title: 'Import Students', error: 'Failed to parse CSV: ' + error.message, preview: null, summary: null });
  }
});

router.post('/import/confirm', async (req, res) => {
  const preview = req.session.importPreview;
  if (!preview || preview.length === 0) {
    return res.render('admin/student-import', { title: 'Import Students', error: 'No import data. Please upload again.', preview: null, summary: null });
  }

  let successCount = 0;
  const failed = [];

  for (const row of preview) {
    if (!row.valid) {
      failed.push({ studentId: row.studentId, studentName: row.studentName, reason: row.errors.join(', ') });
      continue;
    }
    try {
      await pool.query(
        'INSERT INTO Students (StudentID, StudentName, SNickname, MAGClass, PCClass, TeacherID, TeacherName, TeacherNickname, Email, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
        [row.studentId, row.studentName, row.sNickname || null, row.magClass || null, row.pcClass || null, row.teacherCode || null, row.teacherName || null, row.teacherNickname || null, row.email || null]
      );
      successCount++;
    } catch (error) {
      failed.push({ studentId: row.studentId, studentName: row.studentName, reason: error.message });
    }
  }

  delete req.session.importPreview;
  await logAudit(req, 'IMPORT_STUDENTS', 'STUDENTS', `Imported ${successCount} students, ${failed.length} failed`);

  res.render('admin/student-import', {
    title: 'Import Students',
    error: null,
    preview: null,
    summary: { successCount, failed, total: preview.length }
  });
});

export default router;
