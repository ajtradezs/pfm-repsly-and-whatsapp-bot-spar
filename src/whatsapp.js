require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Anthropic = require('@anthropic-ai/sdk');
const { teams } = require('../config/teams');
const { uploadImage } = require('./drive');
const db = require('./db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory buffer: Map<teamName, Map<repName, message[]>>
const waBuffer = new Map();

let client = null;
let isReady = false;

// Build group -> team mapping from env vars
function buildGroupTeamMap() {
  const map = {};
  for (const team of teams) {
    const groupId = process.env[team.groupIdEnvVar];
    if (groupId && groupId.trim() !== '') {
      map[groupId.trim()] = team;
    } else {
      console.warn(`[WhatsApp] Group ID not set for team "${team.name}" (env var: ${team.groupIdEnvVar}) — WA monitoring skipped for this team.`);
    }
  }
  return map;
}

// Use Claude Haiku to parse a WhatsApp message
async function parseMessageWithClaude(senderName, messageText) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `You are parsing a WhatsApp message from a field sales representative.

Sender: ${senderName}
Message: ${messageText}

Extract and return ONLY valid JSON (no explanation) with these fields:
{
  "repName": "name of the rep if mentioned, else use sender name",
  "activity_type": one of "check_in" | "note" | "photo" | "agenda" | "general",
  "store_mentioned": "store or client name if mentioned, else null",
  "summary": "one sentence summary of what the rep reported"
}

activity_type guide:
- check_in: rep is at a store, arrived, checking in
- note: general observation, feedback, issue report
- photo: mentions photos taken or uploaded
- agenda: refers to forms, schedules, agendas completed
- general: anything else`
        }
      ]
    });

    const text = response.content[0].text.trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('[WhatsApp] Claude parse error:', err.message);
    return {
      repName: senderName,
      activity_type: 'general',
      store_mentioned: null,
      summary: messageText.substring(0, 100)
    };
  }
}

// Handle an incoming message
async function handleMessage(msg, groupTeamMap) {
  // Only process group messages from monitored groups
  const chat = await msg.getChat();
  if (!chat.isGroup) return;

  const groupId = chat.id._serialized || chat.id.user;
  const team = groupTeamMap[groupId];
  if (!team) return;

  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.name || contact.number || 'Unknown';
  const messageText = msg.body || '';
  const timestamp = new Date(msg.timestamp * 1000);

  // Handle media — upload photos to imgbb
  const hasMedia = msg.hasMedia;
  let mediaCount = hasMedia ? 1 : 0;
  let photoUrl = null;

  if (hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.mimetype && media.mimetype.startsWith('image/')) {
        const ts = timestamp.toISOString().replace(/[:.]/g, '-');
        const filename = `wa_${senderName.replace(/\s+/g, '_')}_${ts}.jpg`;
        photoUrl = await uploadImage(media.data, media.mimetype, filename);
        if (photoUrl) console.log(`[WhatsApp] Photo uploaded: ${photoUrl}`);
      }
    } catch (err) {
      console.error('[WhatsApp] Media download/upload error:', err.message);
    }
  }

  // Parse message with Claude
  const parsed = await parseMessageWithClaude(senderName, messageText);
  const repName = parsed.repName || senderName;

  // Store in buffer
  if (!waBuffer.has(team.name)) {
    waBuffer.set(team.name, new Map());
  }
  const teamBuffer = waBuffer.get(team.name);

  if (!teamBuffer.has(repName)) {
    teamBuffer.set(repName, []);
  }

  teamBuffer.get(repName).push({
    sender: senderName,
    repName,
    text: messageText,
    time: timestamp.toISOString(),
    mediaCount,
    photoUrl,
    parsed
  });

  // Persist message to dashboard SQLite database
  try {
    const date      = timestamp.toISOString().slice(0, 10);
    const dbGroupId = db.insertGroup(groupId, team.name);
    const dbMemberId = db.upsertMember(dbGroupId, repName);
    db.insertMessage(
      dbGroupId,
      dbMemberId,
      date,
      timestamp.toISOString(),
      messageText,
      parsed.activity_type,
      parsed.store_mentioned,
      photoUrl
    );
  } catch (dbErr) {
    console.error('[WhatsApp] DB write error (non-fatal):', dbErr.message);
  }

  console.log(`[WhatsApp] [${team.name}] Message from ${senderName} → ${parsed.activity_type}: ${parsed.summary}`);
}

// Initialize WhatsApp client
function initClient(onReady) {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rep-activity-agent' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  });

  const groupTeamMap = buildGroupTeamMap();

  client.on('qr', (qr) => {
    console.log('[WhatsApp] Scan this QR code to connect:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    isReady = true;
    const monitoredGroups = Object.keys(groupTeamMap);
    const teamNames = monitoredGroups.map((id) => groupTeamMap[id].name).join(', ');
    console.log(`[WhatsApp] Connected. Monitoring groups for: ${teamNames || 'none configured'}`);
    if (onReady) onReady(client);
  });

  client.on('message', (msg) => handleMessage(msg, groupTeamMap));

  client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Authentication failed:', msg);
  });

  client.on('disconnected', (reason) => {
    isReady = false;
    console.warn('[WhatsApp] Disconnected:', reason);
    console.log('[WhatsApp] Attempting reconnect in 15s...');
    setTimeout(async () => {
      try {
        await client.initialize();
        console.log('[WhatsApp] Reconnect initiated.');
      } catch (e) {
        console.error('[WhatsApp] Reconnect failed:', e.message);
      }
    }, 15000);
  });

  client.initialize();
  return client;
}

// Get WhatsApp activity buffer for a team
// Returns: Map<repName, message[]> or empty Map
function getWhatsAppActivity(teamName) {
  return waBuffer.get(teamName) || new Map();
}

// Clear buffer for a team after report has been sent
function clearWhatsAppActivity(teamName) {
  waBuffer.set(teamName, new Map());
}

// Send a message to a WhatsApp number (manager personal number)
async function sendToNumber(waNumber, message) {
  if (!client || !isReady) {
    console.warn('[WhatsApp] Client not ready — cannot send message.');
    return false;
  }

  try {
    // Ensure number is in the format: countrycode+number@c.us
    const chatId = waNumber.includes('@') ? waNumber : `${waNumber}@c.us`;
    await client.sendMessage(chatId, message);
    console.log(`[WhatsApp] Message sent to ${waNumber}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] sendToNumber error:', err.message);
    return false;
  }
}

// List all groups the client is in (useful for setup)
async function listGroups() {
  if (!client || !isReady) {
    console.warn('[WhatsApp] Client not ready.');
    return [];
  }

  const chats = await client.getChats();
  return chats
    .filter((c) => c.isGroup)
    .map((c) => ({
      id: c.id._serialized,
      name: c.name,
      participantCount: c.participants ? c.participants.length : 0
    }));
}

function getClient() {
  return client;
}

function isClientReady() {
  return isReady;
}

module.exports = {
  initClient,
  getWhatsAppActivity,
  clearWhatsAppActivity,
  sendToNumber,
  listGroups,
  getClient,
  isClientReady
};
