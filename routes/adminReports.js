import { Router } from 'express';
import pool from '../db.js';

const router = Router();

function buildFilterWhere(query) {
  const where = [];
  const params = [];

  if (query.schoolYearId) {
    where.push('bt.SchoolYearID = ?');
    params.push(query.schoolYearId);
  }
  if (query.termId) {
    where.push('md.TermID = ?');
    params.push(query.termId);
  }
  if (query.meetingDateId) {
    where.push('b.MeetingDateID = ?');
    params.push(query.meetingDateId);
  }
  if (query.teacherCode) {
    where.push('b.TeacherCode = ?');
    params.push(query.teacherCode);
  }
  if (query.status) {
    where.push('b.Status = ?');
    params.push(query.status);
  }
  if (query.translatorRequired === '1') {
    where.push('b.TranslatorRequired = 1');
  } else if (query.translatorRequired === '0') {
    where.push('(b.TranslatorRequired = 0 OR b.TranslatorRequired IS NULL)');
  }
  if (query.emailSent === '1') {
    where.push('(SELECT COUNT(*) FROM EmailLogs el WHERE el.BookingID = b.BookingID AND el.Status=\'SENT\') > 0');
  } else if (query.emailSent === '0') {
    where.push('(SELECT COUNT(*) FROM EmailLogs el WHERE el.BookingID = b.BookingID AND el.Status=\'SENT\') = 0');
  }

  return { whereClause: where.length > 0 ? 'WHERE ' + where.join(' AND ') : '', params };
}

let emailLogsExist = null;
async function checkEmailLogsExist() {
  if (emailLogsExist !== null) return emailLogsExist;
  try {
    await pool.query('SELECT TOP 0 1 FROM EmailLogs');
    emailLogsExist = true;
  } catch (e) {
    emailLogsExist = false;
  }
  return emailLogsExist;
}

function getBookingsQuery(whereClause, hasEmailLogs) {
  const emailSentSub = hasEmailLogs
    ? "(SELECT COUNT(*) FROM EmailLogs el WHERE el.BookingID = b.BookingID AND el.Status='SENT')"
    : "0";
  const emailAddrSub = hasEmailLogs
    ? "(SELECT TOP 1 el.Email FROM EmailLogs el WHERE el.BookingID = b.BookingID AND el.Status='SENT' ORDER BY el.LogID DESC)"
    : "NULL";
  return `
    SELECT b.*, s.StudentName, s.PCClass, t.TeacherName,
           md.MeetingDate, md.DayNumber, md.DayLabel,
           ts.ScheduleCode, ts.StartTime, ts.EndTime,
           ${emailSentSub} as EmailSentCount,
           ${emailAddrSub} as LastEmailAddress,
           (SELECT COUNT(*) FROM AuditLogs al WHERE al.Action='PDF_DOWNLOAD' AND al.Details LIKE '%BookingID: ' + CAST(b.BookingID as varchar(50)) + '%') as PdfCount
    FROM Bookings b
    LEFT JOIN Students s ON s.StudentID = b.StudentID
    LEFT JOIN Teachers t ON t.TeacherCode = b.TeacherCode
    LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID
    LEFT JOIN BookingTerms bt ON bt.TermID = md.TermID
    LEFT JOIN TimeSlots ts ON ts.SlotID = b.SlotID
    ${whereClause}
    ORDER BY b.CreatedAt DESC
  `;
}

router.get('/', async (req, res) => {
  try {
    const [[{ totalStudents }]] = await pool.query("SELECT COUNT(*) as totalStudents FROM Students WHERE IsActive=1");
    const [[{ totalTeachers }]] = await pool.query("SELECT COUNT(*) as totalTeachers FROM Teachers WHERE IsActive=1");
    const [[{ totalMeetingDates }]] = await pool.query("SELECT COUNT(*) as totalMeetingDates FROM MeetingDates WHERE IsActive=1");
    const [[{ totalTimeSlots }]] = await pool.query("SELECT COUNT(*) as totalTimeSlots FROM TimeSlots");
    const [[{ totalBookings }]] = await pool.query("SELECT COUNT(*) as totalBookings FROM Bookings WHERE Status='CONFIRMED'");

    let emailsSent = 0;
    try {
      const [[row]] = await pool.query("SELECT COUNT(DISTINCT el.BookingID) as cnt FROM EmailLogs el WHERE el.Status='SENT'");
      emailsSent = row.cnt;
    } catch (e) { emailsSent = 0; }

    const [[{ pdfDownloaded }]] = await pool.query("SELECT COUNT(*) as pdfDownloaded FROM AuditLogs WHERE Action='PDF_DOWNLOAD'");

    let availableSlots = 0;
    try {
      const [[{ cnt }]] = await pool.query(`
        SELECT COUNT(*) as cnt FROM TeacherAvailability ta
        WHERE ta.IsAvailable = 1
        AND NOT EXISTS (
          SELECT 1 FROM Bookings b
          WHERE b.TeacherCode = ta.TeacherCode
          AND b.MeetingDateID = ta.MeetingDateID
          AND b.SlotID = ta.SlotID
          AND b.Status = 'CONFIRMED'
        )
      `);
      availableSlots = cnt;
    } catch (e) {
      availableSlots = 0;
    }

    const hasEmailLogs = await checkEmailLogsExist();
    const { whereClause, params } = buildFilterWhere(req.query);
    const [bookings] = await pool.query(getBookingsQuery(whereClause, hasEmailLogs), params);

    const [schoolYears] = await pool.query('SELECT SchoolYearID, YearLabel FROM SchoolYears ORDER BY SchoolYearID DESC');
    const [terms] = await pool.query(
      `SELECT bt.TermID, bt.TermLabel, sy.YearLabel
       FROM BookingTerms bt JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       ORDER BY bt.TermID DESC`
    );
    const [meetingDates] = await pool.query(
      'SELECT DateID, MeetingDate, DayNumber, DayLabel FROM MeetingDates WHERE IsActive=1 ORDER BY DayNumber'
    );
    const [teachers] = await pool.query(
      'SELECT TeacherCode, TeacherName FROM Teachers WHERE IsActive=1 ORDER BY TeacherName'
    );

    const [[{ studentsWithBooking }]] = await pool.query(
      "SELECT COUNT(DISTINCT b.StudentID) as studentsWithBooking FROM Bookings b WHERE b.Status='CONFIRMED'"
    );
    const studentsWithoutBooking = totalStudents - studentsWithBooking;
    const bookingPercentage = totalStudents > 0 ? Math.round((studentsWithBooking / totalStudents) * 100) : 0;

    const filterObj = {
      schoolYearId: req.query.schoolYearId || '',
      termId: req.query.termId || '',
      meetingDateId: req.query.meetingDateId || '',
      teacherCode: req.query.teacherCode || '',
      status: req.query.status || '',
      translatorRequired: req.query.translatorRequired || '',
      emailSent: req.query.emailSent || ''
    };
    const qsParts = [];
    for (const [k, v] of Object.entries(filterObj)) {
      if (v) qsParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    const queryString = qsParts.join('&');

    res.render('admin/reports', {
      title: 'Reports',
      totalStudents,
      totalTeachers,
      totalMeetingDates,
      totalTimeSlots,
      totalBookings,
      emailsSent,
      pdfDownloaded,
      availableSlots,
      bookings,
      schoolYears,
      terms,
      meetingDates,
      teachers,
      studentsWithBooking,
      studentsWithoutBooking,
      bookingPercentage,
      filters: filterObj,
      queryString,
      adminRole: req.session.adminRole || 'ADMIN'
    });
  } catch (error) {
    console.error('Reports error:', error.message);
    res.render('admin/reports', {
      title: 'Reports',
      totalStudents: 0, totalTeachers: 0, totalMeetingDates: 0, totalTimeSlots: 0,
      totalBookings: 0, emailsSent: 0, pdfDownloaded: 0, availableSlots: 0,
      bookings: [], schoolYears: [], terms: [], meetingDates: [], teachers: [],
      studentsWithBooking: 0, studentsWithoutBooking: 0, bookingPercentage: 0,
      filters: { schoolYearId: '', termId: '', meetingDateId: '', teacherCode: '', status: '', translatorRequired: '', emailSent: '' },
      queryString: '',
      adminRole: req.session.adminRole || 'ADMIN',
      error: 'Failed to load reports: ' + error.message
    });
  }
});

router.get('/export/csv', async (req, res) => {
  try {
    const hasEmailLogs = await checkEmailLogsExist();
    const { whereClause, params } = buildFilterWhere(req.query);
    const [bookings] = await pool.query(getBookingsQuery(whereClause, hasEmailLogs), params);

    const headers = [
      'Booking ID', 'Student ID', 'Student Name', 'PC Class', 'Teacher Code', 'Teacher Name',
      'Meeting Date', 'Day Number', 'Day Label', 'Schedule Code', 'Start Time', 'End Time',
      'Translator Required', 'Translator Language', 'Status', 'Booked By',
      'Email Sent', 'Email Address', 'PDF Generated', 'Created At'
    ];

    const escCsv = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    let csv = headers.map(escCsv).join(',') + '\n';
    for (const b of bookings) {
      csv += [
        b.BookingID, b.StudentID, b.StudentName, b.PCClass, b.TeacherCode, b.TeacherName,
        b.MeetingDate, b.DayNumber, b.DayLabel, b.ScheduleCode, b.StartTime, b.EndTime,
        b.TranslatorRequired ? 'Yes' : 'No', b.TranslatorLanguage || '', b.Status, b.BookedBy,
        b.EmailSentCount > 0 ? 'Yes' : 'No', b.LastEmailAddress || '',
        b.PdfCount > 0 ? 'Yes' : 'No', b.CreatedAt
      ].map(escCsv).join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings_report.csv"');
    res.send(csv);
  } catch (error) {
    console.error('CSV export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

router.get('/export/excel', async (req, res) => {
  try {
    if (req.session.adminRole !== 'SUPER_ADMIN') {
      return res.status(403).send('Access denied. SUPER_ADMIN only.');
    }

    const ExcelJS = (await import('exceljs')).default;
    const hasEmailLogs = await checkEmailLogsExist();
    const { whereClause, params } = buildFilterWhere(req.query);
    const [bookings] = await pool.query(getBookingsQuery(whereClause, hasEmailLogs), params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bookings Report');

    sheet.columns = [
      { header: 'Booking ID', key: 'BookingID', width: 12 },
      { header: 'Student ID', key: 'StudentID', width: 15 },
      { header: 'Student Name', key: 'StudentName', width: 25 },
      { header: 'PC Class', key: 'PCClass', width: 12 },
      { header: 'Teacher Code', key: 'TeacherCode', width: 15 },
      { header: 'Teacher Name', key: 'TeacherName', width: 25 },
      { header: 'Meeting Date', key: 'MeetingDate', width: 15 },
      { header: 'Day Number', key: 'DayNumber', width: 12 },
      { header: 'Day Label', key: 'DayLabel', width: 15 },
      { header: 'Schedule Code', key: 'ScheduleCode', width: 15 },
      { header: 'Start Time', key: 'StartTime', width: 12 },
      { header: 'End Time', key: 'EndTime', width: 12 },
      { header: 'Translator Required', key: 'TranslatorRequired', width: 18 },
      { header: 'Language', key: 'TranslatorLanguage', width: 15 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Booked By', key: 'BookedBy', width: 12 },
      { header: 'Email Sent', key: 'EmailSent', width: 12 },
      { header: 'Email Address', key: 'EmailAddress', width: 25 },
      { header: 'PDF Generated', key: 'PdfGenerated', width: 14 },
      { header: 'Created At', key: 'CreatedAt', width: 20 }
    ];

    for (const b of bookings) {
      sheet.addRow({
        BookingID: b.BookingID,
        StudentID: b.StudentID,
        StudentName: b.StudentName,
        PCClass: b.PCClass,
        TeacherCode: b.TeacherCode,
        TeacherName: b.TeacherName,
        MeetingDate: b.MeetingDate,
        DayNumber: b.DayNumber,
        DayLabel: b.DayLabel,
        ScheduleCode: b.ScheduleCode,
        StartTime: b.StartTime,
        EndTime: b.EndTime,
        TranslatorRequired: b.TranslatorRequired ? 'Yes' : 'No',
        TranslatorLanguage: b.TranslatorLanguage || '',
        Status: b.Status,
        BookedBy: b.BookedBy,
        EmailSent: b.EmailSentCount > 0 ? 'Yes' : 'No',
        EmailAddress: b.LastEmailAddress || '',
        PdfGenerated: b.PdfCount > 0 ? 'Yes' : 'No',
        CreatedAt: b.CreatedAt
      });
    }

    sheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings_report.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

router.get('/export/pdf', async (req, res) => {
  try {
    if (req.session.adminRole !== 'SUPER_ADMIN') {
      return res.status(403).send('Access denied. SUPER_ADMIN only.');
    }

    const PDFDocument = (await import('pdfkit')).default;
    const { whereClause, params } = buildFilterWhere(req.query);

    const [[{ totalStudents }]] = await pool.query("SELECT COUNT(*) as totalStudents FROM Students WHERE IsActive=1");
    const [[{ totalTeachers }]] = await pool.query("SELECT COUNT(*) as totalTeachers FROM Teachers WHERE IsActive=1");
    const [[{ totalBookings }]] = await pool.query("SELECT COUNT(*) as totalBookings FROM Bookings WHERE Status='CONFIRMED'");

    let emailsSent = 0;
    try {
      const [[row]] = await pool.query("SELECT COUNT(DISTINCT el.BookingID) as cnt FROM EmailLogs el WHERE el.Status='SENT'");
      emailsSent = row.cnt;
    } catch (e) { emailsSent = 0; }

    const [[{ pdfDownloaded }]] = await pool.query("SELECT COUNT(*) as pdfDownloaded FROM AuditLogs WHERE Action='PDF_DOWNLOAD'");
    const [[{ studentsWithBooking }]] = await pool.query("SELECT COUNT(DISTINCT b.StudentID) as studentsWithBooking FROM Bookings b WHERE b.Status='CONFIRMED'");

    const [filteredBookings] = await pool.query(
      `SELECT COUNT(*) as cnt FROM Bookings b LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID LEFT JOIN BookingTerms bt ON bt.TermID = md.TermID ${whereClause}`,
      params
    );
    const filteredCount = filteredBookings[0].cnt;

    const studentsWithoutBooking = totalStudents - studentsWithBooking;
    const bookingPercentage = totalStudents > 0 ? Math.round((studentsWithBooking / totalStudents) * 100) : 0;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="reports_summary.pdf"');
    doc.pipe(res);

    doc.fontSize(20).text('PGJ Booking System - Reports Summary', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(14).text('Summary Statistics', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Total Active Students: ${totalStudents}`);
    doc.text(`Total Active Teachers: ${totalTeachers}`);
    doc.text(`Total Confirmed Bookings: ${totalBookings}`);
    doc.text(`Emails Sent: ${emailsSent}`);
    doc.text(`PDFs Downloaded: ${pdfDownloaded}`);
    doc.moveDown();

    doc.fontSize(14).text('Student Booking Coverage', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Students with Booking: ${studentsWithBooking}`);
    doc.text(`Students without Booking: ${studentsWithoutBooking}`);
    doc.text(`Booking Percentage: ${bookingPercentage}%`);
    doc.moveDown();

    doc.fontSize(14).text('Filtered Results', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Bookings matching current filters: ${filteredCount}`);

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error.message);
    res.status(500).send('Export failed: ' + error.message);
  }
});

router.get('/students-without-booking', async (req, res) => {
  try {
    let sql = `
      SELECT s.StudentID, s.StudentName, s.PCClass, t.TeacherName
      FROM Students s
      LEFT JOIN Teachers t ON t.TeacherCode = s.TeacherID
      WHERE s.IsActive = 1
      AND s.StudentID NOT IN (
        SELECT DISTINCT b.StudentID FROM Bookings b WHERE b.Status = 'CONFIRMED'
    `;
    const params = [];

    if (req.query.termId) {
      sql += ' AND b.MeetingDateID IN (SELECT DateID FROM MeetingDates WHERE TermID = ?)';
      params.push(req.query.termId);
    }

    sql += ')';
    sql += ' ORDER BY s.StudentName';

    const [students] = await pool.query(sql, params);
    res.json({ success: true, students });
  } catch (error) {
    console.error('Students without booking error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
