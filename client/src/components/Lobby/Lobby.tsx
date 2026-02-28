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
  // Inline settings editor
  const [settingsTarget, setSettingsTarget] = useState<string | null>(null);
  const [pendingGridSize, setPendingGridSize] = useState(16);
  const [pendingShrink, setPendingShrink] = useState(false);
  const [openParticipating, setOpenParticipating] = useState(true);
  const [openLobbies, setOpenLobbies] = useState(true);
  const [openBattlefields, setOpenBattlefields] = useState(false);

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

  async function handleUpdateSettings(id: string) {
    setLoadingAction('settings-' + id);
    try {
      await api.updateGameSettings(id, { gridSize: pendingGridSize, shrinkEnabled: pendingShrink });
      setSettingsTarget(null);
      await loadGames();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
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

  const participatingGames = games.filter(g => g.status === 'active' && g.is_player);
  const lobbyGames = games.filter(g => g.status === 'lobby');
  const battlefieldGames = games.filter(g => g.status === 'active' && !g.is_player);

  function renderRow(g: PublicGame, section: 'participating' | 'lobby' | 'battlefield') {
    const isOwn = g.host_name.toLowerCase() === user?.username?.toLowerCase();
    const showDeleteConfirm = deleteTarget === g.id;
    const showJoinPrompt = joinTarget === g.id;
    return (
      <div key={g.id} className={`game-row card status-${g.status}${showDeleteConfirm ? ' delete-confirm-open' : ''}`}>
        <div className="game-row-info">
          <div className="game-row-top">
            <span className="game-name">
              {g.has_password && <span className="lock-icon" title="Access code required">🔒 </span>}
              {g.name}
            </span>
          </div>
          <div className="game-row-meta tactical">
            <span className={`tag tag-xs ${g.status === 'active' ? 'tag-amber' : 'tag-green'}`}>
              {g.status.toUpperCase()}
            </span>
            <span>·</span>
            <span>HOST: {g.host_name.toUpperCase()}</span>
            <span>·</span>
            <span>{g.player_count}/{g.max_players} UNITS</span>
            <span>·</span>
            <span>{g.grid_size}×{g.grid_size}</span>
          </div>
        </div>

        {/* PARTICIPATING: RETURN */}
        {section === 'participating' && !showDeleteConfirm && (
          <button className="btn btn-amber btn-sm" disabled={!!loadingAction} onClick={() => handleRejoin(g.id)}>
            {loadingAction === g.id ? '...' : 'RETURN'}
          </button>
        )}

        {/* LOBBY: JOIN / RETURN */}
        {section === 'lobby' && !showDeleteConfirm && (
          <button
            className="btn btn-amber btn-sm"
            disabled={!!loadingAction}
            onClick={() => { if (myActiveGame?.id === g.id) handleRejoin(g.id); else handleJoin(g.id); }}
          >
            {loadingAction === g.id ? '...' : myActiveGame?.id === g.id ? 'RETURN' : 'JOIN'}
          </button>
        )}

        {/* BATTLEFIELD: SPECTATE */}
        {section === 'battlefield' && (
          <button className="btn btn-ghost btn-sm" disabled={!!loadingAction} onClick={() => handleRejoin(g.id)}>
            {loadingAction === g.id ? '...' : 'SPECTATE'}
          </button>
        )}

        {/* Host settings button (lobby only) */}
        {section === 'lobby' && isOwn && !showDeleteConfirm && (
          <button
            className={`btn btn-ghost btn-sm${settingsTarget === g.id ? ' btn-active' : ''}`}
            disabled={!!loadingAction}
            onClick={() => {
              if (settingsTarget === g.id) {
                setSettingsTarget(null);
              } else {
                setSettingsTarget(g.id);
                setPendingGridSize(g.grid_size);
                setPendingShrink(g.shrink_enabled);
              }
            }}
            title="Edit settings"
          >⚙</button>
        )}

        {/* Host delete button */}
        {section !== 'battlefield' && isOwn && !showDeleteConfirm && (
          <button
            className="btn btn-ghost btn-sm btn-danger-outline"
            disabled={!!loadingAction}
            onClick={() => setDeleteTarget(g.id)}
            title="Delete operation"
          >✕</button>
        )}

        {/* Inline settings editor */}
        {section === 'lobby' && settingsTarget === g.id && (
          <div className="settings-row">
            <div className="settings-row-fields">
              <div className="form-group form-group--inline">
                <label className="form-label tactical">GRID</label>
                <select className="input input-sm" value={pendingGridSize} onChange={e => setPendingGridSize(Number(e.target.value))}>
                  {[6,8,10,12,14,16,20].map(n => (<option key={n} value={n}>{n}×{n}</option>))}
                </select>
              </div>
              <label className="shrink-toggle shrink-toggle--compact">
                <input type="checkbox" checked={pendingShrink} onChange={e => setPendingShrink(e.target.checked)} />
                <span className="shrink-label tactical">SHRINK</span>
              </label>
            </div>
            <div className="settings-row-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setSettingsTarget(null)}>CANCEL</button>
              <button className="btn btn-amber btn-sm" disabled={loadingAction === 'settings-' + g.id} onClick={() => handleUpdateSettings(g.id)}>
                {loadingAction === 'settings-' + g.id ? 'SAVING...' : 'SAVE'}
              </button>
            </div>
          </div>
        )}

        {/* Inline password prompt */}
        {section === 'lobby' && showJoinPrompt && (
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
            <button className="btn btn-amber btn-sm" disabled={!!loadingAction || !joinPassword} onClick={() => handleJoin(g.id, joinPassword)}>
              {loadingAction === g.id ? '...' : 'ENTER'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setJoinTarget(null); setJoinPassword(''); }}>CANCEL</button>
          </div>
        )}

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <div className="delete-confirm-row">
            {g.status === 'active' && (
              <div className="delete-warning tactical">⚠ THIS OPERATION IS ACTIVE — ALL PROGRESS WILL BE LOST</div>
            )}
            <div className="delete-confirm-msg">Permanently delete "{g.name}"?</div>
            <div className="delete-confirm-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(null)}>CANCEL</button>
              <button className="btn btn-danger btn-sm" disabled={loadingAction === 'delete-' + g.id} onClick={() => handleDelete(g.id)}>
                {loadingAction === 'delete-' + g.id ? 'DELETING...' : 'DELETE OPERATION'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

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

        {/* Participating section — active games you're in */}
        {participatingGames.length > 0 && (
          <section className="lobby-section">
            <button className="section-header section-header--toggle" onClick={() => setOpenParticipating(v => !v)}>
              <h2 className="section-title display">PARTICIPATING <span className="section-count tactical">{participatingGames.length}</span></h2>
              <span className="section-chevron">{openParticipating ? '▾' : '▸'}</span>
            </button>
            {openParticipating && (
              <div className="game-list">
                {participatingGames.map(g => renderRow(g, 'participating'))}
              </div>
            )}
          </section>
        )}

        {/* Lobbies section — open games awaiting players */}
        <section className="lobby-section">
          <button className="section-header section-header--toggle" onClick={() => setOpenLobbies(v => !v)}>
            <h2 className="section-title display">LOBBIES <span className="section-count tactical">{lobbyGames.length}</span></h2>
            <span className="section-chevron">{openLobbies ? '▾' : '▸'}</span>
          </button>
          {openLobbies && (
            <>
              {lobbyGames.length === 0 ? (
                <div className="empty-state card">
                  <span className="empty-icon tactical">◫</span>
                  <p className="empty-text">No open lobbies. Deploy one above.</p>
                </div>
              ) : (
                <div className="game-list">
                  {lobbyGames.map(g => renderRow(g, 'lobby'))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Active battlefields — ongoing games to spectate */}
        {battlefieldGames.length > 0 && (
          <section className="lobby-section">
            <button className="section-header section-header--toggle" onClick={() => setOpenBattlefields(v => !v)}>
              <h2 className="section-title display">ACTIVE BATTLEFIELDS <span className="section-count tactical">{battlefieldGames.length}</span></h2>
              <span className="section-chevron">{openBattlefields ? '▾' : '▸'}</span>
            </button>
            {openBattlefields && (
              <div className="game-list">
                {battlefieldGames.map(g => renderRow(g, 'battlefield'))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
