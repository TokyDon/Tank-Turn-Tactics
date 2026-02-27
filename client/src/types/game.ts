export interface User {
  id: string;
  username: string;
}

export interface BoardItem {
  id: string;
  type: 'heart' | 'loot';
  x: number;
  y: number;
  value: number;
}

export interface GamePlayer {
  userId: string;
  username: string;
  x: number;
  y: number;
  hearts: number;
  extraHearts: number | null; // only visible to self
  ap: number | null; // secret — only visible to self
  range: number;
  isDowned: boolean;
  canRevive: boolean;
  hasTakenPrimary: boolean;
  hasTakenTurn: boolean;
  isHaunted: boolean;
  color: string;
  isMe: boolean;
  isBot: boolean;
  botDifficulty: 'private' | 'major' | 'general' | null;
}

export interface GameLog {
  type: string;
  message: string;
  turn: number;
  at: number;
}

export interface JuryVote {
  vote_type: 'haunting' | 'intercession';
  target_id: string;
}

export interface GameState {
  id: string;
  name: string;
  status: 'lobby' | 'active' | 'ended';
  gridSize: number;
  activeGridSize: number;
  currentTurn: number;
  turnStartedAt: number | null;
  shrinkEnabled: boolean;
  players: GamePlayer[];
  items: BoardItem[];
  logs: GameLog[];
  myVotes: JuryVote[] | null;
}

export interface PublicGame {
  id: string;
  name: string;
  status: 'lobby' | 'active' | 'ended';
  grid_size: number;
  max_players: number;
  player_count: number;
  host_name: string;
  created_at: number;
}

export type PrimaryActionType = 'move' | 'attack' | 'addHeart' | 'upgradeRange' | 'idle';
export type SecondaryActionType = 'giveHeart' | 'giveAP' | 'idle';

export interface PrimaryAction {
  type: PrimaryActionType;
  x?: number;
  y?: number;
  targetUserId?: string;
}

export interface SecondaryAction {
  type: SecondaryActionType;
  targetUserId?: string;
  amount?: number;
}
