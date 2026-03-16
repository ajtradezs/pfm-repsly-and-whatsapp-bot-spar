require('dotenv').config();
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { teams } = require('../config/teams');
const { getDailyRepSummary } = require('./repsly');
const { getWhatsAppActivity, clearWhatsAppActivity, sendToNumber } = require('./whatsapp');
const { logRepDay } = require('./sheets');
const { buildTeamReport, enrichWithFeedback, formatEmailHTML, formatWASummary } = require('./report');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const EMAIL_RECIPIENTS = (process.env.EMAIL_RECIPIENTS || '').split(',').map((e) => e.trim()).filter(Boolean);
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

function getSheetUrl(teamName) {
  if (!SPREADSHEET_ID) return null;
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
}

function createTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD
    }
  });
}

// Send HTML email to all team managers
async function sendEmailReport(teamName, subject, htmlBody, recipients) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn('[Emailer] Gmail credentials not set — skipping email.');
    return;
  }

  const to = recipients && recipients.length > 0 ? recipients : EMAIL_RECIPIENTS;
  if (to.length === 0) {
    console.warn('[Emailer] No email recipients configured.');
    return;
  }

  try {
    const transporter = createTransport();
    const info = await transporter.sendMail({
      from: `"Rep Activity Agent" <${GMAIL_USER}>`,
      to: to.join(', '),
      subject,
      html: htmlBody
    });
    console.log(`[Emailer] Email sent to ${to.join(', ')} — Message ID: ${info.messageId}`);
  } catch (err) {
    console.error('[Emailer] sendEmailReport error:', err.message);
  }
}

// Send WhatsApp message to a manager's personal number
async function sendWhatsAppToManager(waNumber, message) {
  if (!waNumber || waNumber.trim() === '') {
    console.warn('[Emailer] Manager WA number not set — skipping WA message.');
    return;
  }
  return sendToNumber(waNumber, message);
}

// Run a report cycle for a given team and report type
async function runReportForTeam(team, reportType) {
  const today = new Date().toISOString().substring(0, 10);
  console.log(`[Emailer] Running ${reportType} report for "${team.name}" — ${today}`);

  // 1. Fetch Repsly data
  let repslyData = [];
  try {
    repslyData = await getDailyRepSummary(today);
    console.log(`[Emailer] Repsly: ${repslyData.length} reps with activity.`);
  } catch (err) {
    console.error('[Emailer] Repsly fetch failed:', err.message);
  }

  // 2. Get WA activity
  const waData = getWhatsAppActivity(team.name);

  // 3. Build report + enrich with AI feedback
  const rawReport = buildTeamReport(team.name, repslyData, waData);
  const reportData = await enrichWithFeedback(rawReport);

  // 4. Log each rep to Google Sheets
  for (const rep of reportData.reps) {
    await logRepDay(team.name, {
      date: today,
      repName: rep.repName,
      repEmail: rep.repEmail,
      checkIns: rep.checkIns,
      storesVisited: rep.storesVisited || rep.checkIns,
      photos: rep.photos + rep.waPhotos,
      formsCompleted: rep.formsCompleted,
      kmTravelled: rep.kmTravelled,
      notes: rep.notes,
      waActivity: rep.waMessages,
      lastWaTime: rep.lastWaTime || '',
      repslyFeedback: rep.repslyFeedback || '',
      waFeedback: rep.waFeedback || '',
      photoLinks: rep.photoUrls || []
    });
  }

  // 5. Build email content
  const sheetUrl = getSheetUrl(team.name);
  const typeLabel = reportType === 'midday' ? 'Midday' : 'End of Day';
  const subject = `[${typeLabel}] ${team.name} Activity Report — ${today}`;
  const htmlBody = formatEmailHTML(team.name, reportData, today, sheetUrl);

  // 6. Determine recipients — TEST_WA_NUMBER overrides manager numbers during testing
  const testWaNumber = (process.env.TEST_WA_NUMBER || '').trim();
  const isTestMode = testWaNumber !== '';

  // Email: use EMAIL_RECIPIENTS env var (already set to test address during testing)
  const allRecipients = EMAIL_RECIPIENTS.length ? EMAIL_RECIPIENTS : team.managers.map((m) => m.email).filter(Boolean);

  // 7. Send email
  await sendEmailReport(team.name, subject, htmlBody, allRecipients);

  // 8. Send WA summary — to test number if set, otherwise to each manager
  const waSummary = formatWASummary(team.name, reportData, today, sheetUrl);
  if (isTestMode) {
    console.log(`[Emailer] TEST MODE — sending WA summary to ${testWaNumber}`);
    await sendWhatsAppToManager(testWaNumber, waSummary);
  } else {
    for (const manager of team.managers) {
      const waNumber = process.env[manager.waEnvVar];
      if (waNumber && waNumber.trim() !== '') {
        await sendWhatsAppToManager(waNumber.trim(), waSummary);
      }
    }
  }

  // 9. Clear WA buffer for EOD
  if (reportType === 'eod') {
    clearWhatsAppActivity(team.name);
    console.log(`[Emailer] WA buffer cleared for "${team.name}".`);
  }

  console.log(`[Emailer] ${typeLabel} report complete for "${team.name}".`);
}

// Run reports for all teams
async function runAllReports(reportType) {
  for (const team of teams) {
    try {
      await runReportForTeam(team, reportType);
    } catch (err) {
      console.error(`[Emailer] Error running ${reportType} report for "${team.name}":`, err.message);
    }
  }
}

// Schedule cron jobs
function scheduleReports() {
  // Midday report: 12:00 on weekdays
  cron.schedule('0 12 * * 1-5', async () => {
    console.log('[Cron] Triggering midday reports...');
    await runAllReports('midday');
  });

  // EOD report: 19:00 on weekdays
  cron.schedule('0 19 * * 1-5', async () => {
    console.log('[Cron] Triggering EOD reports...');
    await runAllReports('eod');
  });

  console.log('[Cron] Scheduled: midday reports at 12:00 weekdays, EOD reports at 19:00 weekdays.');
}

// Expose for manual triggers (e.g. from index.js for testing)
async function sendReport(teamName, reportData, date, sheetUrl, type) {
  const team = teams.find((t) => t.name === teamName);
  if (!team) {
    console.error(`[Emailer] Team "${teamName}" not found in config.`);
    return;
  }

  const typeLabel = type === 'midday' ? 'Midday' : 'End of Day';
  const subject = `[${typeLabel}] ${teamName} Activity Report — ${date}`;
  const htmlBody = formatEmailHTML(teamName, reportData, date, sheetUrl);

  const managerEmails = team.managers.map((m) => m.email).filter(Boolean);
  const allRecipients = [...new Set([...EMAIL_RECIPIENTS, ...managerEmails])];

  await sendEmailReport(teamName, subject, htmlBody, allRecipients);

  const waSummary = formatWASummary(teamName, reportData, date, sheetUrl);
  for (const manager of team.managers) {
    const waNumber = process.env[manager.waEnvVar];
    if (waNumber && waNumber.trim() !== '') {
      await sendWhatsAppToManager(waNumber.trim(), waSummary);
    }
  }
}

module.exports = {
  scheduleReports,
  runAllReports,
  runReportForTeam,
  sendReport,
  sendWhatsAppToManager
};
