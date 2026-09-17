const fs = require('fs');
const file = 'c:\\\\Users\\\\Auron\\\\Documents\\\\PGJ-Booking-System_Staging\\\\routes\\\\adminTeachers.js';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /const csvContent = 'TeacherCode,TeacherName,TeacherNickname,Email,Room,MeetingDays\\n';/,
  "const csvContent = 'TeacherCode,TeacherName,TeacherNickname,TeacherImage,Email,Room,IsActive,MeetingDays\\n';"
);
fs.writeFileSync(file, content);
console.log('File updated successfully');
