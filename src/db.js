/**
 * db.js — SQLite persistence layer for the dashboard.
 * All functions are synchronous (better-sqlite3).
 * Database file: data/dashboard.db
 */

const path = require('path');
const fs   = require('fs');

let db    = null;
let stmts = null; // cached prepared statements — compiled once, reused on every call

function initDb() {
  if (db) return db;

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true }); // no-op if exists

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

    CREATE INDEX IF NOT EXISTS idx_messages_date   ON messages(date);
    CREATE INDEX IF NOT EXISTS idx_messages_group  ON messages(group_id, date);
    CREATE INDEX IF NOT EXISTS idx_messages_member ON messages(member_id, date);

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

  // Compile all statements once — reused on every subsequent call
  stmts = {
    insertGroupIgnore: db.prepare('INSERT OR IGNORE INTO groups (wa_group_id, team_name) VALUES (?, ?)'),
    selectGroupId:     db.prepare('SELECT id FROM groups WHERE wa_group_id = ?'),
    insertMemberIgnore:db.prepare('INSERT OR IGNORE INTO members (group_id, name) VALUES (?, ?)'),
    selectMemberId:    db.prepare('SELECT id FROM members WHERE group_id = ? AND name = ?'),
    insertMessage:     db.prepare(`
      INSERT INTO messages (group_id, member_id, date, timestamp, raw_body, category, store_name, media_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    upsertSummary:     db.prepare(`
      INSERT INTO summaries (scope, scope_id, date, summary_text, generated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(scope, scope_id, date) DO UPDATE SET
        summary_text = excluded.summary_text,
        generated_at = excluded.generated_at`),
    allGroupsWithSummary: db.prepare(`
      SELECT
        g.id, g.wa_group_id, g.team_name,
        COUNT(DISTINCT m.id)                                        AS totalMembers,
        COUNT(DISTINCT CASE WHEN msg.id IS NOT NULL THEN m.id END) AS activeMembers,
        COUNT(DISTINCT CASE WHEN msg.id IS NULL     THEN m.id END) AS inactiveMembers,
        COUNT(msg.id)                                               AS totalMessages,
        MAX(msg.timestamp)                                          AS lastActivity
      FROM groups g
      LEFT JOIN members m   ON m.group_id = g.id
      LEFT JOIN messages msg ON msg.member_id = m.id AND msg.date = ?
      GROUP BY g.id
      ORDER BY g.team_name`),
    groupById:    db.prepare('SELECT * FROM groups WHERE id = ?'),
    memberActivity: db.prepare(`
      SELECT
        m.id, m.name,
        COUNT(msg.id)                                                   AS messageCount,
        MAX(msg.timestamp)                                              AS lastMessageTime,
        SUM(CASE WHEN msg.category = 'check_in' THEN 1 ELSE 0 END)    AS checkIns,
        SUM(CASE WHEN msg.category = 'photo'    THEN 1 ELSE 0 END)    AS photos,
        SUM(CASE WHEN msg.category = 'note'     THEN 1 ELSE 0 END)    AS notes,
        SUM(CASE WHEN msg.category = 'agenda'   THEN 1 ELSE 0 END)    AS agendas,
        SUM(CASE WHEN msg.category = 'general'  THEN 1 ELSE 0 END)    AS general
      FROM members m
      LEFT JOIN messages msg ON msg.member_id = m.id AND msg.date = ?
      WHERE m.group_id = ?
      GROUP BY m.id, m.name
      ORDER BY messageCount DESC, m.name`),
    messagesByGroup:  db.prepare(`
      SELECT msg.*, mem.name AS memberName
      FROM messages msg JOIN members mem ON mem.id = msg.member_id
      WHERE msg.group_id = ? AND msg.date = ?
      ORDER BY msg.timestamp`),
    messagesByMember: db.prepare(`
      SELECT msg.*, mem.name AS memberName
      FROM messages msg JOIN members mem ON mem.id = msg.member_id
      WHERE msg.group_id = ? AND msg.date = ? AND msg.member_id = ?
      ORDER BY msg.timestamp`),
    memberWithGroup:  db.prepare(`
      SELECT m.*, g.team_name, g.id AS groupId
      FROM members m JOIN groups g ON g.id = m.group_id
      WHERE m.id = ?`),
    memberDailyStats: db.prepare(`
      SELECT
        date,
        COUNT(*)                                                    AS messageCount,
        MAX(timestamp)                                              AS lastMessageTime,
        SUM(CASE WHEN category = 'check_in' THEN 1 ELSE 0 END)    AS checkIns,
        SUM(CASE WHEN category = 'photo'    THEN 1 ELSE 0 END)    AS photos,
        SUM(CASE WHEN category = 'note'     THEN 1 ELSE 0 END)    AS notes,
        SUM(CASE WHEN category = 'agenda'   THEN 1 ELSE 0 END)    AS agendas
      FROM messages
      WHERE member_id = ? AND date >= ? AND date <= ?
      GROUP BY date
      ORDER BY date DESC`),
    memberMessages:   db.prepare(`
      SELECT * FROM messages WHERE member_id = ? AND date = ? ORDER BY timestamp`),
    summaryGet:       db.prepare('SELECT * FROM summaries WHERE scope = ? AND scope_id = ? AND date = ?'),
    allDates:         db.prepare('SELECT DISTINCT date FROM messages ORDER BY date DESC'),
  };

  console.log('[DB] SQLite initialised at', dbPath);
  return db;
}

// ── Write helpers ──────────────────────────────────────────────────────────

function insertGroup(waGroupId, teamName) {
  initDb();
  stmts.insertGroupIgnore.run(waGroupId, teamName);
  return stmts.selectGroupId.get(waGroupId).id;
}

function upsertMember(groupId, name) {
  initDb();
  stmts.insertMemberIgnore.run(groupId, name);
  return stmts.selectMemberId.get(groupId, name).id;
}

function insertMessage(groupId, memberId, date, timestamp, rawBody, category, storeName, mediaUrl) {
  initDb();
  stmts.insertMessage.run(
    groupId, memberId, date, timestamp,
    rawBody || '', category || 'general', storeName || null, mediaUrl || null
  );
}

function upsertSummary(scope, scopeId, date, summaryText) {
  initDb();
  stmts.upsertSummary.run(scope, scopeId, date, summaryText);
}

// ── Read helpers ───────────────────────────────────────────────────────────

/**
 * Returns all groups with per-group message summary stats for a given date.
 * Single JOIN query — no N+1.
 */
function getAllGroupsWithSummary(date) {
  initDb();
  return stmts.allGroupsWithSummary.all(date);
}

/**
 * Returns group info + members with their message stats for a given date.
 * inactive = true when messageCount === 0 on that date.
 */
function getGroupWithMemberActivity(groupId, date) {
  initDb();
  const group = stmts.groupById.get(groupId);
  if (!group) return null;
  const members = stmts.memberActivity.all(date, groupId)
    .map(m => ({ ...m, inactive: m.messageCount === 0 }));
  return { group, date, members };
}

function getMessages(groupId, date, memberId = null) {
  initDb();
  return memberId
    ? stmts.messagesByMember.all(groupId, date, memberId)
    : stmts.messagesByGroup.all(groupId, date);
}

function getMemberDetail(memberId, dateFrom, dateTo) {
  initDb();
  const member = stmts.memberWithGroup.get(memberId);
  if (!member) return null;
  const dailyStats = stmts.memberDailyStats.all(memberId, dateFrom, dateTo);
  return { member, dailyStats };
}

function getMemberMessages(memberId, date) {
  initDb();
  return stmts.memberMessages.all(memberId, date);
}

function getSummary(scope, scopeId, date) {
  initDb();
  return stmts.summaryGet.get(scope, scopeId, date);
}

function getAllDates() {
  initDb();
  return stmts.allDates.all().map(r => r.date);
}

module.exports = {
  initDb,
  insertGroup,
  upsertMember,
  insertMessage,
  upsertSummary,
  getAllGroupsWithSummary,
  getGroupWithMemberActivity,
  getMessages,
  getMemberDetail,
  getMemberMessages,
  getSummary,
  getAllDates
};
