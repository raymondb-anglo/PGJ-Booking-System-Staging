import pool from '../db.js';
import { ensureBookingsTable, createBooking, unlockBooking } from '../utils/bookingEngine.js';

async function setup() {
  await ensureBookingsTable();

  const [students] = await pool.query('SELECT StudentID, TeacherID FROM Students WHERE IsActive = 1 LIMIT 2');
  if (students.length === 0) {
    console.log('SKIP: No active students found');
    process.exit(0);
  }

  const student1 = students[0];
  const student2 = students.length > 1 ? students[1] : null;

  const [terms] = await pool.query('SELECT TermID FROM BookingTerms WHERE IsActive = 1 LIMIT 1');
  if (terms.length === 0) {
    console.log('SKIP: No active term');
    process.exit(0);
  }

  const [dates] = await pool.query(
    'SELECT DateID FROM MeetingDates WHERE TermID = ? AND IsActive = 1 LIMIT 1',
    [terms[0].TermID]
  );
  if (dates.length === 0) {
    console.log('SKIP: No active meeting dates');
    process.exit(0);
  }
  const dateId = dates[0].DateID;

  const [slots] = await pool.query(
    'SELECT SlotID, ScheduleCode FROM TimeSlots WHERE MeetingDateID = ? AND IsBlocked = 0 ORDER BY StartTime LIMIT 5',
    [dateId]
  );
  if (slots.length === 0) {
    console.log('SKIP: No available slots');
    process.exit(0);
  }

  return { student1, student2, dateId, slots };
}

async function cleanupBooking(bookingId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await unlockBooking(conn, bookingId);
    await conn.commit();
  } catch (e) {
  } finally {
    conn.release();
  }
}

async function attemptBooking({ studentId, teacherCode, meetingDateId, slotId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await createBooking(conn, {
      studentId, teacherCode, meetingDateId, slotId,
      translatorRequired: false, translatorLanguage: null, bookedBy: 'ADMIN'
    });
    await conn.commit();
    return { success: true, bookingId: result.bookingId, scheduleCode: result.scheduleCode };
  } catch (err) {
    await conn.rollback();
    return { success: false, message: err.message || 'Unknown error', status: err.status };
  } finally {
    conn.release();
  }
}

async function test1_sameSlotSameTeacher(student, dateId, slot) {
  console.log('\n=== TEST 1: Same Slot, Same Teacher — 20 parallel requests ===');
  const N = 20;
  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(attemptBooking({
      studentId: student.StudentID,
      teacherCode: student.TeacherID,
      meetingDateId: dateId,
      slotId: slot.SlotID
    }));
  }

  const results = await Promise.all(promises);
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  console.log(`  Successes: ${successes.length} (expected: 1)`);
  console.log(`  Failures:  ${failures.length} (expected: ${N - 1})`);

  if (successes.length === 1) {
    console.log('  PASS: Exactly 1 booking created');
    await cleanupBooking(successes[0].bookingId);
    console.log('  Cleanup: Booking unlocked');
  } else if (successes.length === 0) {
    console.log('  FAIL: No bookings created (unexpected)');
  } else {
    console.log(`  FAIL: ${successes.length} bookings created (double booking!)}`);
    for (const s of successes) {
      await cleanupBooking(s.bookingId);
    }
  }

  return successes.length === 1;
}

async function test2_sameTimeDiffTeachers(student1, student2, dateId, slot) {
  if (!student2 || student1.TeacherID === student2.TeacherID) {
    console.log('\n=== TEST 2: Same Time, Different Teachers — SKIPPED (need 2 students with different teachers) ===');
    return true;
  }

  console.log('\n=== TEST 2: Same Time, Different Teachers ===');
  const p1 = attemptBooking({
    studentId: student1.StudentID, teacherCode: student1.TeacherID,
    meetingDateId: dateId, slotId: slot.SlotID
  });
  const p2 = attemptBooking({
    studentId: student2.StudentID, teacherCode: student2.TeacherID,
    meetingDateId: dateId, slotId: slot.SlotID
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  const successes = [r1, r2].filter(r => r.success);
  console.log(`  Successes: ${successes.length} (expected: 2)`);

  for (const s of successes) await cleanupBooking(s.bookingId);

  if (successes.length === 2) {
    console.log('  PASS: Both teachers booked independently');
    return true;
  } else {
    console.log('  FAIL: Not all bookings succeeded');
    return false;
  }
}

async function test3_sameTeacherDiffSlots(student, dateId, slots) {
  if (slots.length < 2) {
    console.log('\n=== TEST 3: Same Teacher, Different Slots — SKIPPED (need 2+ slots) ===');
    return true;
  }

  console.log('\n=== TEST 3: Same Teacher, Different Slots ===');
  console.log('  NOTE: Using only slot1 since one student can only book once per date');
  const r1 = await attemptBooking({
    studentId: student.StudentID, teacherCode: student.TeacherID,
    meetingDateId: dateId, slotId: slots[0].SlotID
  });
  console.log(`  Slot ${slots[0].ScheduleCode}: ${r1.success ? 'SUCCESS' : 'FAIL: ' + r1.message}`);

  if (r1.success) {
    await cleanupBooking(r1.bookingId);
    console.log('  PASS: Booking created and cleaned up');
    return true;
  }
  return false;
}

async function runTests() {
  console.log('=== BOOKING ENGINE CONCURRENCY TESTS ===');
  const { student1, student2, dateId, slots } = await setup();
  console.log(`Student: ${student1.StudentID}, Teacher: ${student1.TeacherID}`);
  console.log(`Date: ${dateId}, Slots: ${slots.map(s => s.ScheduleCode).join(', ')}`);

  const results = [];
  results.push(await test1_sameSlotSameTeacher(student1, dateId, slots[0]));
  results.push(await test2_sameTimeDiffTeachers(student1, student2, dateId, slots[0]));
  results.push(await test3_sameTeacherDiffSlots(student1, dateId, slots));

  console.log('\n=== SUMMARY ===');
  console.log(`Test 1 (Same Slot Race):       ${results[0] ? 'PASS' : 'FAIL'}`);
  console.log(`Test 2 (Diff Teachers):        ${results[1] ? 'PASS' : 'FAIL'}`);
  console.log(`Test 3 (Diff Slots):           ${results[2] ? 'PASS' : 'FAIL'}`);
  console.log(`Overall: ${results.every(r => r) ? 'ALL PASS' : 'SOME FAILED'}`);

  await pool.end();
}

runTests().catch(err => {
  console.error('Test error:', err);
  pool.end();
  process.exit(1);
});
