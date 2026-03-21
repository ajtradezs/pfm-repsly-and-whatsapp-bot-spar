/**
 * db.js — SQLite persistence layer for the dashboard.
 * All functions are synchronous (better-sqlite3).
 * Database file: data/dashboard.db
 */

const path = require('path');
const fs = require('fs');

let db = null;

function initDb() {
  if (db) return db;

  // Ensure data/ directory exists
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const Database = require('better-sqlite3');
  const dbPath = path.join(dataDir, 'dashboard.db');
  db = new Database(dbPath);

  // WAL mode: allows one writer (bot) + concurrent readers (API) without lock contention
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_group_id TEXT    UNIQUE NOT NULL,
      team_name   TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL REFERENCES groups(id),
      name       TEXT    NOT NULL,
      UNIQUE(group_id, name)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL REFERENCES groups(id),
      member_id  INTEGER NOT NULL REFERENCES members(id),
      date       TEXT    NOT NULL,
      timestamp  TEXT    NOT NULL,
      raw_body   TEXT,
      category   TEXT,
      store_name TEXT,
      media_url  TEXT,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_date     ON messages(date);
    CREATE INDEX IF NOT EXISTS idx_messages_group    ON messages(group_id, date);
    CREATE INDEX IF NOT EXISTS idx_messages_member   ON messages(member_id, date);

    CREATE TABLE IF NOT EXISTS summaries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      scope        TEXT    NOT NULL,
      scope_id     INTEGER NOT NULL,
      date         TEXT    NOT NULL,
      summary_text TEXT    NOT NULL,
      generated_at TEXT    DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id, date)
    );
  `);

  console.log('[DB] SQLite initialised at', dbPath);
  return db;
}

// ── Write helpers ──────────────────────────────────────────────────────────

function insertGroup(waGroupId, teamName) {
  const d = initDb();
  d.prepare(
    'INSERT OR IGNORE INTO groups (wa_group_id, team_name) VALUES (?, ?)'
  ).run(waGroupId, teamName);
  return d.prepare('SELECT id FROM groups WHERE wa_group_id = ?').get(waGroupId).id;
}

function upsertMember(groupId, name) {
  const d = initDb();
  d.prepare(
    'INSERT OR IGNORE INTO members (group_id, name) VALUES (?, ?)'
  ).run(groupId, name);
  return d.prepare('SELECT id FROM members WHERE group_id = ? AND name = ?').get(groupId, name).id;
}

function insertMessage(groupId, memberId, date, timestamp, rawBody, category, storeName, mediaUrl) {
  const d = initDb();
  d.prepare(`
    INSERT INTO messages (group_id, member_id, date, timestamp, raw_body, category, store_name, media_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(groupId, memberId, date, timestamp, rawBody || '', category || 'general', storeName || null, mediaUrl || null);
}

function upsertSummary(scope, scopeId, date, summaryText) {
  const d = initDb();
  d.prepare(`
    INSERT INTO summaries (scope, scope_id, date, summary_text, generated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(scope, scope_id, date) DO UPDATE SET
      summary_text = excluded.summary_text,
      generated_at = excluded.generated_at
  `).run(scope, scopeId, date, summaryText);
}

// ── Read helpers ───────────────────────────────────────────────────────────

function getGroups() {
  return initDb().prepare('SELECT * FROM groups ORDER BY team_name').all();
}

/**
 * Returns group info + members with their message stats for a given date.
 * inactive = true when messageCount === 0 on that date.
 */
function getGroupWithMemberActivity(groupId, date) {
  const d = initDb();
  const group = d.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return null;

  const members = d.prepare(`
    SELECT
      m.id,
      m.name,
      COUNT(msg.id)                                          AS messageCount,
      MAX(msg.timestamp)                                     AS lastMessageTime,
      SUM(CASE WHEN msg.category = 'check_in' THEN 1 ELSE 0 END) AS checkIns,
      SUM(CASE WHEN msg.category = 'photo'    THEN 1 ELSE 0 END) AS photos,
      SUM(CASE WHEN msg.category = 'note'     THEN 1 ELSE 0 END) AS notes,
      SUM(CASE WHEN msg.category = 'agenda'   THEN 1 ELSE 0 END) AS agendas,
      SUM(CASE WHEN msg.category = 'general'  THEN 1 ELSE 0 END) AS general
    FROM members m
    LEFT JOIN messages msg ON msg.member_id = m.id AND msg.date = ?
    WHERE m.group_id = ?
    GROUP BY m.id, m.name
    ORDER BY messageCount DESC, m.name
  `).all(date, groupId);

  const membersFlagged = members.map(m => ({ ...m, inactive: m.messageCount === 0 }));

  return { group, date, members: membersFlagged };
}

function getMessages(groupId, date, memberId = null) {
  const d = initDb();
  if (memberId) {
    return d.prepare(`
      SELECT msg.*, mem.name AS memberName
      FROM messages msg
      JOIN members mem ON mem.id = msg.member_id
      WHERE msg.group_id = ? AND msg.date = ? AND msg.member_id = ?
      ORDER BY msg.timestamp
    `).all(groupId, date, memberId);
  }
  return d.prepare(`
    SELECT msg.*, mem.name AS memberName
    FROM messages msg
    JOIN members mem ON mem.id = msg.member_id
    WHERE msg.group_id = ? AND msg.date = ?
    ORDER BY msg.timestamp
  `).all(groupId, date);
}

function getMemberDetail(memberId, dateFrom, dateTo) {
  const d = initDb();
  const member = d.prepare(`
    SELECT m.*, g.team_name, g.id AS groupId
    FROM members m JOIN groups g ON g.id = m.group_id
    WHERE m.id = ?
  `).get(memberId);
  if (!member) return null;

  const dailyStats = d.prepare(`
    SELECT
      date,
      COUNT(*)                                                AS messageCount,
      MAX(timestamp)                                          AS lastMessageTime,
      SUM(CASE WHEN category = 'check_in' THEN 1 ELSE 0 END) AS checkIns,
      SUM(CASE WHEN category = 'photo'    THEN 1 ELSE 0 END) AS photos,
      SUM(CASE WHEN category = 'note'     THEN 1 ELSE 0 END) AS notes,
      SUM(CASE WHEN category = 'agenda'   THEN 1 ELSE 0 END) AS agendas
    FROM messages
    WHERE member_id = ? AND date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date DESC
  `).all(memberId, dateFrom, dateTo);

  return { member, dailyStats };
}

function getMemberMessages(memberId, date) {
  return initDb().prepare(`
    SELECT * FROM messages
    WHERE member_id = ? AND date = ?
    ORDER BY timestamp
  `).all(memberId, date);
}

function getSummary(scope, scopeId, date) {
  return initDb().prepare(
    'SELECT * FROM summaries WHERE scope = ? AND scope_id = ? AND date = ?'
  ).get(scope, scopeId, date);
}

/**
 * Returns distinct dates that have any message data, newest first.
 * Used to populate the date picker with data-backed dates.
 */
function getAllDates() {
  return initDb()
    .prepare('SELECT DISTINCT date FROM messages ORDER BY date DESC')
    .all()
    .map(r => r.date);
}

/**
 * Returns group summary stats across all members for a date.
 * Used on the group list view card.
 */
function getGroupSummary(groupId, date) {
  return initDb().prepare(`
    SELECT
      COUNT(DISTINCT m.id)                                             AS totalMembers,
      COUNT(DISTINCT CASE WHEN msg.id IS NOT NULL THEN m.id END)      AS activeMembers,
      COUNT(DISTINCT CASE WHEN msg.id IS NULL     THEN m.id END)      AS inactiveMembers,
      COUNT(msg.id)                                                    AS totalMessages,
      MAX(msg.timestamp)                                               AS lastActivity
    FROM members m
    LEFT JOIN messages msg ON msg.member_id = m.id AND msg.date = ?
    WHERE m.group_id = ?
  `).get(date, groupId);
}

module.exports = {
  initDb,
  insertGroup,
  upsertMember,
  insertMessage,
  upsertSummary,
  getGroups,
  getGroupWithMemberActivity,
  getMessages,
  getMemberDetail,
  getMemberMessages,
  getSummary,
  getAllDates,
  getGroupSummary
};
