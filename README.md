# Tank Turn Tactics

A persistent multiplayer turn-based strategy game. Players control tanks on a grid, spending Action Points each turn to move, attack, upgrade, and outlast opponents.

## Features

- Persistent online multiplayer via Socket.io
- Shrinking grid mechanics
- Daily AP grants (weekdays only)
- Bot opponents — Private / Major / General difficulty
- Haunting mechanic (downed players vote on the living)
- Mobile-first responsive UI

## Stack

| Layer | Technology |
|---|---|
| Client | React 19 + TypeScript + Vite |
| Server | Node.js + Express + Socket.io |
| Database | SQLite (node:sqlite) |
| Auth | JWT + bcryptjs |

## Development

```bash
# Server
cd server && npm install && npm run dev

# Client (separate terminal)
cd client && npm install && npm run dev
```

Server runs on `http://localhost:3001`  
Client runs on `http://localhost:5173`

## Environment Variables

Copy `server/.env.example` to `server/.env` and fill in:

```
JWT_SECRET=your-secret-here
PORT=3001
```
