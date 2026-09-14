# PGJ Booking System

## Overview
A Node.js web application for managing teacher booking slots. Uses Express.js, EJS templating, Bootstrap 5, and MySQL (via mysql2/promise). Connected to a Hostinger MySQL database.

**Current State: Live — Bookings Enabled**

## Project Structure
```
/project
├── server.js          # Main Express server entry point
├── db.js              # MySQL connection pool + test function
├── package.json
├── /routes
│   ├── admin.js       # Admin dashboard route only
│   ├── config.js      # School year, terms, parent-login config
│   ├── adminAuth.js   # Admin login/logout + auth middleware
│   ├── adminUsers.js  # Admin user management (SUPER_ADMIN)
│   ├── adminStudents.js # Student CRUD + CSV import
│   ├── adminTeachers.js # Teacher CRUD + CSV import + image upload
│   ├── adminPdfTemplate.js  # PDF template builder
│   ├── adminTcTemplate.js   # T&C template builder
│   ├── adminAuditLogs.js    # Audit logs viewer
│   ├── adminAdvancedExport.js # Super Admin advanced booking export
│   └── adminLoginDesigner.js # Parent login page designer
├── /utils
│   ├── pdfGenerator.js # PDF generation using PDFKit + templates
│   ├── emailSender.js  # Email sending using Nodemailer + logging
│   └── auditLog.js     # Audit logging utility
├── /views
│   ├── layout.ejs
│   ├── /admin
│   │   ├── dashboard.ejs      # Main dashboard with config mode banner
│   │   ├── login.ejs
│   │   ├── forbidden.ejs
│   │   ├── users.ejs / user-form.ejs
│   │   ├── pdf-template.ejs / pdf-template-form.ejs
│   │   ├── tc-template.ejs / tc-template-form.ejs
│   │   ├── parent-login-designer.ejs
│   │   ├── students.ejs / student-form.ejs / student-import.ejs
│   │   ├── teachers.ejs / teacher-form.ejs / teacher-import.ejs
│   │   ├── audit-logs.ejs
│   │   └── /config
│   │       ├── school-year.ejs
│   │       └── parent-login.ejs
│   └── /partials
│       ├── loading.ejs
│       └── logo.ejs
├── /public
│   ├── /css
│   └── /js
```

## Tech Stack
- **Backend**: Node.js, Express.js (ESM modules)
- **Database**: MySQL via mysql2/promise (Hostinger remote)
- **View Engine**: EJS + express-ejs-layouts
- **Frontend**: Bootstrap 5, vanilla JavaScript
- **Auth**: bcryptjs + express-session
- **PDF**: pdfkit
- **Email**: nodemailer (SMTP)
- **Port**: 5000

## Database Connection
- Host: Hostinger MySQL remote server
- Connection pool via mysql2/promise
- Environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT

## Database Tables (Active)
- **AdminUsers**: admin accounts with roles (ADMIN, SUPER_ADMIN)
- **Students**: StudentID(PK), StudentName, SNickname, MAGClass, PCClass, TeacherID(FK→Teachers.TeacherCode), TeacherName, TeacherNickname, Email, IsActive
- **Teachers**: TeacherID(auto PK), TeacherCode(unique), TeacherName, TeacherNickname, TeacherImage, Email, Room, MeetingDays(VARCHAR50, comma-separated DayNumbers e.g. "1,3"), IsActive
- **SchoolYears**: academic year config
- **BookingTerms**: booking term periods (PGJ1, PGJ2, etc.)
- **PdfTemplates**: customizable PDF confirmation templates
- **TcTemplates**: terms & conditions templates
- **ParentLoginConfig**: login page design settings
- **SystemSettings**: key-value system settings per term
- **AuditLogs**: admin activity tracking

## Database Tables (Active — New)
- **MeetingDates**: DateID(PK,auto), TermID(FK), MeetingDate, DayNumber, DayLabel, IsActive, SessionDurationMinutes(default 10), SessionIntervalMinutes(default 5), CreatedAt
  - DayNumber unique per term (app-enforced)
  - DayLabel auto-set to "Day N"
  - SessionDurationMinutes: how long each slot lasts (configurable per day, default 10)
  - SessionIntervalMinutes: buffer between consecutive slots (configurable per day, default 5)
- **TimeSlots**: SlotID(PK,auto), MeetingDateID(FK→MeetingDates ON DELETE CASCADE), DayNumber, SchedulePrefix(CHAR1), ScheduleCode(unique per date), StartTime, EndTime, IsBlocked, BlockReason, CreatedAt
  - Prefix mapping: Day 1→A, Day 2→B, Day 3→C... (deterministic)
  - Codes: A01, A02... B01, B02... (sequential per day, reset per day)
  - Slot duration and buffer configurable per meeting date
- **TimeRanges**: RangeID(PK,auto), MeetingDateID(FK→MeetingDates ON DELETE CASCADE), StartTime, EndTime, CreatedAt
  - Multiple ranges per day define slot generation windows
  - Overlap prevention enforced at app level
- **BlockedRanges**: BlockID(PK,auto), MeetingDateID(FK→MeetingDates ON DELETE CASCADE), StartTime, EndTime, BlockReason, CreatedAt
  - Slots overlapping blocked ranges auto-marked IsBlocked=1 with reason

- **TeacherAvailability**: AvailabilityID(PK,auto), TeacherCode(FK→Teachers.TeacherCode), MeetingDateID(FK→MeetingDates ON DELETE CASCADE), SlotID(FK→TimeSlots ON DELETE CASCADE), IsAvailable(default 1), BlockedReason, CreatedAt
  - UNIQUE KEY (TeacherCode, SlotID) — one record per teacher+slot
  - Priority: Global blocked > Teacher blocked > Available
  - Admin can block/unblock per teacher without affecting others
  - CSV bulk import: TeacherCode, DayNumber, ScheduleCode, IsAvailable, BlockReason

- **Bookings**: BookingID(PK,auto), StudentID, TeacherCode, MeetingDateID(FK→MeetingDates CASCADE), SlotID(FK→TimeSlots CASCADE), ScheduleCode, TranslatorRequired, TranslatorLanguage, Status(CONFIRMED/CANCELLED/UNLOCKED), BookedBy(PARENT/ADMIN), CreatedAt, CancelledAt
  - ActiveBookingKey: STORED generated column — CONCAT(TeacherCode,MeetingDateID,SlotID) when CONFIRMED, else NULL
  - ActiveStudentDateKey: STORED generated column — CONCAT(StudentID,MeetingDateID) when CONFIRMED, else NULL
  - UNIQUE KEY on ActiveBookingKey — prevents double-booking same teacher+slot (only CONFIRMED)
  - UNIQUE KEY on ActiveStudentDateKey — prevents student booking twice per meeting date (only CONFIRMED)
  - Transaction flow: lock slot → check availability → check student → check existing → insert → update availability
  - Legacy table migrated via ensureBookingsTable() (additive, idempotent)

- **Translations**: TranslationID(PK,auto), LanguageName(VARCHAR100), LanguageCode(VARCHAR10), IsActive(default 1), SortOrder(default 0), CreatedAt
  - Admin-managed list of translator languages
  - Active languages shown as dropdown in parent booking form
  - If no languages configured, falls back to free-text input

## Database Tables (Empty — Awaiting Rebuild)
- **EmailLogs**: email send history

## Route Structure
| Path | Handler | Access |
|------|---------|--------|
| `/` | Redirect to `/admin/login` | Public |
| `/admin/login` | adminAuth.js | Public |
| `/admin/dashboard` | admin.js | Admin |
| `/admin/config/*` | config.js | Super Admin |
| `/admin/users` | adminUsers.js | Super Admin |
| `/admin/pdf-template` | adminPdfTemplate.js | Super Admin |
| `/admin/tc-template` | adminTcTemplate.js | Super Admin |
| `/admin/audit-logs` | adminAuditLogs.js | Admin (export: Super Admin) |
| `/admin/audit-logs/export` | adminAuditLogs.js | Super Admin |
| `/admin/reports` | adminReports.js | Admin |
| `/admin/reports/export/csv` | adminReports.js | Admin |
| `/admin/reports/export/excel` | adminReports.js | Super Admin |
| `/admin/reports/export/pdf` | adminReports.js | Super Admin |
| `/admin/reports/students-without-booking` | adminReports.js | Admin |
| `/admin/reports/advanced-export` | adminAdvancedExport.js | Super Admin |
| `/admin/reports/advanced-export/export/csv` | adminAdvancedExport.js | Super Admin |
| `/admin/reports/advanced-export/export/excel` | adminAdvancedExport.js | Super Admin |
| `/admin/reports/advanced-export/export/pdf` | adminAdvancedExport.js | Super Admin |
| `/admin/translations` | adminTranslations.js | Admin |
| `/admin/translations/api/languages` | adminTranslations.js | Admin (JSON) |
| `/admin/students` | adminStudents.js | Admin |
| `/admin/teachers` | adminTeachers.js | Admin |
| `/admin/config/meeting-dates` | adminMeetingDates.js | Admin |
| `/admin/config/meeting-dates/slots/:id` | adminMeetingDates.js | Admin |
| `/admin/config/teacher-availability` | adminTeacherAvailability.js | Admin |
| `/admin/bookings` | adminBookings.js | Admin |
| `/admin/bookings/book-on-behalf` | adminBookings.js | Admin |
| `/booking` | parentBooking.js | Public (student auth) |
| `/booking/select` | parentBooking.js | Student session |
| `/booking/confirmation` | parentBooking.js | Student session |
| `/booking/view/:bookingId` | parentBooking.js | Student session |
| `/booking/download-pdf/:bookingId` | parentBooking.js | Student session |
| `POST /booking/send-email` | parentBooking.js | Student session |
| `/admin/parent-login-designer` | adminLoginDesigner.js | Super Admin |
| `/teacher-schedule` | teacherSchedule.js | Public |
| `/teacher-schedule/api/schedule/:teacherCode` | teacherSchedule.js | Public (JSON, rate-limited) |
| `/health/db` | server.js inline | Super Admin |

## RBAC
- **SUPER_ADMIN**: Full access to all config, templates, users, audit logs
- **ADMIN**: Dashboard + Students + Teachers (no config pages visible)
- `requireAdminAuth` middleware in adminAuth.js for all `/admin` routes
- `requireSuperAdmin` middleware for sensitive routes
- `superAdminOnly` inline middleware in config.js

## Preserved Templates & Config
- PDF Builder: layout designer with header/body/footer, image support, variable placeholders
- T&C Templates: multiple templates, activate one for parent login
- Login Page Designer: logo, background, mobile/desktop preview
- School Year & Terms: academic year setup with booking terms

## Student-Teacher Relationship
- Each student has one PC Teacher (Students.TeacherID → Teachers.TeacherCode)
- Teacher can have many students
- When teacher name changes, linked students are auto-updated
- Student soft-delete (IsActive=0) hides from list, preserves data

## Dependencies
- multer: file upload handling (teacher images + CSV imports)
- csv-parse: CSV parsing for bulk imports
- bcryptjs: password hashing
- pdfkit: PDF generation
- nodemailer: email sending
- dotenv: environment variable loading from .env file
- exceljs: Excel export generation

## Production Deployment
- **dotenv**: `import 'dotenv/config'` at top of server.js loads `.env` automatically
- **PM2**: `ecosystem.config.cjs` configured for PM2 process management
- **Default Port**: 5040 in production (Replit overrides to 5000 via env)
- **DB Retry**: Server retries database connection up to 5 times with exponential backoff
- **Files**: `.env.example`, `ecosystem.config.cjs`, `DEPLOYMENT.md`
- Flow: Replit → GitHub → Linux server → PM2

## Schema Migration Notes
- `ensureSchema()` in adminMeetingDates.js auto-adds DayNumber/DayLabel columns to MeetingDates if missing, creates TimeSlots/TimeRanges/BlockedRanges tables if not exist. Safe, idempotent, additive only.

## Rebuild Order (Remaining)
1. ~~Students~~ DONE
2. ~~Teachers~~ DONE
3. ~~Meeting Dates & Slots~~ DONE
4. ~~Teacher Availability~~ DONE
5. ~~Booking Engine (locking & concurrency)~~ DONE
6. ~~Parent Flow~~ DONE
7. ~~Email/PDF Confirmation~~ DONE
8. ~~Reports & Audit Logs~~ DONE
9. ~~Teacher Schedule~~ DONE
10. ~~Configuration Mode Removed~~ DONE
