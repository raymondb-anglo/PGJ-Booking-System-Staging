import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const router = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function ensureAvailabilityTable() {
  // MSSQL schema is already pre-configured by user.
  return;
}

function getDayPrefix(dayNumber) {
  if (dayNumber < 1 || dayNumber > 26) return '?';
  return String.fromCharCode(64 + dayNumber);
}

router.get('/', async (req, res) => {
  try {
    await ensureAvailabilityTable();

    const [teachers] = await pool.query(
      'SELECT TeacherCode, TeacherName, TeacherNickname, MeetingDays FROM Teachers WHERE IsActive = 1 ORDER BY TeacherName ASC'
    );

    const [terms] = await pool.query(
      `SELECT bt.TermID, bt.TermLabel, sy.YearLabel, bt.IsActive
       FROM BookingTerms bt
       JOIN SchoolYears sy ON sy.SchoolYearID = bt.SchoolYearID
       ORDER BY bt.IsActive DESC, bt.TermID DESC`
    );

    let selectedTermId = req.query.termId || null;
    if (!selectedTermId && terms.length > 0) {
      const activeTerm = terms.find(t => t.IsActive) || terms[0];
      selectedTermId = activeTerm.TermID;
    }

    let meetingDates = [];
    if (selectedTermId) {
      [meetingDates] = await pool.query(
        `SELECT md.*, (SELECT COUNT(*) FROM TimeSlots WHERE MeetingDateID = md.DateID) as slotCount
         FROM MeetingDates md WHERE md.TermID = ? ORDER BY md.DayNumber ASC`,
        [selectedTermId]
      );
      for (const md of meetingDates) {
        md.prefix = md.DayNumber ? getDayPrefix(md.DayNumber) : '-';
      }
    }

    const allMeetingDates = [...meetingDates];

    const selectedTeacher = req.query.teacherCode || null;
    const selectedDateId = req.query.dateId ? parseInt(req.query.dateId) : null;

    if (selectedTeacher && meetingDates.length > 0) {
      const teacherObj = teachers.find(t => t.TeacherCode === selectedTeacher);
      const tMeetingDays = (teacherObj && teacherObj.MeetingDays) ? teacherObj.MeetingDays.split(',').map(d => d.trim()) : null;
      if (tMeetingDays) {
        meetingDates = meetingDates.filter(md => tMeetingDays.includes(String(md.DayNumber)));
      }
    }

    let slots = [];
    let selectedMeetingDate = null;
    let copyTeachers = [];
    let copyDates = [];

    if (selectedTeacher && selectedDateId) {
      const [md] = await pool.query('SELECT * FROM MeetingDates WHERE DateID = ?', [selectedDateId]);
      if (md.length > 0) {
        selectedMeetingDate = md[0];
        selectedMeetingDate.prefix = selectedMeetingDate.DayNumber ? getDayPrefix(selectedMeetingDate.DayNumber) : '?';

        const [rawSlots] = await pool.query(
          'SELECT * FROM TimeSlots WHERE MeetingDateID = ? ORDER BY ScheduleCode ASC',
          [selectedDateId]
        );

        const [availability] = await pool.query(
          'SELECT * FROM TeacherAvailability WHERE TeacherCode = ? AND MeetingDateID = ?',
          [selectedTeacher, selectedDateId]
        );
        const availMap = {};
        for (const a of availability) {
          availMap[a.SlotID] = a;
        }

        slots = rawSlots.map(s => ({
          ...s,
          globalBlocked: s.IsBlocked === 1,
          globalBlockReason: s.BlockReason,
          teacherAvail: availMap[s.SlotID] || null,
          teacherBlocked: availMap[s.SlotID] ? !availMap[s.SlotID].IsAvailable : false,
          teacherBlockReason: availMap[s.SlotID] ? availMap[s.SlotID].BlockedReason : null,
          effectiveStatus: s.IsBlocked === 1 ? 'global-blocked' :
            (availMap[s.SlotID] && !availMap[s.SlotID].IsAvailable ? 'teacher-blocked' : 'available')
        }));

        copyTeachers = teachers.filter(t => t.TeacherCode !== selectedTeacher);
        copyDates = meetingDates.filter(d => d.DateID !== selectedDateId && d.slotCount > 0);
      }
    }

    res.render('admin/config/teacher-availability', {
      title: 'Teacher Availability',
      teachers,
      terms,
      selectedTermId: selectedTermId ? parseInt(selectedTermId) : null,
      meetingDates,
      allMeetingDates,
      selectedTeacher,
      selectedDateId,
      selectedMeetingDate,
      slots,
      copyTeachers,
      copyDates,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Teacher availability error:', error.message);
    res.render('admin/config/teacher-availability', {
      title: 'Teacher Availability',
      teachers: [], terms: [], selectedTermId: null, meetingDates: [], allMeetingDates: [],
      selectedTeacher: null, selectedDateId: null, selectedMeetingDate: null,
      slots: [], copyTeachers: [], copyDates: [],
      error: 'Failed to load: ' + error.message
    });
  }
});

function buildReturnUrl(teacherCode, dateId, termId) {
  return `/admin/config/teacher-availability?teacherCode=${encodeURIComponent(teacherCode)}&dateId=${dateId}&termId=${termId}`;
}

router.post('/save', async (req, res) => {
  const { teacherCode, dateId, termId } = req.body;
  if (!teacherCode || !dateId) {
    return res.redirect('/admin/config/teacher-availability?error=' + encodeURIComponent('Teacher and date are required.'));
  }

  const blockedSlots = req.body.blockedSlots || [];
  const blockedReasons = req.body.blockedReasons || {};
  const blockedArray = Array.isArray(blockedSlots) ? blockedSlots : [blockedSlots];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [allSlots] = await conn.query(
      'SELECT SlotID, IsBlocked FROM TimeSlots WHERE MeetingDateID = ?',
      [dateId]
    );

    for (const slot of allSlots) {
      if (slot.IsBlocked) continue;

      const isTeacherBlocked = blockedArray.includes(String(slot.SlotID));
      const reason = isTeacherBlocked ? (blockedReasons[slot.SlotID] || null) : null;

      await conn.query(
        `UPDATE TeacherAvailability SET IsAvailable = ?, BlockedReason = ? WHERE TeacherCode = ? AND SlotID = ?;
         IF @@ROWCOUNT = 0
         BEGIN
           DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
           INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
           VALUES (@NextAvailID, ?, ?, ?, ?, ?);
         END`,
        [isTeacherBlocked ? 0 : 1, reason, teacherCode, slot.SlotID, teacherCode, dateId, slot.SlotID, isTeacherBlocked ? 0 : 1, reason]
      );
    }

    await conn.commit();

    const blockedCount = blockedArray.filter(id => {
      const s = allSlots.find(sl => String(sl.SlotID) === id);
      return s && !s.IsBlocked;
    }).length;

    await logAudit(req, 'SAVE_TEACHER_AVAILABILITY', 'TEACHER_AVAILABILITY',
      `Saved availability for ${teacherCode} on DateID ${dateId}: ${blockedCount} teacher-blocked slots`);

    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&success=' + encodeURIComponent(`Availability saved: ${blockedCount} slot(s) blocked.`));
  } catch (error) {
    await conn.rollback();
    console.error('Save availability error:', error.message);
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('Failed to save: ' + error.message));
  } finally {
    conn.release();
  }
});

router.post('/bulk-block', async (req, res) => {
  const { teacherCode, dateId, termId, slotIds, blockReason } = req.body;
  if (!teacherCode || !dateId || !slotIds) {
    return res.redirect('/admin/config/teacher-availability?error=' + encodeURIComponent('Missing required fields.'));
  }

  const ids = Array.isArray(slotIds) ? slotIds : [slotIds];
  const reason = blockReason || null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const slotId of ids) {
      const [slot] = await conn.query('SELECT IsBlocked FROM TimeSlots WHERE SlotID = ?', [slotId]);
      if (slot.length > 0 && slot[0].IsBlocked) continue;

      await conn.query(
        `UPDATE TeacherAvailability SET IsAvailable = 0, BlockedReason = ? WHERE TeacherCode = ? AND SlotID = ?;
         IF @@ROWCOUNT = 0
         BEGIN
           DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
           INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
           VALUES (@NextAvailID, ?, ?, ?, 0, ?);
         END`,
        [reason, teacherCode, slotId, teacherCode, dateId, slotId, reason]
      );
    }

    await conn.commit();
    await logAudit(req, 'BULK_BLOCK_TEACHER', 'TEACHER_AVAILABILITY',
      `Bulk blocked ${ids.length} slots for ${teacherCode} on DateID ${dateId}`);
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&success=' + encodeURIComponent(`${ids.length} slot(s) blocked.`));
  } catch (error) {
    await conn.rollback();
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('Failed to bulk block.'));
  } finally {
    conn.release();
  }
});

router.post('/bulk-unblock', async (req, res) => {
  const { teacherCode, dateId, termId, slotIds } = req.body;
  if (!teacherCode || !dateId || !slotIds) {
    return res.redirect('/admin/config/teacher-availability?error=' + encodeURIComponent('Missing required fields.'));
  }

  const ids = Array.isArray(slotIds) ? slotIds : [slotIds];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [globalBlocked] = await conn.query(
      'SELECT SlotID FROM TimeSlots WHERE MeetingDateID = ? AND IsBlocked = 1 AND SlotID IN (' + ids.map(() => '?').join(',') + ')',
      [dateId, ...ids]
    );
    const globalBlockedSet = new Set(globalBlocked.map(r => String(r.SlotID)));

    let skipped = 0;
    for (const slotId of ids) {
      if (globalBlockedSet.has(String(slotId))) { skipped++; continue; }
      await conn.query(
        `UPDATE TeacherAvailability SET IsAvailable = 1, BlockedReason = NULL WHERE TeacherCode = ? AND SlotID = ?;
         IF @@ROWCOUNT = 0
         BEGIN
           DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
           INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
           VALUES (@NextAvailID, ?, ?, ?, 1, NULL);
         END`,
        [teacherCode, slotId, teacherCode, dateId, slotId]
      );
    }

    await conn.commit();
    await logAudit(req, 'BULK_UNBLOCK_TEACHER', 'TEACHER_AVAILABILITY',
      `Bulk unblocked ${ids.length} slots for ${teacherCode} on DateID ${dateId}`);
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&success=' + encodeURIComponent(`${ids.length} slot(s) unblocked.`));
  } catch (error) {
    await conn.rollback();
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('Failed to bulk unblock.'));
  } finally {
    conn.release();
  }
});

router.post('/copy-from-teacher', async (req, res) => {
  const { teacherCode, dateId, termId, sourceTeacherCode } = req.body;
  if (!teacherCode || !dateId || !sourceTeacherCode) {
    return res.redirect('/admin/config/teacher-availability?error=' + encodeURIComponent('Missing required fields.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sourceAvail] = await conn.query(
      'SELECT SlotID, IsAvailable, BlockedReason FROM TeacherAvailability WHERE TeacherCode = ? AND MeetingDateID = ?',
      [sourceTeacherCode, dateId]
    );

    if (sourceAvail.length === 0) {
      await conn.rollback();
      return res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('Source teacher has no availability data for this day.'));
    }

    const [globalBlocked] = await conn.query(
      'SELECT SlotID FROM TimeSlots WHERE MeetingDateID = ? AND IsBlocked = 1',
      [dateId]
    );
    const globalBlockedSet = new Set(globalBlocked.map(r => r.SlotID));

    let copied = 0;
    for (const a of sourceAvail) {
      if (globalBlockedSet.has(a.SlotID)) continue;
      await conn.query(
        `UPDATE TeacherAvailability SET IsAvailable = ?, BlockedReason = ? WHERE TeacherCode = ? AND SlotID = ?;
         IF @@ROWCOUNT = 0
         BEGIN
           DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
           INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
           VALUES (@NextAvailID, ?, ?, ?, ?, ?);
         END`,
        [a.IsAvailable, a.BlockedReason, teacherCode, a.SlotID, teacherCode, dateId, a.SlotID, a.IsAvailable, a.BlockedReason]
      );
      copied++;
    }

    await conn.commit();
    await logAudit(req, 'COPY_TEACHER_AVAILABILITY', 'TEACHER_AVAILABILITY',
      `Copied availability from ${sourceTeacherCode} to ${teacherCode} on DateID ${dateId} (${copied} records, ${sourceAvail.length - copied} global-blocked skipped)`);
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&success=' + encodeURIComponent(`Availability copied from ${sourceTeacherCode}.`));
  } catch (error) {
    await conn.rollback();
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('Failed to copy availability.'));
  } finally {
    conn.release();
  }
});

router.post('/copy-from-day', async (req, res) => {
  const { teacherCode, dateId, termId, sourceDateId } = req.body;
  if (!teacherCode || !dateId || !sourceDateId) {
    return res.redirect('/admin/config/teacher-availability?error=' + encodeURIComponent('Missing required fields.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sourceAvail] = await conn.query(
      `SELECT ta.IsAvailable, ta.BlockedReason, ts.StartTime, ts.EndTime
       FROM TeacherAvailability ta
       JOIN TimeSlots ts ON ts.SlotID = ta.SlotID
       WHERE ta.TeacherCode = ? AND ta.MeetingDateID = ?
       ORDER BY ts.StartTime`,
      [teacherCode, sourceDateId]
    );

    if (sourceAvail.length === 0) {
      await conn.rollback();
      return res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('No availability data exists for the source day.'));
    }

    const [targetSlots] = await conn.query(
      'SELECT SlotID, StartTime, EndTime FROM TimeSlots WHERE MeetingDateID = ? ORDER BY StartTime',
      [dateId]
    );

    const sourceMap = {};
    for (const a of sourceAvail) {
      const key = a.StartTime + '-' + a.EndTime;
      sourceMap[key] = a;
    }

    const [globalBlocked] = await conn.query(
      'SELECT SlotID FROM TimeSlots WHERE MeetingDateID = ? AND IsBlocked = 1',
      [dateId]
    );
    const globalBlockedSet = new Set(globalBlocked.map(r => r.SlotID));

    let copied = 0;
    for (const ts of targetSlots) {
      if (globalBlockedSet.has(ts.SlotID)) continue;
      const key = ts.StartTime + '-' + ts.EndTime;
      const match = sourceMap[key];
      if (match) {
        await conn.query(
          `UPDATE TeacherAvailability SET IsAvailable = ?, BlockedReason = ? WHERE TeacherCode = ? AND SlotID = ?;
           IF @@ROWCOUNT = 0
           BEGIN
             DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
             INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
             VALUES (@NextAvailID, ?, ?, ?, ?, ?);
           END`,
          [match.IsAvailable, match.BlockedReason, teacherCode, ts.SlotID, teacherCode, dateId, ts.SlotID, match.IsAvailable, match.BlockedReason]
        );
        copied++;
      }
    }

    await conn.commit();
    await logAudit(req, 'COPY_DAY_AVAILABILITY', 'TEACHER_AVAILABILITY',
      `Copied availability from DateID ${sourceDateId} to ${dateId} for ${teacherCode} (${copied} matched slots)`);
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&success=' + encodeURIComponent(`Availability copied from another day (${copied} matched slots).`));
  } catch (error) {
    await conn.rollback();
    res.redirect(buildReturnUrl(teacherCode, dateId, termId) + '&error=' + encodeURIComponent('Failed to copy from day.'));
  } finally {
    conn.release();
  }
});

router.get('/import', (req, res) => {
  res.render('admin/config/teacher-availability-import', {
    title: 'Import Teacher Availability',
    error: null, preview: null, summary: null
  });
});

router.get('/import/template', (req, res) => {
  const csvContent = 'TeacherCode,DayNumber,ScheduleCode,IsAvailable,BlockReason\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=Teacher_Availability_Import_Template.csv');
  res.send(csvContent);
});

router.post('/import/preview', csvUpload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.render('admin/config/teacher-availability-import', {
      title: 'Import Teacher Availability',
      error: 'Please upload a CSV file.', preview: null, summary: null
    });
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });

    if (records.length === 0) {
      return res.render('admin/config/teacher-availability-import', {
        title: 'Import Teacher Availability',
        error: 'CSV file is empty.', preview: null, summary: null
      });
    }

    const [activeTeachers] = await pool.query('SELECT TeacherCode FROM Teachers WHERE IsActive = 1');
    const teacherCodes = new Set(activeTeachers.map(t => t.TeacherCode));

    const [activeDates] = await pool.query(
      'SELECT DateID, DayNumber FROM MeetingDates WHERE IsActive = 1'
    );
    const dayNumToDateId = {};
    for (const d of activeDates) {
      dayNumToDateId[String(d.DayNumber)] = d.DateID;
    }

    const dateIds = activeDates.map(d => d.DateID);
    let slotMap = {};
    if (dateIds.length > 0) {
      const [slots] = await pool.query(
        `SELECT SlotID, MeetingDateID, ScheduleCode, StartTime, EndTime, IsBlocked
         FROM TimeSlots WHERE MeetingDateID IN (${dateIds.map(() => '?').join(',')})`,
        dateIds
      );
      for (const s of slots) {
        const key = s.MeetingDateID + '_' + s.ScheduleCode;
        slotMap[key] = s;
      }
    }

    const preview = [];
    for (const row of records) {
      const teacherCode = (row.TeacherCode || row.teacher_code || row.teacherCode || '').trim();
      const dayNumber = (row.DayNumber || row.day_number || row.dayNumber || row.Day || '').trim();
      const scheduleCode = (row.ScheduleCode || row.schedule_code || row.scheduleCode || row.SlotCode || '').trim().toUpperCase();
      const isAvailableRaw = (row.IsAvailable || row.is_available || row.isAvailable || row.Available || '').trim();
      const blockReason = (row.BlockReason || row.block_reason || row.blockReason || row.Reason || '').trim();

      const errors = [];
      let isAvailable = null;
      let dateId = null;
      let slot = null;
      let globalBlocked = false;

      if (!teacherCode) errors.push('Missing TeacherCode');
      else if (!teacherCodes.has(teacherCode)) errors.push('Teacher not found or inactive');

      if (!dayNumber) errors.push('Missing DayNumber');
      else {
        dateId = dayNumToDateId[dayNumber];
        if (!dateId) errors.push('Day ' + dayNumber + ' not found or inactive');
      }

      if (!scheduleCode) errors.push('Missing ScheduleCode');

      if (isAvailableRaw === '') {
        errors.push('Missing IsAvailable');
      } else if (isAvailableRaw !== '0' && isAvailableRaw !== '1') {
        errors.push('IsAvailable must be 0 or 1');
      } else {
        isAvailable = parseInt(isAvailableRaw);
      }

      if (dateId && scheduleCode && errors.length === 0) {
        const key = dateId + '_' + scheduleCode;
        slot = slotMap[key];
        if (!slot) {
          errors.push('Slot ' + scheduleCode + ' not found for Day ' + dayNumber);
        } else if (slot.IsBlocked === 1) {
          globalBlocked = true;
        }
      }

      preview.push({
        teacherCode,
        dayNumber,
        scheduleCode,
        isAvailable,
        blockReason,
        dateId,
        slotId: slot ? slot.SlotID : null,
        startTime: slot ? slot.StartTime.substring(0, 5) : '',
        endTime: slot ? slot.EndTime.substring(0, 5) : '',
        globalBlocked,
        errors,
        valid: errors.length === 0
      });
    }

    req.session.availabilityImportPreview = preview;
    res.render('admin/config/teacher-availability-import', {
      title: 'Import Teacher Availability',
      error: null, preview, summary: null
    });
  } catch (error) {
    console.error('Availability import preview error:', error.message);
    res.render('admin/config/teacher-availability-import', {
      title: 'Import Teacher Availability',
      error: 'Failed to parse CSV: ' + error.message, preview: null, summary: null
    });
  }
});

router.post('/import/confirm', async (req, res) => {
  const preview = req.session.availabilityImportPreview;
  if (!preview || preview.length === 0) {
    return res.render('admin/config/teacher-availability-import', {
      title: 'Import Teacher Availability',
      error: 'No import data. Please upload again.', preview: null, summary: null
    });
  }

  let successCount = 0;
  let skippedGlobal = 0;
  const failed = [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (let i = 0; i < preview.length; i++) {
      const row = preview[i];

      if (!row.valid) {
        failed.push({ row: i + 1, teacherCode: row.teacherCode, scheduleCode: row.scheduleCode, reason: row.errors.join(', ') });
        continue;
      }

      if (row.globalBlocked) {
        skippedGlobal++;
        continue;
      }

      try {
        await conn.query(
          `UPDATE TeacherAvailability SET IsAvailable = ?, BlockedReason = ? WHERE TeacherCode = ? AND SlotID = ?;
           IF @@ROWCOUNT = 0
           BEGIN
             DECLARE @NextAvailID INT = ISNULL((SELECT MAX(AvailabilityID) FROM TeacherAvailability WITH (UPDLOCK, HOLDLOCK)), 0) + 1;
             INSERT INTO TeacherAvailability (AvailabilityID, TeacherCode, MeetingDateID, SlotID, IsAvailable, BlockedReason)
             VALUES (@NextAvailID, ?, ?, ?, ?, ?);
           END`,
          [row.isAvailable, row.isAvailable === 0 ? (row.blockReason || null) : null, row.teacherCode, row.slotId, row.teacherCode, row.dateId, row.slotId, row.isAvailable, row.isAvailable === 0 ? (row.blockReason || null) : null]
        );
        successCount++;
      } catch (err) {
        failed.push({ row: i + 1, teacherCode: row.teacherCode, scheduleCode: row.scheduleCode, reason: err.message });
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    delete req.session.availabilityImportPreview;
    return res.render('admin/config/teacher-availability-import', {
      title: 'Import Teacher Availability',
      error: 'Import failed: ' + error.message, preview: null, summary: null
    });
  } finally {
    conn.release();
  }

  delete req.session.availabilityImportPreview;
  await logAudit(req, 'IMPORT_TEACHER_AVAILABILITY', 'TEACHER_AVAILABILITY',
    `Imported ${successCount} availability records, ${skippedGlobal} skipped (global-blocked), ${failed.length} failed`);

  res.render('admin/config/teacher-availability-import', {
    title: 'Import Teacher Availability',
    error: null, preview: null,
    summary: { successCount, skippedGlobal, failed, total: preview.length }
  });
});

export default router;
