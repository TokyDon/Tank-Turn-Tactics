/**
 * botAI.js — Tank Turn Tactics bot intelligence
 *
 * Three difficulty tiers, each with distinct personality, strategy and response timing.
 *
 *  PRIVATE  — Rank Amateur. Random behaviour, slow to act, never strategises.
 *             Acts 10–22h after turn/AP grant. Tests if the game even works.
 *
 *  MAJOR    — Battle-hardened. Targets weak enemies, repositions intelligently,
 *             occasionally upgrades. Acts 3–9h after turn/AP grant.
 *
 *  GENERAL  — Cold tactician. Executes kill shots, stockpiles range upgrades,
 *             survives at all costs, acts fast (0.5–2h). Hardest to beat.
 */

const { query } = require('../db');
const { v4: uuidv4 } = require('uuid');

// ─── Timing windows (seconds from turn start / AP grant) ─────────────────────
const TIMING = {
  private: { min: 10 * 3600, max: 22 * 3600 },   // 10–22 hours
  major:   { min:  3 * 3600, max:  9 * 3600 },   //  3–9  hours
  general: { min:      1800, max:  2 * 3600 },   //  0.5–2 hours
};

// ─── Bot name pool ────────────────────────────────────────────────────────────
const BOT_NAMES = {
  private: ['PVT·Alpha', 'PVT·Bravo', 'PVT·Charlie', 'PVT·Delta',
            'PVT·Echo',  'PVT·Foxtrot', 'PVT·Golf', 'PVT·Hotel'],
  major:   ['MAJ·India',  'MAJ·Juliet', 'MAJ·Kilo',  'MAJ·Lima',
            'MAJ·Mike',   'MAJ·November', 'MAJ·Oscar', 'MAJ·Papa'],
  general: ['GEN·Quebec', 'GEN·Romeo',  'GEN·Sierra', 'GEN·Tango',
            'GEN·Uniform','GEN·Victor', 'GEN·Whisky', 'GEN·Xray'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chebyshev(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function inRange(player, tx, ty) {
  return chebyshev(player.x, player.y, tx, ty) <= player.range_val;
}

async function isOccupied(gameId, x, y, excludeUserId) {
  const { rows } = excludeUserId
    ? await query('SELECT 1 FROM game_players WHERE game_id=$1 AND x=$2 AND y=$3 AND is_downed=0 AND user_id!=$4', [gameId, x, y, excludeUserId])
    : await query('SELECT 1 FROM game_players WHERE game_id=$1 AND x=$2 AND y=$3 AND is_downed=0', [gameId, x, y]);
  return rows.length > 0;
}

async function getAdjacentMoves(gameId, player, gridSize) {
  const moves = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = player.x + dx, ny = player.y + dy;
      if (nx >= 0 && ny >= 0 && nx < gridSize && ny < gridSize) {
        if (!await isOccupied(gameId, nx, ny, player.user_id)) {
          moves.push({ x: nx, y: ny });
        }
      }
    }
  }
  return moves;
}

async function getEnemiesInRange(gameId, player) {
  const { rows: players } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND is_downed=0 AND user_id!=$2',
    [gameId, player.user_id]
  );
  return players.filter(p => inRange(player, p.x, p.y));
}

async function getAllActivePlayers(gameId, excludeUserId) {
  const { rows } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND is_downed=0 AND user_id!=$2',
    [gameId, excludeUserId]
  );
  return rows;
}

/** Move one step toward a target position using adjacent movement */
async function moveToward(gameId, bot, tx, ty, gridSize) {
  const moves = await getAdjacentMoves(gameId, bot, gridSize);
  if (moves.length === 0) return null;
  // Pick the adjacent cell that minimises distance to target
  moves.sort((a, b) =>
    chebyshev(a.x, a.y, tx, ty) - chebyshev(b.x, b.y, tx, ty)
  );
  return moves[0];
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Difficulty: PRIVATE ─────────────────────────────────────────────────────
// Barely functional. Random movement, accidental attacks. Test-dummy tier.

async function privateStrategy(gameId, bot, game) {
  const enemies = await getEnemiesInRange(gameId, bot);
  const moves = await getAdjacentMoves(gameId, bot, game.active_grid_size);

  const roll = Math.random();

  let primary = { type: 'idle' };
  const secondary = { type: 'idle' };

  if (roll < 0.18 && enemies.length > 0 && bot.ap >= 1) {
    // Random attack
    const target = randomPick(enemies);
    primary = { type: 'attack', targetUserId: target.user_id };

  } else if (roll < 0.45 && moves.length > 0 && bot.ap >= 1) {
    // Wander aimlessly
    const dest = randomPick(moves);
    primary = { type: 'move', x: dest.x, y: dest.y };

  } else {
    // Hold position (does nothing)
    primary = { type: 'idle' };
  }

  return { primary, secondary };
}

// ─── Difficulty: MAJOR ───────────────────────────────────────────────────────
// Competent. Hunts weakest targets, repositions, sometimes upgrades.

async function majorStrategy(gameId, bot, game) {
  const enemies = await getEnemiesInRange(gameId, bot);
  const allEnemies = await getAllActivePlayers(gameId, bot.user_id);
  const moves = await getAdjacentMoves(gameId, bot, game.active_grid_size);

  let primary = { type: 'idle' };
  let secondary = { type: 'idle' };

  // Priority 1: Attack weakest enemy in range (if AP available)
  if (bot.ap >= 1 && enemies.length > 0) {
    const weakest = enemies.reduce((a, b) =>
      (a.hearts + a.extra_hearts) <= (b.hearts + b.extra_hearts) ? a : b
    );
    primary = { type: 'attack', targetUserId: weakest.user_id };

  // Priority 2: Upgrade range if affordable and useful (40% chance when possible)
  } else if (bot.ap >= 3 && bot.range_val < 3 && Math.random() < 0.40) {
    primary = { type: 'upgradeRange' };

  // Priority 3: Add heart if low health (< 2 hearts) and can afford
  } else if (bot.ap >= 3 && bot.hearts < 2 && bot.extra_hearts === 0) {
    primary = { type: 'addHeart' };

  // Priority 4: Move toward the nearest enemy
  } else if (bot.ap >= 1 && allEnemies.length > 0 && moves.length > 0) {
    const nearest = allEnemies.reduce((a, b) =>
      chebyshev(bot.x, bot.y, a.x, a.y) <= chebyshev(bot.x, bot.y, b.x, b.y) ? a : b
    );
    const dest = await moveToward(gameId, bot, nearest.x, nearest.y, game.active_grid_size);
    if (dest) primary = { type: 'move', x: dest.x, y: dest.y };

  } else {
    primary = { type: 'idle' };
  }

  // Secondary: 15% chance — give 1 AP to an allied bot within range if flush
  if (bot.ap >= 3 && Math.random() < 0.15) {
    const { rows: allies } = await query(
      'SELECT * FROM game_players WHERE game_id=$1 AND is_bot=1 AND is_downed=0 AND user_id!=$2',
      [gameId, bot.user_id]
    );
    const inRangeAlly = allies.find(a => inRange(bot, a.x, a.y));
    if (inRangeAlly) {
      secondary = { type: 'giveAP', targetUserId: inRangeAlly.user_id, amount: 1 };
    }
  }

  return { primary, secondary };
}

// ─── Difficulty: GENERAL ─────────────────────────────────────────────────────
// Elite commander. Executes kill shots, stockpiles range, survives, acts fast.

async function generalStrategy(gameId, bot, game) {
  const enemies = await getEnemiesInRange(gameId, bot);
  const allEnemies = await getAllActivePlayers(gameId, bot.user_id);
  const moves = await getAdjacentMoves(gameId, bot, game.active_grid_size);

  let primary = { type: 'idle' };
  let secondary = { type: 'idle' };

  // ── Priority 1: Kill shot — target with 1 heart and no extra hearts in range ──
  const killable = enemies.filter(e => e.hearts <= 1 && e.extra_hearts <= 0);
  if (bot.ap >= 1 && killable.length > 0) {
    // Pick the richest target (most AP) to loot their stash
    const richest = killable.reduce((a, b) => a.ap >= b.ap ? a : b);
    primary = { type: 'attack', targetUserId: richest.user_id };

  // ── Priority 2: Upgrade range — range is the most powerful stat ──
  } else if (bot.ap >= 3 && bot.range_val < 5) {
    primary = { type: 'upgradeRange' };

  // ── Priority 3: Attack weakest enemy in range ──
  } else if (bot.ap >= 1 && enemies.length > 0) {
    // Prefer weakest (closest to death) to maximise eliminations
    const weakest = enemies.reduce((a, b) =>
      (a.hearts + a.extra_hearts) <= (b.hearts + b.extra_hearts) ? a : b
    );
    primary = { type: 'attack', targetUserId: weakest.user_id };

  // ── Priority 4: Survival — add heart if on 1 HP ──
  } else if (bot.ap >= 3 && bot.hearts <= 1 && bot.extra_hearts === 0) {
    primary = { type: 'addHeart' };

  // ── Priority 5: Reposition toward highest-AP enemy (best loot) ──
  } else if (bot.ap >= 1 && allEnemies.length > 0 && moves.length > 0) {
    // Target the richest enemy (AP is secret from client but bots cheat slightly)
    const target = allEnemies.reduce((a, b) =>
      chebyshev(bot.x, bot.y, a.x, a.y) <= chebyshev(bot.x, bot.y, b.x, b.y) ? a : b
    );
    const dest = await moveToward(gameId, bot, target.x, target.y, game.active_grid_size);
    if (dest) primary = { type: 'move', x: dest.x, y: dest.y };
    else primary = { type: 'idle' };

  } else {
    primary = { type: 'idle' };
  }

  // ── Secondary: Give AP to struggling allied bots (cooperative play) ──
  if (bot.ap >= 4) {
    const { rows: allies } = await query(
      'SELECT * FROM game_players WHERE game_id=$1 AND is_bot=1 AND is_downed=0 AND user_id!=$2',
      [gameId, bot.user_id]
    );
    // Only help allies that are general-tier (team play among elites)
    const struggling = allies
      .filter(a => a.bot_difficulty === 'general' && a.ap <= 1 && inRange(bot, a.x, a.y));
    if (struggling.length > 0) {
      secondary = { type: 'giveAP', targetUserId: struggling[0].user_id, amount: 2 };
    }
  }

  return { primary, secondary };
}

// ─── Main: Execute a single bot's turn ───────────────────────────────────────

async function executeBotTurn(gameId, botUserId) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game || game.status !== 'active') return false;

  const { rows: bRows } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2',
    [gameId, botUserId]
  );
  const bot = bRows[0];

  if (!bot || bot.is_downed || bot.has_taken_turn) return false;

  let action;
  switch (bot.bot_difficulty) {
    case 'private': action = await privateStrategy(gameId, bot, game); break;
    case 'major':   action = await majorStrategy(gameId, bot, game);   break;
    case 'general': action = await generalStrategy(gameId, bot, game); break;
    default:        action = { primary: { type: 'idle' }, secondary: { type: 'idle' } };
  }

  // Import and call takeAction (handle circular dep by requiring here)
  const { takeAction } = require('./logic');
  try {
    await takeAction(gameId, botUserId, action.primary, action.secondary);
    return true;
  } catch (err) {
    // If the chosen action failed (e.g. target moved), fall back to idle
    console.warn(`[BOT] ${bot.username} action failed (${err.message}), falling back to idle`);
    try {
      await takeAction(gameId, botUserId, { type: 'idle' }, { type: 'idle' });
    } catch { /* best effort */ }
    return false;
  }
}

// ─── Schedule bot turn timing ─────────────────────────────────────────────────
// Called when a new turn starts or daily AP is granted.

async function scheduleBotTurns(gameId) {
  const now = Math.floor(Date.now() / 1000);
  const { rows: bots } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND is_bot=1 AND is_downed=0',
    [gameId]
  );

  for (const bot of bots) {
    const timing = TIMING[bot.bot_difficulty] || TIMING.private;
    const delay = timing.min + Math.floor(Math.random() * (timing.max - timing.min));
    await query(
      'UPDATE game_players SET bot_act_after=$1 WHERE game_id=$2 AND user_id=$3',
      [now + delay, gameId, bot.user_id]
    );
  }
}

// ─── Process all due bot turns (called by scheduler every 30 min) ─────────────

async function processDueBotTurns(io) {
  const now = Math.floor(Date.now() / 1000);

  const { rows: dueBots } = await query(`
    SELECT gp.*, g.id as game_id
    FROM game_players gp
    JOIN games g ON gp.game_id = g.id
    WHERE gp.is_bot=1
      AND gp.is_downed=0
      AND gp.has_taken_turn=0
      AND gp.bot_act_after IS NOT NULL
      AND gp.bot_act_after <= $1
      AND g.status='active'
  `, [now]);

  for (const bot of dueBots) {
    const executed = await executeBotTurn(bot.game_id, bot.user_id);
    if (executed && io) {
      io.to(`game:${bot.game_id}`).emit('game-state-changed', { gameId: bot.game_id });
    }
  }

  return dueBots.length;
}

// ─── Ensure bot users exist (seed once) ──────────────────────────────────────

async function ensureBotUsers() {
  const allNames = [
    ...BOT_NAMES.private.map(n => ({ name: n, diff: 'private' })),
    ...BOT_NAMES.major.map(n => ({ name: n, diff: 'major' })),
    ...BOT_NAMES.general.map(n => ({ name: n, diff: 'general' })),
  ];
  for (const { name, diff } of allNames) {
    const id = `bot-${diff}-${name.replace(/[^a-zA-Z]/g, '').toLowerCase()}`;
    await query(
      'INSERT INTO users (id, username, password_hash, is_bot, bot_difficulty) VALUES ($1,$2,$3,1,$4) ON CONFLICT DO NOTHING',
      [id, name, 'bot-no-login', diff]
    );
  }
}

// ─── Get an available bot user of a given difficulty ─────────────────────────

async function getAvailableBotUser(gameId, difficulty) {
  await ensureBotUsers();
  // Find a bot of this difficulty NOT already in this game
  const { rows } = await query(`
    SELECT u.* FROM users u
    WHERE u.is_bot=1 AND u.bot_difficulty=$1
      AND u.id NOT IN (
        SELECT user_id FROM game_players WHERE game_id=$2
      )
    ORDER BY RANDOM() LIMIT 1
  `, [difficulty, gameId]);
  return rows[0] || null;
}

module.exports = {
  executeBotTurn,
  scheduleBotTurns,
  processDueBotTurns,
  ensureBotUsers,
  getAvailableBotUser,
  TIMING,
  BOT_NAMES,
};
