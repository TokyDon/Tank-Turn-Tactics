const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');
const { getGameState } = require('./game/logic');

function initSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try {
      // Explicitly whitelist algorithm — prevents alg:none and RS256 confusion attacks
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      socket.userId = payload.userId;
      socket.username = payload.username;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[socket] ${socket.username} connected`);

    // Each user joins their personal room so DMs can be delivered in real time
    socket.join(`user:${socket.userId}`);

    socket.on('join-game', (gameId) => {
      socket.join(`game:${gameId}`);
      const state = getGameState(gameId, socket.userId);
      if (state) socket.emit('game-state', state);
    });

    socket.on('leave-game', (gameId) => {
      socket.leave(`game:${gameId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[socket] ${socket.username} disconnected`);
    });
  });
}

module.exports = { initSocket };
