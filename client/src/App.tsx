import { useState } from 'react';
import { useGame } from './context/GameContext';
import Login from './components/Auth/Login';
import Lobby from './components/Lobby/Lobby';
import Game from './components/Game/Game';
import Chat from './components/Chat/Chat';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const { user, game } = useGame();
  const [view, setView] = useState<'lobby' | 'game'>('lobby');

  if (!user) return <Login />;
  return (
    <ErrorBoundary>
      {game && view === 'game'
        ? <Game onLeave={() => setView('lobby')} />
        : <Lobby onEnterGame={() => setView('game')} />
      }
      <Chat />
    </ErrorBoundary>
  );
}
