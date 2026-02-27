const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { takeAction, takePrimaryAction, takeSecondaryAction, submitJuryVote, getGameState, endTurn } = require('../game/logic');
const { broadcastGameUpdate } = require('../game/scheduler');
const db = require('../db');

const router = express.Router();

// Admin username can be overridden via env var
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'james';

router.post('/:id/action', authMiddleware, (req, res) => {
  const { primaryAction, secondaryAction } = req.body;
  try {
    const state = takeAction(req.params.id, req.userId, primaryAction, secondaryAction);
    broadcastGameUpdate(req.params.id);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Two-phase turn: submit primary action (phase 1)
router.post('/:id/primary-action', authMiddleware, (req, res) => {
  const { primaryAction } = req.body;
  try {
    const state = takePrimaryAction(req.params.id, req.userId, primaryAction);
    broadcastGameUpdate(req.params.id);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Two-phase turn: submit secondary action (phase 2) — also used to skip secondary
router.post('/:id/secondary-action', authMiddleware, (req, res) => {
  const { secondaryAction } = req.body;
  try {
    const state = takeSecondaryAction(req.params.id, req.userId, secondaryAction);
    broadcastGameUpdate(req.params.id);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/vote', authMiddleware, (req, res) => {
  const { targetUserId, voteType } = req.body;
  try {
    submitJuryVote(req.params.id, req.userId, targetUserId, voteType);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/admin/force-turn', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT username FROM users WHERE id=?').get(req.userId);
    if (!user || user.username !== ADMIN_USERNAME) return res.status(403).json({ error: 'Forbidden' });
    // Mark all un-acted alive players as having acted (no penalty)
    db.prepare(
      'UPDATE game_players SET has_taken_turn=1 WHERE game_id=? AND is_downed=0 AND has_taken_turn=0'
    ).run(req.params.id);
    endTurn(req.params.id);
    broadcastGameUpdate(req.params.id);
    const state = getGameState(req.params.id, req.userId);
    res.json({ game: state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
