import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { GameState, User } from '../types/game';
import * as api from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';

interface GameContextValue {
  user: User | null;
  token: string | null;
  game: GameState | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<string[]>;
  logout: () => void;
  loadGame: (id: string) => Promise<void>;
  clearGame: () => void;
  refreshGame: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ttt_token'));
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentGameId = useRef<string | null>(null);

  // Restore session
  useEffect(() => {
    if (token) {
      api.getMe()
        .then(({ user: u }) => {
          setUser(u);
          // Restore last active game
          const savedGameId = localStorage.getItem('ttt_game_id');
          if (savedGameId) {
            api.getGame(savedGameId)
              .then(({ game: g }) => {
                setGame(g);
                currentGameId.current = savedGameId;
                getSocket().emit('join-game', savedGameId);
              })
              .catch(() => localStorage.removeItem('ttt_game_id'));
          }
        })
        .catch(() => { setToken(null); localStorage.removeItem('ttt_token'); });
    }
  }, [token]);

  // Set up socket listener for game updates
  useEffect(() => {
    if (!token) return;
    const socket = getSocket();

    socket.on('game-state', (state: GameState) => {
      setGame(state);
    });

    socket.on('game-state-changed', ({ gameId }: { gameId: string }) => {
      if (currentGameId.current === gameId) {
        api.getGame(gameId).then(({ game: g }) => setGame(g)).catch(() => {});
      }
    });

    return () => {
      socket.off('game-state');
      socket.off('game-state-changed');
    };
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const { token: t, user: u } = await api.login(username, password);
      localStorage.setItem('ttt_token', t);
      setToken(t);
      setUser(u);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (username: string, password: string): Promise<string[]> => {
    setLoading(true);
    setError(null);
    try {
      const { token: t, user: u, recoveryCodes } = await api.register(username, password);
      localStorage.setItem('ttt_token', t);
      setToken(t);
      setUser(u);
      return recoveryCodes;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ttt_token');
    localStorage.removeItem('ttt_game_id');
    setToken(null);
    setUser(null);
    setGame(null);
    currentGameId.current = null;
    disconnectSocket();
  }, []);

  const loadGame = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { game: g } = await api.getGame(id);
      setGame(g);
      currentGameId.current = id;
      localStorage.setItem('ttt_game_id', id);
      const socket = getSocket();
      socket.emit('join-game', id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearGame = useCallback(() => {
    if (currentGameId.current) {
      const socket = getSocket();
      socket.emit('leave-game', currentGameId.current);
    }
    setGame(null);
    currentGameId.current = null;
    localStorage.removeItem('ttt_game_id');
  }, []);

  const refreshGame = useCallback(async () => {
    if (!currentGameId.current) return;
    try {
      const { game: g } = await api.getGame(currentGameId.current);
      setGame(g);
    } catch {/* silent */}
  }, []);

  return (
    <GameContext.Provider value={{ user, token, game, loading, error, login, register, logout, loadGame, clearGame, refreshGame }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
