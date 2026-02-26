import { useState } from 'react';
import { useGame } from './context/GameContext';
import Login from './components/Auth/Login';
import Lobby from './components/Lobby/Lobby';
import Game from './components/Game/Game';

export default function App() {
  const { user, game } = useGame();
  const [view, setView] = useState<'lobby' | 'game'>('lobby');

  if (!user) return <Login />;
  if (game && view === 'game') return <Game onLeave={() => setView('lobby')} />;
  return <Lobby onEnterGame={() => setView('game')} />;
}
