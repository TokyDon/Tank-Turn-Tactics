const jwt = require('jsonwebtoken');

// Fail loudly at startup if JWT_SECRET is missing in production —
// never silently fall back to a known string.
const JWT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('JWT_SECRET env var must be set in production'); })()
    : 'ttt-dev-secret-change-in-prod'
);

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const token = header.slice(7);
  try {
    // Explicitly whitelist algorithm — prevents alg:none and RS256 confusion attacks
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
