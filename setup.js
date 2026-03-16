/**
 * setup.js — Rep Activity Agent Setup Script
 *
 * Run with: npm run setup
 *
 * This script will:
 * 1. Connect to WhatsApp via QR scan
 * 2. List all groups with their IDs
 * 3. Suggest which group IDs to put in .env
 * 4. Create Google Sheet tabs with headers for each team
 */

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');
const path = require('path');
const { teams } = require('./config/teams');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const CREDENTIALS_PATH = path.resolve(
  process.env.GOOGLE_CREDENTIALS_PATH || './credentials/google-credentials.json'
);

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
  'Repsly Synced'
];

// ── Google Sheets Setup ──────────────────────────────────────────────────────

async function setupGoogleSheets() {
  if (!SPREADSHEET_ID) {
    console.warn('\n[Setup] GOOGLE_SPREADSHEET_ID not set in .env — skipping Sheets setup.');
    console.warn('        Create a Google Spreadsheet and paste its ID into .env first.\n');
    return;
  }

  console.log('\n[Setup] Setting up Google Sheets tabs...');

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existingTabs = meta.data.sheets.map((s) => s.properties.title);
    console.log(`[Setup] Existing tabs: ${existingTabs.join(', ') || '(none)'}`);

    for (const team of teams) {
      const tabName = team.sheetTab || team.name;

      if (!existingTabs.includes(tabName)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{ addSheet: { properties: { title: tabName } } }]
          }
        });
        console.log(`[Setup]   Created tab: "${tabName}"`);
      } else {
        console.log(`[Setup]   Tab already exists: "${tabName}"`);
      }

      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] }
      });
      console.log(`[Setup]   Headers written for "${tabName}".`);
    }

    console.log(`[Setup] Sheets setup complete. View at: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
  } catch (err) {
    console.error('[Setup] Google Sheets error:', err.message);
  }
}

// ── WhatsApp Setup ───────────────────────────────────────────────────────────

function setupWhatsApp() {
  return new Promise((resolve) => {
    console.log('\n[Setup] Starting WhatsApp setup — scan the QR code below:\n');

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: 'rep-activity-agent-setup' }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      }
    });

    client.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
      console.log('\n[Setup] Waiting for QR scan...');
    });

    client.on('ready', async () => {
      console.log('\n[Setup] WhatsApp connected!\n');

      try {
        const chats = await client.getChats();
        const groups = chats
          .filter((c) => c.isGroup)
          .map((c) => ({
            id: c.id._serialized,
            name: c.name,
            participants: c.participants ? c.participants.length : '?'
          }));

        console.log(`[Setup] Found ${groups.length} WhatsApp group(s):\n`);

        groups.forEach((g, i) => {
          console.log(`  ${i + 1}. ${g.name}`);
          console.log(`     ID:           ${g.id}`);
          console.log(`     Participants: ${g.participants}`);
          console.log('');
        });

        // Suggest matches for each team
        console.log('[Setup] === SUGGESTED GROUP MATCHES ===\n');
        for (const team of teams) {
          const teamName = team.name.toLowerCase();
          const matches = groups.filter(
            (g) =>
              g.name.toLowerCase().includes(teamName.split(' ')[0]) ||
              teamName.includes(g.name.toLowerCase().split(' ')[0])
          );

          console.log(`Team: "${team.name}" (env var: ${team.groupIdEnvVar})`);
          if (matches.length > 0) {
            matches.forEach((m) => {
              console.log(`  Possible match → "${m.name}" : ${m.id}`);
            });
          } else {
            console.log('  No automatic match found — check the list above and copy the ID manually.');
          }
          console.log('');
        }

        console.log('[Setup] Copy the relevant Group ID(s) into your .env file:\n');
        for (const team of teams) {
          console.log(`  ${team.groupIdEnvVar}=<paste group ID here>`);
        }

        console.log('\n[Setup] Also fill in manager WhatsApp numbers (international format, no + or spaces):');
        console.log('  VANESSA_WA=27XXXXXXXXX');
        console.log('  TALITHA_WA=27XXXXXXXXX');

      } catch (err) {
        console.error('[Setup] Error listing groups:', err.message);
      }

      await client.destroy();
      resolve();
    });

    client.on('auth_failure', (msg) => {
      console.error('[Setup] WhatsApp auth failed:', msg);
      resolve();
    });

    client.initialize();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('====================================');
  console.log('  Rep Activity Agent — Setup Script ');
  console.log('====================================\n');

  // Step 1: Google Sheets
  await setupGoogleSheets();

  // Step 2: WhatsApp
  await setupWhatsApp();

  console.log('\n[Setup] Setup complete.');
  console.log('[Setup] Next steps:');
  console.log('  1. Fill in SPAR_GROUP_ID in .env with the group ID from above.');
  console.log('  2. Fill in VANESSA_WA and TALITHA_WA with international numbers (no + sign).');
  console.log('  3. Set ANTHROPIC_API_KEY in .env.');
  console.log('  4. Set GOOGLE_SPREADSHEET_ID in .env (if not done yet).');
  console.log('  5. Run: npm start\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Setup] Fatal error:', err);
  process.exit(1);
});
