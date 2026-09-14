import pool from '../db.js';

export async function ensureBookingsTable() {
  // MSSQL schema is already pre-configured by user.
  return;
}

export async function createBooking(conn, { studentId, teacherCode, meetingDateId, slotId, translatorRequired, translatorLanguage, bookedBy }) {
  const [slotRows] = await conn.query(
    'SELECT SlotID, ScheduleCode, IsBlocked FROM TimeSlots WITH (UPDLOCK, ROWLOCK) WHERE SlotID = ? AND MeetingDateID = ?',
    [slotId, meetingDateId]
  );
  if (slotRows.length === 0) throw { status: 400, message: 'Time slot not found.' };
  if (slotRows[0].IsBlocked) throw { status: 409, message: 'This time slot is globally blocked and cannot be booked.' };

  const [availRows] = await conn.query(
    'SELECT AvailabilityID, IsAvailable FROM TeacherAvailability WITH (UPDLOCK, ROWLOCK) WHERE TeacherCode = ? AND MeetingDateID = ? AND SlotID = ?',
    [teacherCode, meetingDateId, slotId]
  );
  if (availRows.length > 0 && !availRows[0].IsAvailable) {
    throw { status: 409, message: 'This time slot is not available for this teacher.' };
  }

  const [existingStudentBooking] = await conn.query(
    'SELECT BookingID FROM Bookings WITH (UPDLOCK, ROWLOCK) WHERE StudentID = ? AND MeetingDateID = ? AND Status = ?',
    [studentId, meetingDateId, 'CONFIRMED']
  );
  if (existingStudentBooking.length > 0) {
    throw { status: 409, message: 'This student already has a booking for this meeting date.' };
  }

  const [existingSlotBooking] = await conn.query(
    'SELECT BookingID FROM Bookings WITH (UPDLOCK, ROWLOCK) WHERE TeacherCode = ? AND MeetingDateID = ? AND SlotID = ? AND Status = ?',
    [teacherCode, meetingDateId, slotId, 'CONFIRMED']
  );
  if (existingSlotBooking.length > 0) {
    throw { status: 409, message: 'This time slot has already been booked. Please select another.' };
  }

  const scheduleCode = slotRows[0].ScheduleCode;
  try {
    // Compute next BookingID manually (MSSQL column is not IDENTITY)
    const [maxIdRows] = await conn.query(
      'SELECT ISNULL(MAX(BookingID), 0) + 1 AS NextID FROM Bookings WITH (UPDLOCK, HOLDLOCK)'
    );
    const nextBookingId = maxIdRows[0].NextID;

    await conn.query(
      `INSERT INTO Bookings (BookingID, StudentID, TeacherCode, MeetingDateID, SlotID, ScheduleCode, TranslatorRequired, TranslatorLanguage, Status, BookedBy, is_locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, 1)`,
      [nextBookingId, studentId, teacherCode, meetingDateId, slotId, scheduleCode, translatorRequired ? 1 : 0, translatorLanguage || null, bookedBy]
    );

    await conn.query(
      `UPDATE TeacherAvailability SET IsAvailable = 0, BlockedReason = 'Booked' WHERE TeacherCode = ? AND SlotID = ?;
       IF @@ROWCOUNT = 0
       BEGIN
         DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
         INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
         VALUES (@NextAvailID, ?, ?, ?, 0, 'Booked');
       END`,
      [teacherCode, slotId, teacherCode, meetingDateId, slotId]
    );

    return { bookingId: nextBookingId, scheduleCode };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw { status: 409, message: 'This time slot has already been booked. Please select another.' };
    }
    throw err;
  }
}

export async function unlockBooking(conn, bookingId) {
  const [rows] = await conn.query(
    'SELECT BookingID, StudentID, TeacherCode, MeetingDateID, SlotID, Status FROM Bookings WITH (UPDLOCK, ROWLOCK) WHERE BookingID = ?',
    [bookingId]
  );
  if (rows.length === 0) throw { status: 404, message: 'Booking not found.' };
  if (rows[0].Status !== 'CONFIRMED') throw { status: 400, message: 'Only confirmed bookings can be unlocked.' };

  const booking = rows[0];
  await conn.query(
    'UPDATE Bookings SET Status = ?, CancelledAt = NOW() WHERE BookingID = ?',
    ['UNLOCKED', bookingId]
  );

  await conn.query(
    `UPDATE TeacherAvailability SET IsAvailable = 1, BlockedReason = NULL WHERE TeacherCode = ? AND SlotID = ?;
     IF @@ROWCOUNT = 0
     BEGIN
       DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
       INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
       VALUES (@NextAvailID, ?, ?, ?, 1, NULL);
     END`,
    [booking.TeacherCode, booking.SlotID, booking.TeacherCode, booking.MeetingDateID, booking.SlotID]
  );

  return booking;
}

export async function cancelBooking(conn, bookingId) {
  const [rows] = await conn.query(
    'SELECT BookingID, StudentID, TeacherCode, MeetingDateID, SlotID, Status FROM Bookings WITH (UPDLOCK, ROWLOCK) WHERE BookingID = ?',
    [bookingId]
  );
  if (rows.length === 0) throw { status: 404, message: 'Booking not found.' };
  if (rows[0].Status !== 'CONFIRMED') throw { status: 400, message: 'Only confirmed bookings can be cancelled.' };

  const booking = rows[0];
  await conn.query(
    'UPDATE Bookings SET Status = ?, CancelledAt = NOW() WHERE BookingID = ?',
    ['CANCELLED', bookingId]
  );

  await conn.query(
    `UPDATE TeacherAvailability SET IsAvailable = 1, BlockedReason = NULL WHERE TeacherCode = ? AND SlotID = ?;
     IF @@ROWCOUNT = 0
     BEGIN
       DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
       INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
       VALUES (@NextAvailID, ?, ?, ?, 1, NULL);
     END`,
    [booking.TeacherCode, booking.SlotID, booking.TeacherCode, booking.MeetingDateID, booking.SlotID]
  );

  return booking;
}

export async function getAvailableSlots(teacherCode, meetingDateId) {
  const [slots] = await pool.query(`
    SELECT
      ts.SlotID, ts.ScheduleCode, ts.StartTime, ts.EndTime, ts.IsBlocked, ts.BlockReason,
      COALESCE(ta.IsAvailable, 1) as TeacherAvailable,
      ta.BlockedReason as TeacherBlockedReason,
      CASE
        WHEN ts.IsBlocked = 1 THEN 'global-blocked'
        WHEN COALESCE(ta.IsAvailable, 1) = 0 THEN 'teacher-blocked'
        WHEN b.BookingID IS NOT NULL THEN 'booked'
        ELSE 'available'
      END as effectiveStatus,
      b.BookingID, b.StudentID as BookedStudentID, b.BookedBy
    FROM TimeSlots ts
    LEFT JOIN TeacherAvailability ta ON ta.SlotID = ts.SlotID AND ta.TeacherCode = ?
    LEFT JOIN Bookings b ON b.SlotID = ts.SlotID AND b.TeacherCode = ? AND b.MeetingDateID = ? AND b.Status = 'CONFIRMED'
    WHERE ts.MeetingDateID = ?
    ORDER BY ts.StartTime
  `, [teacherCode, teacherCode, meetingDateId, meetingDateId]);
  return slots;
}
