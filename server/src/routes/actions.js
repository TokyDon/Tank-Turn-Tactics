const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { takeAction, takePrimaryAction, takeSecondaryAction, submitJuryVote, getGameState, endTurn } = require('../game/logic');
const { broadcastGameUpdate } = require('../game/scheduler');
const { query } = require('../db');

const router = express.Router();

// Admin username can be overridden via env var
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'james';

router.post('/:id/action', authMiddleware, async (req, res) => {
  const { primaryAction, secondaryAction } = req.body;
  try {
    const state = await takeAction(req.params.id, req.userId, primaryAction, secondaryAction);
    broadcastGameUpdate(req.params.id);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/primary-action', authMiddleware, async (req, res) => {
  const { primaryAction } = req.body;
  try {
    const state = await takePrimaryAction(req.params.id, req.userId, primaryAction);
    broadcastGameUpdate(req.params.id);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/secondary-action', authMiddleware, async (req, res) => {
  const { secondaryAction } = req.body;
  try {
    const state = await takeSecondaryAction(req.params.id, req.userId, secondaryAction);
    broadcastGameUpdate(req.params.id);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/vote', authMiddleware, async (req, res) => {
  const { targetUserId, voteType } = req.body;
  try {
    await submitJuryVote(req.params.id, req.userId, targetUserId, voteType);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/admin/force-turn', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query('SELECT username FROM users WHERE id=$1', [req.userId]);
    const user = rows[0];
    if (!user || user.username !== ADMIN_USERNAME) return res.status(403).json({ error: 'Forbidden' });
    await query(
      'UPDATE game_players SET has_taken_turn=1 WHERE game_id=$1 AND is_downed=0 AND has_taken_turn=0',
      [req.params.id]
    );
    await endTurn(req.params.id);
    broadcastGameUpdate(req.params.id);
    const state = await getGameState(req.params.id, req.userId);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

