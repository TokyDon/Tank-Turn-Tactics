import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../../services/socket';
import * as api from '../../services/api';
import type { GameState, User, Message } from '../../types/game';
import './GameChat.css';

interface Props {
  game: GameState;
  user: User;
}

export default function GameChat({ game, user }: Props) {
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [activeUsername, setActiveUsername] = useState('');
  const [thread, setThread] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  // unread counts per player userId
  const [unread, setUnread] = useState<Record<string, number>>({});
  const threadEndRef = useRef<HTMLDivElement>(null);

  const humanPlayers = game.players.filter(p => p.userId !== user.id && !p.isBot);

  // --- Real-time incoming messages ---
  useEffect(() => {
    const socket = getSocket();
    const handle = (msg: Message) => {
      if (msg.recipientId !== user.id) return;
      if (activeUserId === msg.senderId) {
        // Thread is open — append and mark read
        setThread(prev => [...prev, msg]);
        api.markRead(msg.senderId).catch(() => {});
      } else {
        setUnread(prev => ({ ...prev, [msg.senderId]: (prev[msg.senderId] ?? 0) + 1 }));
      }
    };
    socket.on('new-message', handle);
    return () => { socket.off('new-message', handle); };
  }, [user.id, activeUserId]);

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
      const { messages } = await api.getThread(userId);
      setThread(messages);
      await api.markRead(userId);
      setUnread(prev => { const next = { ...prev }; delete next[userId]; return next; });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSend = async () => {
    if (!draft.trim() || !activeUserId || sending) return;
    setSending(true);
    const text = draft.trim();
    setDraft('');
    try {
      const { message } = await api.sendMessage(activeUserId, text, game.id);
      setThread(prev => [...prev, message]);
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

  // --- Player list view ---
  return (
    <div className="gchat-screen">
      {humanPlayers.length === 0 ? (
        <div className="gchat-no-players tactical">NO HUMAN OPERATIVES IN THIS OPERATION</div>
      ) : (
        <div className="gchat-player-list">
          {humanPlayers.map(p => {
            const count = unread[p.userId] ?? 0;
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
                {count > 0 && <span className="gchat-unread-badge">{count}</span>}
                <span className="gchat-chevron tactical">›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
