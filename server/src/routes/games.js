const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { createGame, joinGame, startGame, addBot, deleteGame, getGameState, getPublicGames } = require('../game/logic');

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

module.exports = router;
