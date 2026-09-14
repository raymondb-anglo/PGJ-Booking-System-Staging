import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../utils/auditLog.js';

const router = Router();

async function ensureSchema() {
  // MSSQL schema is already pre-configured by user.
  return;
}

function getDayPrefix(dayNumber) {
  if (dayNumber < 1 || dayNumber > 26) return '?';
  return String.fromCharCode(64 + dayNumber);
}

function timeToMin(t) {
  const parts = t.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function minToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function rangesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

function generateSlotsFromRanges(timeRanges, blockedRanges, prefix, duration = 10, interval = 5) {
  const slots = [];
  let slotNumber = 1;

  const sortedRanges = [...timeRanges].sort((a, b) => timeToMin(a.StartTime) - timeToMin(b.StartTime));

  for (const range of sortedRanges) {
    let currentMin = timeToMin(range.StartTime);
    const endMin = timeToMin(range.EndTime);

    while (currentMin + duration <= endMin) {
      const slotStart = currentMin;
      const slotEnd = currentMin + duration;

      let isBlocked = false;
      let blockReason = null;
      for (const br of blockedRanges) {
        const brStart = timeToMin(br.StartTime);
        const brEnd = timeToMin(br.EndTime);
        if (rangesOverlap(slotStart, slotEnd, brStart, brEnd)) {
          isBlocked = true;
          blockReason = br.BlockReason;
          break;
        }
      }

      const code = prefix + String(slotNumber).padStart(2, '0');
      slots.push({
        scheduleCode: code,
        startTime: minToTime(slotStart) + ':00',
        endTime: minToTime(slotEnd) + ':00',
        isBlocked,
        blockReason
      });
      slotNumber++;
      currentMin = slotEnd + interval;
    }
  }
  return slots;
}

router.get('/', async (req, res) => {
  try {
    await ensureSchema();

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
        'SELECT * FROM MeetingDates WHERE TermID = ? ORDER BY DayNumber ASC, MeetingDate ASC',
        [selectedTermId]
      );

      for (const md of meetingDates) {
        const [slots] = await pool.query('SELECT COUNT(*) as cnt FROM TimeSlots WHERE MeetingDateID = ?', [md.DateID]);
        const [blocked] = await pool.query('SELECT COUNT(*) as cnt FROM TimeSlots WHERE MeetingDateID = ? AND IsBlocked = 1', [md.DateID]);
        md.slotCount = slots[0].cnt;
        md.blockedCount = blocked[0].cnt;
        md.prefix = md.DayNumber ? getDayPrefix(md.DayNumber) : '-';
      }
    }

    res.render('admin/config/meeting-dates', {
      title: 'Meeting Dates',
      terms,
      selectedTermId: selectedTermId ? parseInt(selectedTermId) : null,
      meetingDates,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Meeting dates error:', error.message);
    res.render('admin/config/meeting-dates', {
      title: 'Meeting Dates', terms: [], selectedTermId: null, meetingDates: [],
      error: 'Failed to load: ' + error.message
    });
  }
});

router.post('/create', async (req, res) => {
  const { termId, meetingDate, dayNumber } = req.body;
  if (!termId || !meetingDate || !dayNumber) {
    return res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('All fields are required.'));
  }

  const dayNum = parseInt(dayNumber);
  if (isNaN(dayNum) || dayNum < 1 || dayNum > 26) {
    return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Day number must be between 1 and 26.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureSchema();

    const [dupDate] = await conn.query('SELECT DateID FROM MeetingDates WHERE TermID = ? AND MeetingDate = ?', [termId, meetingDate]);
    if (dupDate.length > 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('This date already exists for this term.'));
    }

    const [dupDay] = await conn.query('SELECT DateID FROM MeetingDates WHERE TermID = ? AND DayNumber = ?', [termId, dayNum]);
    if (dupDay.length > 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Day ' + dayNum + ' already exists for this term.'));
    }

    const dayLabel = 'Day ' + dayNum;
    await conn.query(
      'INSERT INTO MeetingDates (TermID, MeetingDate, DayNumber, DayLabel, IsActive) VALUES (?, ?, ?, ?, 1)',
      [termId, meetingDate, dayNum, dayLabel]
    );

    await conn.commit();
    await logAudit(req, 'CREATE_MEETING_DATE', 'MEETING_DATES', `Created ${meetingDate} as ${dayLabel} (Prefix ${getDayPrefix(dayNum)})`);
    res.redirect('/admin/config/meeting-dates?termId=' + termId + '&success=' + encodeURIComponent('Meeting date created.'));
  } catch (error) {
    await conn.rollback();
    console.error('Create meeting date error:', error.message);
    res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('Failed to create: ' + error.message));
  } finally {
    conn.release();
  }
});

router.post('/edit', async (req, res) => {
  const { dateId, termId, meetingDate, dayNumber } = req.body;
  if (!dateId || !meetingDate || !dayNumber) {
    return res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('All fields are required.'));
  }

  const dayNum = parseInt(dayNumber);
  if (isNaN(dayNum) || dayNum < 1 || dayNum > 26) {
    return res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('Day number must be between 1 and 26.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dupDate] = await conn.query('SELECT DateID FROM MeetingDates WHERE TermID = ? AND MeetingDate = ? AND DateID != ?', [termId, meetingDate, dateId]);
    if (dupDate.length > 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('This date already exists for this term.'));
    }

    const [dupDay] = await conn.query('SELECT DateID FROM MeetingDates WHERE TermID = ? AND DayNumber = ? AND DateID != ?', [termId, dayNum, dateId]);
    if (dupDay.length > 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Day ' + dayNum + ' already exists for this term.'));
    }

    const [existingSlots] = await conn.query('SELECT COUNT(*) as cnt FROM TimeSlots WHERE MeetingDateID = ?', [dateId]);
    if (existingSlots[0].cnt > 0) {
      const [current] = await conn.query('SELECT DayNumber FROM MeetingDates WHERE DateID = ?', [dateId]);
      if (current.length > 0 && current[0].DayNumber !== dayNum) {
        await conn.rollback();
        return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Cannot change day number when time slots exist. Clear slots first.'));
      }
    }

    const dayLabel = 'Day ' + dayNum;
    await conn.query('UPDATE MeetingDates SET MeetingDate = ?, DayNumber = ?, DayLabel = ? WHERE DateID = ?', [meetingDate, dayNum, dayLabel, dateId]);

    await conn.commit();
    await logAudit(req, 'UPDATE_MEETING_DATE', 'MEETING_DATES', `Updated DateID ${dateId} to ${meetingDate} ${dayLabel}`);
    res.redirect('/admin/config/meeting-dates?termId=' + termId + '&success=' + encodeURIComponent('Meeting date updated.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('Failed to update: ' + error.message));
  } finally {
    conn.release();
  }
});

router.post('/delete', async (req, res) => {
  const { dateId, termId } = req.body;
  if (!dateId) {
    return res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('Date ID is required.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [slots] = await conn.query('SELECT COUNT(*) as cnt FROM TimeSlots WHERE MeetingDateID = ?', [dateId]);
    await conn.query('DELETE FROM TimeSlots WHERE MeetingDateID = ?', [dateId]);
    await conn.query('DELETE FROM TimeRanges WHERE MeetingDateID = ?', [dateId]);
    await conn.query('DELETE FROM BlockedRanges WHERE MeetingDateID = ?', [dateId]);
    await conn.query('DELETE FROM MeetingDates WHERE DateID = ?', [dateId]);
    await conn.commit();

    await logAudit(req, 'DELETE_MEETING_DATE', 'MEETING_DATES', `Deleted DateID ${dateId} with ${slots[0].cnt} slots`);
    res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&success=' + encodeURIComponent('Meeting date deleted.'));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('Failed to delete: ' + error.message));
  } finally {
    conn.release();
  }
});

router.post('/duplicate', async (req, res) => {
  const { sourceDateId, termId, meetingDate, dayNumber } = req.body;
  if (!sourceDateId || !termId || !meetingDate || !dayNumber) {
    return res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('All fields are required.'));
  }

  const dayNum = parseInt(dayNumber);
  if (isNaN(dayNum) || dayNum < 1 || dayNum > 26) {
    return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Day number must be between 1 and 26.'));
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dupDate] = await conn.query('SELECT DateID FROM MeetingDates WHERE TermID = ? AND MeetingDate = ?', [termId, meetingDate]);
    if (dupDate.length > 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('This date already exists.'));
    }

    const [dupDay] = await conn.query('SELECT DateID FROM MeetingDates WHERE TermID = ? AND DayNumber = ?', [termId, dayNum]);
    if (dupDay.length > 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Day ' + dayNum + ' already exists.'));
    }

    const [source] = await conn.query('SELECT * FROM MeetingDates WHERE DateID = ?', [sourceDateId]);
    if (source.length === 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?termId=' + termId + '&error=' + encodeURIComponent('Source date not found.'));
    }

    const dayLabel = 'Day ' + dayNum;
    const newPrefix = getDayPrefix(dayNum);

    const sourceDuration = source[0].SessionDurationMinutes || 10;
    const sourceInterval = source[0].SessionIntervalMinutes ?? 5;

    const [insertResult] = await conn.query(
      'INSERT INTO MeetingDates (TermID, MeetingDate, DayNumber, DayLabel, IsActive, SessionDurationMinutes, SessionIntervalMinutes) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [termId, meetingDate, dayNum, dayLabel, sourceDuration, sourceInterval]
    );
    const newDateId = insertResult.insertId;

    const [sourceRanges] = await conn.query('SELECT StartTime, EndTime FROM TimeRanges WHERE MeetingDateID = ?', [sourceDateId]);
    for (const r of sourceRanges) {
      await conn.query('INSERT INTO TimeRanges (MeetingDateID, StartTime, EndTime) VALUES (?, ?, ?)', [newDateId, r.StartTime, r.EndTime]);
    }

    const [sourceBlocked] = await conn.query('SELECT StartTime, EndTime, BlockReason FROM BlockedRanges WHERE MeetingDateID = ?', [sourceDateId]);
    for (const b of sourceBlocked) {
      await conn.query('INSERT INTO BlockedRanges (MeetingDateID, StartTime, EndTime, BlockReason) VALUES (?, ?, ?, ?)', [newDateId, b.StartTime, b.EndTime, b.BlockReason]);
    }

    const [sourceSlots] = await conn.query('SELECT StartTime, EndTime, IsBlocked, BlockReason FROM TimeSlots WHERE MeetingDateID = ? ORDER BY ScheduleCode ASC', [sourceDateId]);
    let slotNum = 1;
    for (const s of sourceSlots) {
      const code = newPrefix + String(slotNum).padStart(2, '0');
      await conn.query(
        'INSERT INTO TimeSlots (MeetingDateID, DayNumber, SchedulePrefix, ScheduleCode, StartTime, EndTime, IsBlocked, BlockReason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newDateId, dayNum, newPrefix, code, s.StartTime, s.EndTime, s.IsBlocked, s.BlockReason]
      );
      slotNum++;
    }

    await conn.commit();
    await logAudit(req, 'DUPLICATE_MEETING_DATE', 'MEETING_DATES', `Duplicated DateID ${sourceDateId} → ${newDateId} as ${dayLabel} with ${sourceSlots.length} slots`);
    res.redirect('/admin/config/meeting-dates?termId=' + termId + '&success=' + encodeURIComponent(`Day duplicated: ${dayLabel} with ${sourceSlots.length} slots.`));
  } catch (error) {
    await conn.rollback();
    console.error('Duplicate meeting date error:', error.message);
    res.redirect('/admin/config/meeting-dates?termId=' + (termId || '') + '&error=' + encodeURIComponent('Failed to duplicate: ' + error.message));
  } finally {
    conn.release();
  }
});

router.get('/slots/:dateId', async (req, res) => {
  try {
    await ensureSchema();
    const [md] = await pool.query('SELECT * FROM MeetingDates WHERE DateID = ?', [req.params.dateId]);
    if (md.length === 0) return res.redirect('/admin/config/meeting-dates?error=' + encodeURIComponent('Meeting date not found.'));

    const meetingDate = md[0];
    meetingDate.prefix = meetingDate.DayNumber ? getDayPrefix(meetingDate.DayNumber) : '?';

    const [slots] = await pool.query('SELECT * FROM TimeSlots WHERE MeetingDateID = ? ORDER BY ScheduleCode ASC', [req.params.dateId]);
    const [timeRanges] = await pool.query('SELECT * FROM TimeRanges WHERE MeetingDateID = ? ORDER BY StartTime ASC', [req.params.dateId]);
    const [blockedRanges] = await pool.query('SELECT * FROM BlockedRanges WHERE MeetingDateID = ? ORDER BY StartTime ASC', [req.params.dateId]);

    const duration = meetingDate.SessionDurationMinutes || 10;
    const interval = meetingDate.SessionIntervalMinutes ?? 5;

    const preview = req.query.preview === '1' && timeRanges.length > 0
      ? generateSlotsFromRanges(timeRanges, blockedRanges, meetingDate.prefix, duration, interval)
      : null;

    res.render('admin/config/time-slots', {
      title: `Time Slots — ${meetingDate.DayLabel}`,
      meetingDate,
      slots,
      timeRanges,
      blockedRanges,
      preview,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Load slots error:', error.message);
    res.redirect('/admin/config/meeting-dates?error=' + encodeURIComponent('Failed to load time slots.'));
  }
});

router.post('/slots/:dateId/update-session', async (req, res) => {
  const dateId = req.params.dateId;
  const duration = Number.isFinite(parseInt(req.body.sessionDuration)) ? parseInt(req.body.sessionDuration) : 10;
  const interval = Number.isFinite(parseInt(req.body.sessionInterval)) ? parseInt(req.body.sessionInterval) : 5;

  if (duration < 5 || duration > 120) {
    return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Session duration must be between 5 and 120 minutes.'));
  }
  if (interval < 0 || interval > 60) {
    return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Interval must be between 0 and 60 minutes.'));
  }

  try {
    await pool.query('UPDATE MeetingDates SET SessionDurationMinutes = ?, SessionIntervalMinutes = ? WHERE DateID = ?', [duration, interval, dateId]);
    await logAudit(req, 'UPDATE_SESSION_SETTINGS', 'MEETING_DATES', `Updated DateID ${dateId}: duration=${duration}min, interval=${interval}min`);
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?success=' + encodeURIComponent(`Session settings updated: ${duration}-min sessions, ${interval}-min buffer.`));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Failed to update session settings.'));
  }
});

router.post('/slots/:dateId/add-range', async (req, res) => {
  const { startTime, endTime } = req.body;
  const dateId = req.params.dateId;

  if (!startTime || !endTime) {
    return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Start and end times are required.'));
  }

  const startMin = timeToMin(startTime);
  const endMin = timeToMin(endTime);
  if (startMin >= endMin) {
    return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('End time must be after start time.'));
  }

  try {
    const [existing] = await pool.query('SELECT StartTime, EndTime FROM TimeRanges WHERE MeetingDateID = ?', [dateId]);
    for (const r of existing) {
      if (rangesOverlap(startMin, endMin, timeToMin(r.StartTime), timeToMin(r.EndTime))) {
        return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('This time range overlaps with an existing range.'));
      }
    }

    await pool.query('INSERT INTO TimeRanges (MeetingDateID, StartTime, EndTime) VALUES (?, ?, ?)',
      [dateId, startTime + ':00', endTime + ':00']);
    await logAudit(req, 'ADD_TIME_RANGE', 'TIME_SLOTS', `Added range ${startTime}-${endTime} for DateID ${dateId}`);
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?success=' + encodeURIComponent('Time range added.'));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Failed to add range: ' + error.message));
  }
});

router.post('/slots/:dateId/delete-range/:rangeId', async (req, res) => {
  try {
    await pool.query('DELETE FROM TimeRanges WHERE RangeID = ? AND MeetingDateID = ?', [req.params.rangeId, req.params.dateId]);
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?success=' + encodeURIComponent('Time range removed.'));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?error=' + encodeURIComponent('Failed to remove range.'));
  }
});

router.post('/slots/:dateId/add-blocked', async (req, res) => {
  const { startTime, endTime, blockReason } = req.body;
  const dateId = req.params.dateId;

  if (!startTime || !endTime || !blockReason) {
    return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Start time, end time, and reason are required.'));
  }

  if (timeToMin(startTime) >= timeToMin(endTime)) {
    return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('End time must be after start time.'));
  }

  try {
    await pool.query('INSERT INTO BlockedRanges (MeetingDateID, StartTime, EndTime, BlockReason) VALUES (?, ?, ?, ?)',
      [dateId, startTime + ':00', endTime + ':00', blockReason.trim()]);
    await logAudit(req, 'ADD_BLOCKED_RANGE', 'TIME_SLOTS', `Added blocked range ${startTime}-${endTime} "${blockReason}" for DateID ${dateId}`);
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?success=' + encodeURIComponent('Blocked range added.'));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Failed to add blocked range.'));
  }
});

router.post('/slots/:dateId/delete-blocked/:blockId', async (req, res) => {
  try {
    await pool.query('DELETE FROM BlockedRanges WHERE BlockID = ? AND MeetingDateID = ?', [req.params.blockId, req.params.dateId]);
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?success=' + encodeURIComponent('Blocked range removed.'));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?error=' + encodeURIComponent('Failed to remove blocked range.'));
  }
});

router.post('/slots/:dateId/generate', async (req, res) => {
  const dateId = req.params.dateId;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [md] = await conn.query('SELECT * FROM MeetingDates WHERE DateID = ?', [dateId]);
    if (md.length === 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates?error=' + encodeURIComponent('Meeting date not found.'));
    }

    const meetingDate = md[0];
    const prefix = getDayPrefix(meetingDate.DayNumber);

    const [timeRanges] = await conn.query('SELECT * FROM TimeRanges WHERE MeetingDateID = ? ORDER BY StartTime', [dateId]);
    if (timeRanges.length === 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Add at least one time range before generating slots.'));
    }

    const [blockedRanges] = await conn.query('SELECT * FROM BlockedRanges WHERE MeetingDateID = ?', [dateId]);

    const duration = meetingDate.SessionDurationMinutes || 10;
    const interval = meetingDate.SessionIntervalMinutes ?? 5;
    const slots = generateSlotsFromRanges(timeRanges, blockedRanges, prefix, duration, interval);

    if (slots.length === 0) {
      await conn.rollback();
      return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('No slots could be generated from the defined ranges.'));
    }

    await conn.query('DELETE FROM TimeSlots WHERE MeetingDateID = ?', [dateId]);

    for (const s of slots) {
      await conn.query(
        'INSERT INTO TimeSlots (MeetingDateID, DayNumber, SchedulePrefix, ScheduleCode, StartTime, EndTime, IsBlocked, BlockReason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [dateId, meetingDate.DayNumber, prefix, s.scheduleCode, s.startTime, s.endTime, s.isBlocked ? 1 : 0, s.blockReason]
      );
    }

    await conn.commit();
    await logAudit(req, 'GENERATE_SLOTS', 'TIME_SLOTS', `Generated ${slots.length} slots for ${meetingDate.DayLabel} (${prefix}) [${duration}min/${interval}min buffer]`);
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?success=' + encodeURIComponent(`${slots.length} time slots generated (${duration}-min sessions, ${interval}-min buffer).`));
  } catch (error) {
    await conn.rollback();
    console.error('Generate slots error:', error.message);
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Failed to generate: ' + error.message));
  } finally {
    conn.release();
  }
});

router.post('/slots/:dateId/toggle-block/:slotId', async (req, res) => {
  const { dateId, slotId } = req.params;
  const { blockReason } = req.body;

  try {
    const [slot] = await pool.query('SELECT IsBlocked, ScheduleCode FROM TimeSlots WHERE SlotID = ?', [slotId]);
    if (slot.length === 0) return res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Slot not found.'));

    const newBlocked = slot[0].IsBlocked ? 0 : 1;
    await pool.query('UPDATE TimeSlots SET IsBlocked = ?, BlockReason = ? WHERE SlotID = ?',
      [newBlocked, newBlocked ? (blockReason || null) : null, slotId]);

    await logAudit(req, newBlocked ? 'BLOCK_SLOT' : 'UNBLOCK_SLOT', 'TIME_SLOTS', `${newBlocked ? 'Blocked' : 'Unblocked'} slot ${slot[0].ScheduleCode}`);
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?success=' + encodeURIComponent(`Slot ${slot[0].ScheduleCode} ${newBlocked ? 'blocked' : 'unblocked'}.`));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + dateId + '?error=' + encodeURIComponent('Failed to update slot.'));
  }
});

router.post('/slots/:dateId/delete/:slotId', async (req, res) => {
  try {
    const [slot] = await pool.query('SELECT ScheduleCode FROM TimeSlots WHERE SlotID = ?', [req.params.slotId]);
    await pool.query('DELETE FROM TimeSlots WHERE SlotID = ?', [req.params.slotId]);
    await logAudit(req, 'DELETE_SLOT', 'TIME_SLOTS', `Deleted slot ${slot[0]?.ScheduleCode || req.params.slotId}`);
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?success=' + encodeURIComponent('Time slot deleted.'));
  } catch (error) {
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?error=' + encodeURIComponent('Failed to delete slot.'));
  }
});

router.post('/slots/:dateId/clear', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [count] = await conn.query('SELECT COUNT(*) as cnt FROM TimeSlots WHERE MeetingDateID = ?', [req.params.dateId]);
    await conn.query('DELETE FROM TimeSlots WHERE MeetingDateID = ?', [req.params.dateId]);
    await conn.commit();
    await logAudit(req, 'CLEAR_SLOTS', 'TIME_SLOTS', `Cleared ${count[0].cnt} slots for DateID ${req.params.dateId}`);
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?success=' + encodeURIComponent(`${count[0].cnt} time slots cleared.`));
  } catch (error) {
    await conn.rollback();
    res.redirect('/admin/config/meeting-dates/slots/' + req.params.dateId + '?error=' + encodeURIComponent('Failed to clear slots.'));
  } finally {
    conn.release();
  }
});

export default router;
