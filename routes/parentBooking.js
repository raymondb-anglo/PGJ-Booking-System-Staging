import { Router } from 'express';
import pool from '../db.js';
import { ensureBookingsTable, createBooking, getAvailableSlots } from '../utils/bookingEngine.js';
import { generateBookingPdf } from '../utils/pdfGenerator.js';
import { sendBookingConfirmation } from '../utils/emailSender.js';
import { getConfig as getLoginConfig } from './adminLoginDesigner.js';

const router = Router();

function requireStudentAuth(req, res, next) {
  if (!req.session.studentData) {
    return res.redirect('/booking');
  }
  next();
}

router.get('/', async (req, res) => {
  console.log('Hit /booking root route');
  if (req.session.studentData) {
    return res.redirect('/booking/select');
  }

  let config = {};
  let tcContent = '';
  try {
    config = await getLoginConfig();
  } catch (e) {
    console.error('Failed to load login config:', e.message);
  }
  let tcContentTH = '';
  let tcContentCN = '';
  try {
    const [tcRows] = await pool.query(
      `SELECT TOP 1 Content, ContentTH, ContentCN FROM TcTemplates WHERE IsActive = 1`
    );
    if (tcRows.length > 0) {
      tcContent = tcRows[0].Content || '';
      tcContentTH = tcRows[0].ContentTH || '';
      tcContentCN = tcRows[0].ContentCN || '';
    }
  } catch (e) {}

  res.render('parent/login', {
    title: config.HeaderTitle || 'Student Login',
    error: req.query.error || null,
    isAdmin: false,
    config,
    tcContent,
    tcContentTH,
    tcContentCN
  });
});

router.post('/login', async (req, res) => {
  const { studentId } = req.body;
  if (!studentId || !studentId.trim()) {
    return res.redirect('/booking?error=' + encodeURIComponent('Please enter your Student ID.'));
  }

  try {
    const [students] = await pool.query(
      `SELECT s.StudentID, s.StudentName, s.SNickname, s.PCClass, s.MAGClass, s.TeacherID,
              t.TeacherName, t.TeacherNickname, t.Room
       FROM Students s
       LEFT JOIN Teachers t ON t.TeacherCode = s.TeacherID
       WHERE s.StudentID = ? AND s.IsActive = 1`,
      [studentId.trim()]
    );

    if (students.length === 0) {
      return res.redirect('/booking?error=' + encodeURIComponent('Student ID not found or inactive. Please check and try again.'));
    }

    const student = students[0];
    if (!student.TeacherID) {
      return res.redirect('/booking?error=' + encodeURIComponent('No teacher assigned to this student. Please contact admin.'));
    }

    req.session.studentData = {
      studentId: student.StudentID,
      studentName: student.StudentName,
      nickname: student.SNickname,
      pcClass: student.PCClass,
      magClass: student.MAGClass,
      teacherCode: student.TeacherID,
      teacherName: student.TeacherName,
      teacherNickname: student.TeacherNickname,
      teacherRoom: student.Room
    };

    res.redirect('/booking/select');
  } catch (error) {
    console.error('Student login error:', error.message);
    res.redirect('/booking?error=' + encodeURIComponent('Login failed. Please try again.'));
  }
});

router.get('/select', requireStudentAuth, async (req, res) => {
  try {
    await ensureBookingsTable();
    const student = req.session.studentData;

    const [terms] = await pool.query(
      `SELECT TOP 1 bt.TermID, bt.TermLabel, sy.YearLabel
       FROM BookingTerms bt JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       WHERE bt.IsActive = 1`
    );

    if (terms.length === 0) {
      return res.render('parent/booking', {
        title: 'Book Appointment',
        student,
        term: null,
        meetingDates: [],
        selectedDateId: null,
        slots: [],
        existingBookings: [],
        translatorLanguages: [],
        error: 'No active booking term found. Please contact the school.',
        success: null,
        isAdmin: false
      });
    }

    const term = terms[0];

    const [teacherRow] = await pool.query('SELECT MeetingDays FROM Teachers WHERE TeacherCode = ?', [student.teacherCode]);
    const teacherMeetingDays = (teacherRow.length > 0 && teacherRow[0].MeetingDays) ? teacherRow[0].MeetingDays : null;

    let meetingDatesQuery = `SELECT md.DateID, md.MeetingDate, md.DayNumber, md.DayLabel,
              (SELECT COUNT(*) FROM TimeSlots ts WHERE ts.MeetingDateID = md.DateID) as slotCount
       FROM MeetingDates md
       WHERE md.TermID = ? AND md.IsActive = 1`;
    const meetingDatesParams = [term.TermID];

    if (teacherMeetingDays) {
      meetingDatesQuery += " AND ',' + ? + ',' LIKE '%,' + CAST(md.DayNumber AS VARCHAR) + ',%'";
      meetingDatesParams.push(teacherMeetingDays);
    }
    meetingDatesQuery += ' ORDER BY md.DayNumber';

    const [meetingDates] = await pool.query(meetingDatesQuery, meetingDatesParams);

    const selectedDateId = req.query.dateId ? parseInt(req.query.dateId) : null;
    let slots = [];

    if (selectedDateId) {
      slots = await getAvailableSlots(student.teacherCode, selectedDateId);
    }

    const [existingBookings] = await pool.query(
      `SELECT b.BookingID, b.MeetingDateID, b.ScheduleCode, b.Status,
              md.MeetingDate, md.DayLabel,
              ts.StartTime, ts.EndTime
       FROM Bookings b
       LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID
       LEFT JOIN TimeSlots ts ON ts.SlotID = b.SlotID
       WHERE b.StudentID = ? AND b.Status = 'CONFIRMED' AND md.TermID = ?
       ORDER BY md.DayNumber`,
      [student.studentId, term.TermID]
    );

    let translatorLanguages = [];
    try {
      const [langs] = await pool.query(
        'SELECT LanguageName FROM Translations WHERE IsActive = 1 ORDER BY SortOrder, LanguageName'
      );
      translatorLanguages = langs.map(l => l.LanguageName);
    } catch (e) { }

    res.render('parent/booking', {
      title: 'Book Appointment',
      student,
      term,
      meetingDates,
      selectedDateId,
      slots,
      existingBookings,
      translatorLanguages,
      error: req.query.error || null,
      success: req.query.success || null,
      isAdmin: false
    });
  } catch (error) {
    console.error('Parent booking page error:', error.message);
    res.render('parent/booking', {
      title: 'Book Appointment',
      student: req.session.studentData,
      term: null,
      meetingDates: [],
      selectedDateId: null,
      slots: [],
      existingBookings: [],
      translatorLanguages: [],
      error: 'Failed to load booking page. Please try again.',
      success: null,
      isAdmin: false
    });
  }
});

router.post('/confirm', requireStudentAuth, async (req, res) => {
  const student = req.session.studentData;
  const { meetingDateId, slotId, translatorRequired, translatorLanguage } = req.body;

  if (!meetingDateId || !slotId) {
    return res.redirect('/booking/select?error=' + encodeURIComponent('Please select a meeting date and time slot.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const result = await createBooking(conn, {
      studentId: student.studentId,
      teacherCode: student.teacherCode,
      meetingDateId: parseInt(meetingDateId),
      slotId: parseInt(slotId),
      translatorRequired: translatorRequired === '1' || translatorRequired === 'on',
      translatorLanguage: translatorLanguage || null,
      bookedBy: 'PARENT'
    });

    await conn.commit();

    req.session.lastBooking = {
      bookingId: result.bookingId,
      scheduleCode: result.scheduleCode,
      meetingDateId: parseInt(meetingDateId),
      slotId: parseInt(slotId)
    };

    res.redirect('/booking/confirmation');
  } catch (error) {
    await conn.rollback();
    const status = error.status || 500;
    const msg = error.message || 'Booking failed. Please try again.';

    if (status === 409) {
      return res.redirect('/booking/select?dateId=' + meetingDateId + '&error=' + encodeURIComponent(msg));
    }
    res.redirect('/booking/select?dateId=' + meetingDateId + '&error=' + encodeURIComponent(msg));
  } finally {
    conn.release();
  }
});

router.get('/confirmation', requireStudentAuth, async (req, res) => {
  const student = req.session.studentData;
  const lastBooking = req.session.lastBooking;

  if (!lastBooking) {
    return res.redirect('/booking/select');
  }

  try {
    const [bookings] = await pool.query(
      `SELECT b.BookingID, b.ScheduleCode, b.TranslatorRequired, b.TranslatorLanguage,
              b.CreatedAt, b.Status,
              md.MeetingDate, md.DayLabel,
              ts.StartTime, ts.EndTime
       FROM Bookings b
       LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID
       LEFT JOIN TimeSlots ts ON ts.SlotID = b.SlotID
       WHERE b.BookingID = ?`,
      [lastBooking.bookingId]
    );

    if (bookings.length === 0) {
      return res.redirect('/booking/select?error=' + encodeURIComponent('Booking not found.'));
    }

    const [studentRows] = await pool.query(
      'SELECT Email FROM Students WHERE StudentID = ?', [student.studentId]
    );
    const studentEmail = (studentRows.length > 0 && studentRows[0].Email) ? studentRows[0].Email : '';

    res.render('parent/confirmation', {
      title: 'Booking Confirmed',
      student,
      booking: bookings[0],
      studentEmail,
      emailSent: req.query.emailSent || null,
      emailError: req.query.emailError || null,
      isAdmin: false
    });
  } catch (error) {
    console.error('Confirmation page error:', error.message);
    res.redirect('/booking/select?error=' + encodeURIComponent('Failed to load confirmation.'));
  }
});

router.get('/view/:bookingId', requireStudentAuth, async (req, res) => {
  const student = req.session.studentData;
  const bookingId = parseInt(req.params.bookingId);

  try {
    const [bookings] = await pool.query(
      `SELECT b.BookingID, b.ScheduleCode, b.TranslatorRequired, b.TranslatorLanguage,
              b.CreatedAt, b.Status, b.StudentID,
              md.MeetingDate, md.DayLabel,
              ts.StartTime, ts.EndTime
       FROM Bookings b
       LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID
       LEFT JOIN TimeSlots ts ON ts.SlotID = b.SlotID
       WHERE b.BookingID = ? AND b.StudentID = ? AND b.Status = 'CONFIRMED'`,
      [bookingId, student.studentId]
    );

    if (bookings.length === 0) {
      return res.redirect('/booking/select?error=' + encodeURIComponent('Booking not found.'));
    }

    const [studentRows] = await pool.query(
      'SELECT Email FROM Students WHERE StudentID = ?', [student.studentId]
    );
    const studentEmail = (studentRows.length > 0 && studentRows[0].Email) ? studentRows[0].Email : '';

    res.render('parent/confirmation', {
      title: 'Booking Confirmation',
      student,
      booking: bookings[0],
      studentEmail,
      emailSent: req.query.emailSent || null,
      emailError: req.query.emailError || null,
      isAdmin: false
    });
  } catch (error) {
    console.error('View booking error:', error.message);
    res.redirect('/booking/select?error=' + encodeURIComponent('Failed to load booking details.'));
  }
});

async function getBookingDataForPdf(bookingId, student) {
  const [rows] = await pool.query(
    `SELECT b.BookingID, b.ScheduleCode, b.TranslatorRequired, b.TranslatorLanguage,
            b.Status, b.StudentID,
            md.MeetingDate, md.DayLabel,
            ts.StartTime, ts.EndTime,
            t.TeacherName, t.TeacherNickname, t.Room
     FROM Bookings b
     LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID
     LEFT JOIN TimeSlots ts ON ts.SlotID = b.SlotID
     LEFT JOIN Teachers t ON t.TeacherCode = b.TeacherCode
     WHERE b.BookingID = ? AND b.StudentID = ? AND b.Status = 'CONFIRMED'`,
    [bookingId, student.studentId]
  );
  if (rows.length === 0) return null;
  const b = rows[0];
  const timeRange = (b.StartTime ? b.StartTime.substring(0,5) : '') + ' – ' + (b.EndTime ? b.EndTime.substring(0,5) : '');
  const meetingDate = b.MeetingDate ? new Date(b.MeetingDate).toLocaleDateString() : '';
  return {
    bookingId: b.BookingID,
    studentId: student.studentId,
    studentName: student.studentName,
    studentEmail: '',
    pcClass: student.pcClass || '',
    teacherName: (b.TeacherName || '') + (b.TeacherNickname ? ' (' + b.TeacherNickname + ')' : ''),
    meetingDate: meetingDate,
    meetingTime: timeRange,
    dayLabel: b.DayLabel || '',
    scheduleCode: b.ScheduleCode || '',
    timeRange: timeRange,
    room: b.Room || '',
    translator: b.TranslatorRequired ? (b.TranslatorLanguage || 'Yes') : 'None'
  };
}

router.get('/download-pdf/:bookingId', requireStudentAuth, async (req, res) => {
  try {
    const student = req.session.studentData;
    const bookingId = parseInt(req.params.bookingId);
    const data = await getBookingDataForPdf(bookingId, student);
    if (!data) {
      return res.status(404).send('Booking not found or not confirmed.');
    }
    const pdfBuffer = await generateBookingPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Booking_${data.scheduleCode}_${data.studentId}.pdf"`);
    res.send(pdfBuffer);

    try {
      const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      await pool.query(
        'DECLARE @NextLogID INT = ISNULL((SELECT MAX(LogID) FROM AuditLogs WITH (UPDLOCK, HOLDLOCK)), 0) + 1; INSERT INTO AuditLogs (LogID, AdminUsername, Action, Category, Details, IPAddress) VALUES (@NextLogID, ?, ?, ?, ?, ?)',
        ['PARENT', 'PDF_DOWNLOAD', 'BOOKING', `PDF downloaded for BookingID: ${data.bookingId}, StudentID: ${data.studentId}, ScheduleCode: ${data.scheduleCode}`, ip]
      );
    } catch (auditErr) {
      console.error('PDF download audit log error:', auditErr.message);
    }
  } catch (error) {
    console.error('PDF download error:', error.message);
    res.status(500).send('Failed to generate PDF. ' + (error.message.includes('No active PDF template') ? 'No active PDF template found. Please contact admin.' : 'Please try again.'));
  }
});

router.post('/send-email', requireStudentAuth, async (req, res) => {
  try {
    const student = req.session.studentData;
    const { bookingId, email } = req.body;
    if (!bookingId || !email || !email.trim()) {
      return res.json({ success: false, error: 'Email address is required.' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.json({ success: false, error: 'Please enter a valid email address.' });
    }
    const data = await getBookingDataForPdf(parseInt(bookingId), student);
    if (!data) {
      return res.json({ success: false, error: 'Booking not found or not confirmed.' });
    }
    const pdfBuffer = await generateBookingPdf(data);
    const result = await sendBookingConfirmation(email.trim(), data, pdfBuffer);
    res.json(result);
  } catch (error) {
    console.error('Email send error:', error.message);
    res.json({ success: false, error: error.message.includes('No active PDF template') ? 'No active PDF template found. Please contact admin.' : 'Failed to send email. Please try again.' });
  }
});

router.get('/api/slots/:dateId', requireStudentAuth, async (req, res) => {
  try {
    await ensureBookingsTable();
    const student = req.session.studentData;
    const slots = await getAvailableSlots(student.teacherCode, parseInt(req.params.dateId));
    res.json({ success: true, slots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/logout', (req, res) => {
  delete req.session.studentData;
  delete req.session.lastBooking;
  res.redirect('/booking');
});

export default router;
