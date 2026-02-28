const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/** Thin wrapper — returns the pg QueryResult object ({ rows, rowCount, ... }) */
async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function init() {
  // citext gives case-insensitive TEXT columns (username lookup)
  await query('CREATE EXTENSION IF NOT EXISTS citext');

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username CITEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT DEFAULT NULL,
      email_verified INTEGER DEFAULT 0,
      recovery_codes TEXT DEFAULT NULL,
      is_bot INTEGER DEFAULT 0,
      bot_difficulty TEXT DEFAULT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'lobby',
      grid_size INTEGER DEFAULT 16,
      active_grid_size INTEGER DEFAULT 16,
      current_turn INTEGER DEFAULT 0,
      turn_started_at BIGINT,
      shrink_enabled INTEGER DEFAULT 0,
      turns_since_shrink INTEGER DEFAULT 0,
      max_players INTEGER DEFAULT 16,
      created_by TEXT NOT NULL,
      password_hash TEXT DEFAULT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  await query(`
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
      has_taken_primary INTEGER DEFAULT 0,
      is_haunted INTEGER DEFAULT 0,
      color TEXT DEFAULT '#d4860a',
      is_bot INTEGER DEFAULT 0,
      bot_difficulty TEXT DEFAULT NULL,
      bot_act_after BIGINT DEFAULT NULL,
      joined_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      FOREIGN KEY (game_id) REFERENCES games(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(game_id, user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS turn_actions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      turn_num INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_data TEXT DEFAULT '{}',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS board_items (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      value INTEGER DEFAULT 1,
      is_collected INTEGER DEFAULT 0,
      collected_by TEXT,
      collected_at BIGINT,
      spawned_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS jury_votes (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      turn_num INTEGER NOT NULL,
      voter_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      vote_type TEXT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      FOREIGN KEY (game_id) REFERENCES games(id),
      UNIQUE(game_id, turn_num, voter_id, vote_type)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS game_log (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      turn_num INTEGER DEFAULT 0,
      log_type TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  // Performance indexes
  await query('CREATE INDEX IF NOT EXISTS idx_gp_game_id ON game_players(game_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_bi_game_id ON board_items(game_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_gl_game_id ON game_log(game_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_jv_game_id ON jury_votes(game_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_gp_bot ON game_players(game_id, is_bot, is_downed)');

  console.log('[db] PostgreSQL schema ready');
}

module.exports = { query, pool, init };

