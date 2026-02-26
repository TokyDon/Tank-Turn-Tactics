const cron = require('node-cron');
const db = require('../db');
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

function scheduleRandomDaily(fn, label) {
  // Run once per day at a random time between 09:00 and 20:00
  cron.schedule('0 9 * * *', () => {
    const delay = randomDelay(0, 11 * 60 * 60 * 1000); // 0-11 hours
    setTimeout(() => {
      console.log(`[scheduler] Running: ${label}`);
      fn();
      // Broadcast to all active games
      const games = db.prepare('SELECT id FROM games WHERE status=\'active\'').all();
      for (const g of games) broadcastGameUpdate(g.id);
    }, delay);
  });
}

function init() {
  // Check for expired turns + execute due bot turns every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    console.log('[scheduler] Checking expired turns and bot turns...');
    checkExpiredTurns();
    const count = processDueBotTurns(io);
    if (count > 0) console.log(`[scheduler] Executed ${count} bot turn(s)`);
    const games = db.prepare('SELECT id FROM games WHERE status=\'active\'').all();
    for (const g of games) broadcastGameUpdate(g.id);
  });

  // Weekday AP — random time daily
  scheduleRandomDaily(() => {
    if (isWeekday()) {
      console.log('[scheduler] Distributing weekday AP...');
      giveWeekdayAPToAll();
      // Re-schedule bot turns: bots "wake up" and decide what to do with new AP
      const games = db.prepare('SELECT id FROM games WHERE status=\'active\'').all();
      for (const g of games) {
        scheduleBotTurns(g.id);  // reset their act-after window for the new day
      }
    }
  }, 'Weekday AP');

  // Daily item spawns — random time
  scheduleRandomDaily(() => {
    console.log('[scheduler] Spawning daily items...');
    spawnDailyItemsForAll();
  }, 'Daily spawns');

  // Random loot drop — 2x daily at random times
  cron.schedule('0 */12 * * *', () => {
    const delay = randomDelay(0, 6 * 60 * 60 * 1000);
    setTimeout(() => {
      const { spawnItem } = require('./logic');
      const games = db.prepare('SELECT id FROM games WHERE status=\'active\'').all();
      for (const g of games) {
        spawnItem(g.id, 'loot', 3);
        broadcastGameUpdate(g.id);
      }
    }, delay);
  });

  console.log('[scheduler] Cron jobs initialised');
}

module.exports = { init, setIO, broadcastGameUpdate };
