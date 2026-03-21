require('dotenv').config();
const { initClient } = require('./whatsapp');
const { scheduleReports } = require('./emailer');
const { ensureSheetExists, ensureHeaders } = require('./sheets');
const { teams } = require('../config/teams');
const { initDb, insertGroup } = require('./db');

// Print masked env var status
function printEnvStatus() {
  const vars = [
    'ANTHROPIC_API_KEY',
    'REPSLY_USERNAME',
    'REPSLY_PASSWORD',
    'REPSLY_BASE_URL',
    'GOOGLE_CREDENTIALS_PATH',
    'GOOGLE_SPREADSHEET_ID',
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD',
    'EMAIL_RECIPIENTS',
    'VANESSA_WA',
    'TALITHA_WA',
    'SPAR_GROUP_ID'
  ];

  console.log('\n=== Rep Activity Agent — Environment Status ===');
  for (const v of vars) {
    const val = process.env[v];
    if (!val || val.trim() === '') {
      console.log(`  ${v}: NOT SET`);
    } else {
      const masked =
        val.length <= 8
          ? '****'
          : val.substring(0, 4) + '****' + val.substring(val.length - 4);
      console.log(`  ${v}: ${masked}`);
    }
  }
  console.log('===============================================\n');
}

async function initSheets() {
  for (const team of teams) {
    try {
      await ensureSheetExists(team.sheetTab || team.name);
      await ensureHeaders(team.sheetTab || team.name);
    } catch (err) {
      console.error(`[Index] Sheet init failed for "${team.name}":`, err.message);
    }
  }
}

async function main() {
  // Force UTF-8 safe output
  if (process.stdout.isTTY) {
    try {
      process.stdout.setEncoding('utf8');
    } catch (_) {}
  }

  console.log('Starting Rep Activity Agent...');
  printEnvStatus();

  // Initialize SQLite dashboard database + seed groups
  try {
    initDb();
    for (const team of teams) {
      const groupId = process.env[team.groupIdEnvVar];
      if (groupId && groupId.trim()) {
        insertGroup(groupId.trim(), team.name);
      }
    }
    console.log('[Index] Dashboard DB initialised.');
  } catch (err) {
    console.error('[Index] Dashboard DB init failed (non-fatal):', err.message);
  }

  // Initialize Google Sheets tabs
  console.log('[Index] Initializing Google Sheets...');
  await initSheets();

  // Schedule cron reports
  scheduleReports();

  // Initialize WhatsApp client
  console.log('[Index] Initializing WhatsApp client...');
  initClient((client) => {
    console.log('[Index] WhatsApp ready. Agent is fully operational.');
  });
}

main().catch((err) => {
  console.error('[Index] Fatal error:', err);
  process.exit(1);
});
