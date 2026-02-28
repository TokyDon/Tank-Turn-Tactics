const cron = require('node-cron');
const { query } = require('../db');
const { giveWeekdayAPToAll, spawnDailyItemsForAll, checkExpiredTurns } = require('./logic');
const { processDueBotTurns, scheduleBotTurns } = require('./botAI');

let io = null;

function setIO(socketIO) { io = socketIO; }

function broadcastGameUpdate(gameId) {
  if (!io) return;
  io.to(`game:${gameId}`).emit('game-state-changed', { gameId });
}

function isWeekday() {
  const d = new Date().getDay();
  return d >= 1 && d <= 5;
}

function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

async function broadcastAllActive() {
  const { rows } = await query("SELECT id FROM games WHERE status='active'");
  for (const g of rows) broadcastGameUpdate(g.id);
}

function scheduleRandomDaily(fn, label) {
  cron.schedule('0 9 * * *', () => {
    const delay = randomDelay(0, 11 * 60 * 60 * 1000);
    setTimeout(async () => {
      console.log(`[scheduler] Running: ${label}`);
      await fn();
      await broadcastAllActive();
    }, delay);
  });
}

function init() {
  // Check for expired turns + execute due bot turns every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('[scheduler] Checking expired turns and bot turns...');
    await checkExpiredTurns();
    const count = await processDueBotTurns(io);
    if (count > 0) console.log(`[scheduler] Executed ${count} bot turn(s)`);
    await broadcastAllActive();
  });

  // Weekday AP — random time daily
  scheduleRandomDaily(async () => {
    if (isWeekday()) {
      console.log('[scheduler] Distributing weekday AP...');
      await giveWeekdayAPToAll();
      const { rows } = await query("SELECT id FROM games WHERE status='active'");
      for (const g of rows) await scheduleBotTurns(g.id);
    }
  }, 'Weekday AP');

  // Daily item spawns — random time
  scheduleRandomDaily(async () => {
    console.log('[scheduler] Spawning daily items...');
    await spawnDailyItemsForAll();
  }, 'Daily spawns');

  // Random loot drop — 2x daily at random times
  cron.schedule('0 */12 * * *', () => {
    const delay = randomDelay(0, 6 * 60 * 60 * 1000);
    setTimeout(async () => {
      const { spawnItem } = require('./logic');
      const { rows } = await query("SELECT id FROM games WHERE status='active'");
      for (const g of rows) {
        await spawnItem(g.id, 'loot', 3);
        broadcastGameUpdate(g.id);
      }
    }, delay);
  });

  console.log('[scheduler] Cron jobs initialised');
}

module.exports = { init, setIO, broadcastGameUpdate };
