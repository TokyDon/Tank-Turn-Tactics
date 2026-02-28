import { useState, useEffect, useRef, useCallback } from 'react';
import { useGame } from '../../context/GameContext';
import { getSocket } from '../../services/socket';
import * as api from '../../services/api';
import type { Message, Conversation } from '../../types/game';
import './Chat.css';

export default function Chat() {
  const { user, game } = useGame();
  const [open, setOpen] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<string | null>(null); // userId
  const [activeUsername, setActiveUsername] = useState('');
  const [thread, setThread] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // --- Socket listener for incoming messages ---
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();

    const handleNewMessage = (msg: Message) => {
      // Update unread badge
      if (msg.recipientId === user.id) {
        // If we have this conversation open, don't bump unread (mark it read immediately)
        if (open && activeConvo === msg.senderId) {
          api.markRead(msg.senderId).catch(() => {});
          setThread(prev => [...prev, msg]);
        } else {
          setUnreadTotal(prev => prev + 1);
          setConversations(prev => {
            const existing = prev.find(c => c.userId === msg.senderId);
            if (existing) {
              return prev.map(c =>
                c.userId === msg.senderId
                  ? { ...c, lastMessage: msg.content, lastAt: msg.createdAt, unreadCount: c.unreadCount + 1 }
                  : c
              ).sort((a, b) => b.lastAt - a.lastAt);
            } else {
              return [
                { userId: msg.senderId, username: msg.senderUsername, lastMessage: msg.content, lastAt: msg.createdAt, unreadCount: 1 },
                ...prev,
              ];
            }
          });
        }
      }
    };

    socket.on('new-message', handleNewMessage);
    return () => { socket.off('new-message', handleNewMessage); };
  }, [user, open, activeConvo]);

  // --- Initial unread count ---
  useEffect(() => {
    if (!user) return;
    api.getUnreadCount().then(({ count }) => setUnreadTotal(count)).catch(() => {});
  }, [user]);

  // --- Load conversations when panel opens ---
  useEffect(() => {
    if (!open || !user) return;
    api.getConversations()
      .then(({ conversations: c }) => setConversations(c))
      .catch(() => {});
  }, [open, user]);

  // --- Load thread when conversation selected ---
  const openConversation = useCallback(async (userId: string, username: string) => {
    setActiveConvo(userId);
    setActiveUsername(username);
    setShowNewConvo(false);
    setLoadingThread(true);
    try {
      const { messages } = await api.getThread(userId);
      setThread(messages);
      // Mark as read
      await api.markRead(userId);
      // Update local state
      setConversations(prev =>
        prev.map(c => c.userId === userId ? { ...c, unreadCount: 0 } : c)
      );
      setUnreadTotal(prev => Math.max(0, prev - (conversations.find(c => c.userId === userId)?.unreadCount ?? 0)));
    } catch {
      // ignore
    } finally {
      setLoadingThread(false);
    }
  }, [conversations]);

  // --- Scroll to bottom on new messages ---
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  const handleSend = async () => {
    if (!draft.trim() || !activeConvo || sending) return;
    setSending(true);
    const text = draft.trim();
    setDraft('');
    try {
      const { message } = await api.sendMessage(activeConvo, text, game?.id);
      setThread(prev => [...prev, message]);
      setConversations(prev => {
        const existing = prev.find(c => c.userId === activeConvo);
        if (existing) {
          return prev.map(c =>
            c.userId === activeConvo
              ? { ...c, lastMessage: text, lastAt: message.createdAt }
              : c
          ).sort((a, b) => b.lastAt - a.lastAt);
        } else {
          return [
            { userId: activeConvo, username: activeUsername, lastMessage: text, lastAt: message.createdAt, unreadCount: 0 },
            ...prev,
          ];
        }
      });
    } catch {
      setDraft(text); // restore draft on failure
    } finally {
      setSending(false);
    }
  };

  const startNewConvo = (userId: string, username: string) => {
    // Check if conversation already exists
    const existing = conversations.find(c => c.userId === userId);
    if (existing) {
      openConversation(userId, username);
    } else {
      setActiveConvo(userId);
      setActiveUsername(username);
      setThread([]);
      setShowNewConvo(false);
    }
  };

  // Players in current game (excluding self)
  const gamemates = game?.players?.filter(p => p.userId !== user?.id && !p.isBot) ?? [];

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  if (!user) return null;

  return (
    <>
      {/* Floating button */}
      <button
        className={`chat-fab${open ? ' chat-fab--open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Messages"
      >
        <span className="chat-fab-icon">✉</span>
        {!open && unreadTotal > 0 && (
          <span className="chat-fab-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <span className="chat-panel-title tactical">COMMS</span>
            {gamemates.length > 0 && (
              <button
                className="btn btn-amber btn-sm"
                onClick={() => { setShowNewConvo(v => !v); setActiveConvo(null); }}
              >
                {showNewConvo ? 'BACK' : '+ NEW'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="chat-panel-body">
            {/* Left: conversation list */}
            <div className="chat-convo-list">
              {showNewConvo ? (
                <div className="chat-new-convo">
                  <p className="chat-list-empty tactical">SELECT OPERATIVE</p>
                  {gamemates.map(p => (
                    <button
                      key={p.userId}
                      className="chat-convo-item"
                      onClick={() => startNewConvo(p.userId, p.username)}
                    >
                      <span className="chat-convo-name">{p.username.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              ) : conversations.length === 0 ? (
                <p className="chat-list-empty tactical">NO COMMS YET</p>
              ) : (
                conversations.map(c => (
                  <button
                    key={c.userId}
                    className={`chat-convo-item${activeConvo === c.userId ? ' chat-convo-item--active' : ''}`}
                    onClick={() => openConversation(c.userId, c.username)}
                  >
                    <div className="chat-convo-header">
                      <span className="chat-convo-name">{c.username.toUpperCase()}</span>
                      <span className="chat-convo-time tactical">{formatTime(c.lastAt)}</span>
                    </div>
                    <div className="chat-convo-preview-row">
                      <span className="chat-convo-preview">{c.lastMessage}</span>
                      {c.unreadCount > 0 && (
                        <span className="chat-unread-badge">{c.unreadCount}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Right: thread */}
            <div className="chat-thread">
              {!activeConvo ? (
                <div className="chat-thread-empty">
                  <span className="tactical">SELECT A CONVERSATION</span>
                </div>
              ) : (
                <>
                  <div className="chat-thread-header tactical">
                    ↯ {activeUsername.toUpperCase()}
                  </div>
                  <div className="chat-messages">
                    {loadingThread ? (
                      <span className="tactical chat-loading">LOADING...</span>
                    ) : thread.length === 0 ? (
                      <span className="tactical chat-loading">START THE CONVERSATION</span>
                    ) : (
                      thread.map(msg => (
                        <div
                          key={msg.id}
                          className={`chat-msg${msg.senderId === user.id ? ' chat-msg--mine' : ''}`}
                        >
                          <div className="chat-msg-content">{msg.content}</div>
                          <div className="chat-msg-time tactical">{formatTime(msg.createdAt)}</div>
                        </div>
                      ))
                    )}
                    <div ref={threadEndRef} />
                  </div>
                  <div className="chat-input-row">
                    <input
                      className="input chat-input"
                      placeholder="Message..."
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                      maxLength={500}
                    />
                    <button
                      className="btn btn-amber btn-sm"
                      onClick={handleSend}
                      disabled={!draft.trim() || sending}
                    >
                      ↑
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
