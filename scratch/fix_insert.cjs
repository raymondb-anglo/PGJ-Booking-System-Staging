const fs = require('fs');
const file = 'c:\\\\Users\\\\Auron\\\\Documents\\\\PGJ-Booking-System_Staging\\\\routes\\\\adminTeachers.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = "'INSERT INTO Teachers (TeacherCode, TeacherName, TeacherNickname, Email, Room, MeetingDays, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)',\\r\\n        [row.teacherCode, row.teacherName, row.teacherNickname, row.email || null, row.room || null, row.meetingDays || null]";
const targetStrLf = "'INSERT INTO Teachers (TeacherCode, TeacherName, TeacherNickname, Email, Room, MeetingDays, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)',\\n        [row.teacherCode, row.teacherName, row.teacherNickname, row.email || null, row.room || null, row.meetingDays || null]";

const replacement = "'INSERT INTO Teachers (TeacherCode, TeacherName, TeacherNickname, TeacherImage, Email, Room, MeetingDays, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',\\n        [row.teacherCode, row.teacherName, row.teacherNickname, row.teacherImage || null, row.email || null, row.room || null, row.meetingDays || null, row.isActive ? parseInt(row.isActive) : 1]";

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replacement);
} else if (content.includes(targetStrLf)) {
    content = content.replace(targetStrLf, replacement);
}

fs.writeFileSync(file, content);
console.log('Final script updated');
