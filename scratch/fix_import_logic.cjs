const fs = require('fs');
const file = 'c:\\\\Users\\\\Auron\\\\Documents\\\\PGJ-Booking-System_Staging\\\\routes\\\\adminTeachers.js';
let content = fs.readFileSync(file, 'utf8');

// Update preview extraction
content = content.replace(
  /const teacherNickname = \(row\.TeacherNickname \|\| row\.teacher_nickname \|\| row\.teacherNickname \|\| row\.Nickname \|\| ''\)\.trim\(\);/,
  "const teacherNickname = (row.TeacherNickname || row.teacher_nickname || row.teacherNickname || row.Nickname || '').trim();\\n      const teacherImage = (row.TeacherImage || row.teacher_image || row.teacherImage || '').trim();\\n      const isActive = (row.IsActive || row.is_active || row.isActive || '').trim();"
);

// Update preview.push
content = content.replace(
  /preview\.push\(\{ teacherCode, teacherName, teacherNickname, email, room, meetingDays, errors, valid: errors\.length === 0 \}\);/,
  "preview.push({ teacherCode, teacherName, teacherNickname, teacherImage, email, room, isActive, meetingDays, errors, valid: errors.length === 0 });"
);

// Update INSERT INTO in confirm
content = content.replace(
  /'INSERT INTO Teachers \(TeacherCode, TeacherName, TeacherNickname, Email, Room, MeetingDays, IsActive\) VALUES \(\?, \?, \?, \?, \?, \?, 1\)',\\n\s*\[row\.teacherCode, row\.teacherName, row\.teacherNickname, row\.email \|\| null, row\.room \|\| null, row\.meetingDays \|\| null\]/,
  "'INSERT INTO Teachers (TeacherCode, TeacherName, TeacherNickname, TeacherImage, Email, Room, MeetingDays, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',\\n        [row.teacherCode, row.teacherName, row.teacherNickname, row.teacherImage || null, row.email || null, row.room || null, row.meetingDays || null, row.isActive ? parseInt(row.isActive) : 1]"
);

fs.writeFileSync(file, content);
console.log('Script updated successfully');
