const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const actionsRoutes = require('./routes/actions');
const messagesRoutes = require('./routes/messages');
const { initSocket } = require('./socket');
const scheduler = require('./game/scheduler');
const db = require('./db');

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: [CLIENT_URL, 'http://localhost:5173'], credentials: true }
});

app.use(cors({ origin: [CLIENT_URL, 'http://localhost:5173'], credentials: true }));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/games', actionsRoutes);
app.use('/api/messages', messagesRoutes);
app.set('io', io);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Serve static client in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

// Initialise DB, then start everything
db.init().then(async () => {
  // Socket.io
  initSocket(io);
  scheduler.setIO(io);
  scheduler.init();

  // Seed bot user accounts (idempotent — safe to run every boot)
  const { ensureBotUsers } = require('./game/botAI');
  await ensureBotUsers();

  server.listen(PORT, () => {
    console.log(`\n🎯 Tank Turn Tactics server running on http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('[startup] DB init failed:', err);
  process.exit(1);
});
