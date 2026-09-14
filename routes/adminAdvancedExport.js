import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function requireSuperAdminCheck(req, res, next) {
  if (req.session.adminRole !== 'SUPER_ADMIN') {
    return res.status(403).render('admin/forbidden', { title: 'Access Denied' });
  }
  next();
}

router.use(requireSuperAdminCheck);

const BASE_SQL = `
  SELECT b.BookingID, b.ScheduleCode,
         t.Email AS TeacherEmail, t.TeacherName,
         s.Email AS StudentEmail, s.StudentID AS StudentCode,
         s.SNickname, s.StudentName, s.PCClass,
         md.DayNumber, md.DayLabel,
         ts.StartTime, ts.EndTime
  FROM Bookings b
  INNER JOIN Students s ON s.StudentID = b.StudentID
  INNER JOIN Teachers t ON t.TeacherCode = b.TeacherCode
  INNER JOIN TimeSlots ts ON ts.SlotID = b.SlotID
  INNER JOIN MeetingDates md ON md.DateID = b.MeetingDateID
  WHERE b.Status = 'CONFIRMED'
`;

const ORDER_SQL = ' ORDER BY s.PCClass, md.DayNumber, ts.StartTime, b.ScheduleCode';

function buildFilters(query) {
  const where = [];
  const params = [];

  if (query.dateId) {
    where.push('b.MeetingDateID = ?');
    params.push(query.dateId);
  }
  if (query.teacherCode) {
    where.push('b.TeacherCode = ?');
    params.push(query.teacherCode);
  }
  if (query.pcClass) {
    where.push('s.PCClass = ?');
    params.push(query.pcClass);
  }
  if (query.studentId) {
    where.push('b.StudentID = ?');
    params.push(query.studentId);
  }
  if (query.teacherEmail) {
    where.push('t.Email LIKE ?');
    params.push('%' + query.teacherEmail + '%');
  }
  if (query.studentEmail) {
    where.push('s.Email LIKE ?');
    params.push('%' + query.studentEmail + '%');
  }
  if (query.search) {
    where.push('(s.StudentName LIKE ? OR s.StudentID LIKE ? OR t.TeacherName LIKE ? OR t.Email LIKE ? OR s.Email LIKE ? OR b.ScheduleCode LIKE ?)');
    const term = '%' + query.search + '%';
    params.push(term, term, term, term, term, term);
  }

  return { whereClause: where.length > 0 ? ' AND ' + where.join(' AND ') : '', params };
}

function formatNickname(sNickname, studentName) {
  if (!sNickname) return studentName || '';
  if (!studentName) return sNickname;
  const parts = studentName.trim().split(/\s+/);
  if (parts.length > 1) {
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return sNickname + ' ' + lastInitial;
  }
  return sNickname;
}

router.get('/', async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM Bookings b
       INNER JOIN Students s ON s.StudentID = b.StudentID
       INNER JOIN Teachers t ON t.TeacherCode = b.TeacherCode
       INNER JOIN TimeSlots ts ON ts.SlotID = b.SlotID
       INNER JOIN MeetingDates md ON md.DateID = b.MeetingDateID
       WHERE b.Status = 'CONFIRMED'` + whereClause,
      params
    );

    const [bookings] = await pool.query(
      BASE_SQL + whereClause + ORDER_SQL + ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY',
      [...params, offset, limit]
    );

    const totalPages = Math.ceil(total / limit);

    const [meetingDates] = await pool.query(
      'SELECT DateID, DayNumber, DayLabel, MeetingDate FROM MeetingDates WHERE IsActive = 1 ORDER BY DayNumber'
    );
    const [teachers] = await pool.query(
      'SELECT TeacherCode, TeacherName FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName'
    );
    const [classes] = await pool.query(
      'SELECT DISTINCT PCClass FROM Students WHERE IsActive = 1 AND PCClass IS NOT NULL ORDER BY PCClass'
    );

    const filters = {
      dateId: req.query.dateId || '',
      teacherCode: req.query.teacherCode || '',
      pcClass: req.query.pcClass || '',
      studentId: req.query.studentId || '',
      teacherEmail: req.query.teacherEmail || '',
      studentEmail: req.query.studentEmail || '',
      search: req.query.search || ''
    };

    const qsParts = [];
    for (const [k, v] of Object.entries(filters)) {
      if (v) qsParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    const queryString = qsParts.join('&');

    res.render('admin/advanced-export', {
      title: 'Advanced Booking Export',
      bookings: bookings.map(b => ({
        ...b,
        StudentNickname: formatNickname(b.SNickname, b.StudentName)
      })),
      meetingDates,
      teachers,
      classes: classes.map(c => c.PCClass),
      filters,
      queryString,
      page,
      totalPages,
      total
    });
  } catch (error) {
    console.error('Advanced export error:', error.message);
    res.render('admin/advanced-export', {
      title: 'Advanced Booking Export',
      bookings: [], meetingDates: [], teachers: [], classes: [],
      filters: { dateId: '', teacherCode: '', pcClass: '', studentId: '', teacherEmail: '', studentEmail: '', search: '' },
      queryString: '', page: 1, totalPages: 0, total: 0,
      error: 'Failed to load: ' + error.message
    });
  }
});

router.get('/export/csv', async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const [bookings] = await pool.query(BASE_SQL + whereClause + ORDER_SQL, params);

    const headers = ['Schedule', 'TeacherEmail', 'StudentEmail', 'StudentCode', 'TeacherName', 'StudentNickname'];
    const escCsv = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };

    let csv = headers.map(escCsv).join(',') + '\n';
    for (const b of bookings) {
      csv += [
        b.ScheduleCode,
        b.TeacherEmail || '',
        b.StudentEmail || '',
        b.StudentCode,
        b.TeacherName,
        formatNickname(b.SNickname, b.StudentName)
      ].map(escCsv).join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="advanced_booking_export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Advanced CSV export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

router.get('/export/excel', async (req, res) => {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const { whereClause, params } = buildFilters(req.query);
    const [bookings] = await pool.query(BASE_SQL + whereClause + ORDER_SQL, params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Booking Export');

    sheet.columns = [
      { header: 'Schedule', key: 'Schedule', width: 12 },
      { header: 'TeacherEmail', key: 'TeacherEmail', width: 30 },
      { header: 'StudentEmail', key: 'StudentEmail', width: 30 },
      { header: 'StudentCode', key: 'StudentCode', width: 15 },
      { header: 'TeacherName', key: 'TeacherName', width: 25 },
      { header: 'StudentNickname', key: 'StudentNickname', width: 20 }
    ];

    for (const b of bookings) {
      sheet.addRow({
        Schedule: b.ScheduleCode,
        TeacherEmail: b.TeacherEmail || '',
        StudentEmail: b.StudentEmail || '',
        StudentCode: b.StudentCode,
        TeacherName: b.TeacherName,
        StudentNickname: formatNickname(b.SNickname, b.StudentName)
      });
    }

    sheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="advanced_booking_export.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Advanced Excel export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

router.get('/export/pdf', async (req, res) => {
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const { whereClause, params } = buildFilters(req.query);
    const [bookings] = await pool.query(BASE_SQL + whereClause + ORDER_SQL, params);

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="advanced_booking_export.pdf"');
    doc.pipe(res);

    doc.fontSize(16).text('Advanced Booking Export', { align: 'center' });
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()} | Total: ${bookings.length} bookings`, { align: 'center' });
    doc.moveDown();

    const cols = [
      { header: 'Schedule', width: 70, key: 'ScheduleCode' },
      { header: 'Teacher Email', width: 160, key: 'TeacherEmail' },
      { header: 'Student Email', width: 160, key: 'StudentEmail' },
      { header: 'Student Code', width: 90, key: 'StudentCode' },
      { header: 'Teacher Name', width: 120, key: 'TeacherName' },
      { header: 'Student Nickname', width: 110, key: 'StudentNickname' }
    ];

    const startX = 40;
    let y = doc.y;
    const rowHeight = 16;

    doc.fontSize(8).font('Helvetica-Bold');
    let x = startX;
    cols.forEach(col => {
      doc.text(col.header, x, y, { width: col.width, ellipsis: true });
      x += col.width;
    });
    y += rowHeight;
    doc.moveTo(startX, y - 2).lineTo(startX + cols.reduce((a, c) => a + c.width, 0), y - 2).stroke();

    doc.font('Helvetica').fontSize(7);
    for (const b of bookings) {
      if (y > doc.page.height - 50) {
        doc.addPage();
        y = 40;
        doc.fontSize(8).font('Helvetica-Bold');
        x = startX;
        cols.forEach(col => {
          doc.text(col.header, x, y, { width: col.width, ellipsis: true });
          x += col.width;
        });
        y += rowHeight;
        doc.moveTo(startX, y - 2).lineTo(startX + cols.reduce((a, c) => a + c.width, 0), y - 2).stroke();
        doc.font('Helvetica').fontSize(7);
      }

      x = startX;
      const rowData = {
        ScheduleCode: b.ScheduleCode,
        TeacherEmail: b.TeacherEmail || '',
        StudentEmail: b.StudentEmail || '',
        StudentCode: b.StudentCode,
        TeacherName: b.TeacherName,
        StudentNickname: formatNickname(b.SNickname, b.StudentName)
      };
      cols.forEach(col => {
        doc.text(String(rowData[col.key] || ''), x, y, { width: col.width, ellipsis: true });
        x += col.width;
      });
      y += rowHeight;
    }

    doc.end();
  } catch (error) {
    console.error('Advanced PDF export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

export default router;
