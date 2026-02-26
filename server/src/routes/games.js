const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { createGame, joinGame, startGame, addBot, getGameState, getPublicGames } = require('../game/logic');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const games = getPublicGames();
    res.json({ games });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authMiddleware, (req, res) => {
  const { name, gridSize, maxPlayers, shrinkEnabled } = req.body;
  if (!name || name.trim().length < 1) return res.status(400).json({ error: 'Game name required' });
  try {
    const game = createGame(name.trim(), req.userId, { gridSize, maxPlayers, shrinkEnabled });
    res.json({ game });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', authMiddleware, (req, res) => {
  try {
    const state = getGameState(req.params.id, req.userId);
    if (!state) return res.status(404).json({ error: 'Game not found' });
    res.json({ game: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/join', authMiddleware, (req, res) => {
  try {
    const state = joinGame(req.params.id, req.userId);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/start', authMiddleware, (req, res) => {
  try {
    const state = startGame(req.params.id, req.userId);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/bots', authMiddleware, (req, res) => {
  const { difficulty } = req.body;
  if (!difficulty) return res.status(400).json({ error: 'difficulty required (private / major / general)' });
  try {
    const state = addBot(req.params.id, req.userId, difficulty);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
