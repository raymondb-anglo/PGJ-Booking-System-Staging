import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';
import { ensureBookingsTable, createBooking, unlockBooking, cancelBooking, getAvailableSlots } from '../utils/bookingEngine.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    await ensureBookingsTable();

    const [terms] = await pool.query(
      `SELECT bt.TermID, bt.TermLabel, sy.YearLabel, bt.IsActive
       FROM BookingTerms bt JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       ORDER BY bt.IsActive DESC, bt.TermID DESC`
    );

    let selectedTermId = req.query.termId || null;
    if (!selectedTermId && terms.length > 0) {
      const active = terms.find(t => t.IsActive) || terms[0];
      selectedTermId = active.TermID;
    }

    let meetingDates = [];
    if (selectedTermId) {
      const [dates] = await pool.query(
        'SELECT DateID, MeetingDate, DayNumber, DayLabel FROM MeetingDates WHERE TermID = ? AND IsActive = 1 ORDER BY DayNumber',
        [selectedTermId]
      );
      meetingDates = dates;
    }

    const selectedDateId = req.query.dateId || null;
    const selectedStatus = req.query.status || '';
    const selectedTeacher = req.query.teacherCode || '';

    let bookings = [];
    if (selectedTermId) {
      let sql = `
        SELECT b.BookingID, b.StudentID, b.TeacherCode, b.MeetingDateID, b.SlotID,
               b.ScheduleCode, b.TranslatorRequired, b.TranslatorLanguage,
               b.Status, b.BookedBy, b.CreatedAt, b.CancelledAt,
               s.StudentName, s.SNickname, s.PCClass,
               t.TeacherName, t.TeacherNickname,
               md.MeetingDate, md.DayLabel,
               ts.StartTime, ts.EndTime
        FROM Bookings b
        LEFT JOIN Students s ON s.StudentID = b.StudentID
        LEFT JOIN Teachers t ON t.TeacherCode = b.TeacherCode
        LEFT JOIN MeetingDates md ON md.DateID = b.MeetingDateID
        LEFT JOIN TimeSlots ts ON ts.SlotID = b.SlotID
        WHERE md.TermID = ?
      `;
      const params = [selectedTermId];

      if (selectedDateId) {
        sql += ' AND b.MeetingDateID = ?';
        params.push(selectedDateId);
      }
      if (selectedStatus) {
        sql += ' AND b.Status = ?';
        params.push(selectedStatus);
      }
      if (selectedTeacher) {
        sql += ' AND b.TeacherCode = ?';
        params.push(selectedTeacher);
      }

      sql += ' ORDER BY b.CreatedAt DESC';
      const [rows] = await pool.query(sql, params);
      bookings = rows;
    }

    const [teachers] = await pool.query(
      'SELECT TeacherCode, TeacherName, TeacherNickname FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName'
    );

    res.render('admin/bookings', {
      title: 'Manage Bookings',
      terms,
      meetingDates,
      teachers,
      bookings,
      selectedTermId: selectedTermId ? parseInt(selectedTermId) : null,
      selectedDateId,
      selectedStatus,
      selectedTeacher,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Bookings list error:', error.message);
    res.render('admin/bookings', {
      title: 'Manage Bookings',
      terms: [], meetingDates: [], teachers: [], bookings: [],
      selectedTermId: null, selectedDateId: null, selectedStatus: '', selectedTeacher: '',
      success: null,
      error: 'Failed to load bookings: ' + error.message
    });
  }
});

router.get('/book-on-behalf', async (req, res) => {
  try {
    await ensureBookingsTable();

    const [terms] = await pool.query(
      `SELECT bt.TermID, bt.TermLabel, sy.YearLabel, bt.IsActive
       FROM BookingTerms bt JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       ORDER BY bt.IsActive DESC, bt.TermID DESC`
    );

    let selectedTermId = req.query.termId || null;
    if (!selectedTermId && terms.length > 0) {
      const active = terms.find(t => t.IsActive) || terms[0];
      selectedTermId = active.TermID;
    }

    let meetingDates = [];
    if (selectedTermId) {
      const [dates] = await pool.query(
        `SELECT md.DateID, md.MeetingDate, md.DayNumber, md.DayLabel,
                (SELECT COUNT(*) FROM TimeSlots ts WHERE ts.MeetingDateID = md.DateID) as slotCount
         FROM MeetingDates md WHERE md.TermID = ? AND md.IsActive = 1 ORDER BY md.DayNumber`,
        [selectedTermId]
      );
      meetingDates = dates;
    }

    const [students] = await pool.query(
      `SELECT s.StudentID, s.StudentName, s.SNickname, s.PCClass, s.TeacherID,
              t.TeacherName, t.TeacherNickname
       FROM Students s
       LEFT JOIN Teachers t ON t.TeacherCode = s.TeacherID
       WHERE s.IsActive = 1
       ORDER BY s.StudentName`
    );

    const selectedStudentId = req.query.studentId || null;
    const selectedDateId = req.query.dateId || null;
    let selectedStudent = null;
    let slots = [];

    if (selectedStudentId) {
      selectedStudent = students.find(s => s.StudentID === selectedStudentId) || null;
    }

    if (selectedStudent && selectedDateId) {
      slots = await getAvailableSlots(selectedStudent.TeacherID, selectedDateId);
    }

    res.render('admin/booking-on-behalf', {
      title: 'Book on Behalf',
      terms,
      meetingDates,
      students,
      slots,
      selectedTermId: selectedTermId ? parseInt(selectedTermId) : null,
      selectedStudentId,
      selectedStudent,
      selectedDateId,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Book on behalf error:', error.message);
    res.render('admin/booking-on-behalf', {
      title: 'Book on Behalf',
      terms: [], meetingDates: [], students: [], slots: [],
      selectedTermId: null, selectedStudentId: null, selectedStudent: null, selectedDateId: null,
      success: null,
      error: 'Failed to load: ' + error.message
    });
  }
});

router.post('/book', async (req, res) => {
  const { studentId, teacherCode, meetingDateId, slotId, translatorRequired, translatorLanguage, termId } = req.body;

  if (!studentId || !teacherCode || !meetingDateId || !slotId) {
    return res.redirect('/admin/bookings/book-on-behalf?error=' + encodeURIComponent('All fields are required.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const result = await createBooking(conn, {
      studentId, teacherCode, meetingDateId: parseInt(meetingDateId),
      slotId: parseInt(slotId),
      translatorRequired: translatorRequired === '1' || translatorRequired === 'on',
      translatorLanguage: translatorLanguage || null,
      bookedBy: 'ADMIN'
    });

    await conn.commit();

    await logAudit(req, 'ADMIN_BOOK', 'BOOKING',
      `Admin booked slot ${result.scheduleCode} for student ${studentId} with teacher ${teacherCode} (BookingID: ${result.bookingId})`);

    res.redirect('/admin/bookings?termId=' + (termId || '') + '&success=' + encodeURIComponent(`Booking created successfully. Schedule: ${result.scheduleCode}`));
  } catch (error) {
    await conn.rollback();
    const msg = error.message || 'Booking failed.';
    const returnUrl = `/admin/bookings/book-on-behalf?studentId=${encodeURIComponent(studentId)}&dateId=${meetingDateId}&termId=${termId || ''}`;
    res.redirect(returnUrl + '&error=' + encodeURIComponent(msg));
  } finally {
    conn.release();
  }
});

router.post('/:id/unlock', async (req, res) => {
  const bookingId = parseInt(req.params.id);
  const termId = req.body.termId || '';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const booking = await unlockBooking(conn, bookingId);
    await conn.commit();

    await logAudit(req, 'UNLOCK_BOOKING', 'BOOKING',
      `Unlocked booking ${bookingId} for student ${booking.StudentID}, teacher ${booking.TeacherCode}, slot ${booking.SlotID}`);

    res.redirect('/admin/bookings?termId=' + termId + '&success=' + encodeURIComponent('Booking unlocked. Student can now rebook.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/bookings?termId=' + termId + '&error=' + encodeURIComponent(error.message || 'Failed to unlock booking.'));
  } finally {
    conn.release();
  }
});

router.post('/:id/cancel', async (req, res) => {
  const bookingId = parseInt(req.params.id);
  const termId = req.body.termId || '';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const booking = await cancelBooking(conn, bookingId);
    await conn.commit();

    await logAudit(req, 'CANCEL_BOOKING', 'BOOKING',
      `Cancelled booking ${bookingId} for student ${booking.StudentID}, teacher ${booking.TeacherCode}, slot ${booking.SlotID}`);

    res.redirect('/admin/bookings?termId=' + termId + '&success=' + encodeURIComponent('Booking cancelled successfully.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/bookings?termId=' + termId + '&error=' + encodeURIComponent(error.message || 'Failed to cancel booking.'));
  } finally {
    conn.release();
  }
});

router.post('/:id/delete', async (req, res) => {
  const bookingId = parseInt(req.params.id);
  const termId = req.body.termId || '';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM Bookings WHERE BookingID = ?', [bookingId]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.redirect('/admin/bookings?termId=' + termId + '&error=' + encodeURIComponent('Booking not found.'));
    }

    const booking = rows[0];

    if (booking.Status === 'CONFIRMED') {
      await conn.query(
        `UPDATE TeacherAvailability SET IsAvailable = 1, BlockedReason = NULL
         WHERE TeacherCode = ? AND SlotID = ?`,
        [booking.TeacherCode, booking.SlotID]
      );
    }

    await conn.query('DELETE FROM Bookings WHERE BookingID = ?', [bookingId]);
    await conn.commit();

    await logAudit(req, 'DELETE_BOOKING', 'BOOKING',
      `Deleted booking ${bookingId} for student ${booking.StudentID}, teacher ${booking.TeacherCode}, slot ${booking.SlotID}, status was ${booking.Status}`);

    res.redirect('/admin/bookings?termId=' + termId + '&success=' + encodeURIComponent('Booking #' + bookingId + ' deleted permanently.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/bookings?termId=' + termId + '&error=' + encodeURIComponent(error.message || 'Failed to delete booking.'));
  } finally {
    conn.release();
  }
});

router.get('/api/slots/:dateId/:teacherCode', async (req, res) => {
  try {
    await ensureBookingsTable();
    const slots = await getAvailableSlots(req.params.teacherCode, parseInt(req.params.dateId));
    res.json({ success: true, slots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
