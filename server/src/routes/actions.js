const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { takeAction, submitJuryVote, getGameState } = require('../game/logic');
const { broadcastGameUpdate } = require('../game/scheduler');

const router = express.Router();

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

router.post('/:id/vote', authMiddleware, (req, res) => {
  const { targetUserId, voteType } = req.body;
  try {
    submitJuryVote(req.params.id, req.userId, targetUserId, voteType);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
