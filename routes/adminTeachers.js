import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'public', 'uploads', 'teachers');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = 'teacher_' + Date.now() + ext;
      cb(null, name);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const showInactive = req.query.showInactive === '1';
    let query = 'SELECT * FROM Teachers';
    const params = [];

    if (!showInactive) {
      query += ' WHERE IsActive = 1';
    }

    if (search) {
      query += (showInactive ? ' WHERE' : ' AND') + ' (TeacherCode LIKE ? OR TeacherName LIKE ? OR TeacherNickname LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY TeacherName ASC';

    const [teachers] = await pool.query(query, params);

    res.render('admin/teachers', {
      title: 'Teachers',
      teachers,
      search,
      showInactive,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Teachers list error:', error.message);
    res.status(500).render('admin/teachers', {
      title: 'Teachers',
      teachers: [],
      search: '',
      showInactive: false,
      error: 'Failed to load teachers.'
    });
  }
});

router.get('/create', async (req, res) => {
  const [meetingDates] = await pool.query('SELECT DateID, DayNumber, DayLabel FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber');
  res.render('admin/teacher-form', { title: 'Add Teacher', teacher: null, meetingDates, error: null });
});

router.post('/create', imageUpload.single('teacherImage'), async (req, res) => {
  const { teacherCode, teacherName, teacherNickname, email, room } = req.body;
  const meetingDaysArr = req.body.meetingDays || [];
  const meetingDays = (Array.isArray(meetingDaysArr) ? meetingDaysArr : [meetingDaysArr]).filter(Boolean).join(',');

  if (!teacherCode || !teacherName || !teacherNickname) {
    const [meetingDates] = await pool.query('SELECT DateID, DayNumber, DayLabel FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber');
    return res.render('admin/teacher-form', {
      title: 'Add Teacher',
      teacher: { ...req.body, MeetingDays: meetingDays },
      meetingDates,
      error: 'Teacher Code, Name, and Nickname are required.'
    });
  }

  try {
    const [existing] = await pool.query('SELECT TeacherCode FROM Teachers WHERE TeacherCode = ?', [teacherCode.trim()]);
    if (existing.length > 0) {
      const [meetingDates] = await pool.query('SELECT DateID, DayNumber, DayLabel FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber');
      return res.render('admin/teacher-form', {
        title: 'Add Teacher',
        teacher: { ...req.body, MeetingDays: meetingDays },
        meetingDates,
        error: 'Teacher Code already exists.'
      });
    }

    const imagePath = req.file ? '/uploads/teachers/' + req.file.filename : null;

    await pool.query(
      'INSERT INTO Teachers (TeacherCode, TeacherName, TeacherNickname, TeacherImage, Email, Room, MeetingDays, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [teacherCode.trim(), teacherName.trim(), teacherNickname.trim(), imagePath, (email || '').trim() || null, (room || '').trim() || null, meetingDays || null]
    );

    await logAudit(req, 'CREATE_TEACHER', 'TEACHERS', `Created teacher ${teacherCode.trim()}`);
    res.redirect('/admin/teachers?success=Teacher+created+successfully');
  } catch (error) {
    console.error('Create teacher error:', error.message);
    const [meetingDates] = await pool.query('SELECT DateID, DayNumber, DayLabel FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber');
    res.render('admin/teacher-form', {
      title: 'Add Teacher',
      teacher: { ...req.body, MeetingDays: meetingDays },
      meetingDates,
      error: 'Failed to create teacher.'
    });
  }
});

router.get('/edit/:code', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM Teachers WHERE TeacherCode = ?', [req.params.code]);
    if (rows.length === 0) return res.redirect('/admin/teachers?error=Teacher+not+found');

    const [meetingDates] = await pool.query('SELECT DateID, DayNumber, DayLabel FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber');
    res.render('admin/teacher-form', { title: 'Edit Teacher', teacher: rows[0], meetingDates, error: null });
  } catch (error) {
    res.redirect('/admin/teachers?error=Failed+to+load+teacher');
  }
});

router.post('/edit/:code', imageUpload.single('teacherImage'), async (req, res) => {
  const { teacherName, teacherNickname, email, room } = req.body;
  const meetingDaysArr = req.body.meetingDays || [];
  const meetingDays = (Array.isArray(meetingDaysArr) ? meetingDaysArr : [meetingDaysArr]).filter(Boolean).join(',');

  if (!teacherName || !teacherNickname) {
    const [rows] = await pool.query('SELECT * FROM Teachers WHERE TeacherCode = ?', [req.params.code]);
    const [meetingDates] = await pool.query('SELECT DateID, DayNumber, DayLabel FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber');
    return res.render('admin/teacher-form', {
      title: 'Edit Teacher',
      teacher: { ...rows[0], ...req.body, MeetingDays: meetingDays },
      meetingDates,
      error: 'Name and Nickname are required.'
    });
  }

  try {
    let imagePath = undefined;
    if (req.file) {
      imagePath = '/uploads/teachers/' + req.file.filename;
    }

    const updateFields = ['TeacherName = ?', 'TeacherNickname = ?', 'Email = ?', 'Room = ?', 'MeetingDays = ?'];
    const updateParams = [teacherName.trim(), teacherNickname.trim(), (email || '').trim() || null, (room || '').trim() || null, meetingDays || null];

    if (imagePath !== undefined) {
      updateFields.push('TeacherImage = ?');
      updateParams.push(imagePath);
    }

    updateParams.push(req.params.code);
    await pool.query(`UPDATE Teachers SET ${updateFields.join(', ')} WHERE TeacherCode = ?`, updateParams);

    await pool.query(
      'UPDATE Students SET TeacherName = ?, TeacherNickname = ? WHERE TeacherID = ?',
      [teacherName.trim(), teacherNickname.trim(), req.params.code]
    );

    await logAudit(req, 'UPDATE_TEACHER', 'TEACHERS', `Updated teacher ${req.params.code}`);
    res.redirect('/admin/teachers?success=Teacher+updated+successfully');
  } catch (error) {
    console.error('Update teacher error:', error.message);
    res.redirect('/admin/teachers/edit/' + req.params.code + '?error=Failed+to+update+teacher');
  }
});

router.post('/toggle/:code', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT IsActive FROM Teachers WHERE TeacherCode = ?', [req.params.code]);
    if (rows.length === 0) return res.redirect('/admin/teachers?error=Teacher+not+found');

    const newStatus = rows[0].IsActive ? 0 : 1;
    await pool.query('UPDATE Teachers SET IsActive = ? WHERE TeacherCode = ?', [newStatus, req.params.code]);

    const action = newStatus ? 'ACTIVATE_TEACHER' : 'DEACTIVATE_TEACHER';
    await logAudit(req, action, 'TEACHERS', `${newStatus ? 'Activated' : 'Deactivated'} teacher ${req.params.code}`);
    res.redirect('/admin/teachers?success=Teacher+' + (newStatus ? 'activated' : 'deactivated') + '+successfully');
  } catch (error) {
    console.error('Toggle teacher error:', error.message);
    res.redirect('/admin/teachers?error=Failed+to+update+teacher+status');
  }
});

router.get('/import', (req, res) => {
  res.render('admin/teacher-import', { title: 'Import Teachers', error: null, preview: null, summary: null });
});

router.get('/import/template', (req, res) => {
  const csvContent = 'TeacherCode,TeacherName,TeacherNickname,Email,Room,MeetingDays\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Teacher_Import_Template.csv');
  res.send(csvContent);
});

router.post('/import/preview', csvUpload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.render('admin/teacher-import', { title: 'Import Teachers', error: 'Please upload a CSV file.', preview: null, summary: null });
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });

    if (records.length === 0) {
      return res.render('admin/teacher-import', { title: 'Import Teachers', error: 'CSV file is empty.', preview: null, summary: null });
    }

    const [existingTeachers] = await pool.query('SELECT TeacherCode FROM Teachers');
    const existingCodes = new Set(existingTeachers.map(t => t.TeacherCode));

    const preview = [];
    const seenCodes = new Set();
    for (const row of records) {
      const teacherCode = (row.TeacherCode || row.teacher_code || row.teacherCode || row.TeacherID || '').trim();
      const teacherName = (row.TeacherName || row.teacher_name || row.teacherName || '').trim();
      const teacherNickname = (row.TeacherNickname || row.teacher_nickname || row.teacherNickname || row.Nickname || '').trim();
      const email = (row.Email || row.email || '').trim();
      const room = (row.Room || row.room || '').trim();
      const meetingDays = (row.MeetingDays || row.meeting_days || row.meetingDays || '').trim();

      const errors = [];
      if (!teacherCode) errors.push('Missing Teacher Code');
      if (!teacherName) errors.push('Missing Teacher Name');
      if (!teacherNickname) errors.push('Missing Nickname');
      if (teacherCode && existingCodes.has(teacherCode)) errors.push('Duplicate Code (exists in DB)');
      if (teacherCode && seenCodes.has(teacherCode)) errors.push('Duplicate Code (in file)');

      if (teacherCode) seenCodes.add(teacherCode);

      preview.push({ teacherCode, teacherName, teacherNickname, email, room, meetingDays, errors, valid: errors.length === 0 });
    }

    req.session.teacherImportPreview = preview;
    res.render('admin/teacher-import', { title: 'Import Teachers', error: null, preview, summary: null });
  } catch (error) {
    console.error('Teacher import preview error:', error.message);
    res.render('admin/teacher-import', { title: 'Import Teachers', error: 'Failed to parse CSV: ' + error.message, preview: null, summary: null });
  }
});

router.post('/import/confirm', async (req, res) => {
  const preview = req.session.teacherImportPreview;
  if (!preview || preview.length === 0) {
    return res.render('admin/teacher-import', { title: 'Import Teachers', error: 'No import data. Please upload again.', preview: null, summary: null });
  }

  let successCount = 0;
  const failed = [];

  for (const row of preview) {
    if (!row.valid) {
      failed.push({ teacherCode: row.teacherCode, teacherName: row.teacherName, reason: row.errors.join(', ') });
      continue;
    }
    try {
      await pool.query(
        'INSERT INTO Teachers (TeacherID, TeacherCode, TeacherName, TeacherNickname, Email, Room, MeetingDays, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [row.teacherCode, row.teacherCode, row.teacherName, row.teacherNickname, row.email || null, row.room || null, row.meetingDays || null]
      );
      successCount++;
    } catch (error) {
      failed.push({ teacherCode: row.teacherCode, teacherName: row.teacherName, reason: error.message });
    }
  }

  delete req.session.teacherImportPreview;
  await logAudit(req, 'IMPORT_TEACHERS', 'TEACHERS', `Imported ${successCount} teachers, ${failed.length} failed`);

  res.render('admin/teacher-import', {
    title: 'Import Teachers',
    error: null,
    preview: null,
    summary: { successCount, failed, total: preview.length }
  });
});

export default router;
