/**
 * tunnel.js — Exposes the dashboard over the internet via ngrok.
 * Runs as a separate PM2 process.
 *
 * Setup (one-time):
 *   npm install @ngrok/ngrok
 *   Add NGROK_AUTHTOKEN to your .env  (free account at ngrok.com)
 *
 * The public URL is printed to the log and written to data/tunnel-url.txt
 * so the dashboard can display it.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const PORT      = parseInt(process.env.DASHBOARD_PORT || '3001');
const AUTH      = process.env.NGROK_AUTHTOKEN;
const URL_FILE  = path.join(__dirname, '..', 'data', 'tunnel-url.txt');

if (!AUTH) {
  console.error('[Tunnel] NGROK_AUTHTOKEN is not set. Add it to your .env file.');
  console.error('[Tunnel] Get a free token at https://ngrok.com');
  process.exit(1);
}

async function start() {
  const ngrok = require('@ngrok/ngrok');

  const listener = await ngrok.forward({
    addr:      PORT,
    authtoken: AUTH,
    // Uncomment to use a fixed custom domain (paid ngrok plan):
    // domain: process.env.NGROK_DOMAIN
  });

  const url = listener.url();

  // Persist URL so the dashboard API can expose it
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(URL_FILE, url, 'utf8');

  console.log('[Tunnel] ─────────────────────────────────────────────');
  console.log(`[Tunnel] Public URL: ${url}`);
  console.log('[Tunnel] Share this link with directors or clients.');
  console.log('[Tunnel] The URL changes each restart (upgrade to ngrok paid for a fixed domain).');
  console.log('[Tunnel] ─────────────────────────────────────────────');

  // Keep process alive
  process.on('SIGINT',  () => { fs.existsSync(URL_FILE) && fs.unlinkSync(URL_FILE); process.exit(0); });
  process.on('SIGTERM', () => { fs.existsSync(URL_FILE) && fs.unlinkSync(URL_FILE); process.exit(0); });
}

start().catch(err => {
  console.error('[Tunnel] Failed to start:', err.message);
  process.exit(1);
});
