import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/bot.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (guild_id, key)
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    answers TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_id TEXT,
    review_reason TEXT,
    review_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS applications_guild_status
    ON applications (guild_id, status);
`);

const defaultSettings = {
  brand_name: 'Staff Team',
  brand_color: '#d93636',
  application_title: 'Staff Application',
  application_description: 'Click the button below to apply for our staff team.',
  application_question_1: 'Why do you want to join the staff team?',
  application_question_2: 'What experience do you have?',
  application_question_3: 'How much time can you contribute each week?',
  application_question_4: 'What is your timezone?',
  application_question_5: 'Why should we choose you?',
  dm_on_decision: 'true',
  movement_template: '{user} was **{action}** by {actor}.\n**Position:** {position}\n**Reason:** {reason}',
  application_accepted_template: 'Congratulations! Your application to **{server}** was accepted.',
  application_rejected_template: 'Thank you for applying to **{server}**. Your application was not accepted this time.'
};

const getStatement = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?');
const setStatement = db.prepare(`
  INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
`);
const deleteStatement = db.prepare('DELETE FROM settings WHERE guild_id = ? AND key = ?');

export const settingKeys = Object.keys(defaultSettings);

export function getSetting(guildId, key) {
  return getStatement.get(guildId, key)?.value ?? defaultSettings[key] ?? null;
}

export function setSetting(guildId, key, value) {
  setStatement.run(guildId, key, String(value));
}

export function resetSetting(guildId, key) {
  deleteStatement.run(guildId, key);
}

export function getAllSettings(guildId) {
  const saved = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildId)
      .map(({ key, value }) => [key, value])
  );
  return { ...defaultSettings, ...saved };
}

export function createApplication(guildId, userId, answers) {
  const result = db.prepare(
    'INSERT INTO applications (guild_id, user_id, answers) VALUES (?, ?, ?)'
  ).run(guildId, userId, JSON.stringify(answers));
  return Number(result.lastInsertRowid);
}

export function setApplicationMessage(id, messageId) {
  db.prepare('UPDATE applications SET review_message_id = ? WHERE id = ?').run(messageId, id);
}

export function getApplication(id, guildId) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ? AND guild_id = ?').get(id, guildId);
  if (row) row.answers = JSON.parse(row.answers);
  return row;
}

export function getPendingApplication(guildId, userId) {
  return db.prepare(
    "SELECT id FROM applications WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
  ).get(guildId, userId);
}

export function reviewApplication(id, guildId, status, reviewerId, reason) {
  return db.prepare(`
    UPDATE applications
    SET status = ?, reviewer_id = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND guild_id = ? AND status = 'pending'
  `).run(status, reviewerId, reason || null, id, guildId).changes;
}

export function getApplicationStats(guildId) {
  return db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'pending') AS pending,
      SUM(status = 'accepted') AS accepted,
      SUM(status = 'rejected') AS rejected
    FROM applications WHERE guild_id = ?
  `).get(guildId);
}

export function closeDatabase() {
  db.close();
}
