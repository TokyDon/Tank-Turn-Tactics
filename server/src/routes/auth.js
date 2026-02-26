const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');

const router = express.Router();

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
function getUsernameSuggestions(base) {
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
    const taken = db.prepare('SELECT id FROM users WHERE username=?').get(c);
    if (!taken) suggestions.push(c);
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

// ─── Register ──────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ error: 'Username must be 2–20 characters' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[a-zA-Z0-9_\-]+$/.test(username))
    return res.status(400).json({ error: 'Username can only contain letters, numbers, _ and -' });

  try {
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (existing) {
      const suggestions = getUsernameSuggestions(username);
      return res.status(409).json({ error: 'Callsign already in use', suggestions });
    }

    // Hash all 8 recovery codes — plaintext returned once to client, never stored
    const plainCodes = generateRecoveryCodes();
    const hashedCodes = await Promise.all(plainCodes.map(c => bcrypt.hash(c, 10)));

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, recovery_codes) VALUES (?,?,?,?)'
    ).run(id, username, hash, JSON.stringify(hashedCodes));

    const token = jwt.sign({ userId: id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, username }, recoveryCodes: plainCodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Login ─────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Account recovery ──────────────────────────────────────────────────────
// Validates username + one-time recovery code, resets password, burns the code.

router.post('/recover', async (req, res) => {
  const { username, code, newPassword } = req.body;
  if (!username || !code || !newPassword)
    return res.status(400).json({ error: 'Username, recovery code and new password required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  // Small intentional delay — deters brute-force against code space
  await new Promise(r => setTimeout(r, 400));

  try {
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user || !user.recovery_codes)
      return res.status(401).json({ error: 'Invalid callsign or code' });

    const stored = JSON.parse(user.recovery_codes);
    const normalised = code.toUpperCase().replace(/\s/g, '');

    let matchIdx = -1;
    for (let i = 0; i < stored.length; i++) {
      if (!stored[i]) continue; // already burned
      if (await bcrypt.compare(normalised, stored[i])) { matchIdx = i; break; }
    }

    if (matchIdx === -1)
      return res.status(401).json({ error: 'Invalid or already-used recovery code' });

    // Burn the used code, update password
    stored[matchIdx] = null;
    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash=?, recovery_codes=? WHERE id=?')
      .run(newHash, JSON.stringify(stored), user.id);

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

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, email_verified, created_at FROM users WHERE id=?'
  ).get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
