import type { GameState, PublicGame, PrimaryAction, SecondaryAction, Message, Conversation } from '../types/game';

const BASE = '/api';

/** Structured API error — carries the full JSON response body so callers can
 *  inspect extra fields (e.g. `suggestions` on a 409 username conflict). */
export class ApiError extends Error {
  data: Record<string, unknown>;
  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.data = data;
  }
}

function getToken(): string | null {
  return localStorage.getItem('ttt_token');
}

function headers(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: headers() });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Request failed', data);
  return data as T;
}

// Auth
export const register = (username: string, password: string) =>
  request<{ token: string; user: { id: string; username: string }; recoveryCodes: string[] }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

export const login = (username: string, password: string) =>
  request<{ token: string; user: { id: string; username: string } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

export const getMe = () =>
  request<{ user: { id: string; username: string } }>('/auth/me');

export const recoverAccount = (username: string, code: string, newPassword: string) =>
  request<{ token: string; user: { id: string; username: string } }>('/auth/recover', {
    method: 'POST',
    body: JSON.stringify({ username, code, newPassword })
  });

// Games
export const getGames = () =>
  request<{ games: PublicGame[] }>('/games');

export const createGame = (name: string, options: {
  gridSize?: number; maxPlayers?: number; shrinkEnabled?: boolean; password?: string;
}) =>
  request<{ game: GameState }>('/games', {
    method: 'POST',
    body: JSON.stringify({ name, ...options })
  });

export const getGame = (id: string) =>
  request<{ game: GameState }>(`/games/${id}`);

export const joinGame = (id: string, password?: string) =>
  request<{ game: GameState }>(`/games/${id}/join`, {
    method: 'POST',
    body: JSON.stringify({ password: password || undefined })
  });

export const deleteGame = (id: string) =>
  request<{ deleted: boolean }>(`/games/${id}`, { method: 'DELETE' });

export const startGame = (id: string) =>
  request<{ game: GameState }>(`/games/${id}/start`, { method: 'POST' });

// Actions
export const takePrimaryAction = (
  gameId: string,
  primaryAction: PrimaryAction
) =>
  request<{ game: GameState }>(`/games/${gameId}/primary-action`, {
    method: 'POST',
    body: JSON.stringify({ primaryAction })
  });

export const takeSecondaryAction = (
  gameId: string,
  secondaryAction: SecondaryAction | null
) =>
  request<{ game: GameState }>(`/games/${gameId}/secondary-action`, {
    method: 'POST',
    body: JSON.stringify({ secondaryAction: secondaryAction || { type: 'idle' } })
  });

// Legacy combined action (kept for compatibility)
export const takeAction = (
  gameId: string,
  primaryAction: PrimaryAction,
  secondaryAction?: SecondaryAction
) =>
  request<{ game: GameState }>(`/games/${gameId}/action`, {
    method: 'POST',
    body: JSON.stringify({ primaryAction, secondaryAction: secondaryAction || { type: 'idle' } })
  });

export const submitVote = (gameId: string, targetUserId: string, voteType: 'haunting' | 'intercession') =>
  request<{ success: boolean }>(`/games/${gameId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ targetUserId, voteType })
  });

export const addBot = (gameId: string, difficulty: 'private' | 'major' | 'general') =>
  request<{ game: import('../types/game').GameState }>(`/games/${gameId}/bots`, {
    method: 'POST',
    body: JSON.stringify({ difficulty })
  });

export const forceAdvanceTurn = (gameId: string) =>
  request<{ game: GameState }>(`/games/${gameId}/admin/force-turn`, { method: 'POST' });

// Game settings (host-only, lobby only)
export const updateGameSettings = (gameId: string, settings: { gridSize?: number; shrinkEnabled?: boolean }) =>
  request<{ game: GameState }>(`/games/${gameId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });

// Messages
export const sendMessage = (recipientId: string, content: string, gameId?: string) =>
  request<{ message: Message }>('/messages', {
    method: 'POST',
    body: JSON.stringify({ recipientId, content, gameId }),
  });

export const getConversations = () =>
  request<{ conversations: Conversation[] }>('/messages/conversations');

export const getThread = (userId: string) =>
  request<{ messages: Message[] }>(`/messages/thread/${userId}`);

export const markRead = (userId: string) =>
  request<{ ok: boolean }>(`/messages/read/${userId}`, { method: 'POST' });

export const getUnreadCount = () =>
  request<{ count: number }>('/messages/unread-count');
