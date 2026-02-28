const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { getAvailableBotUser, scheduleBotTurns } = require('./botAI');

const PLAYER_COLORS = [
  '#d4860a', '#cf2020', '#22c55e', '#3b82f6',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
  '#eab308', '#06b6d4', '#8b5cf6', '#f43f5e',
  '#10b981', '#6366f1', '#84cc16', '#0ea5e9'
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function chebyshev(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function inRange(player, tx, ty) {
  return chebyshev(player.x, player.y, tx, ty) <= player.range_val;
}

async function isOccupied(gameId, x, y, excludeUserId = null) {
  if (excludeUserId) {
    const { rows } = await query(
      'SELECT 1 FROM game_players WHERE game_id=$1 AND x=$2 AND y=$3 AND is_downed=0 AND user_id!=$4',
      [gameId, x, y, excludeUserId]
    );
    return rows.length > 0;
  }
  const { rows } = await query(
    'SELECT 1 FROM game_players WHERE game_id=$1 AND x=$2 AND y=$3 AND is_downed=0',
    [gameId, x, y]
  );
  return rows.length > 0;
}

async function randomEmptyCell(gameId, gridSize) {
  const { rows: occupied } = await query(
    'SELECT x,y FROM game_players WHERE game_id=$1 AND is_downed=0', [gameId]
  );
  const { rows: items } = await query(
    'SELECT x,y FROM board_items WHERE game_id=$1 AND is_collected=0', [gameId]
  );
  const taken = new Set([...occupied, ...items].map(p => `${p.x},${p.y}`));

  let attempts = 0;
  while (attempts < 200) {
    const x = Math.floor(Math.random() * gridSize);
    const y = Math.floor(Math.random() * gridSize);
    if (!taken.has(`${x},${y}`)) return { x, y };
    attempts++;
  }
  return null;
}

async function addLog(gameId, turnNum, logType, message, data = {}) {
  await query(
    'INSERT INTO game_log (id, game_id, turn_num, log_type, message, data) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), gameId, turnNum, logType, message, JSON.stringify(data)]
  );
}

// ─── Game Creation ──────────────────────────────────────────────────────────

async function createGame(name, createdBy, options = {}) {
  const id = uuidv4();
  const gridSize = options.gridSize || 16;
  const maxPlayers = options.maxPlayers || 16;
  const shrinkEnabled = options.shrinkEnabled ? 1 : 0;
  const passwordHash = options.password ? await bcrypt.hash(options.password, 10) : null;

  await query(
    `INSERT INTO games (id, name, grid_size, active_grid_size, max_players, shrink_enabled, created_by, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, name, gridSize, gridSize, maxPlayers, shrinkEnabled, createdBy, passwordHash]
  );

  await addLog(id, 0, 'system', `Game "${name}" created`);

  const { rows } = await query('SELECT username FROM users WHERE id=$1', [createdBy]);
  const user = rows[0];
  const playerId = uuidv4();
  await query(
    'INSERT INTO game_players (id, game_id, user_id, username, color) VALUES ($1,$2,$3,$4,$5)',
    [playerId, id, createdBy, user.username, PLAYER_COLORS[0]]
  );
  await addLog(id, 0, 'join', `${user.username} created and joined the game`);

  return getGameState(id, createdBy);
}

async function joinGame(gameId, userId, password) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.status !== 'lobby') throw new Error('Game already started');

  const { rows: existing } = await query(
    'SELECT 1 FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, userId]
  );
  if (existing[0]) throw new Error('Already in this game');

  if (game.password_hash) {
    if (!password) throw new Error('PASSWORD_REQUIRED');
    if (!bcrypt.compareSync(password, game.password_hash)) throw new Error('Incorrect password');
  }

  const { rows: countRows } = await query(
    'SELECT COUNT(*) as c FROM game_players WHERE game_id=$1', [gameId]
  );
  const count = parseInt(countRows[0].c, 10);
  if (count >= game.max_players) throw new Error('Game is full');

  const { rows: uRows } = await query('SELECT username FROM users WHERE id=$1', [userId]);
  const user = uRows[0];
  const color = PLAYER_COLORS[count % PLAYER_COLORS.length];
  const playerId = uuidv4();

  await query(
    'INSERT INTO game_players (id, game_id, user_id, username, color) VALUES ($1,$2,$3,$4,$5)',
    [playerId, gameId, userId, user.username, color]
  );
  await addLog(gameId, game.current_turn, 'join', `${user.username} joined the game`);
  return getGameState(gameId, userId);
}

async function startGame(gameId, userId) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.created_by !== userId) throw new Error('Only the host can start the game');
  if (game.status !== 'lobby') throw new Error('Game already started');

  const { rows: players } = await query('SELECT * FROM game_players WHERE game_id=$1', [gameId]);
  if (players.length < 2) throw new Error('Need at least 2 players');

  const positions = new Set();
  for (const player of players) {
    let x, y, key;
    do {
      x = Math.floor(Math.random() * game.grid_size);
      y = Math.floor(Math.random() * game.grid_size);
      key = `${x},${y}`;
    } while (positions.has(key));
    positions.add(key);
    await query('UPDATE game_players SET x=$1, y=$2 WHERE id=$3', [x, y, player.id]);
  }

  await query(
    "UPDATE games SET status='active', current_turn=1, turn_started_at=$1 WHERE id=$2",
    [Math.floor(Date.now() / 1000), gameId]
  );

  await scheduleBotTurns(gameId);
  await addLog(gameId, 1, 'system', 'Battle commenced. All units deploy to the field.');
  return getGameState(gameId, userId);
}

// ─── Actions ────────────────────────────────────────────────────────────────

// ─── Primary Action (phase 1 of turn) ───────────────────────────────────────

async function takePrimaryAction(gameId, userId, primaryAction) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const { rows: pRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
  const player = pRows[0];
  if (!player) throw new Error('Not in this game');
  if (player.is_downed) throw new Error('You are downed — you cannot take actions');
  if (player.has_taken_primary) throw new Error('You already submitted your primary action this turn');

  const logs = [];
  const pa = primaryAction || { type: 'idle' };
  let apCost = 0;

  if (pa.type === 'move') {
    const { x, y } = pa;
    if (chebyshev(player.x, player.y, x, y) !== 1) throw new Error('Can only move to adjacent square');
    if (await isOccupied(gameId, x, y, userId)) throw new Error('Square is occupied');
    if (x < 0 || y < 0 || x >= game.active_grid_size || y >= game.active_grid_size)
      throw new Error('Out of bounds');
    apCost = 1;
    await query('UPDATE game_players SET x=$1, y=$2 WHERE game_id=$3 AND user_id=$4', [x, y, gameId, userId]);
    logs.push({ type: 'action', msg: `${player.username} moved to [${x},${y}]` });
    await collectItems(gameId, userId, player, x, y, logs);

  } else if (pa.type === 'attack') {
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, pa.targetUserId]);
    const target = tRows[0];
    if (!target) throw new Error('Target not found');
    if (target.is_downed) throw new Error('Target is already downed');
    if (!inRange(player, target.x, target.y)) throw new Error('Target not in range');
    apCost = 1;

    const newHearts = (target.hearts - 1);
    if (newHearts <= 0 && target.extra_hearts <= 0) {
      const targetTotalAp = target.ap;
      await query('UPDATE game_players SET hearts=0, extra_hearts=0, is_downed=1, ap=0 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      await query('UPDATE game_players SET ap=ap+$1 WHERE game_id=$2 AND user_id=$3', [targetTotalAp, gameId, userId]);
      logs.push({ type: 'attack', msg: `${player.username} eliminated ${target.username}! (+${targetTotalAp} AP)`, target: target.username });
    } else if (newHearts <= 0 && target.extra_hearts > 0) {
      await query('UPDATE game_players SET hearts=3, extra_hearts=extra_hearts-1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      logs.push({ type: 'attack', msg: `${player.username} attacked ${target.username} (−1 ♥)`, target: target.username });
    } else {
      await query('UPDATE game_players SET hearts=$1 WHERE game_id=$2 AND user_id=$3', [newHearts, gameId, target.user_id]);
      logs.push({ type: 'attack', msg: `${player.username} attacked ${target.username} (−1 ♥)`, target: target.username });
    }

  } else if (pa.type === 'addHeart') {
    apCost = 3;
    if (player.ap < 3) throw new Error('Need 3 AP');
    if (player.hearts >= 3) {
      await query('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    } else {
      await query('UPDATE game_players SET hearts=hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    }
    logs.push({ type: 'action', msg: `${player.username} reinforced their armor (+1 ♥)` });

  } else if (pa.type === 'upgradeRange') {
    apCost = 3;
    if (player.ap < 3) throw new Error('Need 3 AP');
    await query('UPDATE game_players SET range_val=range_val+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    logs.push({ type: 'action', msg: `${player.username} upgraded targeting range` });

  } else if (pa.type === 'idle') {
    apCost = 0;
    logs.push({ type: 'action', msg: `${player.username} held position` });
  } else {
    throw new Error('Invalid action type');
  }

  if (player.ap < apCost) throw new Error(`Need ${apCost} AP`);
  await query('UPDATE game_players SET ap=ap-$1 WHERE game_id=$2 AND user_id=$3', [apCost, gameId, userId]);
  await query('UPDATE game_players SET has_taken_primary=1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);

  for (const l of logs) {
    await addLog(gameId, game.current_turn, l.type, l.msg, l);
  }

  await query(
    'INSERT INTO turn_actions (id, game_id, turn_num, player_id, action_type, action_data) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), gameId, game.current_turn, player.id, pa.type, JSON.stringify({ pa })]
  );

  return getGameState(gameId, userId);
}

// ─── Secondary Action (phase 2 of turn — optional) ──────────────────────────

async function takeSecondaryAction(gameId, userId, secondaryAction) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const { rows: pRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
  const player = pRows[0];
  if (!player) throw new Error('Not in this game');
  if (player.is_downed) throw new Error('You are downed — you cannot take actions');
  if (player.has_taken_turn) throw new Error('You already completed your turn');

  const logs = [];
  const sa = secondaryAction || { type: 'idle' };

  if (sa.type === 'giveHeart') {
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, sa.targetUserId]);
    const target = tRows[0];
    if (!target) throw new Error('Target not found');
    if (!inRange(player, target.x, target.y)) throw new Error('Target not in range');

    if (target.is_downed) {
      if (!target.can_revive) throw new Error('This commander cannot be revived');
      await query('UPDATE game_players SET is_downed=0, hearts=1, ap=1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      logs.push({ type: 'revive', msg: `${player.username} revived ${target.username} from the dead!`, target: target.username });
    } else {
      if (player.hearts <= 0) throw new Error('No hearts to give');
      const fromNew = player.hearts - 1;
      await query('UPDATE game_players SET hearts=$1 WHERE game_id=$2 AND user_id=$3', [fromNew < 0 ? 0 : fromNew, gameId, userId]);
      if (target.hearts >= 3) {
        await query('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      } else {
        await query('UPDATE game_players SET hearts=hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      }
      logs.push({ type: 'gift', msg: `${player.username} gave a ♥ to ${target.username}`, target: target.username });
    }

  } else if (sa.type === 'giveAP') {
    const amount = Math.min(3, Math.max(1, sa.amount || 1));
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, sa.targetUserId]);
    const target = tRows[0];
    if (!target) throw new Error('Target not found');
    if (!inRange(player, target.x, target.y)) throw new Error('Target not in range');
    if (player.ap < amount) throw new Error(`Need ${amount} AP to give`);

    await query('UPDATE game_players SET ap=ap-$1 WHERE game_id=$2 AND user_id=$3', [amount, gameId, userId]);
    await query('UPDATE game_players SET ap=ap+$1 WHERE game_id=$2 AND user_id=$3', [amount, gameId, target.user_id]);
    logs.push({ type: 'gift', msg: `${player.username} transferred ${amount} AP to ${target.username}`, target: target.username });
  }
  // sa.type === 'idle': no action, just end the turn

  await query('UPDATE game_players SET has_taken_turn=1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);

  for (const l of logs) {
    await addLog(gameId, game.current_turn, l.type, l.msg, l);
  }

  const { rows: acRows } = await query('SELECT COUNT(*) as c FROM game_players WHERE game_id=$1 AND is_downed=0', [gameId]);
  const activePlayers = parseInt(acRows[0].c, 10);
  const { rows: ttRows } = await query('SELECT COUNT(*) as c FROM game_players WHERE game_id=$1 AND is_downed=0 AND has_taken_turn=1', [gameId]);
  const turnsTaken = parseInt(ttRows[0].c, 10);
  if (turnsTaken >= activePlayers) {
    await endTurn(gameId);
  }

  return getGameState(gameId, userId);
}

// ─── Combined action (used by bots — processes both phases atomically) ───────

async function takeAction(gameId, userId, primaryAction, secondaryAction) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const { rows: pRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
  const player = pRows[0];
  if (!player) throw new Error('Not in this game');
  if (player.is_downed) throw new Error('You are downed — you cannot take actions');
  if (player.has_taken_turn) throw new Error('You already acted this turn');

  const logs = [];

  // ── Primary ──
  const pa = primaryAction || { type: 'idle' };
  let apCost = 0;

  if (pa.type === 'move') {
    const { x, y } = pa;
    if (chebyshev(player.x, player.y, x, y) !== 1) throw new Error('Can only move to adjacent square');
    if (await isOccupied(gameId, x, y, userId)) throw new Error('Square is occupied');
    if (x < 0 || y < 0 || x >= game.active_grid_size || y >= game.active_grid_size)
      throw new Error('Out of bounds');
    apCost = 1;
    await query('UPDATE game_players SET x=$1, y=$2 WHERE game_id=$3 AND user_id=$4', [x, y, gameId, userId]);
    logs.push({ type: 'action', msg: `${player.username} moved to [${x},${y}]` });
    await collectItems(gameId, userId, player, x, y, logs);

  } else if (pa.type === 'attack') {
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, pa.targetUserId]);
    const target = tRows[0];
    if (!target) throw new Error('Target not found');
    if (target.is_downed) throw new Error('Target is already downed');
    if (!inRange(player, target.x, target.y)) throw new Error('Target not in range');
    apCost = 1;

    const newHearts = (target.hearts - 1);
    if (newHearts <= 0 && target.extra_hearts <= 0) {
      const targetTotalAp = target.ap;
      await query('UPDATE game_players SET hearts=0, extra_hearts=0, is_downed=1, ap=0 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      await query('UPDATE game_players SET ap=ap+$1 WHERE game_id=$2 AND user_id=$3', [targetTotalAp, gameId, userId]);
      logs.push({ type: 'attack', msg: `${player.username} eliminated ${target.username}! (+${targetTotalAp} AP)`, target: target.username });
    } else if (newHearts <= 0 && target.extra_hearts > 0) {
      await query('UPDATE game_players SET hearts=3, extra_hearts=extra_hearts-1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      logs.push({ type: 'attack', msg: `${player.username} attacked ${target.username} (−1 ♥)`, target: target.username });
    } else {
      await query('UPDATE game_players SET hearts=$1 WHERE game_id=$2 AND user_id=$3', [newHearts, gameId, target.user_id]);
      logs.push({ type: 'attack', msg: `${player.username} attacked ${target.username} (−1 ♥)`, target: target.username });
    }

  } else if (pa.type === 'addHeart') {
    apCost = 3;
    if (player.ap < 3) throw new Error('Need 3 AP');
    if (player.hearts >= 3) {
      await query('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    } else {
      await query('UPDATE game_players SET hearts=hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    }
    logs.push({ type: 'action', msg: `${player.username} reinforced their armor (+1 ♥)` });

  } else if (pa.type === 'upgradeRange') {
    apCost = 3;
    if (player.ap < 3) throw new Error('Need 3 AP');
    await query('UPDATE game_players SET range_val=range_val+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    logs.push({ type: 'action', msg: `${player.username} upgraded targeting range` });

  } else if (pa.type === 'idle') {
    apCost = 0;
    logs.push({ type: 'action', msg: `${player.username} held position` });
  } else {
    throw new Error('Invalid action type');
  }

  if (player.ap < apCost) throw new Error(`Need ${apCost} AP`);
  await query('UPDATE game_players SET ap=ap-$1 WHERE game_id=$2 AND user_id=$3', [apCost, gameId, userId]);

  // ── Secondary ──
  const sa = secondaryAction || { type: 'idle' };
  const { rows: fpRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
  const freshPlayer = fpRows[0];

  if (sa.type === 'giveHeart') {
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, sa.targetUserId]);
    const target = tRows[0];
    if (!target) throw new Error('Target not found');
    if (!inRange(freshPlayer, target.x, target.y)) throw new Error('Target not in range');

    if (target.is_downed) {
      if (!target.can_revive) throw new Error('This commander cannot be revived');
      await query('UPDATE game_players SET is_downed=0, hearts=1, ap=1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      logs.push({ type: 'revive', msg: `${player.username} revived ${target.username} from the dead!`, target: target.username });
    } else {
      if (freshPlayer.hearts <= 0) throw new Error('No hearts to give');
      const fromNew = freshPlayer.hearts - 1;
      await query('UPDATE game_players SET hearts=$1 WHERE game_id=$2 AND user_id=$3', [fromNew < 0 ? 0 : fromNew, gameId, userId]);
      if (target.hearts >= 3) {
        await query('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      } else {
        await query('UPDATE game_players SET hearts=hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, target.user_id]);
      }
      logs.push({ type: 'gift', msg: `${player.username} gave a ♥ to ${target.username}`, target: target.username });
    }

  } else if (sa.type === 'giveAP') {
    const amount = Math.min(3, Math.max(1, sa.amount || 1));
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, sa.targetUserId]);
    const target = tRows[0];
    if (!target) throw new Error('Target not found');
    if (!inRange(freshPlayer, target.x, target.y)) throw new Error('Target not in range');
    if (freshPlayer.ap < amount) throw new Error(`Need ${amount} AP to give`);

    await query('UPDATE game_players SET ap=ap-$1 WHERE game_id=$2 AND user_id=$3', [amount, gameId, userId]);
    await query('UPDATE game_players SET ap=ap+$1 WHERE game_id=$2 AND user_id=$3', [amount, gameId, target.user_id]);
    logs.push({ type: 'gift', msg: `${player.username} transferred ${amount} AP to ${target.username}`, target: target.username });
  }

  // Mark full turn complete (both phases)
  await query('UPDATE game_players SET has_taken_primary=1, has_taken_turn=1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);

  for (const l of logs) {
    await addLog(gameId, game.current_turn, l.type, l.msg, l);
  }

  await query(
    'INSERT INTO turn_actions (id, game_id, turn_num, player_id, action_type, action_data) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), gameId, game.current_turn, player.id, pa.type, JSON.stringify({ pa, sa })]
  );

  const { rows: acRows } = await query('SELECT COUNT(*) as c FROM game_players WHERE game_id=$1 AND is_downed=0', [gameId]);
  const activePlayers = parseInt(acRows[0].c, 10);
  const { rows: ttRows } = await query('SELECT COUNT(*) as c FROM game_players WHERE game_id=$1 AND is_downed=0 AND has_taken_turn=1', [gameId]);
  const turnsTaken = parseInt(ttRows[0].c, 10);
  if (turnsTaken >= activePlayers) {
    await endTurn(gameId);
  }

  return getGameState(gameId, userId);
}
  if (turnsTaken >= activePlayers) {
    endTurn(gameId);
  }

  return getGameState(gameId, userId);
}

// ─── Collect items when moving ───────────────────────────────────────────────

async function collectItems(gameId, userId, player, x, y, logs) {
  const { rows: iRows } = await query(
    'SELECT * FROM board_items WHERE game_id=$1 AND x=$2 AND y=$3 AND is_collected=0',
    [gameId, x, y]
  );
  const item = iRows[0];
  if (!item) return;

  await query('UPDATE board_items SET is_collected=1, collected_by=$1, collected_at=$2 WHERE id=$3',
    [userId, Math.floor(Date.now() / 1000), item.id]);

  if (item.item_type === 'heart') {
    const { rows: pRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    const p = pRows[0];
    if (p.hearts >= 3) {
      await query('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    } else {
      await query('UPDATE game_players SET hearts=hearts+1 WHERE game_id=$1 AND user_id=$2', [gameId, userId]);
    }
    logs.push({ type: 'loot', msg: `${player.username} picked up a field heart (+1 ♥)` });
  } else if (item.item_type === 'loot') {
    await query('UPDATE game_players SET ap=ap+$1 WHERE game_id=$2 AND user_id=$3', [item.value, gameId, userId]);
    logs.push({ type: 'loot', msg: `${player.username} secured a supply drop (+${item.value} AP)` });
  }
}

// ─── End Turn ────────────────────────────────────────────────────────────────

async function endTurn(gameId) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game || game.status !== 'active') return;

  // Auto-complete turns for players who submitted primary but ran out of time for secondary (no penalty)
  await query(
    'UPDATE game_players SET has_taken_turn=1 WHERE game_id=$1 AND is_downed=0 AND has_taken_primary=1 AND has_taken_turn=0',
    [gameId]
  );

  // Penalise players who submitted no primary at all
  const { rows: inactive } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND is_downed=0 AND has_taken_turn=0',
    [gameId]
  );

  for (const p of inactive) {
    const newHearts = p.hearts - 1;
    if (newHearts <= 0 && p.extra_hearts <= 0) {
      // Downed by inactivity — scatter their AP
      const ap = p.ap;
      await query('UPDATE game_players SET hearts=0, is_downed=1, ap=0 WHERE game_id=$1 AND user_id=$2', [gameId, p.user_id]);
      if (ap > 0) {
        const pos = await randomEmptyCell(gameId, game.active_grid_size);
        if (pos) {
          await query(
            'INSERT INTO board_items (id, game_id, item_type, x, y, value) VALUES ($1,$2,$3,$4,$5,$6)',
            [uuidv4(), gameId, 'loot', pos.x, pos.y, ap]
          );
        }
      }
      await addLog(gameId, game.current_turn, 'system', `${p.username} was eliminated for missing their turn`);
    } else if (newHearts <= 0 && p.extra_hearts > 0) {
      await query('UPDATE game_players SET hearts=3, extra_hearts=extra_hearts-1 WHERE game_id=$1 AND user_id=$2', [gameId, p.user_id]);
      await addLog(gameId, game.current_turn, 'system', `${p.username} missed their turn (−1 ♥)`);
    } else {
      await query('UPDATE game_players SET hearts=$1 WHERE game_id=$2 AND user_id=$3', [newHearts, gameId, p.user_id]);
      await addLog(gameId, game.current_turn, 'system', `${p.username} missed their turn (−1 ♥)`);
    }
  }

  // Process jury votes for this turn
  await processJuryVotes(gameId, game.current_turn);

  // Grid shrink check
  if (game.shrink_enabled) {
    const newTurnsSince = game.turns_since_shrink + 1;
    if (newTurnsSince >= 3) {
      await shrinkGrid(gameId, game);
      await query('UPDATE games SET turns_since_shrink=0 WHERE id=$1', [gameId]);
    } else {
      await query('UPDATE games SET turns_since_shrink=$1 WHERE id=$2', [newTurnsSince, gameId]);
    }
  }

  const newTurn = game.current_turn + 1;
  await query(
    'UPDATE games SET current_turn=$1, turn_started_at=$2 WHERE id=$3',
    [newTurn, Math.floor(Date.now() / 1000), gameId]
  );

  // Reset turn flags (both phases)
  await query('UPDATE game_players SET has_taken_turn=0, has_taken_primary=0, is_haunted=0 WHERE game_id=$1 AND is_downed=0', [gameId]);

  await addLog(gameId, newTurn, 'system', `Turn ${newTurn} begins`);

  // Schedule new timing for any bot players
  await scheduleBotTurns(gameId);

  // Check game end conditions
  await checkGameEnd(gameId);
}

// ─── Jury Votes ──────────────────────────────────────────────────────────────

async function submitJuryVote(gameId, voterId, targetId, voteType) {
  const VALID_VOTE_TYPES = ['haunting', 'intercession'];
  if (!VALID_VOTE_TYPES.includes(voteType)) throw new Error('Invalid vote type');

  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game || game.status !== 'active') throw new Error('Game not active');

  const { rows: vRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, voterId]);
  const voter = vRows[0];
  if (!voter) throw new Error('Not in this game');
  if (!voter.is_downed) throw new Error('Only downed players can vote');

  const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, targetId]);
  const target = tRows[0];
  if (!target) throw new Error('Target not found');

  // Upsert vote (one vote per voter per type per turn)
  const { rows: eRows } = await query(
    'SELECT id FROM jury_votes WHERE game_id=$1 AND turn_num=$2 AND voter_id=$3 AND vote_type=$4',
    [gameId, game.current_turn, voterId, voteType]
  );
  const existing = eRows[0];

  if (existing) {
    await query('UPDATE jury_votes SET target_id=$1, created_at=$2 WHERE id=$3',
      [targetId, Math.floor(Date.now() / 1000), existing.id]);
  } else {
    await query(
      'INSERT INTO jury_votes (id, game_id, turn_num, voter_id, target_id, vote_type) VALUES ($1,$2,$3,$4,$5,$6)',
      [uuidv4(), gameId, game.current_turn, voterId, targetId, voteType]
    );
  }

  return { success: true };
}

async function processJuryVotes(gameId, turnNum) {
  // Haunting: most votes = haunted next turn
  const { rows: hauntRows } = await query(
    `SELECT target_id, COUNT(*) as votes FROM jury_votes 
     WHERE game_id=$1 AND turn_num=$2 AND vote_type='haunting'
     GROUP BY target_id ORDER BY votes DESC LIMIT 1`,
    [gameId, turnNum]
  );
  const hauntVotes = hauntRows[0];

  if (hauntVotes && hauntVotes.votes > 0) {
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, hauntVotes.target_id]);
    const target = tRows[0];
    if (target) {
      await query('UPDATE game_players SET is_haunted=1 WHERE game_id=$1 AND user_id=$2', [gameId, hauntVotes.target_id]);
      await addLog(gameId, turnNum, 'jury', `The jury haunts ${target.username} — no AP this cycle`);
    }
  }

  // Intercession: any player with 3+ votes gets 3 AP
  const { rows: intercession } = await query(
    `SELECT target_id, COUNT(*) as votes FROM jury_votes
     WHERE game_id=$1 AND turn_num=$2 AND vote_type='intercession'
     GROUP BY target_id HAVING COUNT(*) >= 3`,
    [gameId, turnNum]
  );

  for (const iv of intercession) {
    const { rows: tRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND user_id=$2', [gameId, iv.target_id]);
    const target = tRows[0];
    if (target && !target.is_downed) {
      await query('UPDATE game_players SET ap=ap+3 WHERE game_id=$1 AND user_id=$2', [gameId, iv.target_id]);
      await addLog(gameId, turnNum, 'jury', `The jury intercedes for ${target.username} (+3 AP)`);
    }
  }
}

// ─── Daily AP ────────────────────────────────────────────────────────────────

async function giveWeekdayAP(gameId) {
  const { rows: gRows } = await query("SELECT * FROM games WHERE id=$1 AND status='active'", [gameId]);
  const game = gRows[0];
  if (!game) return;

  const { rows: players } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND is_downed=0 AND is_haunted=0',
    [gameId]
  );

  for (const p of players) {
    await query('UPDATE game_players SET ap=ap+1 WHERE game_id=$1 AND user_id=$2', [gameId, p.user_id]);
  }

  await addLog(gameId, game.current_turn, 'system', 'Daily AP distributed to all active units');
  return players.length;
}

async function giveWeekdayAPToAll() {
  const { rows: activeGames } = await query("SELECT id FROM games WHERE status='active'");
  for (const g of activeGames) await giveWeekdayAP(g.id);
}

// ─── Spawns ──────────────────────────────────────────────────────────────────

async function spawnItem(gameId, itemType, value = 1) {
  const { rows: gRows } = await query("SELECT * FROM games WHERE id=$1 AND status='active'", [gameId]);
  const game = gRows[0];
  if (!game) return null;

  const pos = await randomEmptyCell(gameId, game.active_grid_size);
  if (!pos) return null;

  const id = uuidv4();
  await query(
    'INSERT INTO board_items (id, game_id, item_type, x, y, value) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, gameId, itemType, pos.x, pos.y, value]
  );

  const label = itemType === 'heart' ? '♥ field heart' : `supply drop (${value} AP)`;
  await addLog(gameId, game.current_turn, 'spawn', `A ${label} appeared at [${pos.x},${pos.y}]`);
  return { id, x: pos.x, y: pos.y, item_type: itemType, value };
}

async function spawnDailyItemsForAll() {
  const { rows: games } = await query("SELECT id FROM games WHERE status='active'");
  for (const g of games) {
    await spawnItem(g.id, 'heart', 1);
    if (Math.random() < 0.5) await spawnItem(g.id, 'loot', 3);
  }
}

// ─── Grid Shrink ─────────────────────────────────────────────────────────────

async function shrinkGrid(gameId, game) {
  const newSize = game.active_grid_size - 1;
  if (newSize < 4) return;

  await query('UPDATE games SET active_grid_size=$1 WHERE id=$2', [newSize, gameId]);

  // Down players out of bounds
  const { rows: outPlayers } = await query(
    'SELECT * FROM game_players WHERE game_id=$1 AND (x >= $2 OR y >= $3) AND is_downed=0',
    [gameId, newSize, newSize]
  );

  for (const p of outPlayers) {
    const ap = p.ap;
    await query('UPDATE game_players SET is_downed=1, can_revive=0, ap=0, hearts=0 WHERE game_id=$1 AND user_id=$2', [gameId, p.user_id]);
    if (ap > 0) {
      const pos = await randomEmptyCell(gameId, newSize);
      if (pos) {
        await query('INSERT INTO board_items (id, game_id, item_type, x, y, value) VALUES ($1,$2,$3,$4,$5,$6)',
          [uuidv4(), gameId, 'loot', pos.x, pos.y, ap]);
      }
    }
    await addLog(gameId, game.current_turn, 'shrink', `${p.username} was consumed by the shrinking grid!`);
  }

  // Downed players out of bounds lose revive
  await query(
    'UPDATE game_players SET can_revive=0 WHERE game_id=$1 AND (x >= $2 OR y >= $3) AND is_downed=1',
    [gameId, newSize, newSize]
  );

  await addLog(gameId, game.current_turn, 'shrink', `The grid shrinks to ${newSize}×${newSize}`);
}

// ─── Game End ─────────────────────────────────────────────────────────────────

async function checkGameEnd(gameId) {
  const { rows } = await query(
    'SELECT COUNT(*) as c FROM game_players WHERE game_id=$1 AND is_downed=0',
    [gameId]
  );
  const active = parseInt(rows[0].c, 10);

  if (active <= 1) {
    await query("UPDATE games SET status='ended' WHERE id=$1", [gameId]);
    const { rows: wRows } = await query('SELECT * FROM game_players WHERE game_id=$1 AND is_downed=0', [gameId]);
    const winner = wRows[0];
    if (winner) await addLog(gameId, 0, 'end', `${winner.username} is the last commander standing. Victory!`);
    else await addLog(gameId, 0, 'end', 'All commanders down. Draw.');
  }
}

async function checkExpiredTurns() {
  const TURN_DURATION_SECONDS = 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const { rows: expired } = await query(
    `SELECT * FROM games WHERE status='active' AND turn_started_at IS NOT NULL AND $1 - turn_started_at >= $2`,
    [now, TURN_DURATION_SECONDS]
  );

  for (const game of expired) await endTurn(game.id);
}

// ─── Game State ───────────────────────────────────────────────────────────────

async function getGameState(gameId, requestingUserId) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) return null;

  const { rows: allPlayers } = await query('SELECT * FROM game_players WHERE game_id=$1 ORDER BY joined_at', [gameId]);
  const { rows: items } = await query('SELECT * FROM board_items WHERE game_id=$1 AND is_collected=0', [gameId]);
  const { rows: logs } = await query(
    'SELECT * FROM game_log WHERE game_id=$1 ORDER BY created_at DESC LIMIT 50',
    [gameId]
  );

  // Sanitize player data — hide AP from others, cap hearts at 3 for display
  const players = allPlayers.map(p => {
    const isMe = p.user_id === requestingUserId;
    return {
      userId: p.user_id,
      username: p.username,
      x: p.x,
      y: p.y,
      hearts: isMe ? p.hearts : Math.min(p.hearts, 3),
      extraHearts: isMe ? p.extra_hearts : null, // hidden
      ap: isMe ? p.ap : null, // secret
      range: p.range_val,
      isDowned: !!p.is_downed,
      canRevive: !!p.can_revive,
      hasTakenPrimary: !!p.has_taken_primary,
      hasTakenTurn: !!p.has_taken_turn,
      isHaunted: isMe ? !!p.is_haunted : false,
      color: p.color,
      isMe,
      isBot: !!p.is_bot,
      botDifficulty: p.bot_difficulty || null,
    };
  });

  // My jury votes this turn (if downed)
  const me = allPlayers.find(p => p.user_id === requestingUserId);
  let myVotes = null;
  if (me?.is_downed) {
    const { rows: voteRows } = await query(
      'SELECT vote_type, target_id FROM jury_votes WHERE game_id=$1 AND turn_num=$2 AND voter_id=$3',
      [gameId, game.current_turn, requestingUserId]
    );
    myVotes = voteRows;
  }

  return {
    id: game.id,
    name: game.name,
    status: game.status,
    gridSize: game.grid_size,
    activeGridSize: game.active_grid_size,
    currentTurn: game.current_turn,
    turnStartedAt: game.turn_started_at,
    shrinkEnabled: !!game.shrink_enabled,
    isPasswordProtected: !!game.password_hash,
    players,
    items: items.map(i => ({ id: i.id, type: i.item_type, x: i.x, y: i.y, value: i.value })),
    logs: logs.map(l => ({ type: l.log_type, message: l.message, turn: l.turn_num, at: l.created_at })),
    myVotes
  };
}

async function getPublicGames() {
  const { rows: games } = await query(
    `SELECT g.*, u.username as host_name,
     (SELECT COUNT(*) FROM game_players gp WHERE gp.game_id=g.id) as player_count
     FROM games g JOIN users u ON g.created_by=u.id
     WHERE g.status IN ('lobby','active')
     ORDER BY g.created_at DESC LIMIT 20`
  );
  return games.map(g => ({ ...g, has_password: !!g.password_hash, password_hash: undefined }));
}

// ─── Delete Game ────────────────────────────────────────────────────────────

async function deleteGame(gameId, userId) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.created_by !== userId) throw new Error('Only the host can delete this operation');

  // Cascade delete all related data
  await query('DELETE FROM jury_votes WHERE game_id=$1', [gameId]);
  await query('DELETE FROM turn_actions WHERE game_id=$1', [gameId]);
  await query('DELETE FROM board_items WHERE game_id=$1', [gameId]);
  await query('DELETE FROM game_log WHERE game_id=$1', [gameId]);
  await query('DELETE FROM game_players WHERE game_id=$1', [gameId]);
  await query('DELETE FROM games WHERE id=$1', [gameId]);

  return { deleted: true };
}

// ─── Add Bot to Lobby ────────────────────────────────────────────────────────

async function addBot(gameId, hostUserId, difficulty) {
  const { rows: gRows } = await query('SELECT * FROM games WHERE id=$1', [gameId]);
  const game = gRows[0];
  if (!game) throw new Error('Game not found');
  if (game.status !== 'lobby') throw new Error('Game already started');
  if (game.created_by !== hostUserId) throw new Error('Only the host can add bots');

  const valid = ['private', 'major', 'general'];
  if (!valid.includes(difficulty)) throw new Error('Invalid difficulty');

  const { rows: countRows } = await query('SELECT COUNT(*) as c FROM game_players WHERE game_id=$1', [gameId]);
  const count = parseInt(countRows[0].c, 10);
  if (count >= game.max_players) throw new Error('Game is full');

  const botUser = await getAvailableBotUser(gameId, difficulty);
  if (!botUser) throw new Error('No available bots for this difficulty');

  const color = PLAYER_COLORS[count % PLAYER_COLORS.length];
  const playerId = uuidv4();

  await query(
    `INSERT INTO game_players (id, game_id, user_id, username, color, is_bot, bot_difficulty)
     VALUES ($1,$2,$3,$4,$5,1,$6)`,
    [playerId, gameId, botUser.id, botUser.username, color, difficulty]
  );

  const diffLabel = { private: 'PRIVATE', major: 'MAJOR', general: 'GENERAL' }[difficulty];
  await addLog(gameId, 0, 'join', `[${diffLabel}] ${botUser.username} enlisted as bot`);

  return getGameState(gameId, hostUserId);
}

module.exports = {
  createGame, joinGame, startGame, addBot, deleteGame,
  takeAction, takePrimaryAction, takeSecondaryAction,
  submitJuryVote,
  giveWeekdayAP, giveWeekdayAPToAll, spawnItem, spawnDailyItemsForAll,
  endTurn, checkExpiredTurns, getGameState, getPublicGames
};
