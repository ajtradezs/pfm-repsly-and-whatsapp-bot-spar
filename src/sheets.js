require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const CREDENTIALS_PATH = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || './credentials/google-credentials.json');

const HEADERS = [
  'Date',
  'Rep Name',
  'Rep Email',
  'Check-ins',
  'Stores Visited',
  'Photos',
  'Agendas/Forms',
  'KM Travelled',
  'Notes',
  'WhatsApp Activity',
  'Last WA Message Time',
  'Repsly Synced',
  'Repsly Feedback',
  'WhatsApp Feedback',
  'Photo Links'
];

async function getAuth() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return auth.getClient();
}

async function getSheetsClient() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

// Ensure a tab/sheet with teamName exists; create it if not
async function ensureSheetExists(teamName) {
  if (!SPREADSHEET_ID) {
    console.warn('[Sheets] GOOGLE_SPREADSHEET_ID not set — skipping sheet operations.');
    return false;
  }

  try {
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existing = meta.data.sheets.map((s) => s.properties.title);

    if (!existing.includes(teamName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: teamName }
              }
            }
          ]
        }
      });
      console.log(`[Sheets] Created tab: ${teamName}`);
    }
    return true;
  } catch (err) {
    console.error('[Sheets] ensureSheetExists error:', err.message);
    return false;
  }
}

// Write header row if not already present
async function ensureHeaders(teamName) {
  if (!SPREADSHEET_ID) return;

  try {
    const sheets = await getSheetsClient();
    const range = `'${teamName}'!A1:O1`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    });

    const existing = res.data.values;
    if (!existing || existing.length === 0 || existing[0][0] !== 'Date') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] }
      });
      console.log(`[Sheets] Headers written for tab: ${teamName}`);
    }
  } catch (err) {
    console.error('[Sheets] ensureHeaders error:', err.message);
  }
}

// Read all rows for the given tab
async function getAllRows(teamName) {
  if (!SPREADSHEET_ID) return [];
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${teamName}'!A:O`
    });
    return res.data.values || [];
  } catch (err) {
    console.error('[Sheets] getAllRows error:', err.message);
    return [];
  }
}

// Append or update a row for repName+date
// repData: { repName, repEmail, date, checkIns, storesVisited, photos, formsCompleted,
//            formNames, kmTravelled, notes, waActivity, lastWaTime }
async function logRepDay(teamName, repData) {
  if (!SPREADSHEET_ID) return;

  await ensureSheetExists(teamName);
  await ensureHeaders(teamName);

  const date = repData.date || new Date().toISOString().substring(0, 10);
  const notesStr = Array.isArray(repData.notes) ? repData.notes.join(' | ') : (repData.notes || '');
  const waActivityStr =
    typeof repData.waActivity === 'number'
      ? String(repData.waActivity)
      : repData.waActivity || '0';

  const row = [
    date,
    repData.repName || '',
    repData.repEmail || '',
    repData.checkIns || 0,
    repData.storesVisited || repData.checkIns || 0,
    repData.photos || 0,
    repData.formsCompleted || 0,
    repData.kmTravelled || 0,
    notesStr,
    waActivityStr,
    repData.lastWaTime || '',
    new Date().toISOString(),
    repData.repslyFeedback || '',
    repData.waFeedback || '',
    Array.isArray(repData.photoLinks) ? repData.photoLinks.join('\n') : (repData.photoLinks || '')
  ];

  try {
    const sheets = await getSheetsClient();
    const allRows = await getAllRows(teamName);

    // Find existing row for this rep+date (skip header row at index 0)
    let existingRowIndex = -1;
    for (let i = 1; i < allRows.length; i++) {
      const r = allRows[i];
      if (r[0] === date && r[1] === repData.repName) {
        existingRowIndex = i;
        break;
      }
    }

    if (existingRowIndex >= 0) {
      // Update existing row (1-indexed, +1 for header offset)
      const rowNum = existingRowIndex + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${teamName}'!A${rowNum}:O${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [row] }
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${teamName}'!A:O`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] }
      });
    }
  } catch (err) {
    console.error('[Sheets] logRepDay error:', err.message);
  }
}

// Read today's rows for a team
async function getTeamRows(teamName, date) {
  const allRows = await getAllRows(teamName);
  if (allRows.length <= 1) return [];

  return allRows.slice(1).filter((r) => r[0] === date);
}

module.exports = {
  ensureSheetExists,
  ensureHeaders,
  logRepDay,
  getTeamRows
};
