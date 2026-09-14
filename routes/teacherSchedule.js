import { Router } from 'express';
import pool from '../db.js';
import PDFDocument from 'pdfkit';

const router = Router();

const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 60;

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateLimit.get(ip);

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimit.set(ip, { start: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimit) {
    if (now - entry.start > RATE_LIMIT_WINDOW) rateLimit.delete(ip);
  }
}, RATE_LIMIT_WINDOW);

router.use(rateLimiter);

async function getActiveTerm() {
  const [terms] = await pool.query(
    `SELECT TOP 1 bt.TermID, bt.TermLabel, sy.YearLabel
     FROM BookingTerms bt
     INNER JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
     WHERE bt.IsActive = 1
     ORDER BY bt.TermID DESC`
  );
  return terms.length > 0 ? terms[0] : null;
}

async function getMeetingDates(termId) {
  const [rows] = await pool.query(
    `SELECT DateID, MeetingDate, DayNumber, DayLabel
     FROM MeetingDates
     WHERE TermID = ? AND IsActive = 1
     ORDER BY DayNumber, MeetingDate`,
    [termId]
  );
  return rows;
}

async function getScheduleData(teacherCode, termId, dateId) {
  const params = [teacherCode, termId];
  let dateFilter = '';
  if (dateId) {
    dateFilter = ' AND md.DateID = ?';
    params.push(dateId);
  }

  const [bookings] = await pool.query(
    `SELECT md.MeetingDate, md.DayNumber, md.DayLabel,
            ts.ScheduleCode, ts.StartTime, ts.EndTime,
            s.StudentName, b.StudentID, s.PCClass,
            b.TranslatorRequired, b.TranslatorLanguage
     FROM Bookings b
     INNER JOIN MeetingDates md ON md.DateID = b.MeetingDateID
     INNER JOIN TimeSlots ts ON ts.SlotID = b.SlotID
     INNER JOIN Students s ON s.StudentID = b.StudentID
     WHERE b.TeacherCode = ?
       AND b.Status = 'CONFIRMED'
       AND md.TermID = ?
       AND md.IsActive = 1${dateFilter}
     ORDER BY md.MeetingDate, ts.StartTime`,
    params
  );

  return bookings.map(b => ({
    meetingDate: b.MeetingDate,
    dayNumber: b.DayNumber,
    dayLabel: b.DayLabel || ('Day ' + b.DayNumber),
    scheduleCode: b.ScheduleCode,
    startTime: b.StartTime ? b.StartTime.substring(0, 5) : '',
    endTime: b.EndTime ? b.EndTime.substring(0, 5) : '',
    studentName: b.StudentName,
    studentId: b.StudentID,
    pcClass: b.PCClass || '',
    translatorRequired: b.TranslatorRequired ? true : false,
    translatorLanguage: b.TranslatorLanguage || ''
  }));
}

async function getSchoolName() {
  try {
    const [rows] = await pool.query(
      `SELECT TOP 1 SettingValue FROM SystemSettings WHERE SettingKey = 'school_name'`
    );
    return rows.length > 0 ? rows[0].SettingValue : 'PGJ Booking System';
  } catch {
    return 'PGJ Booking System';
  }
}

router.get('/', async (req, res) => {
  try {
    const activeTerm = await getActiveTerm();

    let teachers = [];
    let meetingDates = [];
    if (activeTerm) {
      const [rows] = await pool.query(
        `SELECT DISTINCT t.TeacherCode, t.TeacherName, t.TeacherNickname, t.Room
         FROM Teachers t
         WHERE t.IsActive = 1
         ORDER BY t.TeacherName`
      );
      teachers = rows;
      meetingDates = await getMeetingDates(activeTerm.TermID);
    }

    res.render('teacher-schedule', {
      title: 'Teacher Schedule',
      teachers,
      meetingDates,
      activeTerm,
      isAdmin: false
    });
  } catch (error) {
    console.error('Teacher schedule page error:', error);
    res.status(500).render('teacher-schedule', {
      title: 'Teacher Schedule',
      teachers: [],
      meetingDates: [],
      activeTerm: null,
      isAdmin: false,
      error: 'Failed to load teacher schedule. Please try again later.'
    });
  }
});

router.get('/api/schedule/:teacherCode', async (req, res) => {
  const { teacherCode } = req.params;
  const dateId = req.query.dateId ? parseInt(req.query.dateId) : null;

  try {
    const [teachers] = await pool.query(
      `SELECT TeacherCode, TeacherName, TeacherNickname, Room
       FROM Teachers WHERE TeacherCode = ? AND IsActive = 1`,
      [teacherCode]
    );

    if (teachers.length === 0) {
      return res.json({ success: false, message: 'Teacher not found.' });
    }

    const activeTerm = await getActiveTerm();
    if (!activeTerm) {
      return res.json({ success: true, teacher: teachers[0], bookings: [] });
    }

    const bookings = await getScheduleData(teacherCode, activeTerm.TermID, dateId);

    res.json({ success: true, teacher: teachers[0], bookings });
  } catch (error) {
    console.error('Teacher schedule API error:', error);
    res.status(500).json({ success: false, message: 'Failed to load schedule.' });
  }
});

router.get('/api/pdf/:teacherCode', async (req, res) => {
  const { teacherCode } = req.params;
  const dateId = req.query.dateId ? parseInt(req.query.dateId) : null;

  try {
    const [teachers] = await pool.query(
      `SELECT TeacherCode, TeacherName, TeacherNickname, Room
       FROM Teachers WHERE TeacherCode = ? AND IsActive = 1`,
      [teacherCode]
    );

    if (teachers.length === 0) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    const teacher = teachers[0];
    const activeTerm = await getActiveTerm();
    if (!activeTerm) {
      return res.status(404).json({ success: false, message: 'No active term.' });
    }

    const bookings = await getScheduleData(teacherCode, activeTerm.TermID, dateId);
    const schoolName = await getSchoolName();

    let dateLabel = 'All Dates';
    if (dateId) {
      const meetingDates = await getMeetingDates(activeTerm.TermID);
      const md = meetingDates.find(d => d.DateID === dateId);
      if (md) {
        dateLabel = (md.DayLabel || 'Day ' + md.DayNumber) + ' — ' +
          new Date(md.MeetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }

    const teacherDisplay = teacher.TeacherName + (teacher.TeacherNickname ? ' (' + teacher.TeacherNickname + ')' : '');
    const safeName = teacher.TeacherName.replace(/[^a-zA-Z0-9]/g, '_');
    const safeDate = dateId ? dateLabel.replace(/[^a-zA-Z0-9]/g, '_') : 'AllDates';
    const filename = `TeacherSchedule_${safeName}_${safeDate}.pdf`;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));

    const pdfReady = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));

    doc.fontSize(16).font('Helvetica-Bold').text(schoolName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica-Bold').text('Teacher Schedule', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Teacher: ${teacherDisplay}${teacher.Room ? '  |  Room: ' + teacher.Room : ''}`, { align: 'left' });
    doc.text(`Term: ${activeTerm.TermLabel} — ${activeTerm.YearLabel}`, { align: 'left' });
    doc.text(`Date: ${dateLabel}`, { align: 'left' });
    doc.text(`Generated: ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`, { align: 'left' });
    doc.moveDown(0.8);

    if (bookings.length === 0) {
      doc.fontSize(11).text('No bookings scheduled for this teacher.', { align: 'center' });
    } else {
      const cols = [
        { label: 'Date', width: 70 },
        { label: 'Day', width: 45 },
        { label: 'Code', width: 38 },
        { label: 'Time', width: 65 },
        { label: 'Student Name', width: 120 },
        { label: 'Student ID', width: 65 },
        { label: 'Class', width: 45 },
        { label: 'Trans.', width: 32 },
        { label: 'Language', width: 55 }
      ];
      const tableLeft = doc.page.margins.left;
      const rowHeight = 18;
      let y = doc.y;

      doc.fontSize(7).font('Helvetica-Bold');
      doc.rect(tableLeft, y, cols.reduce((s, c) => s + c.width, 0), rowHeight).fill('#f0f0f0').stroke('#cccccc');
      doc.fillColor('#000000');
      let x = tableLeft;
      cols.forEach(col => {
        doc.text(col.label, x + 3, y + 4, { width: col.width - 6, height: rowHeight, lineBreak: false });
        x += col.width;
      });
      y += rowHeight;

      doc.font('Helvetica').fontSize(7);
      bookings.forEach((b, idx) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          y = doc.page.margins.top;

          doc.font('Helvetica-Bold').fontSize(7);
          doc.rect(tableLeft, y, cols.reduce((s, c) => s + c.width, 0), rowHeight).fill('#f0f0f0').stroke('#cccccc');
          doc.fillColor('#000000');
          let hx = tableLeft;
          cols.forEach(col => {
            doc.text(col.label, hx + 3, y + 4, { width: col.width - 6, height: rowHeight, lineBreak: false });
            hx += col.width;
          });
          y += rowHeight;
          doc.font('Helvetica').fontSize(7);
        }

        const bg = idx % 2 === 0 ? '#ffffff' : '#f9f9f9';
        doc.rect(tableLeft, y, cols.reduce((s, c) => s + c.width, 0), rowHeight).fill(bg).stroke('#e0e0e0');
        doc.fillColor('#000000');

        let dateStr = '';
        if (b.meetingDate) {
          dateStr = new Date(b.meetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        }

        const values = [dateStr, b.dayLabel, b.scheduleCode, b.startTime + '–' + b.endTime, b.studentName, b.studentId, b.pcClass || '', b.translatorRequired ? 'Yes' : 'No', b.translatorLanguage || ''];

        x = tableLeft;
        values.forEach((val, i) => {
          doc.text(String(val), x + 3, y + 4, { width: cols[i].width - 6, height: rowHeight, lineBreak: false });
          x += cols[i].width;
        });
        y += rowHeight;
      });

      doc.moveDown(1);
      doc.fontSize(9).text(`Total bookings: ${bookings.length}`, { align: 'left' });
    }

    doc.end();
    const pdfBuffer = await pdfReady;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Teacher schedule PDF error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate PDF.' });
  }
});

export default router;
