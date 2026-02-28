const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Rate limiters
const authLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });  // 20 per 15 min
const recoverLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });  // 10 per hour

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Generate 8 one-time recovery codes in XXXX-XXXX format */
function generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < 8; i++) {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
  }
  return codes;
}

/** Return up to 3 available username variants when the requested one is taken */
async function getUsernameSuggestions(base) {
  const suggestions = [];
  const candidates = [
    `${base}_${Math.floor(Math.random() * 90) + 10}`,
    `${base}${Math.floor(Math.random() * 900) + 100}`,
    `${base}_${Math.floor(Math.random() * 9000) + 1000}`,
    `${base}${Math.floor(Math.random() * 9) + 1}`,
  ];
  for (const c of candidates) {
    if (c.length > 20 || c.length < 2) continue;
    if (!/^[a-zA-Z0-9_\-]+$/.test(c)) continue;
    const { rows } = await query('SELECT id FROM users WHERE username=$1', [c]);
    if (!rows[0]) suggestions.push(c);
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

// ─── Register ──────────────────────────────────────────────────────────────

router.post('/register', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ error: 'Username must be 2–20 characters' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!/^[a-zA-Z0-9_\-]+$/.test(username))
    return res.status(400).json({ error: 'Username can only contain letters, numbers, _ and -' });

  try {
    const { rows: existing } = await query('SELECT id FROM users WHERE username=$1', [username]);
    if (existing[0]) {
      const suggestions = await getUsernameSuggestions(username);
      return res.status(409).json({ error: 'Callsign already in use', suggestions });
    }

    // Hash all 8 recovery codes — plaintext returned once to client, never stored
    const plainCodes = generateRecoveryCodes();
    const hashedCodes = await Promise.all(plainCodes.map(c => bcrypt.hash(c, 10)));

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await query(
      'INSERT INTO users (id, username, password_hash, recovery_codes) VALUES ($1,$2,$3,$4)',
      [id, username, hash, JSON.stringify(hashedCodes)]
    );

    const token = jwt.sign({ userId: id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, username }, recoveryCodes: plainCodes });
  } catch (err) {
    console.error('[register error]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Login ─────────────────────────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const { rows } = await query('SELECT * FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[login error]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Account recovery ──────────────────────────────────────────────────────

router.post('/recover', recoverLimiter, async (req, res) => {
  const { username, code, newPassword } = req.body;
  if (!username || !code || !newPassword)
    return res.status(400).json({ error: 'Username, recovery code and new password required' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  await new Promise(r => setTimeout(r, 400));

  try {
    const { rows } = await query('SELECT * FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user || !user.recovery_codes)
      return res.status(401).json({ error: 'Invalid callsign or code' });

    const stored = JSON.parse(user.recovery_codes);
    const normalised = code.toUpperCase().replace(/\s/g, '');

    let matchIdx = -1;
    for (let i = 0; i < stored.length; i++) {
      if (!stored[i]) continue;
      if (await bcrypt.compare(normalised, stored[i])) { matchIdx = i; break; }
    }

    if (matchIdx === -1)
      return res.status(401).json({ error: 'Invalid or already-used recovery code' });

    stored[matchIdx] = null;
    const newHash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE users SET password_hash=$1, recovery_codes=$2 WHERE id=$3',
      [newHash, JSON.stringify(stored), user.id]
    );

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Me ────────────────────────────────────────────────────────────────────

router.get('/me', authMiddleware, async (req, res) => {
  const { rows } = await query(
    'SELECT id, username, email, email_verified, created_at FROM users WHERE id=$1 AND is_bot=0',
    [req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
});

module.exports = router;

