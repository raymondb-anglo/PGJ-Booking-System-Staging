import 'dotenv/config';
import pool from '../db.js';

async function fixPdfTemplate() {
  try {
    const [recordset] = await pool.query('SELECT TemplateID, BodyText FROM PdfTemplates WHERE IsActive = 1');
    if (recordset && recordset.length > 0) {
      for (const row of recordset) {
        let body = row.BodyText;
        if (body && body.includes('(Online Meeting)')) {
          body = body.replace(/\(Online Meeting\)/g, '{{room}}');
          await pool.query('UPDATE PdfTemplates SET BodyText = ? WHERE TemplateID = ?', [body, row.TemplateID]);
          console.log(`Updated TemplateID: ${row.TemplateID}`);
        } else {
          console.log(`No '(Online Meeting)' found in TemplateID: ${row.TemplateID}`);
        }
      }
    } else {
      console.log('No active PDF templates found.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

fixPdfTemplate();
