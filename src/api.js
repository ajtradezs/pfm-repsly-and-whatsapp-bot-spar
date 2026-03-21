/**
 * api.js — Dashboard Express server.
 * Runs as a separate PM2 process on DASHBOARD_PORT (default 3001).
 * Reads from data/dashboard.db (SQLite written by the bot).
 */

require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const TUNNEL_URL_FILE = path.join(__dirname, '..', 'data', 'tunnel-url.txt');

const {
  initDb,
  getGroups,
  getGroupWithMemberActivity,
  getGroupSummary,
  getMessages,
  getMemberDetail,
  getMemberMessages,
  getSummary,
  upsertSummary,
  getAllDates
} = require('./db');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

app.use(express.json());

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'dashboard', 'public')));

// ── Simple optional password protection (for non-localhost deployments) ────
const DASH_PASSWORD = (process.env.DASHBOARD_PASSWORD || '').trim();
if (DASH_PASSWORD) {
  app.use('/api', (req, res, next) => {
    const auth = req.headers['x-dashboard-key'];
    if (auth !== DASH_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/config — branding info for the frontend
app.get('/api/config', (req, res) => {
  let tunnelUrl = null;
  try {
    if (fs.existsSync(TUNNEL_URL_FILE)) {
      tunnelUrl = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
    }
  } catch (_) {}

  res.json({
    companyName:    process.env.COMPANY_NAME    || 'Dashboard',
    companyLogoUrl: process.env.COMPANY_LOGO_URL || null,
    tunnelUrl
  });
});

// GET /api/dates — dates that have message data (for date picker hints)
app.get('/api/dates', (req, res) => {
  try {
    res.json(getAllDates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups — list of all configured groups with summary stats
app.get('/api/groups', (req, res) => {
  try {
    const date   = req.query.date || today();
    const groups = getGroups();
    const result = groups.map(g => {
      const summary = getGroupSummary(g.id, date);
      return { ...g, date, ...summary };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id — group detail with per-member activity
app.get('/api/groups/:id', (req, res) => {
  try {
    const date   = req.query.date || today();
    const detail = getGroupWithMemberActivity(parseInt(req.params.id), date);
    if (!detail) return res.status(404).json({ error: 'Group not found' });

    // Attach cached summary if it exists
    const summary = getSummary('group', detail.group.id, date);
    detail.cachedSummary = summary ? summary.summary_text : null;
    detail.summaryGeneratedAt = summary ? summary.generated_at : null;

    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/messages — all messages for a group on a date
app.get('/api/groups/:id/messages', (req, res) => {
  try {
    const date = req.query.date || today();
    res.json(getMessages(parseInt(req.params.id), date));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members/:id — member detail with daily stats across a date range
app.get('/api/members/:id', (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || (() => {
      const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
    })();
    const dateTo = req.query.dateTo || today();
    const detail = getMemberDetail(parseInt(req.params.id), dateFrom, dateTo);
    if (!detail) return res.status(404).json({ error: 'Member not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/members/:id/messages — messages for one member on a specific date
app.get('/api/members/:id/messages', (req, res) => {
  try {
    const date = req.query.date || today();
    res.json(getMemberMessages(parseInt(req.params.id), date));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/summaries/:scope/:scopeId — fetch cached summary
app.get('/api/summaries/:scope/:scopeId', (req, res) => {
  try {
    const date = req.query.date || today();
    const s = getSummary(req.params.scope, parseInt(req.params.scopeId), date);
    if (!s) return res.status(404).json({ error: 'No summary for this date' });
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/summaries/generate — generate AI summary on demand and cache it
const generatingKeys = new Set();

app.post('/api/summaries/generate', async (req, res) => {
  const { scope, scopeId, date: reqDate } = req.body || {};
  if (!scope || !scopeId) return res.status(400).json({ error: 'scope and scopeId required' });

  const date = reqDate || today();
  const key  = `${scope}:${scopeId}:${date}`;

  if (generatingKeys.has(key)) {
    return res.status(429).json({ error: 'Generation already in progress' });
  }

  try {
    generatingKeys.add(key);

    // Gather messages for context
    let messages;
    if (scope === 'group') {
      messages = getMessages(scopeId, date);
    } else {
      messages = getMemberMessages(scopeId, date);
    }

    if (messages.length === 0) {
      return res.status(404).json({ error: 'No messages found for this date' });
    }

    const messageLines = messages.map(m =>
      `[${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '?'}] ${m.memberName || 'Rep'} (${m.category}): ${m.raw_body}`
    ).join('\n');

    const scopeLabel = scope === 'group' ? 'WhatsApp group' : 'sales representative';

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response  = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role:    'user',
        content: `Summarise the following WhatsApp activity for a field sales ${scopeLabel} on ${date}. Be concise — 2-3 sentences max. Highlight who was active, any notable check-ins or issues mentioned, and flag anyone who was quiet.\n\n${messageLines}`
      }]
    });

    const summaryText = response.content[0].text.trim();
    upsertSummary(scope, scopeId, date, summaryText);

    res.json({ summary_text: summaryText, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    generatingKeys.delete(key);
  }
});

// ── SPA fallback ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
// DASHBOARD_HOST defaults to 0.0.0.0 so directors on the same network
// can access the dashboard at http://[bot-laptop-ip]:3001
// Set DASHBOARD_HOST=127.0.0.1 to restrict to localhost only.
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';

try {
  initDb();
  app.listen(PORT, HOST, () => {
    const iface = HOST === '0.0.0.0' ? 'all network interfaces' : HOST;
    console.log(`[Dashboard] Server running on ${iface} at port ${PORT}`);
    console.log(`[Dashboard] Local:   http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') {
      console.log(`[Dashboard] Network: http://[this-machine-ip]:${PORT}  ← directors use this`);
    }
  });
} catch (err) {
  console.error('[Dashboard] Failed to start:', err.message);
  process.exit(1);
}
