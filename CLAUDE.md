# PFM Repsly + WhatsApp Bot (SPAR)

## Project Purpose
Automated field sales activity reporter for the SPAR/PFM team. Monitors WhatsApp group messages from field reps, fetches Repsly visit data, and sends midday + EOD reports via email and WhatsApp to team managers. Uses Claude Haiku to parse rep messages and generate AI feedback.

## How It Works
1. **WhatsApp client** (`src/whatsapp.js`) runs as a persistent daemon, monitoring group messages
2. **Repsly** (`src/repsly.js`) fetches daily visit/check-in data from the Repsly API
3. **Emailer/Scheduler** (`src/emailer.js`) runs cron jobs at 12:00 and 19:00 on weekdays
4. **Report** (`src/report.js`) builds the combined report and enriches it with Claude AI feedback
5. **Sheets** (`src/sheets.js`) logs each rep's daily data to Google Sheets
6. Reports are sent via email (Gmail) and WhatsApp to managers

## Running with PM2 (Recommended)
```bash
# Install dependencies
npm install

# Install PM2 globally if not installed
npm install -g pm2

# Start the bot (keeps it alive, auto-restarts on crash)
npm run pm2:start

# Check status
npm run pm2:status

# View logs
npm run pm2:logs

# Stop the bot
npm run pm2:stop

# Auto-start on machine reboot
pm2 startup
pm2 save
```

## Running Without PM2 (Dev/Testing)
```bash
npm start
```

## First-Time Setup (WhatsApp QR)
```bash
npm run setup
# Scan the QR code with your WhatsApp to authenticate
```

## Key Files
| File | Purpose |
|------|---------|
| `src/index.js` | Entry point — starts WhatsApp client + schedules cron jobs |
| `src/whatsapp.js` | WhatsApp client, message parsing, buffer management |
| `src/emailer.js` | Cron scheduling, report orchestration, email/WA sending |
| `src/report.js` | Report building + Claude AI feedback enrichment |
| `src/repsly.js` | Repsly API integration |
| `src/sheets.js` | Google Sheets logging |
| `src/drive.js` | Photo upload to imgbb |
| `config/teams.js` | Team/manager configuration |
| `ecosystem.config.js` | PM2 process manager config |
| `.env` | Environment variables (never commit this) |

## Required Environment Variables (.env)
```
ANTHROPIC_API_KEY=
REPSLY_USERNAME=
REPSLY_PASSWORD=
GMAIL_USER=
GMAIL_APP_PASSWORD=
EMAIL_RECIPIENTS=
GOOGLE_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
IMGBB_API_KEY=
SPAR_GROUP_ID=
TEST_WA_NUMBER=   # optional — routes all WA to this number during testing
```

## Cron Schedule
- **Midday**: 12:00 PM, Monday–Friday
- **EOD**: 7:00 PM, Monday–Friday

## Log Files (when using PM2)
- `logs/out.log` — standard output
- `logs/error.log` — errors

## Troubleshooting

### Bot didn't run overnight
1. Check PM2 is running: `pm2 status`
2. Check logs: `pm2 logs pfm-repsly-bot --lines 100`
3. If WhatsApp disconnected, bot will auto-reconnect after 15s — check logs for `[WhatsApp] Attempting reconnect`
4. If process was dead: `npm run pm2:start`

### WhatsApp not connecting
- Re-run `npm run setup` and scan QR code again
- Check `LocalAuth` session in `.wwebjs_auth/` — delete and re-authenticate if corrupt

### Reports not sending
- Verify all env vars are set: missing `SPAR_GROUP_ID` = silent WA failure
- Check Gmail app password is valid (not expired)
- Check `logs/error.log` for specific errors

## GitHub
https://github.com/ajtradezs/pfm-repsly-and-whatsapp-bot-spar
