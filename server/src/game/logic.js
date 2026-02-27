const { v4: uuidv4 } = require('uuid');
const db = require('../db');
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

function isOccupied(gameId, x, y, excludeUserId = null) {
  let q = db.prepare(
    'SELECT 1 FROM game_players WHERE game_id=? AND x=? AND y=? AND is_downed=0'
  );
  if (excludeUserId) {
    q = db.prepare(
      'SELECT 1 FROM game_players WHERE game_id=? AND x=? AND y=? AND is_downed=0 AND user_id!=?'
    );
    return !!q.get(gameId, x, y, excludeUserId);
  }
  return !!q.get(gameId, x, y);
}

function randomEmptyCell(gameId, gridSize) {
  const occupied = db.prepare(
    'SELECT x,y FROM game_players WHERE game_id=? AND is_downed=0'
  ).all(gameId);
  const items = db.prepare(
    'SELECT x,y FROM board_items WHERE game_id=? AND is_collected=0'
  ).all(gameId);
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

function addLog(gameId, turnNum, logType, message, data = {}) {
  db.prepare(
    'INSERT INTO game_log (id, game_id, turn_num, log_type, message, data) VALUES (?,?,?,?,?,?)'
  ).run(uuidv4(), gameId, turnNum, logType, message, JSON.stringify(data));
}

// ─── Game Creation ──────────────────────────────────────────────────────────

function createGame(name, createdBy, options = {}) {
  const id = uuidv4();
  const gridSize = options.gridSize || 16;
  const maxPlayers = options.maxPlayers || 16;
  const shrinkEnabled = options.shrinkEnabled ? 1 : 0;

  db.prepare(
    `INSERT INTO games (id, name, grid_size, active_grid_size, max_players, shrink_enabled, created_by)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, name, gridSize, gridSize, maxPlayers, shrinkEnabled, createdBy);

  addLog(id, 0, 'system', `Game "${name}" created`);

  // Auto-join the creator as first player (host)
  const user = db.prepare('SELECT username FROM users WHERE id=?').get(createdBy);
  const playerId = uuidv4();
  db.prepare(
    `INSERT INTO game_players (id, game_id, user_id, username, color) VALUES (?,?,?,?,?)`
  ).run(playerId, id, createdBy, user.username, PLAYER_COLORS[0]);
  addLog(id, 0, 'join', `${user.username} created and joined the game`);

  return getGameState(id, createdBy);
}

function joinGame(gameId, userId) {
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'lobby') throw new Error('Game already started');

  const existing = db.prepare('SELECT 1 FROM game_players WHERE game_id=? AND user_id=?').get(gameId, userId);
  if (existing) throw new Error('Already in this game');

  const count = db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id=?').get(gameId).c;
  if (count >= game.max_players) throw new Error('Game is full');

  const user = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
  const color = PLAYER_COLORS[count % PLAYER_COLORS.length];
  const playerId = uuidv4();

  db.prepare(
    `INSERT INTO game_players (id, game_id, user_id, username, color)
     VALUES (?,?,?,?,?)`
  ).run(playerId, gameId, userId, user.username, color);

  addLog(gameId, game.current_turn, 'join', `${user.username} joined the game`);
  return getGameState(gameId, userId);
}

function startGame(gameId, userId) {
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) throw new Error('Game not found');
  if (game.created_by !== userId) throw new Error('Only the host can start the game');
  if (game.status !== 'lobby') throw new Error('Game already started');

  const players = db.prepare('SELECT * FROM game_players WHERE game_id=?').all(gameId);
  if (players.length < 2) throw new Error('Need at least 2 players');

  // Assign random starting positions
  const positions = new Set();
  const updatePos = db.prepare('UPDATE game_players SET x=?, y=? WHERE id=?');

  for (const player of players) {
    let x, y, key;
    do {
      x = Math.floor(Math.random() * game.grid_size);
      y = Math.floor(Math.random() * game.grid_size);
      key = `${x},${y}`;
    } while (positions.has(key));
    positions.add(key);
    updatePos.run(x, y, player.id);
  }

  db.prepare(
    `UPDATE games SET status='active', current_turn=1, turn_started_at=? WHERE id=?`
  ).run(Math.floor(Date.now() / 1000), gameId);


  // Schedule initial bot turns
  scheduleBotTurns(gameId);

  addLog(gameId, 1, 'system', 'Battle commenced. All units deploy to the field.');
  return getGameState(gameId, userId);
}

// ─── Actions ────────────────────────────────────────────────────────────────

function takeAction(gameId, userId, primaryAction, secondaryAction) {
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'active') throw new Error('Game is not active');

  const player = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, userId);
  if (!player) throw new Error('Not in this game');
  if (player.is_downed) throw new Error('You are downed — you cannot take actions');
  if (player.has_taken_turn) throw new Error('You already acted this turn');

  const logs = [];

  // ── Primary Action ──
  const pa = primaryAction || { type: 'idle' };
  let apCost = 0;

  if (pa.type === 'move') {
    const { x, y } = pa;
    if (chebyshev(player.x, player.y, x, y) !== 1) throw new Error('Can only move to adjacent square');
    if (isOccupied(gameId, x, y, userId)) throw new Error('Square is occupied');
    if (x < 0 || y < 0 || x >= game.active_grid_size || y >= game.active_grid_size)
      throw new Error('Out of bounds');
    apCost = 1;
    db.prepare('UPDATE game_players SET x=?, y=? WHERE game_id=? AND user_id=?')
      .run(x, y, gameId, userId);
    logs.push({ type: 'action', msg: `${player.username} moved to [${x},${y}]` });

    // Check items at new position
    collectItems(gameId, userId, player, x, y, logs);

  } else if (pa.type === 'attack') {
    const target = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, pa.targetUserId);
    if (!target) throw new Error('Target not found');
    if (target.is_downed) throw new Error('Target is already downed');
    if (!inRange(player, target.x, target.y)) throw new Error('Target not in range');
    apCost = 1;

    const newHearts = (target.hearts - 1);
    if (newHearts <= 0 && target.extra_hearts <= 0) {
      // Downed
      const targetTotalAp = target.ap;
      db.prepare('UPDATE game_players SET hearts=0, extra_hearts=0, is_downed=1, ap=0 WHERE game_id=? AND user_id=?')
        .run(gameId, target.user_id);
      db.prepare('UPDATE game_players SET ap=ap+? WHERE game_id=? AND user_id=?')
        .run(targetTotalAp, gameId, userId);
      logs.push({ type: 'attack', msg: `${player.username} eliminated ${target.username}! (+${targetTotalAp} AP)`, target: target.username });
    } else if (newHearts <= 0 && target.extra_hearts > 0) {
      db.prepare('UPDATE game_players SET hearts=3, extra_hearts=extra_hearts-1 WHERE game_id=? AND user_id=?')
        .run(gameId, target.user_id);
      logs.push({ type: 'attack', msg: `${player.username} attacked ${target.username} (−1 ♥)`, target: target.username });
    } else {
      db.prepare('UPDATE game_players SET hearts=? WHERE game_id=? AND user_id=?')
        .run(newHearts, gameId, target.user_id);
      logs.push({ type: 'attack', msg: `${player.username} attacked ${target.username} (−1 ♥)`, target: target.username });
    }

  } else if (pa.type === 'addHeart') {
    apCost = 3;
    if (player.ap < 3) throw new Error('Need 3 AP');
    if (player.hearts >= 3) {
      db.prepare('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=? AND user_id=?').run(gameId, userId);
    } else {
      db.prepare('UPDATE game_players SET hearts=hearts+1 WHERE game_id=? AND user_id=?').run(gameId, userId);
    }
    logs.push({ type: 'action', msg: `${player.username} reinforced their armor (+1 ♥)` });

  } else if (pa.type === 'upgradeRange') {
    apCost = 3;
    if (player.ap < 3) throw new Error('Need 3 AP');
    db.prepare('UPDATE game_players SET range_val=range_val+1 WHERE game_id=? AND user_id=?').run(gameId, userId);
    logs.push({ type: 'action', msg: `${player.username} upgraded targeting range` });

  } else if (pa.type === 'idle') {
    apCost = 0;
    logs.push({ type: 'action', msg: `${player.username} held position` });
  } else {
    throw new Error('Invalid action type');
  }

  // Deduct AP for primary action
  if (player.ap < apCost) throw new Error(`Need ${apCost} AP`);
  db.prepare('UPDATE game_players SET ap=ap-? WHERE game_id=? AND user_id=?').run(apCost, gameId, userId);

  // ── Secondary Action ──
  const sa = secondaryAction || { type: 'idle' };
  const freshPlayer = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, userId);

  if (sa.type === 'giveHeart') {
    const target = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, sa.targetUserId);
    if (!target) throw new Error('Target not found');
    if (!inRange(freshPlayer, target.x, target.y)) throw new Error('Target not in range');

    if (target.is_downed) {
      // Revive!
      db.prepare('UPDATE game_players SET is_downed=0, hearts=1, ap=1, can_revive=1 WHERE game_id=? AND user_id=?')
        .run(gameId, target.user_id);
      logs.push({ type: 'revive', msg: `${player.username} revived ${target.username} from the dead!`, target: target.username });
    } else {
      if (freshPlayer.hearts <= 0) throw new Error('No hearts to give');
      const fromNew = freshPlayer.hearts - 1;
      db.prepare('UPDATE game_players SET hearts=? WHERE game_id=? AND user_id=?').run(fromNew < 0 ? 0 : fromNew, gameId, userId);
      if (target.hearts >= 3) {
        db.prepare('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=? AND user_id=?').run(gameId, target.user_id);
      } else {
        db.prepare('UPDATE game_players SET hearts=hearts+1 WHERE game_id=? AND user_id=?').run(gameId, target.user_id);
      }
      logs.push({ type: 'gift', msg: `${player.username} gave a ♥ to ${target.username}`, target: target.username });
    }

  } else if (sa.type === 'giveAP') {
    const amount = Math.min(3, Math.max(1, sa.amount || 1));
    const target = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, sa.targetUserId);
    if (!target) throw new Error('Target not found');
    if (!inRange(freshPlayer, target.x, target.y)) throw new Error('Target not in range');
    if (freshPlayer.ap < amount) throw new Error(`Need ${amount} AP to give`);

    db.prepare('UPDATE game_players SET ap=ap-? WHERE game_id=? AND user_id=?').run(amount, gameId, userId);
    db.prepare('UPDATE game_players SET ap=ap+? WHERE game_id=? AND user_id=?').run(amount, gameId, target.user_id);
    logs.push({ type: 'gift', msg: `${player.username} transferred ${amount} AP to ${target.username}`, target: target.username });
  }

  // Mark turn taken
  db.prepare('UPDATE game_players SET has_taken_turn=1 WHERE game_id=? AND user_id=?').run(gameId, userId);

  // Log actions
  for (const l of logs) {
    addLog(gameId, game.current_turn, l.type, l.msg, l);
  }

  // Record action
  db.prepare(
    'INSERT INTO turn_actions (id, game_id, turn_num, player_id, action_type, action_data) VALUES (?,?,?,?,?,?)'
  ).run(uuidv4(), gameId, game.current_turn, player.id, pa.type, JSON.stringify({ pa, sa }));

  // Check if all active players have taken their turn
  const activePlayers = db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id=? AND is_downed=0').get(gameId).c;
  const turnsTaken = db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id=? AND is_downed=0 AND has_taken_turn=1').get(gameId).c;
  if (turnsTaken >= activePlayers) {
    endTurn(gameId);
  }

  return getGameState(gameId, userId);
}

// ─── Collect items when moving ───────────────────────────────────────────────

function collectItems(gameId, userId, player, x, y, logs) {
  const item = db.prepare(
    'SELECT * FROM board_items WHERE game_id=? AND x=? AND y=? AND is_collected=0'
  ).get(gameId, x, y);

  if (!item) return;

  db.prepare('UPDATE board_items SET is_collected=1, collected_by=?, collected_at=? WHERE id=?')
    .run(userId, Math.floor(Date.now() / 1000), item.id);

  if (item.item_type === 'heart') {
    const p = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, userId);
    if (p.hearts >= 3) {
      db.prepare('UPDATE game_players SET extra_hearts=extra_hearts+1 WHERE game_id=? AND user_id=?').run(gameId, userId);
    } else {
      db.prepare('UPDATE game_players SET hearts=hearts+1 WHERE game_id=? AND user_id=?').run(gameId, userId);
    }
    logs.push({ type: 'loot', msg: `${player.username} picked up a field heart (+1 ♥)` });
  } else if (item.item_type === 'loot') {
    db.prepare('UPDATE game_players SET ap=ap+? WHERE game_id=? AND user_id=?').run(item.value, gameId, userId);
    logs.push({ type: 'loot', msg: `${player.username} secured a supply drop (+${item.value} AP)` });
  }
}

// ─── End Turn ────────────────────────────────────────────────────────────────

function endTurn(gameId) {
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game || game.status !== 'active') return;

  // Penalise players who didn't act
  const inactive = db.prepare(
    'SELECT * FROM game_players WHERE game_id=? AND is_downed=0 AND has_taken_turn=0'
  ).all(gameId);

  for (const p of inactive) {
    const newHearts = p.hearts - 1;
    if (newHearts <= 0 && p.extra_hearts <= 0) {
      // Downed by inactivity — scatter their AP
      const ap = p.ap;
      db.prepare('UPDATE game_players SET hearts=0, is_downed=1, ap=0 WHERE game_id=? AND user_id=?')
        .run(gameId, p.user_id);
      if (ap > 0) {
        const pos = randomEmptyCell(gameId, game.active_grid_size);
        if (pos) {
          db.prepare(
            'INSERT INTO board_items (id, game_id, item_type, x, y, value) VALUES (?,?,?,?,?,?)'
          ).run(uuidv4(), gameId, 'loot', pos.x, pos.y, ap);
        }
      }
      addLog(gameId, game.current_turn, 'system', `${p.username} was eliminated for missing their turn`);
    } else if (newHearts <= 0 && p.extra_hearts > 0) {
      db.prepare('UPDATE game_players SET hearts=3, extra_hearts=extra_hearts-1 WHERE game_id=? AND user_id=?')
        .run(gameId, p.user_id);
      addLog(gameId, game.current_turn, 'system', `${p.username} missed their turn (−1 ♥)`);
    } else {
      db.prepare('UPDATE game_players SET hearts=? WHERE game_id=? AND user_id=?')
        .run(newHearts, gameId, p.user_id);
      addLog(gameId, game.current_turn, 'system', `${p.username} missed their turn (−1 ♥)`);
    }
  }

  // Process jury votes for this turn
  processJuryVotes(gameId, game.current_turn);

  // Grid shrink check
  if (game.shrink_enabled) {
    const newTurnsSince = game.turns_since_shrink + 1;
    if (newTurnsSince >= 3) {
      shrinkGrid(gameId, game);
      db.prepare('UPDATE games SET turns_since_shrink=0 WHERE id=?').run(gameId);
    } else {
      db.prepare('UPDATE games SET turns_since_shrink=? WHERE id=?').run(newTurnsSince, gameId);
    }
  }

  const newTurn = game.current_turn + 1;
  db.prepare(
    'UPDATE games SET current_turn=?, turn_started_at=? WHERE id=?'
  ).run(newTurn, Math.floor(Date.now() / 1000), gameId);

  // Reset turn flags
  db.prepare('UPDATE game_players SET has_taken_turn=0, is_haunted=0 WHERE game_id=? AND is_downed=0').run(gameId);

  addLog(gameId, newTurn, 'system', `Turn ${newTurn} begins`);

  // Schedule new timing for any bot players
  scheduleBotTurns(gameId);

  // Check game end conditions
  checkGameEnd(gameId);
}

// ─── Jury Votes ──────────────────────────────────────────────────────────────

function submitJuryVote(gameId, voterId, targetId, voteType) {
  const VALID_VOTE_TYPES = ['haunting', 'intercession'];
  if (!VALID_VOTE_TYPES.includes(voteType)) throw new Error('Invalid vote type');

  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game || game.status !== 'active') throw new Error('Game not active');

  const voter = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, voterId);
  if (!voter) throw new Error('Not in this game');
  if (!voter.is_downed) throw new Error('Only downed players can vote');

  const target = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, targetId);
  if (!target) throw new Error('Target not found');
  if (voteType === 'intercession' && target.is_downed) {
    // Can vote for anyone for intercession? Rules say "any player" - I'll allow downed too
  }

  // Upsert vote (one vote per voter per type per turn)
  const existing = db.prepare(
    'SELECT id FROM jury_votes WHERE game_id=? AND turn_num=? AND voter_id=? AND vote_type=?'
  ).get(gameId, game.current_turn, voterId, voteType);

  if (existing) {
    db.prepare('UPDATE jury_votes SET target_id=?, created_at=? WHERE id=?')
      .run(targetId, Math.floor(Date.now() / 1000), existing.id);
  } else {
    db.prepare(
      'INSERT INTO jury_votes (id, game_id, turn_num, voter_id, target_id, vote_type) VALUES (?,?,?,?,?,?)'
    ).run(uuidv4(), gameId, game.current_turn, voterId, targetId, voteType);
  }

  return { success: true };
}

function processJuryVotes(gameId, turnNum) {
  // Haunting: most votes = haunted next turn
  const hauntVotes = db.prepare(
    `SELECT target_id, COUNT(*) as votes FROM jury_votes 
     WHERE game_id=? AND turn_num=? AND vote_type='haunting'
     GROUP BY target_id ORDER BY votes DESC LIMIT 1`
  ).get(gameId, turnNum);

  if (hauntVotes && hauntVotes.votes > 0) {
    const target = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, hauntVotes.target_id);
    if (target) {
      db.prepare('UPDATE game_players SET is_haunted=1 WHERE game_id=? AND user_id=?')
        .run(gameId, hauntVotes.target_id);
      addLog(gameId, turnNum, 'jury', `The jury haunts ${target.username} — no AP this cycle`);
    }
  }

  // Intercession: any player with 3+ votes gets 3 AP
  const intercession = db.prepare(
    `SELECT target_id, COUNT(*) as votes FROM jury_votes
     WHERE game_id=? AND turn_num=? AND vote_type='intercession'
     GROUP BY target_id HAVING votes >= 3`
  ).all(gameId, turnNum);

  for (const iv of intercession) {
    const target = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, iv.target_id);
    if (target && !target.is_downed) {
      db.prepare('UPDATE game_players SET ap=ap+3 WHERE game_id=? AND user_id=?').run(gameId, iv.target_id);
      addLog(gameId, turnNum, 'jury', `The jury intercedes for ${target.username} (+3 AP)`);
    }
  }
}

// ─── Daily AP ────────────────────────────────────────────────────────────────

function giveWeekdayAP(gameId) {
  const game = db.prepare('SELECT * FROM games WHERE id=? AND status=\'active\'').get(gameId);
  if (!game) return;

  const players = db.prepare(
    'SELECT * FROM game_players WHERE game_id=? AND is_downed=0 AND is_haunted=0'
  ).all(gameId);

  for (const p of players) {
    db.prepare('UPDATE game_players SET ap=ap+1 WHERE game_id=? AND user_id=?')
      .run(gameId, p.user_id);
  }

  addLog(gameId, game.current_turn, 'system', 'Daily AP distributed to all active units');
  return players.length;
}

function giveWeekdayAPToAll() {
  const activeGames = db.prepare('SELECT id FROM games WHERE status=\'active\'').all();
  for (const g of activeGames) giveWeekdayAP(g.id);
}

// ─── Spawns ──────────────────────────────────────────────────────────────────

function spawnItem(gameId, itemType, value = 1) {
  const game = db.prepare('SELECT * FROM games WHERE id=? AND status=\'active\'').get(gameId);
  if (!game) return null;

  const pos = randomEmptyCell(gameId, game.active_grid_size);
  if (!pos) return null;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO board_items (id, game_id, item_type, x, y, value) VALUES (?,?,?,?,?,?)'
  ).run(id, gameId, itemType, pos.x, pos.y, value);

  const label = itemType === 'heart' ? '♥ field heart' : `supply drop (${value} AP)`;
  addLog(gameId, game.current_turn, 'spawn', `A ${label} appeared at [${pos.x},${pos.y}]`);
  return { id, x: pos.x, y: pos.y, item_type: itemType, value };
}

function spawnDailyItemsForAll() {
  const games = db.prepare('SELECT id FROM games WHERE status=\'active\'').all();
  for (const g of games) {
    spawnItem(g.id, 'heart', 1);
    if (Math.random() < 0.5) spawnItem(g.id, 'loot', 3);
  }
}

// ─── Grid Shrink ─────────────────────────────────────────────────────────────

function shrinkGrid(gameId, game) {
  const newSize = game.active_grid_size - 1;
  if (newSize < 4) return;

  db.prepare('UPDATE games SET active_grid_size=? WHERE id=?').run(newSize, gameId);

  // Down players out of bounds
  const outPlayers = db.prepare(
    'SELECT * FROM game_players WHERE game_id=? AND (x >= ? OR y >= ?) AND is_downed=0'
  ).all(gameId, newSize, newSize);

  for (const p of outPlayers) {
    const ap = p.ap;
    db.prepare('UPDATE game_players SET is_downed=1, can_revive=0, ap=0, hearts=0 WHERE game_id=? AND user_id=?')
      .run(gameId, p.user_id);
    if (ap > 0) {
      const pos = randomEmptyCell(gameId, newSize);
      if (pos) {
        db.prepare('INSERT INTO board_items (id, game_id, item_type, x, y, value) VALUES (?,?,?,?,?,?)')
          .run(uuidv4(), gameId, 'loot', pos.x, pos.y, ap);
      }
    }
    addLog(gameId, game.current_turn, 'shrink', `${p.username} was consumed by the shrinking grid!`);
  }

  // Downed players out of bounds lose revive
  db.prepare(
    'UPDATE game_players SET can_revive=0 WHERE game_id=? AND (x >= ? OR y >= ?) AND is_downed=1'
  ).run(gameId, newSize, newSize);

  addLog(gameId, game.current_turn, 'shrink', `The grid shrinks to ${newSize}×${newSize}`);
}

// ─── Game End ─────────────────────────────────────────────────────────────────

function checkGameEnd(gameId) {
  const active = db.prepare(
    'SELECT COUNT(*) as c FROM game_players WHERE game_id=? AND is_downed=0'
  ).get(gameId).c;

  if (active <= 1) {
    db.prepare('UPDATE games SET status=\'ended\' WHERE id=?').run(gameId);
    const winner = db.prepare('SELECT * FROM game_players WHERE game_id=? AND is_downed=0').get(gameId);
    if (winner) addLog(gameId, 0, 'end', `${winner.username} is the last commander standing. Victory!`);
    else addLog(gameId, 0, 'end', 'All commanders down. Draw.');
  }
}

function checkExpiredTurns() {
  const TURN_DURATION_SECONDS = 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const expired = db.prepare(
    `SELECT * FROM games WHERE status='active' AND turn_started_at IS NOT NULL AND ? - turn_started_at >= ?`
  ).all(now, TURN_DURATION_SECONDS);

  for (const game of expired) endTurn(game.id);
}

// ─── Game State ───────────────────────────────────────────────────────────────

function getGameState(gameId, requestingUserId) {
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) return null;

  const allPlayers = db.prepare('SELECT * FROM game_players WHERE game_id=? ORDER BY joined_at').all(gameId);
  const items = db.prepare('SELECT * FROM board_items WHERE game_id=? AND is_collected=0').all(gameId);
  const logs = db.prepare(
    'SELECT * FROM game_log WHERE game_id=? ORDER BY created_at DESC LIMIT 50'
  ).all(gameId);

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
    myVotes = db.prepare(
      'SELECT vote_type, target_id FROM jury_votes WHERE game_id=? AND turn_num=? AND voter_id=?'
    ).all(gameId, game.current_turn, requestingUserId);
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
    players,
    items: items.map(i => ({ id: i.id, type: i.item_type, x: i.x, y: i.y, value: i.value })),
    logs: logs.map(l => ({ type: l.log_type, message: l.message, turn: l.turn_num, at: l.created_at })),
    myVotes
  };
}

function getPublicGames() {
  const games = db.prepare(
    `SELECT g.*, u.username as host_name,
     (SELECT COUNT(*) FROM game_players gp WHERE gp.game_id=g.id) as player_count
     FROM games g JOIN users u ON g.created_by=u.id
     WHERE g.status IN ('lobby','active')
     ORDER BY g.created_at DESC LIMIT 20`
  ).all();
  return games;
}

// ─── Add Bot to Lobby ────────────────────────────────────────────────────────

function addBot(gameId, hostUserId, difficulty) {
  const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status !== 'lobby') throw new Error('Game already started');
  if (game.created_by !== hostUserId) throw new Error('Only the host can add bots');

  const valid = ['private', 'major', 'general'];
  if (!valid.includes(difficulty)) throw new Error('Invalid difficulty');

  const count = db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id=?').get(gameId).c;
  if (count >= game.max_players) throw new Error('Game is full');

  const botUser = getAvailableBotUser(gameId, difficulty);
  if (!botUser) throw new Error('No available bots for this difficulty');

  const color = PLAYER_COLORS[count % PLAYER_COLORS.length];
  const playerId = uuidv4();

  db.prepare(
    `INSERT INTO game_players (id, game_id, user_id, username, color, is_bot, bot_difficulty)
     VALUES (?,?,?,?,?,1,?)`
  ).run(playerId, gameId, botUser.id, botUser.username, color, difficulty);

  const diffLabel = { private: 'PRIVATE', major: 'MAJOR', general: 'GENERAL' }[difficulty];
  addLog(gameId, 0, 'join', `[${diffLabel}] ${botUser.username} enlisted as bot`);

  return getGameState(gameId, hostUserId);
}

module.exports = {
  createGame, joinGame, startGame, addBot, takeAction, submitJuryVote,
  giveWeekdayAP, giveWeekdayAPToAll, spawnItem, spawnDailyItemsForAll,
  endTurn, checkExpiredTurns, getGameState, getPublicGames
};
