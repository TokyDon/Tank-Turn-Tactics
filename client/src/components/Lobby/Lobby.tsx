import { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import * as api from '../../services/api';
import type { PublicGame } from '../../types/game';
import './Lobby.css';

interface Props { onEnterGame: () => void; }

export default function Lobby({ onEnterGame }: Props) {
  const { user, logout, loadGame, game } = useGame();
  const [games, setGames] = useState<PublicGame[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [gridSize, setGridSize] = useState(16);
  const [maxPlayers, setMaxPlayers] = useState(16);
  const [shrinkEnabled, setShrinkEnabled] = useState(false);
  const [loadingAction, setLoadingAction] = useState('');
  const [error, setError] = useState('');
  // Join password prompt
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    loadGames();
    const interval = setInterval(loadGames, 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadGames() {
    try {
      const { games: g } = await api.getGames();
      setGames(g);
    } catch { /* silent */ }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoadingAction('create');
    try {
      const { game: g } = await api.createGame(newName, {
        gridSize, maxPlayers, shrinkEnabled,
        password: newPassword.trim() || undefined,
      });
      await loadGame(g.id);
      onEnterGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoadingAction('');
    }
  }

  async function handleJoin(id: string, password?: string) {
    setError('');
    setLoadingAction(id);
    try {
      await api.joinGame(id, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'PASSWORD_REQUIRED') {
        setJoinTarget(id);
        setJoinPassword('');
        setLoadingAction('');
        return;
      }
      if (msg === 'Already in this game' || msg === 'Game already started') {
        try {
          await loadGame(id);
          onEnterGame();
        } catch {
          setError('Failed to rejoin game');
        } finally {
          setLoadingAction('');
        }
        return;
      }
      setError(msg || 'Failed to join');
      setLoadingAction('');
      return;
    }
    try {
      setJoinTarget(null);
      await loadGame(id);
      onEnterGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    } finally {
      setLoadingAction('');
    }
  }

  async function handleDelete(id: string) {
    setLoadingAction('delete-' + id);
    try {
      await api.deleteGame(id);
      setDeleteTarget(null);
      await loadGames();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setLoadingAction('');
    }
  }

  async function handleRejoin(id: string) {
    setLoadingAction(id);
    try {
      await loadGame(id);
      onEnterGame();
    } catch { /* silent */ } finally {
      setLoadingAction('');
    }
  }

  const myActiveGame = game;

  return (
    <div className="lobby-screen">
      <header className="lobby-header">
        <div>
          <h1 className="lobby-title display">TANK TURN TACTICS</h1>
          <p className="lobby-callsign tactical">CDR {user?.username?.toUpperCase()}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>LOG OUT</button>
      </header>

      <div className="lobby-body">
        {error && <div className="error-msg">{error}</div>}

        {/* Rejoin active game */}
        {myActiveGame && (
          <div className="rejoin-banner card">
            <div className="rejoin-info">
              <span className="tag tag-amber">ACTIVE</span>
              <span className="rejoin-name">{myActiveGame.name}</span>
              <span className="rejoin-turn tactical">TURN {myActiveGame.currentTurn}</span>
            </div>
            <button
              className="btn btn-amber btn-sm"
              onClick={() => onEnterGame()}
            >
              RETURN
            </button>
          </div>
        )}

        {/* Create game */}
        <section className="lobby-section">
          <div className="section-header">
            <h2 className="section-title display">OPERATIONS</h2>
            <button
              className={`btn btn-sm ${showCreate ? 'btn-ghost' : 'btn-amber'}`}
              onClick={() => setShowCreate(v => !v)}
            >
              {showCreate ? 'CANCEL' : '+ NEW OP'}
            </button>
          </div>

          {showCreate && (
            <form className="create-form card" onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label tactical">OPERATION NAME</label>
                <input
                  className="input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Name your operation..."
                  maxLength={40}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label tactical">ACCESS CODE (OPTIONAL)</label>
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Leave blank for open access..."
                  maxLength={64}
                />
              </div>
              <div className="create-grid-options">
                <div className="form-group">
                  <label className="form-label tactical">GRID SIZE</label>
                  <select
                    className="input"
                    value={gridSize}
                    onChange={e => setGridSize(Number(e.target.value))}
                  >
                    {[6,8,10,12,14,16].map(n => (
                      <option key={n} value={n}>{n}×{n}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label tactical">MAX PLAYERS</label>
                  <select
                    className="input"
                    value={maxPlayers}
                    onChange={e => setMaxPlayers(Number(e.target.value))}
                  >
                    {[2,4,6,8,10,12,14,16].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="shrink-toggle">
                <input
                  type="checkbox"
                  checked={shrinkEnabled}
                  onChange={e => setShrinkEnabled(e.target.checked)}
                />
                <span className="shrink-label tactical">ENABLE SHRINKING GRID (every 3 turns)</span>
              </label>
              <button
                type="submit"
                className="btn btn-amber btn-full"
                disabled={!!loadingAction || !newName}
              >
                {loadingAction === 'create' ? 'DEPLOYING...' : 'DEPLOY OPERATION'}
              </button>
            </form>
          )}
        </section>

        {/* Game list */}
        <section className="lobby-section">
          <div className="section-header">
            <h2 className="section-title display">ACTIVE BATTLEFIELDS</h2>
            <button className="btn btn-ghost btn-sm" onClick={loadGames}>↻</button>
          </div>

          {games.length === 0 ? (
            <div className="empty-state card">
              <span className="empty-icon tactical">◫</span>
              <p className="empty-text">No active operations. Deploy one.</p>
            </div>
          ) : (
            <div className="game-list">
              {games.map(g => {
                const isOwn = g.host_name.toLowerCase() === user?.username?.toLowerCase();
                const isMyGame = myActiveGame?.id === g.id;
                const showDeleteConfirm = deleteTarget === g.id;
                const showJoinPrompt = joinTarget === g.id;
                return (
                  <div key={g.id} className={`game-row card${showDeleteConfirm ? ' delete-confirm-open' : ''}`}>
                    <div className="game-row-info">
                      <div className="game-row-top">
                        <span className="game-name">
                          {g.has_password && <span className="lock-icon" title="Access code required">🔒 </span>}
                          {g.name}
                        </span>
                        <span className={`tag ${g.status === 'active' ? 'tag-amber' : g.status === 'ended' ? 'tag-muted' : 'tag-green'}`}>
                          {g.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="game-row-meta tactical">
                        <span>HOST: {g.host_name.toUpperCase()}</span>
                        <span>·</span>
                        <span>{g.player_count}/{g.max_players} UNITS</span>
                        <span>·</span>
                        <span>{g.grid_size}×{g.grid_size}</span>
                      </div>
                    </div>

                    {/* Join / return button */}
                    {g.status !== 'ended' && !showDeleteConfirm && (
                      <button
                        className="btn btn-amber btn-sm"
                        disabled={!!loadingAction}
                        onClick={() => {
                          if (isMyGame) handleRejoin(g.id);
                          else handleJoin(g.id);
                        }}
                      >
                        {loadingAction === g.id ? '...' : isMyGame ? 'RETURN' : 'JOIN'}
                      </button>
                    )}

                    {/* Host delete button */}
                    {isOwn && !showDeleteConfirm && (
                      <button
                        className="btn btn-ghost btn-sm btn-danger-outline"
                        disabled={!!loadingAction}
                        onClick={() => setDeleteTarget(g.id)}
                        title="Delete operation"
                      >
                        ✕
                      </button>
                    )}

                    {/* Inline password prompt */}
                    {showJoinPrompt && (
                      <div className="join-password-row">
                        <input
                          className="input input-sm"
                          type="password"
                          placeholder="Enter access code..."
                          value={joinPassword}
                          onChange={e => setJoinPassword(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleJoin(g.id, joinPassword)}
                          autoFocus
                        />
                        <button
                          className="btn btn-amber btn-sm"
                          disabled={!!loadingAction || !joinPassword}
                          onClick={() => handleJoin(g.id, joinPassword)}
                        >
                          {loadingAction === g.id ? '...' : 'ENTER'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setJoinTarget(null); setJoinPassword(''); }}>
                          CANCEL
                        </button>
                      </div>
                    )}

                    {/* Delete confirmation */}
                    {showDeleteConfirm && (
                      <div className="delete-confirm-row">
                        {g.status === 'active' && (
                          <div className="delete-warning tactical">⚠ THIS OPERATION IS ACTIVE — ALL PROGRESS WILL BE LOST</div>
                        )}
                        <div className="delete-confirm-msg">Permanently delete “{g.name}”?</div>
                        <div className="delete-confirm-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(null)}>CANCEL</button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={loadingAction === 'delete-' + g.id}
                            onClick={() => handleDelete(g.id)}
                          >
                            {loadingAction === 'delete-' + g.id ? 'DELETING...' : 'DELETE OPERATION'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
