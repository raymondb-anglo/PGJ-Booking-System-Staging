import 'dotenv/config';
import pool from './db.js';

function buildFilters(query) {
  const where = [];
  const params = [];
  if (query.dateId) { where.push('b.MeetingDateID = ?'); params.push(query.dateId); }
  if (query.teacherCode) { where.push('b.TeacherCode = ?'); params.push(query.teacherCode); }
  if (query.pcClass) { where.push('s.PCClass = ?'); params.push(query.pcClass); }
  if (query.studentId) { where.push('b.StudentID = ?'); params.push(query.studentId); }
  if (query.teacherEmail) { where.push('t.Email LIKE ?'); params.push('%' + query.teacherEmail + '%'); }
  if (query.studentEmail) { where.push('s.Email LIKE ?'); params.push('%' + query.studentEmail + '%'); }
  if (query.search) {
    where.push('(s.StudentName LIKE ? OR s.StudentID LIKE ? OR t.TeacherName LIKE ? OR t.Email LIKE ? OR s.Email LIKE ? OR b.ScheduleCode LIKE ?)');
    const term = '%' + query.search + '%';
    params.push(term, term, term, term, term, term);
  }
  return { whereClause: where.length > 0 ? ' AND ' + where.join(' AND ') : '', params };
}

const ORDER_SQL = ' ORDER BY s.PCClass, md.DayNumber, ts.StartTime, b.ScheduleCode';

async function run() {
  try {
    const q = { teacherCode: '64T00025', pcClass: 'S4 Mentorship - Mr Arnel' };
    const { whereClause, params } = buildFilters(q);
    const limit = 50; const offset = 0;

    const [bookings] = await pool.query(
      `SELECT * FROM (
        SELECT ROW_NUMBER() OVER (${ORDER_SQL.trim()}) AS _RowNum,
               b.BookingID, b.ScheduleCode,
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
        WHERE b.Status = 'CONFIRMED'${whereClause ? ' ' + whereClause.trim() : ''}
      ) AS _paged
      WHERE _paged._RowNum > ${offset} AND _paged._RowNum <= ${offset + limit}
      ORDER BY _paged._RowNum`,
      params
    );
    console.log('Bookings paged:', bookings);
  } catch (err) { console.error(err); } finally { process.exit(0); }
}
run();
