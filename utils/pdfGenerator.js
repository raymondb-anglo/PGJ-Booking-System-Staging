import PDFDocument from 'pdfkit';
import pool from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function replacePlaceholders(text, data) {
  if (!text) return '';
  return text
    .replace(/\{\{student_name\}\}/g, data.studentName || '')
    .replace(/\{\{student_id\}\}/g, data.studentId || '')
    .replace(/\{\{pc_class\}\}/g, data.pcClass || '')
    .replace(/\{\{teacher_name\}\}/g, data.teacherName || '')
    .replace(/\{\{meeting_date\}\}/g, data.meetingDate || '')
    .replace(/\{\{meeting_time\}\}/g, data.meetingTime || '')
    .replace(/\{\{day_label\}\}/g, data.dayLabel || '')
    .replace(/\{\{schedule_code\}\}/g, data.scheduleCode || '')
    .replace(/\{\{time_range\}\}/g, data.timeRange || data.meetingTime || '')
    .replace(/\{\{room\}\}/g, data.room || '')
    .replace(/\{\{translator\}\}/g, data.translator || 'None')
    .replace(/\{\{student_email\}\}/g, data.studentEmail || '');
}

/**
 * Parse HTML body text and render it into a PDFKit document.
 * Supports: <strong>/<b>, <br>, <sup>, <a href="...">, <span>, <div>, &amp; entities
 */
function renderHtmlBody(doc, html, pageWidth) {
  if (!html) return;

  // Decode common HTML entities
  function decodeEntities(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&hellip;/g, '…')
      .replace(/&ndash;/g, '–')
      .replace(/&mdash;/g, '—')
      .replace(/&nbsp;/g, ' ');
  }

  // Handle literal escaped newlines from DB if any
  html = html.replace(/\\r\\n/g, '<br>').replace(/\\n/g, '<br>');

  // Normalize: replace \r\n with nothing (HTML uses <br> for breaks)
  let normalized = html.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');
  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  // Split the HTML into block-level chunks by <div>, <br>, and </div>
  // We'll process inline tags within each block
  const blocks = [];
  let current = normalized;

  // Split on <br>, <br/>, <br />, </div><div>, </div>, <div>
  // Each split creates a new "line" / paragraph block
  const blockParts = current.split(/<br\s*\/?>/gi);
  
  for (let part of blockParts) {
    // Further split on <div> and </div> boundaries
    const subParts = part.split(/<\/?div[^>]*>/gi);
    for (let sp of subParts) {
      const trimmed = sp.trim();
      if (trimmed.length > 0) {
        blocks.push(trimmed);
      } else {
        // Empty block = visual line break
        blocks.push('');
      }
    }
  }

  const leftMargin = doc.page.margins.left;
  const textOptions = { width: pageWidth, align: 'justify', lineGap: 2 };

  doc.fontSize(11).font('Helvetica').fillColor('#000000');

  for (const block of blocks) {
    if (block === '') {
      doc.moveDown(0.4);
      continue;
    }

    // Check if block is one of the specific fields to format like a table
    const fieldMatch = block.match(/^(Student|PC Class|Teacher|Date|Time|Room|Translator)\s*:\s*(.*)$/i);
    if (fieldMatch) {
      const label = fieldMatch[1] + ':';
      const value = fieldMatch[2];
      
      const startX = doc.x;
      const currentY = doc.y;
      const labelWidth = 80; // fixed width for labels

      doc.font('Helvetica').fontSize(11).fillColor('#000000');
      doc.text(label, startX, currentY, { width: labelWidth, lineGap: 2 });
      
      const yAfterLabel = doc.y;
      
      const cleanValue = decodeEntities(value.replace(/<[^>]*>/g, '').trim());
      
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000');
      doc.text(cleanValue, startX + labelWidth, currentY, { width: pageWidth - labelWidth, lineGap: 2 });
      
      const yAfterValue = doc.y;
      
      // Move to the next line properly
      doc.x = startX;
      doc.y = Math.max(yAfterLabel, yAfterValue) + 5;
      continue;
    }

    // Parse inline tokens from this block
    const tokens = parseInlineTokens(block);

    if (tokens.length === 0) continue;

    // Render tokens as a single paragraph using continued text
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const isLast = (i === tokens.length - 1);
      const text = decodeEntities(token.text);

      if (text.trim() === '' && !token.isLink) continue;

      // Set font based on style
      if (token.bold) {
        doc.font('Helvetica-Bold');
      } else {
        doc.font('Helvetica');
      }

      if (token.superscript) {
        // Render superscript: smaller font, no special vertical offset in PDFKit
        // We approximate by using a smaller font size inline
        const prevSize = 11;
        doc.fontSize(8);
        if (token.bold) doc.font('Helvetica-Bold');
        doc.text(text, { ...textOptions, continued: !isLast });
        doc.fontSize(prevSize);
      } else if (token.isLink) {
        // Render link: blue, underlined
        doc.fillColor('#2b6cb0').fontSize(11);
        doc.text(text, {
          ...textOptions,
          continued: !isLast,
          link: token.href,
          underline: true
        });
        doc.fillColor('#000000');
      } else {
        doc.fontSize(11).fillColor('#000000');
        doc.text(text, { ...textOptions, continued: !isLast });
      }
    }

    doc.moveDown(0.3);
  }
}

/**
 * Parse inline HTML tokens from a text block.
 * Returns an array of { text, bold, superscript, isLink, href }
 */
function parseInlineTokens(html) {
  const tokens = [];
  // Regex to match tags we care about
  const tagRegex = /<(\/?)(\w+)([^>]*)>/g;
  let lastIndex = 0;
  let bold = false;
  let sup = false;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    // Text before this tag
    const textBefore = html.substring(lastIndex, match.index);
    if (textBefore) {
      tokens.push({ text: textBefore, bold, superscript: sup, isLink: false, href: null });
    }

    const isClosing = match[1] === '/';
    const tagName = match[2].toLowerCase();
    const attrs = match[3] || '';

    if (tagName === 'strong' || tagName === 'b') {
      bold = !isClosing;
    } else if (tagName === 'sup') {
      sup = !isClosing;
    } else if (tagName === 'a') {
      if (!isClosing) {
        const hrefMatch = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
        const href = hrefMatch ? hrefMatch[1] : '';
        // Find the closing </a> and extract link text
        const closeAIdx = html.indexOf('</a>', tagRegex.lastIndex);
        if (closeAIdx !== -1) {
          const linkText = html.substring(tagRegex.lastIndex, closeAIdx);
          // Strip any inner tags from link text
          const cleanLinkText = linkText.replace(/<[^>]*>/g, '');
          tokens.push({ text: cleanLinkText, bold, superscript: sup, isLink: true, href });
          tagRegex.lastIndex = closeAIdx + 4; // skip past </a>
        }
      }
      // </a> is handled above by jumping past it
    }
    // <span>, </span>, <div>, </div> are just wrappers — we skip them

    lastIndex = tagRegex.lastIndex;
  }

  // Remaining text after last tag
  const remaining = html.substring(lastIndex);
  if (remaining) {
    tokens.push({ text: remaining, bold, superscript: sup, isLink: false, href: null });
  }

  return tokens;
}

export async function getActiveTemplate() {
  const [rows] = await pool.query(
    'SELECT TOP 1 * FROM PdfTemplates WHERE IsActive = 1 ORDER BY TemplateID DESC'
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function generateBookingPdf(bookingData, templateOverride) {
  const template = templateOverride || await getActiveTemplate();
  if (!template) {
    throw new Error('No active PDF template found.');
  }

  const data = {
    studentName: bookingData.studentName,
    studentId: bookingData.studentId,
    studentEmail: bookingData.studentEmail || '',
    pcClass: bookingData.pcClass,
    teacherName: bookingData.teacherName,
    meetingDate: bookingData.meetingDate,
    meetingTime: bookingData.meetingTime,
    room: bookingData.room || 'TBD',
    translator: bookingData.translator || 'None'
  };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    const pageWidth = doc.page.width - 100;

    if (template.HeaderImage) {
      const imgPath = path.join(__dirname, '..', 'public', template.HeaderImage);
      if (fs.existsSync(imgPath)) {
        try {
          doc.image(imgPath, { fit: [pageWidth, 100], align: 'center' });
          doc.moveDown(1);
        } catch (e) {
          console.error('PDF header image error:', e.message);
        }
      }
    }

    if (template.HeaderText) {
      const headerText = replacePlaceholders(template.HeaderText, data);
      doc.fontSize(20).font('Helvetica-Bold').text(headerText, { align: 'center' });
      if (template.SubHeaderText) {
        const subHeaderText = replacePlaceholders(template.SubHeaderText, data);
        doc.moveDown(0.3);
        doc.fontSize(13).font('Helvetica').fillColor('#555555').text(subHeaderText, { align: 'center' });
        doc.fillColor('#000000');
      }
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#cccccc');
      doc.moveDown(1);
    }

    if (template.BodyText) {
      const bodyText = replacePlaceholders(template.BodyText, data);
      renderHtmlBody(doc, bodyText, pageWidth);
      doc.moveDown(1);
    }

    if (template.FooterText) {
      const footerText = replacePlaceholders(template.FooterText, data);
      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#cccccc');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#666666').text(footerText, { align: 'center' });
    }

    doc.end();
  });
}
