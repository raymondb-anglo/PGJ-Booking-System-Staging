import nodemailer from 'nodemailer';
import pool from '../db.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return transporter;
}

export async function sendBookingConfirmation(email, bookingData, pdfBuffer) {
  const mailer = getTransporter();

  if (!mailer) {
    await logEmail(bookingData.bookingId, bookingData.studentId, email, 'FAILED', 'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables.');
    return { success: false, error: 'Email service is not configured. Please contact the administrator.' };
  }

  try {
    const fromName = process.env.SMTP_FROM_NAME || 'PGJ Booking System';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

    await mailer.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: `PGJ Booking Confirmation – ${bookingData.studentName}`,
      text: `Dear Parent,\n\nYour booking has been confirmed.\n\nStudent: ${bookingData.studentName} (${bookingData.studentId})\nPC Class: ${bookingData.pcClass || 'N/A'}\nTeacher: ${bookingData.teacherName}\nDate: ${bookingData.meetingDate}\nTime: ${bookingData.meetingTime}\nRoom: ${bookingData.room || 'TBD'}\nTranslator: ${bookingData.translator || 'None'}\n\nPlease find the confirmation attached.\n\nBest regards,\nPGJ Booking System`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <p>Dear Parent,</p>
          <p>Your booking has been confirmed.</p>
          <table style="border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">Student:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.studentName} (${bookingData.studentId})</b></td>
            </tr>
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">PC Class:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.pcClass || 'N/A'}</b></td>
            </tr>
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">Teacher:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.teacherName}</b></td>
            </tr>
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">Date:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.meetingDate}</b></td>
            </tr>
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">Time:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.meetingTime}</b></td>
            </tr>
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">Room:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.room || 'TBD'}</b></td>
            </tr>
            <tr>
              <td style="padding-right: 15px; padding-bottom: 5px;">Translator:</td>
              <td style="padding-bottom: 5px;"><b>${bookingData.translator || 'None'}</b></td>
            </tr>
          </table>
          <p>Please find the confirmation attached.</p>
          <p>Best regards,<br>PGJ Booking System</p>
        </div>
      `,
      attachments: [
        {
          filename: `Booking_Confirmation_${bookingData.studentId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    await logEmail(bookingData.bookingId, bookingData.studentId, email, 'SENT', null);
    return { success: true };
  } catch (error) {
    console.error('Email send error:', error.message);
    await logEmail(bookingData.bookingId, bookingData.studentId, email, 'FAILED', error.message);
    return { success: false, error: 'Failed to send email. Please try again later.' };
  }
}

async function logEmail(bookingId, studentId, email, status, errorMessage) {
  try {
    await pool.query(
      `INSERT INTO EmailLogs (BookingID, StudentID, Email, Status, ErrorMessage)
       VALUES (?, ?, ?, ?, ?)`,
      [bookingId, studentId || null, email, status, errorMessage || null]
    );
    console.log('Email log inserted successfully for BookingID:', bookingId);
  } catch (e) {
    console.error('Email log error (attempt 1):', e.message);
    // MSSQL uses 'Invalid column name' (not MySQL's 'Unknown column')
    if (e.message && (e.message.includes('Invalid column name') || e.message.includes('Unknown column'))) {
      try {
        // Try adding StudentID column if it doesn't exist (MSSQL syntax)
        await pool.query('ALTER TABLE EmailLogs ADD StudentID VARCHAR(20) NULL');
        console.log('Added StudentID column to EmailLogs table');
      } catch (alterErr) {
        // Column might already exist, ignore
        console.log('ALTER TABLE note:', alterErr.message);
      }
      try {
        // Retry the insert
        await pool.query(
          `INSERT INTO EmailLogs (BookingID, StudentID, Email, Status, ErrorMessage)
           VALUES (?, ?, ?, ?, ?)`,
          [bookingId, studentId || null, email, status, errorMessage || null]
        );
        console.log('Email log inserted successfully (after alter) for BookingID:', bookingId);
      } catch (e2) {
        console.error('Email log error (attempt 2 after alter):', e2.message);
        // Last resort: try without StudentID column
        try {
          await pool.query(
            `INSERT INTO EmailLogs (BookingID, Email, Status, ErrorMessage)
             VALUES (?, ?, ?, ?)`,
            [bookingId, email, status, errorMessage || null]
          );
          console.log('Email log inserted (without StudentID) for BookingID:', bookingId);
        } catch (e3) {
          console.error('Email log error (final fallback):', e3.message);
        }
      }
    } else {
      // Try without StudentID as fallback
      try {
        await pool.query(
          `INSERT INTO EmailLogs (BookingID, Email, Status, ErrorMessage)
           VALUES (?, ?, ?, ?)`,
          [bookingId, email, status, errorMessage || null]
        );
        console.log('Email log inserted (without StudentID) for BookingID:', bookingId);
      } catch (e2) {
        console.error('Email log error (fallback without StudentID):', e2.message);
      }
    }
  }
}
