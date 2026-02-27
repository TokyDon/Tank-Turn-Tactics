const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// DATA_DIR can be overridden via env var — used in production to point at a
// persistent disk (e.g. Render's mounted volume at /data).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'game.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email TEXT DEFAULT NULL,
    email_verified INTEGER DEFAULT 0,
    recovery_codes TEXT DEFAULT NULL,
    is_bot INTEGER DEFAULT 0,
    bot_difficulty TEXT DEFAULT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'lobby',
    grid_size INTEGER DEFAULT 16,
    active_grid_size INTEGER DEFAULT 16,
    current_turn INTEGER DEFAULT 0,
    turn_started_at INTEGER,
    shrink_enabled INTEGER DEFAULT 0,
    turns_since_shrink INTEGER DEFAULT 0,
    max_players INTEGER DEFAULT 16,
    created_by TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS game_players (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    hearts INTEGER DEFAULT 3,
    extra_hearts INTEGER DEFAULT 0,
    ap INTEGER DEFAULT 1,
    range_val INTEGER DEFAULT 2,
    is_downed INTEGER DEFAULT 0,
    can_revive INTEGER DEFAULT 1,
    has_taken_turn INTEGER DEFAULT 0,
    is_haunted INTEGER DEFAULT 0,
    color TEXT DEFAULT '#d4860a',
    is_bot INTEGER DEFAULT 0,
    bot_difficulty TEXT DEFAULT NULL,
    bot_act_after INTEGER DEFAULT NULL,
    joined_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(game_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS turn_actions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    turn_num INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_data TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (game_id) REFERENCES games(id)
  );

  CREATE TABLE IF NOT EXISTS board_items (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    value INTEGER DEFAULT 1,
    is_collected INTEGER DEFAULT 0,
    collected_by TEXT,
    collected_at INTEGER,
    spawned_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (game_id) REFERENCES games(id)
  );

  CREATE TABLE IF NOT EXISTS jury_votes (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    turn_num INTEGER NOT NULL,
    voter_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    vote_type TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (game_id) REFERENCES games(id),
    UNIQUE(game_id, turn_num, voter_id, vote_type)
  );

  CREATE TABLE IF NOT EXISTS game_log (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    turn_num INTEGER DEFAULT 0,
    log_type TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (game_id) REFERENCES games(id)
  );
`);

// ─── Migrations (safe — ignore if column already exists) ──────────────────
const migrations = [
  'ALTER TABLE users ADD COLUMN is_bot INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN bot_difficulty TEXT DEFAULT NULL',
  'ALTER TABLE game_players ADD COLUMN is_bot INTEGER DEFAULT 0',
  'ALTER TABLE game_players ADD COLUMN bot_difficulty TEXT DEFAULT NULL',
  'ALTER TABLE game_players ADD COLUMN bot_act_after INTEGER DEFAULT NULL',
  // Option-B ready: email fields (nullable, unused until email feature added)
  'ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL',
  'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN recovery_codes TEXT DEFAULT NULL',
  // Two-phase turn: track primary separately from full-turn completion
  'ALTER TABLE game_players ADD COLUMN has_taken_primary INTEGER DEFAULT 0',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

module.exports = db;
