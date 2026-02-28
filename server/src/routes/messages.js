const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { query } = require('../db');

const router = express.Router();

// POST /api/messages — send a message
router.post('/', authMiddleware, async (req, res) => {
  const { recipientId, content, gameId } = req.body;
  if (!recipientId) return res.status(400).json({ error: 'recipientId required' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
  if (content.trim().length > 500) return res.status(400).json({ error: 'Message too long (max 500 chars)' });
  if (recipientId === req.userId) return res.status(400).json({ error: 'Cannot message yourself' });

  try {
    // Verify recipient exists
    const recipientResult = await query('SELECT id, username FROM users WHERE id = $1', [recipientId]);
    if (!recipientResult.rows.length) return res.status(404).json({ error: 'Recipient not found' });

    const id = uuidv4();
    const now = Date.now();

    await query(
      `INSERT INTO messages (id, game_id, sender_id, sender_username, recipient_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, gameId || null, req.userId, req.username, recipientId, content.trim(), now]
    );

    const message = {
      id,
      gameId: gameId || null,
      senderId: req.userId,
      senderUsername: req.username,
      recipientId,
      content: content.trim(),
      createdAt: now,
      readAt: null,
    };

    // Emit real-time notification to recipient
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${recipientId}`).emit('new-message', message);
    }

    res.json({ message });
  } catch (err) {
    console.error('[messages send error]', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/messages/conversations — list all conversations with unread counts
router.get('/conversations', authMiddleware, async (req, res) => {
  const gameId = req.query.gameId || null;
  try {
    // Last message per conversation partner using DISTINCT ON
    const convoResult = await query(
      `SELECT DISTINCT ON (other_id)
         other_id,
         other_username,
         content AS last_message,
         created_at AS last_at
       FROM (
         SELECT
           CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id,
           CASE WHEN sender_id = $1 THEN (SELECT username FROM users WHERE id = recipient_id LIMIT 1)
                ELSE sender_username END AS other_username,
           content,
           created_at
         FROM messages
         WHERE (sender_id = $1 OR recipient_id = $1)
           AND ($2::text IS NULL OR game_id = $2)
       ) sub
       ORDER BY other_id, created_at DESC`,
      [req.userId, gameId]
    );

    // Unread counts per sender
    const unreadResult = await query(
      `SELECT sender_id, COUNT(*)::int AS unread_count
       FROM messages
       WHERE recipient_id = $1 AND read_at IS NULL
         AND ($2::text IS NULL OR game_id = $2)
       GROUP BY sender_id`,
      [req.userId, gameId]
    );

    const unreadMap = new Map(
      unreadResult.rows.map(r => [r.sender_id, Number(r.unread_count)])
    );

    const conversations = convoResult.rows
      .map(r => ({
        userId: r.other_id,
        username: r.other_username,
        lastMessage: r.last_message || '',
        lastAt: Number(r.last_at),
        unreadCount: unreadMap.get(r.other_id) ?? 0,
      }))
      .sort((a, b) => b.lastAt - a.lastAt);

    res.json({ conversations });
  } catch (err) {
    console.error('[conversations error]', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// GET /api/messages/thread/:userId — get message thread with a specific user
router.get('/thread/:userId', authMiddleware, async (req, res) => {
  const otherId = req.params.userId;
  const gameId = req.query.gameId || null;
  try {
    const result = await query(
      `SELECT id, game_id, sender_id, sender_username, recipient_id, content, created_at, read_at
       FROM messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         AND ($3::text IS NULL OR game_id = $3)
       ORDER BY created_at ASC
       LIMIT 200`,
      [req.userId, otherId, gameId]
    );

    const messages = result.rows.map(r => ({
      id: r.id,
      gameId: r.game_id,
      senderId: r.sender_id,
      senderUsername: r.sender_username,
      recipientId: r.recipient_id,
      content: r.content,
      createdAt: Number(r.created_at),
      readAt: r.read_at ? Number(r.read_at) : null,
    }));

    res.json({ messages });
  } catch (err) {
    console.error('[thread error]', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/messages/read/:userId — mark all messages from a user as read
router.post('/read/:userId', authMiddleware, async (req, res) => {
  const otherId = req.params.userId;
  const gameId = req.query.gameId || null;
  try {
    await query(
      `UPDATE messages SET read_at = $1
       WHERE sender_id = $2 AND recipient_id = $3 AND read_at IS NULL
         AND ($4::text IS NULL OR game_id = $4)`,
      [Date.now(), otherId, req.userId, gameId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[read error]', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// GET /api/messages/unread-count — total unread messages for current user
router.get('/unread-count', authMiddleware, async (req, res) => {
  const gameId = req.query.gameId || null;
  try {
    const result = await query(
      `SELECT COUNT(*) AS count FROM messages WHERE recipient_id = $1 AND read_at IS NULL
         AND ($2::text IS NULL OR game_id = $2)`,
      [req.userId, gameId]
    );
    res.json({ count: Number(result.rows[0].count) });
  } catch (err) {
    console.error('[unread count error]', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

module.exports = router;
