const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { createGame, joinGame, startGame, addBot, deleteGame, getGameState, getPublicGames } = require('../game/logic');
const { query } = require('../db');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const games = await getPublicGames();
    res.json({ games });
  } catch (err) {
    console.error('[games list error]', err);
    res.status(500).json({ error: 'Failed to load games' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { name, shrinkEnabled, password } = req.body;
  if (!name || name.trim().length < 1) return res.status(400).json({ error: 'Game name required' });
  if (name.trim().length > 60) return res.status(400).json({ error: 'Game name too long (max 60 chars)' });
  if (password && password.length > 64) return res.status(400).json({ error: 'Password too long' });

  const gridSize   = Math.min(20, Math.max(6,  parseInt(req.body.gridSize,  10) || 16));
  const maxPlayers = Math.min(20, Math.max(2,  parseInt(req.body.maxPlayers, 10) || 16));

  try {
    const game = await createGame(name.trim(), req.userId, { gridSize, maxPlayers, shrinkEnabled, password: password || null });
    res.json({ game });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const state = await getGameState(req.params.id, req.userId);
    if (!state) return res.status(404).json({ error: 'Game not found' });
    res.json({ game: state });
  } catch (err) {
    console.error('[game state error]', err);
    res.status(500).json({ error: 'Failed to load game' });
  }
});

router.post('/:id/join', authMiddleware, async (req, res) => {
  const { password } = req.body;
  try {
    const state = await joinGame(req.params.id, req.userId, password || null);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await deleteGame(req.params.id, req.userId);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/start', authMiddleware, async (req, res) => {
  try {
    const state = await startGame(req.params.id, req.userId);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/bots', authMiddleware, async (req, res) => {
  const { difficulty } = req.body;
  if (!difficulty) return res.status(400).json({ error: 'difficulty required (private / major / general)' });
  try {
    const state = await addBot(req.params.id, req.userId, difficulty);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /:id/settings — host can edit grid size and shrink toggle while game is in lobby
router.patch('/:id/settings', authMiddleware, async (req, res) => {
  const { gridSize, shrinkEnabled } = req.body;
  if (gridSize === undefined && shrinkEnabled === undefined) {
    return res.status(400).json({ error: 'No settings provided' });
  }
  try {
    const gameResult = await query('SELECT * FROM games WHERE id = $1', [req.params.id]);
    if (!gameResult.rows.length) return res.status(404).json({ error: 'Game not found' });
    const game = gameResult.rows[0];
    if (game.created_by !== req.userId) return res.status(403).json({ error: 'Only the host can change settings' });
    if (game.status !== 'lobby') return res.status(400).json({ error: 'Settings can only be changed in the lobby' });

    const newGridSize = gridSize !== undefined
      ? Math.min(20, Math.max(6, parseInt(gridSize, 10) || game.grid_size))
      : game.grid_size;
    const newShrink = shrinkEnabled !== undefined ? !!shrinkEnabled : game.shrink_enabled;

    await query(
      'UPDATE games SET grid_size = $1, active_grid_size = $1, shrink_enabled = $2 WHERE id = $3',
      [newGridSize, newShrink, req.params.id]
    );

    const state = await getGameState(req.params.id, req.userId);
    res.json({ game: state });
  } catch (err) {
    console.error('[settings update error]', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
