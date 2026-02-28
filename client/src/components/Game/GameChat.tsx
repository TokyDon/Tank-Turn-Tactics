import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../../services/socket';
import * as api from '../../services/api';
import type { GameState, User, Message } from '../../types/game';
import './GameChat.css';

interface Props {
  game: GameState;
  user: User;
  onUnreadChange?: (total: number) => void;
  openUserId?: string;
  openUsername?: string;
}

interface ConvInfo { lastAt: number; unread: number; }

export default function GameChat({ game, user, onUnreadChange, openUserId, openUsername }: Props) {
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [activeUsername, setActiveUsername] = useState('');
  const [thread, setThread] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  // per-player: last message timestamp + unread count
  const [convInfo, setConvInfo] = useState<Record<string, ConvInfo>>({});
  const threadEndRef = useRef<HTMLDivElement>(null);

  const humanPlayers = game.players.filter(p => p.userId !== user.id && !p.isBot);

  // --- Load conversations on mount to seed sort order + unread counts ---
  useEffect(() => {
    api.getConversations(game.id).then(({ conversations }) => {
      setConvInfo(prev => {
        const next = { ...prev };
        for (const c of conversations) {
          next[c.userId] = {
            lastAt: c.lastAt,
            unread: c.unreadCount,
          };
        }
        return next;
      });
    }).catch(() => {});
  }, [game.id]);

  // --- Notify parent of total unread ---
  useEffect(() => {
    const total = humanPlayers.reduce((sum, p) => sum + (convInfo[p.userId]?.unread ?? 0), 0);
    onUnreadChange?.(total);
  }, [convInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Real-time incoming messages ---
  useEffect(() => {
    const socket = getSocket();
    const handle = (msg: Message) => {
      if (msg.recipientId !== user.id) return;
      if (msg.gameId !== game.id) return;
      if (activeUserId === msg.senderId) {
        setThread(prev => [...prev, msg]);
        api.markRead(msg.senderId, game.id).catch(() => {});
        setConvInfo(prev => ({
          ...prev,
          [msg.senderId]: { lastAt: msg.createdAt, unread: 0 },
        }));
      } else {
        setConvInfo(prev => ({
          ...prev,
          [msg.senderId]: {
            lastAt: msg.createdAt,
            unread: (prev[msg.senderId]?.unread ?? 0) + 1,
          },
        }));
      }
    };
    socket.on('new-message', handle);
    return () => { socket.off('new-message', handle); };
  }, [user.id, game.id, activeUserId]);

  // --- Scroll to bottom when thread changes ---
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  const openThread = useCallback(async (userId: string, username: string) => {
    setActiveUserId(userId);
    setActiveUsername(username);
    setThread([]);
    setLoading(true);
    try {
      const { messages } = await api.getThread(userId, game.id);
      setThread(messages);
      await api.markRead(userId, game.id);
      setConvInfo(prev => ({
        ...prev,
        [userId]: { lastAt: prev[userId]?.lastAt ?? 0, unread: 0 },
      }));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [game.id]);

  // Auto-open thread when navigated from grid popup
  useEffect(() => {
    if (openUserId && openUsername) {
      openThread(openUserId, openUsername);
    }
  }, [openUserId, openUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async () => {
    if (!draft.trim() || !activeUserId || sending) return;
    setSending(true);
    const text = draft.trim();
    setDraft('');
    try {
      const { message } = await api.sendMessage(activeUserId, text, game.id);
      setThread(prev => [...prev, message]);
      setConvInfo(prev => ({
        ...prev,
        [activeUserId]: { lastAt: message.createdAt, unread: prev[activeUserId]?.unread ?? 0 },
      }));
    } catch {
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // --- Thread view ---
  if (activeUserId) {
    return (
      <div className="gchat-screen">
        <div className="gchat-thread-header">
          <button className="btn btn-ghost btn-sm" onClick={() => { setActiveUserId(null); setThread([]); }}>
            ← BACK
          </button>
          <span className="gchat-thread-name tactical">↯ {activeUsername.toUpperCase()}</span>
        </div>
        <div className="gchat-messages">
          {loading ? (
            <span className="gchat-empty tactical">LOADING...</span>
          ) : thread.length === 0 ? (
            <span className="gchat-empty tactical">START THE CONVERSATION</span>
          ) : (
            thread.map(msg => (
              <div key={msg.id} className={`gchat-msg${msg.senderId === user.id ? ' gchat-msg--mine' : ''}`}>
                <div className="gchat-msg-content">{msg.content}</div>
                <div className="gchat-msg-time tactical">{formatTime(msg.createdAt)}</div>
              </div>
            ))
          )}
          <div ref={threadEndRef} />
        </div>
        <div className="gchat-input-row">
          <input
            className="input gchat-input"
            placeholder="Message..."
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            maxLength={500}
            autoFocus
          />
          <button
            className="btn btn-amber btn-sm"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
          >
            ↑
          </button>
        </div>
      </div>
    );
  }

  // Sort players: those with conversations newest-first, then the rest alphabetically
  const sortedPlayers = [...humanPlayers].sort((a, b) => {
    const aLast = convInfo[a.userId]?.lastAt ?? 0;
    const bLast = convInfo[b.userId]?.lastAt ?? 0;
    if (bLast !== aLast) return bLast - aLast;
    return a.username.localeCompare(b.username);
  });

  // --- Player list view ---
  return (
    <div className="gchat-screen">
      {sortedPlayers.length === 0 ? (
        <div className="gchat-no-players tactical">NO HUMAN OPERATIVES IN THIS OPERATION</div>
      ) : (
        <div className="gchat-player-list">
          {sortedPlayers.map(p => {
            const info = convInfo[p.userId];
            const count = info?.unread ?? 0;
            return (
              <button
                key={p.userId}
                className="gchat-player-row card"
                onClick={() => openThread(p.userId, p.username)}
              >
                <span className="gchat-player-dot" style={{ background: p.color }} />
                <div className="gchat-player-info">
                  <span className="gchat-player-name">{p.username}</span>
                  {p.isDowned && <span className="tag tag-red">KIA</span>}
                </div>
                <div className="gchat-player-meta">
                  {info?.lastAt ? <span className="gchat-last-time tactical">{formatTime(info.lastAt)}</span> : null}
                  {count > 0 && <span className="gchat-unread-badge">{count}</span>}
                </div>
                <span className="gchat-chevron tactical">›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
